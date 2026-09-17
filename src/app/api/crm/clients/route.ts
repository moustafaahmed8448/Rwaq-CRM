import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated, unauthorized, getSessionUser } from "@/lib/auth";
import { hasDatabase, prisma } from "@/lib/prisma";
import { parseChannel, parseStatus } from "@/lib/reporting";
import { readClients, writeClients, readCustomStatuses, writeCustomStatuses, createNotification } from "@/lib/storage";
import { ClientData, ActivityEntry, makeActivityEntry, summarizeAction } from "@/lib/types";

const PREDEFINED_STATUSES = ["WAITING", "WON", "LOST"];

function allStatuses(): string[] {
  return [...new Set([...PREDEFINED_STATUSES, ...readCustomStatuses()])];
}

const actorOf = (request: NextRequest): string => getSessionUser(request)?.name ?? "Unknown";
const roleOf = (request: NextRequest): string => getSessionUser(request)?.role ?? "Sales";

const baseSchema = z.object({
  name: z.string().min(2),
  phoneNumber: z.string().min(5),
  status: z.string().min(1),
  project: z.string().min(1),
  location: z.string().min(1),
  acquisitionChannel: z.string().min(1),
  operationToTake: z.string().min(1),
  firstContactPerson: z.string().min(1),
  secondContactPerson: z.string().min(1),
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

const filtered = (request: NextRequest) => {
  const q = request.nextUrl.searchParams;
  return {
    channel: parseChannel(q.get("channel")),
    status: parseStatus(q.get("status")),
    location: q.get("location")?.toLowerCase(),
    salesperson: q.get("salesperson")?.toLowerCase(),
    archived: q.get("archived") === "1",
    includeArchived: q.get("includeArchived") === "1",
  };
};

/* ── GET ─────────────────────────────────────────────────────── */
export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const f = filtered(request);

  const archivedFilter = (c: ClientData) =>
    f.archived ? c.archived === true : (f.includeArchived ? true : !c.archived);

  if (hasDatabase()) {
    const clients = await prisma.client.findMany({
      where: {
        acquisitionChannel: f.channel,
        status: f.status,
        ...(f.location ? { location: { contains: f.location, mode: "insensitive" } } : {}),
        ...(f.salesperson
          ? { OR: [
              { firstContactPerson: { contains: f.salesperson, mode: "insensitive" } },
              { secondContactPerson: { contains: f.salesperson, mode: "insensitive" } },
            ]}
          : {}),
      },
      orderBy: { lastUpdateDate: "desc" },
    });
    return NextResponse.json({ source: "postgres", clients, statuses: allStatuses() });
  }

  // Local storage mode
  const all = readClients();
  const result = all.filter((c) =>
    archivedFilter(c) &&
    (!f.channel || c.acquisitionChannel === f.channel) &&
    ((!f.status || String(f.status) === "ALL" || c.status === f.status)) &&
    (!f.location || c.location.toLowerCase().includes(f.location)) &&
    (!f.salesperson ||
      c.firstContactPerson.toLowerCase().includes(f.salesperson) ||
      c.secondContactPerson.toLowerCase().includes(f.salesperson))
  );
  return NextResponse.json({
    source: "local",
    clients: result,
    statuses: allStatuses(),
    archivedCount: all.filter((c) => c.archived === true).length,
    role: roleOf(request),
  });
}

/* ── POST — create client ───────────────────────────────────── */
export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const parsed = baseSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { notes, ...rest } = parsed.data;
  const acquisitionChannel = parseChannel(rest.acquisitionChannel);
  if (!acquisitionChannel)
    return NextResponse.json({ error: "Invalid acquisition channel" }, { status: 400 });

  const now = new Date().toISOString();
  const actor = actorOf(request);

  if (hasDatabase()) {
    const client = await prisma.client.create({
      data: { ...rest, status: rest.status as any, acquisitionChannel },
    });
    return NextResponse.json({ source: "postgres", client }, { status: 201 });
  }

  const newClient: ClientData = {
    id: `client-${Date.now()}`,
    ...rest,
    status: rest.status,
    acquisitionChannel,
    notes: notes ?? "",
    createdAt: now,
    lastUpdateDate: now,
    activityLog: [
      makeActivityEntry("CREATED", actor, { summary: "Client created" }),
    ],
    customStatuses: readCustomStatuses(),
  };

  const clients = readClients();
  clients.unshift(newClient);
  writeClients(clients);
  return NextResponse.json({ source: "local", client: newClient }, { status: 201 });
}

