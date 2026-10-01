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
  listClientIds,
  listClients,
  listClientsPaged,
  readSetting,
  removeSettingValue,
  updateClient,
  type ClientFilters,
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

/**
 * Filter values are matched against the STORED column, verbatim.
 *
 * They used to run through `parseChannel`/`parseStatus` first, which is the
 * WRONG normalizer here: those exist to canonicalise what a user TYPES when
 * creating a record ("my channel" → "MY_CHANNEL"), so they upper-case and
 * substitute underscores. Filter values are already the exact stored strings
 * that the dropdowns hold, so applying them a second time could only corrupt a
 * match.
 *
 * It did, silently and badly: custom statuses in this workspace are Arabic
 * ("جديد", "متابعة"), and `parseStatus` rewrites them. Selecting every status on
 * a 30-day, no-SALES view returned 123 clients when the unfiltered answer was
 * 172 — the 49 clients on those two custom statuses vanished from the table with
 * no way to find them. Filtering a single custom status returned 0.
 *
 * Trim only. If a value needs canonicalising, it should be normalised when it is
 * STORED, so the stored column and the filter list can never drift apart.
 */
function filterValues(...raw: (string | null)[]): string[] {
  return [...new Set(raw.flatMap((v) => list(v)).filter(Boolean))];
}

function filtered(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  return {
    // Comma-separated lists, matching the multi-select filter bar: every group
    // ANDs together, every value inside a group ORs. That is exactly what
    // matchesFilters() in src/app/page.tsx and the Excel export do, so the table,
    // the export and the paged count can never disagree about a filter.
    channel: filterValues(q.get("channel"), q.get("channels")),
    status: filterValues(q.get("status"), q.get("statuses")),
    location: filterValues(q.get("location"), q.get("locations")),
    firstContact: filterValues(q.get("firstContact"), q.get("firstContacts")),
    secondContact: filterValues(q.get("secondContact"), q.get("secondContacts")),
    archived: q.get("archived") === "1",
    includeArchived: q.get("includeArchived") === "1",
    // Named createdFrom/createdTo because that is what clientWhere() reads.
    // These were previously emitted as `from`/`to`, which clientWhere has never
    // looked at — so every "Today / This week / Last 7 days" preset was silently
    // discarded and the table returned the whole book regardless. Mapped at the
    // parse boundary rather than inside clientWhere, so the SQL layer keeps one
    // name for the same idea the analytics route already uses.
    createdFrom: day(q.get("from")),
    createdTo: day(q.get("to")),
  };
}

/** Splits a repeated or comma-separated query value into a trimmed list. */
function list(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Normalizes a `?from=` / `?to=` value to a bare `YYYY-MM-DD` day key.
 *
 * The `.slice(0, 10)` matters: a date input submits a bare day, but the value can
 * also arrive as a full ISO timestamp, and `new Date("2026-01-05T00:00:00.000Z")`
 * parsed as local time can land on the previous day in a positive-offset timezone.
 */
function day(value: string | null): string | undefined {
  const raw = (value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

/**
 * Paging + free-text search, applied on top of `filtered()`.
 *
 * `?paged=1` switches the route to a single page and adds `total`/`page` to the
 * response. Without that flag the route keeps returning the ENTIRE list, because
 * the dashboard, the kanban and the reference-option usage counts all read this
 * endpoint and need every row — paging them would make the KPI cards describe
 * one screen instead of the whole book. The clients table is the only caller
 * that opts in.
 */
function paging(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const sortRaw = q.get("sort");
  return {
    enabled: q.get("paged") === "1",
    page: Number(q.get("page") ?? 1),
    pageSize: Number(q.get("pageSize") ?? 25),
    query: (q.get("q") ?? "").trim(),
    sort: (["recent", "oldest", "registered", "registeredOldest"] as const).find((s) => s === sortRaw),
  };
}

/* ── GET ─────────────────────────────────────────────────────── */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const session = await getSessionUser(request);
    const page = paging(request);

    // Sales/CRM only ever see their own book; Admin keeps the full view. Applied
    // to BOTH paths so paging can never widen a rep's view.
    // Typed as ClientFilters (not inferred from filtered()) so `search` is a
    // known key — it is added on the next line.
    const filters: ClientFilters = { ...filtered(request), assignee: assigneeScope(session) };

    // Free-text search belongs on the FILTERS, not the paging options:
    // clientWhere() is what turns it into SQL. Keeping it here means the
    // identical narrowing applies whether or not paging is on, so the two can
    // never disagree about what "search" means.
    if (page.query) filters.search = page.query;

    /**
     * `?idsOnly=1` returns just the matching ids, for cross-page bulk selection.
     *
     * Without it, "select all 202 matching clients" would have to download all
     * 202 full rows — activity logs included — purely to read their ids.
     */
    const idsOnly = request.nextUrl.searchParams.get("idsOnly") === "1";

    // Reference data for the filter bar. `usage` and `removable` are workspace-wide
    // (matching /api/channels) rather than scoped to the viewer's book, so the delete
    // flow never offers a status that clients elsewhere still depend on.
    const result = await Promise.all([
      readSetting("statuses"),
      listClients({ includeArchived: true }),
      prisma.client.count({ where: { archived: true } }),
      idsOnly
        ? listClientIds(filters)
        : page.enabled
          ? listClientsPaged(filters, {
              page: page.page,
              pageSize: page.pageSize,
              sort: page.sort,
            })
          : listClients(filters).then((rows) => ({ rows, total: rows.length, page: 1, pageSize: rows.length, pageCount: 1 })),
    ]);
    const [custom, allClients, archivedCount, loaded] = result;
    // `ids` only exists on the idsOnly branch; the normal branches never set it.
    const ids = "ids" in loaded ? loaded.ids : undefined;

    const clients = loaded.rows;
    const known = await allStatuses();

    // A paged response carries the pager's state. `activityLog` is omitted from
    // paged rows: the table never renders it and it was the bulk of the payload.
    const shaped = page.enabled
      ? clients.map(stripActivityLog)
      : clients;

    return NextResponse.json({
      source: "postgres",
      clients: shaped,
      statuses: known,
      usage: Object.fromEntries(known.map((s) => [s, allClients.filter((c) => c.status === s).length])),
      removable: custom,
      archivedCount,
      role: await roleOf(request),
      // idsOnly answers a different question, so it carries `ids` and a total and
      // no rows — the caller only wants to tick checkboxes.
      ...(idsOnly ? { ids: ids, total: loaded.total } : {}),
      ...(page.enabled && !idsOnly
        ? { total: loaded.total, page: loaded.page, pageSize: loaded.pageSize, pageCount: loaded.pageCount }
        : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/** Drops `activityLog` from a row the table will never expand. */
function stripActivityLog<T extends { activityLog: unknown }>(row: T): Omit<T, "activityLog"> {
  const { activityLog: _dropped, ...rest } = row;
  return rest;
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
