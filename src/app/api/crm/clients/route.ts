import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assigneeScope, canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { PREDEFINED_STATUSES, parseChannel, parseStatus } from "@/lib/reporting";
import {
  addSettingValue,
  countClients,
  createClient,
  databaseErrorMessage,
  deleteClient,
  findClient,
  listClients,
  readSetting,
  removeSettingValue,
  updateClient,
  type ClientPatch,
} from "@/lib/db";
import { prisma } from "@/lib/prisma";

async function allStatuses(): Promise<string[]> {
  const custom = await readSetting("statuses");
  return [...new Set([...PREDEFINED_STATUSES, ...custom])];
}

const actorOf = async (request: NextRequest): Promise<string> =>
  (await getSessionUser(request))?.name ?? "Unknown";
const roleOf = async (request: NextRequest): Promise<string> =>
  (await getSessionUser(request))?.role ?? "Sales";

/**
 * Visitor is read-only. This is the real enforcement — hiding the buttons in the
 * UI would be cosmetic, since any client can call these endpoints directly.
 */
async function readOnlyGuard(request: NextRequest): Promise<NextResponse | null> {
  if (canWrite(await roleOf(request))) return null;
  return NextResponse.json({ error: "Read-only role" }, { status: 403 });
}

const baseSchema = z.object({
  name: z.string().min(2),
  phoneNumber: z.string().min(5),
  status: z.string().min(1),
  project: z.string().min(1),
  location: z.string().min(1),
  acquisitionChannel: z.string().min(1),
  operationToTake: z.string().min(1),
  firstContactPerson: z.string().min(1),
  secondContactPerson: z.string().optional(),
  notes: z.string().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).optional(),
  phoneNumber: z.string().min(5).optional(),
  status: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  acquisitionChannel: z.string().min(1).optional(),
  operationToTake: z.string().optional(),
  firstContactPerson: z.string().optional(),
  secondContactPerson: z.string().optional(),
  notes: z.string().optional(),
  archived: z.boolean().optional(),
});

function filtered(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  return {
    channel: parseChannel(q.get("channel")),
    status: parseStatus(q.get("status")),
    location: q.get("location")?.toLowerCase() || undefined,
    salesperson: q.get("salesperson")?.toLowerCase() || undefined,
    archived: q.get("archived") === "1",
    includeArchived: q.get("includeArchived") === "1",
  };
}

/* ── GET ─────────────────────────────────────────────────────── */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const session = await getSessionUser(request);
    // Sales/CRM only ever see their own book; Admin keeps the full view.
    const clients = await listClients({ ...filtered(request), assignee: assigneeScope(session) });
    const archivedCount = await prisma.client.count({ where: { archived: true } });
    // Reference data for the filter bar. `usage` and `removable` are workspace-wide
    // (matching /api/channels) rather than scoped to the viewer's book, so the delete
    // flow never offers a status that clients elsewhere still depend on.
    const [custom, allClients] = await Promise.all([
      readSetting("statuses"),
      listClients({ includeArchived: true }),
    ]);
    const known = await allStatuses();
    return NextResponse.json({
      source: "postgres",
      clients,
      statuses: known,
      usage: Object.fromEntries(known.map((s) => [s, allClients.filter((c) => c.status === s).length])),
      removable: custom,
      archivedCount,
      role: await roleOf(request),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/* ── POST — create client ───────────────────────────────────── */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const blocked = await readOnlyGuard(request);
  if (blocked) return blocked;
  const parsed = baseSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { notes, ...rest } = parsed.data;
  const acquisitionChannel = parseChannel(rest.acquisitionChannel);
  if (!acquisitionChannel)
    return NextResponse.json({ error: "Invalid acquisition channel" }, { status: 400 });

  try {
    const client = await createClient(
      { ...rest, secondContactPerson: rest.secondContactPerson ?? "", acquisitionChannel, notes },
      await actorOf(request),
    );
    return NextResponse.json({ source: "postgres", client }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/* ── PATCH — update client, archive/restore, log activity ───── */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const blocked = await readOnlyGuard(request);
  if (blocked) return blocked;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id, archived, ...rest } = parsed.data;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (archived !== undefined && (await roleOf(request)) !== "Admin") {
    return NextResponse.json(
      { error: "Only admins can archive or restore clients" },
      { status: 403 },
    );
  }

  try {
    const patch: ClientPatch = { ...rest };

    if (rest.acquisitionChannel !== undefined) {
      const channel = parseChannel(rest.acquisitionChannel);
      if (!channel)
        return NextResponse.json({ error: "Invalid acquisition channel" }, { status: 400 });
      patch.acquisitionChannel = channel;
    }
    if (archived !== undefined) patch.archived = archived;

    const result = await updateClient(id, patch, await actorOf(request));

    if (result.outcome === "not_found")
      return NextResponse.json({ error: "Client not found" }, { status: 404 });

    if (result.outcome === "no_changes") {
      const current = await findClient(id);
      return NextResponse.json({ source: "postgres", client: current });
    }

    return NextResponse.json({ source: "postgres", client: result.client });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/* ── DELETE — admin only ───────────────────────────────────── */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if ((await roleOf(request)) !== "Admin") {
    return NextResponse.json(
      { error: "Only admins can permanently delete clients. Archive it instead." },
      { status: 403 },
    );
  }

  try {
    const deleted = await deleteClient(id);
    if (!deleted) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json({ source: "postgres", deleted: id });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/* ── PUT — custom statuses (workspace-wide, so not read-only) ─── */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const blocked = await readOnlyGuard(request);
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const label = String(body.label ?? "").trim();

  if (action === "add" && !label)
    return NextResponse.json({ error: "Status label required" }, { status: 400 });
  if (action === "add" && (PREDEFINED_STATUSES.includes(label.toUpperCase()) || label.length < 2))
    return NextResponse.json({ error: "Invalid status label" }, { status: 400 });

  try {
    const current = await readSetting("statuses");

    if (action === "add") {
      if (current.includes(label))
        return NextResponse.json({ error: "Status already exists" }, { status: 409 });
      await addSettingValue("statuses", label);
      return NextResponse.json({ ok: true });
    }

    if (action === "remove" && label) {
      // Admin-only, matching channel and location removal: this rewrites shared
      // reference data for the whole workspace.
      if ((await roleOf(request)) !== "Admin") {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
      }
      if (PREDEFINED_STATUSES.includes(label.toUpperCase())) {
        return NextResponse.json({ error: "Cannot remove a built-in status" }, { status: 400 });
      }
      if (!current.includes(label)) {
        return NextResponse.json({ error: "Status not found" }, { status: 404 });
      }
      // Enforced here as well as in the UI: a status still attached to clients
      // must stay in the list, or those clients end up pointing at something that
      // no longer exists anywhere in the app.
      const inUse = await countClients({ status: label });
      if (inUse > 0) {
        return NextResponse.json(
          { error: "Status is still used by existing clients", usage: inUse },
          { status: 409 },
        );
      }
      await removeSettingValue("statuses", label);
      const remaining = await readSetting("statuses");
      return NextResponse.json({
        ok: true,
        statuses: [...PREDEFINED_STATUSES, ...remaining],
        removable: remaining,
      });
    }

    return NextResponse.json({ statuses: current });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