/* ── PATCH — update client + log activity ──────────────────── */
export async function PATCH(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, archived, ...rest } = parsed.data;
  if (archived !== undefined && roleOf(request) !== "Admin") {
    return NextResponse.json({ error: "Only admins can archive or restore clients" }, { status: 403 });
  }
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const changes: Array<{ field: string; oldVal: string; newVal: string }> = [];
  const actor = actorOf(request);

  if (hasDatabase()) {
    const updates: Record<string, unknown> = {};
    if (rest.name !== undefined) updates.name = rest.name;
    if (rest.phoneNumber !== undefined) updates.phoneNumber = rest.phoneNumber;
    if (rest.project !== undefined) updates.project = rest.project;
    if (rest.location !== undefined) updates.location = rest.location;
    if (rest.operationToTake !== undefined) updates.operationToTake = rest.operationToTake;
    if (rest.firstContactPerson !== undefined) updates.firstContactPerson = rest.firstContactPerson;
    if (rest.secondContactPerson !== undefined) updates.secondContactPerson = rest.secondContactPerson;
    if (rest.status !== undefined) updates.status = rest.status;
    if (rest.acquisitionChannel !== undefined) updates.acquisitionChannel = parseChannel(rest.acquisitionChannel);
    if (rest.notes !== undefined) updates.notes = rest.notes;
    if (archived !== undefined) updates.archived = archived;
    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const client = await prisma.client.update({ where: { id }, data: updates });
    return NextResponse.json({ source: "postgres", client });
  }

  const clients = readClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const existing = clients[idx];
  const updates: Partial<ClientData> = {};

  for (const key of Object.keys(rest) as string[]) {
    if (key === "id") continue;
    const newVal = (rest as any)[key];
    if (newVal === undefined) continue;
    const oldVal = (existing as any)[key];
    if (String(oldVal ?? "") !== String(newVal ?? "")) {
      (updates as any)[key] = newVal;
      const fieldLabel: Record<string, string> = {
        name: "Name", phoneNumber: "Phone", project: "Project",
        location: "Location", status: "Status", acquisitionChannel: "Channel",
        operationToTake: "Operation", firstContactPerson: "1st Contact",
        secondContactPerson: "2nd Contact", notes: "Notes",
      };
      changes.push({ field: fieldLabel[key] ?? key, oldVal: String(oldVal ?? ""), newVal: String(newVal) });
    }
  }

  if (changes.length === 0 && archived === undefined)
    return NextResponse.json({ source: "local", client: existing });

  updates.lastUpdateDate = new Date().toISOString();
  const extraActivity: ActivityEntry[] = [];
  if (archived !== undefined && archived !== (existing.archived === true)) {
    updates.archived = archived;
    updates.archivedAt = archived ? new Date().toISOString() : undefined;
    extraActivity.push(
      makeActivityEntry(archived ? "ARCHIVED" : "RESTORED", actor, {
        summary: archived ? `Client “${existing.name}” archived` : `Client “${existing.name}” restored from archive`,
      })
    );
  }
  updates.activityLog = [...(existing.activityLog ?? []),
    ...extraActivity,
    ...(changes.map((c) =>
      makeActivityEntry(
        c.field === "Status" ? "STATUS_CHANGE" : "FIELD_EDIT",
        actor,
        { field: c.field, oldValue: c.oldVal, newValue: c.newVal, summary: summarizeAction(c.field === "Status" ? "STATUS_CHANGE" : "FIELD_EDIT", c.field, c.oldVal, c.newVal) }
      )
    ))
  ];

  clients[idx] = { ...existing, ...updates } as ClientData;
  writeClients(clients);

  // Notify salespeople who were newly assigned to this client
  for (const c of changes) {
    if ((c.field === "1st Contact" || c.field === "2nd Contact") && c.newVal) {
      createNotification({
        recipient: c.newVal,
        type: "ASSIGNED",
        message: `You were assigned “${existing.name}” as ${c.field.toLowerCase()}`,
        clientId: id,
        clientName: existing.name,
      });
    }
  }

  return NextResponse.json({ source: "local", client: clients[idx] });
}

/* ── DELETE — admin only ───────────────────────────────────── */
export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (roleOf(request) !== "Admin") {
    return NextResponse.json(
      { error: "Only admins can permanently delete clients. Archive it instead." },
      { status: 403 },
    );
  }

  const actor = actorOf(request);

  if (hasDatabase()) {
    await prisma.client.delete({ where: { id } });
    return NextResponse.json({ source: "postgres", deleted: id });
  }

  const clients = readClients();
  const target = clients.find((c) => c.id === id);
  if (!target) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const updatedActivity = [...(target.activityLog ?? []),
    makeActivityEntry("DELETED", actor, { summary: `Client "${target.name}" deleted` })
  ];
  const filtered = clients.filter((c) => c.id !== id);
  writeClients(filtered);
  return NextResponse.json({ source: "local", deleted: id, activityLog: updatedActivity });
}

/* ── CUSTOM STATUSES ────────────────────────────────────────── */
export async function PUT(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const label = String(body.label ?? "").trim();

  if (action === "add" && !label)
    return NextResponse.json({ error: "Status label required" }, { status: 400 });
  if (action === "add" && (PREDEFINED_STATUSES.includes(label.toUpperCase()) || label.length < 2))
    return NextResponse.json({ error: "Invalid status label" }, { status: 400 });

  const current = readCustomStatuses();
  if (action === "add") {
    if (current.includes(label)) return NextResponse.json({ error: "Status already exists" }, { status: 409 });
    writeCustomStatuses([...current, label]);
    return NextResponse.json({ ok: true });
  }
  if (action === "remove" && label) {
    writeCustomStatuses(current.filter((s) => s !== label));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ statuses: current });
}

export async function GET_custom(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  return NextResponse.json({ statuses: readCustomStatuses() });
}
