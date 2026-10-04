import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assigneeScope, canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { PREDEFINED_STATUSES, parseChannel, parseStatus } from "@/lib/reporting";
import {
  addSettingValue,
  bulkUpdateClients,
  countClients,
  countClientsByFollowUp,
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

/**
 * A follow-up date, as an ISO string or null to clear it.
 *
 * Validated with `.refine` rather than `z.coerce.date()` because `z.coerce.date()`
 * silently turns a nonsense string into `Invalid Date` and hands Prisma a value
 * that fails deep inside the driver. Rejecting it here means the caller gets a
 * 400 with a message instead of a 500.
 *
 * Optional (not required) so omitting it leaves an existing value alone on PATCH
 * and stores NULL on create, where "not set" is the right default.
 *
 * Declared BEFORE the schemas that reference it: they are module-level
 * `const`s, so reading this from `baseSchema`'s initializer before it has been
 * initialized throws a temporal-dead-zone error on import.
 */
const followUpSchema = z
  .union([z.string(), z.date(), z.null()])
  .refine(
    (value) => value === null || !Number.isNaN(new Date(value).getTime()),
    { message: "Invalid follow-up date" },
  )
  .optional();

/* Four fields in this form are ones the create form does not validate and leaves
   empty unless you go and fill them in: `project`, `location`, `operationToTake`
   and `firstContactPerson`. All four were `min(1)`, so ANY client added without
   picking every one of them was rejected outright — and the rejection body was a
   Zod `fieldErrors` OBJECT, which `apiErrorMessage` cannot read, so the save
   looked like nothing had happened at all. Everything else in that form went down
   with it, and the follow-up date is precisely the field people notice losing.
   An empty string now means "not set", which is what the form was already
   sending; the columns are plain strings that store "" without complaint.
   `name` and `phoneNumber` stay required: the form validates those two itself and
   shows a visible message. */
const unset = z.string().optional();

const baseSchema = z.object({
  name: z.string().min(2),
  phoneNumber: z.string().min(5),
  status: z.string().min(1),
  acquisitionChannel: z.string().min(1),
  project: unset,
  location: unset,
  operationToTake: unset,
  firstContactPerson: unset,
  secondContactPerson: z.string().optional(),
  notes: z.string().optional(),
  nextFollowUpAt: followUpSchema,
});

/* Same reading here, and the same trap: `.optional()` permits `undefined` but NOT
   `""`. With `min(1)` still attached, opening a client whose location or operation
   was already empty and pressing Save sent `""` and failed validation — so the
   one field the user HAD just corrected, the follow-up date, was rejected with
   everything else. */
const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).optional(),
  phoneNumber: z.string().min(5).optional(),
  status: z.string().min(1).optional(),
  acquisitionChannel: z.string().min(1).optional(),
  project: z.string().optional(),
  location: z.string().optional(),
  operationToTake: z.string().optional(),
  firstContactPerson: z.string().optional(),
  secondContactPerson: z.string().optional(),
  notes: z.string().optional(),
  archived: z.boolean().optional(),
  nextFollowUpAt: followUpSchema,
});

/**
 * A schema rejection as a PLAIN, translatable string.
 *
 * Every one of these used to answer with Zod's `flatten()`, which is an OBJECT
 * `{ formErrors, fieldErrors }`. `apiErrorMessage` returns the generic fallback
 * for anything that is not a string, so a rejected field came back to the user as
 * "Something went wrong. Please try again." — naming no field, and looking like a
 * server crash rather than a form problem. `issues` still rides along so the raw
 * Zod text is available when debugging a payload.
 */
function invalidDetails(error: z.ZodError) {
  return NextResponse.json(
    {
      error: "Client details are incomplete",
      issues: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    },
    { status: 400 },
  );
}

/**
 * Removes every field whose incoming value is what the row ALREADY holds, so
 * validation never rejects a value the database is already storing.
 *
 * The edit form posts the whole client back, so without this the schema re-checks
 * untouched fields and any stored empty (`status`, `project`, a short phone) fails
 * its `min(1)` and takes the whole save down — including the one field the user
 * had actually changed. `updateClient` skips unchanged fields itself, but only
 * after validation has already run, so the guard has to live here too.
 *
 * `id` is never dropped: it is the addressee, not a field being changed, and the
 * single-client branch still needs it. `undefined` values are dropped as well,
 * since they are already "leave this alone".
 */
function dropUnchanged(
  raw: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw, id: raw.id };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "id") continue;
    if (value === undefined) { delete out[key]; continue; }
    // The form and `findClient` both speak ISO strings, so a plain comparison is
    // enough here — unlike `updateClient`, which sees raw Date columns.
    if (String(existing[key] ?? "") === String(value ?? "")) delete out[key];
  }
  return out;
}

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
    /* Only the four known buckets are accepted. An unrecognised value is dropped
       rather than passed through, so a typo cannot silently widen the view to
       "every client" — the failure mode where a filter that looks applied is
       actually applying nothing. */
    followUp: (["overdue", "today", "upcoming", "none"] as const).find((f) => q.get("followUp") === f),
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

    /* Default scope when the caller names nobody: Sales/CRM get their own book,
       Admin gets the whole company. Applied to BOTH paths so paging can never
       widen a rep's view. */
    const scope = assigneeScope(session);

    /* `?assignee=<name>` narrows to one person's book, for ANY signed-in user.
       This is what `/profile?user=<name>` drives: clicking a rep's name in the
       dashboard's Sales Performance panel opens that person's profile instead of
       the viewer's own.

       WIDENED DELIBERATELY. This used to be honoured for Admins only, on the
       grounds that letting a rep pass a colleague's name would expose their book.
       That restriction has been lifted at the product's request, so be explicit
       about the consequence: any authenticated user can now read any other user's
       clients — name, phone, project, notes and follow-up dates included. There is
       no per-user read permission in this codebase to narrow it further, so this
       line IS the permission boundary.

       It stays a DEFAULT-OVERRIDE rather than a replacement: with no `assignee`
       param the value is still `scope`, so every existing caller that passes
       nothing keeps exactly the view it had before. */
    const requested = (request.nextUrl.searchParams.get("assignee") ?? "").trim();
    const assignee = requested || scope;

    // Typed as ClientFilters (not inferred from filtered()) so `search` is a
    // known key — it is added on the next line.
    const filters: ClientFilters = { ...filtered(request), assignee };
    // `contact` narrows by ROLE and is only meaningful once an assignee exists, so
    // it is resolved here rather than inside `filtered()` — which has no access
    // to the resolved scope.
    filters.contact = assignee
      ? (["first", "second"] as const).find((c) => request.nextUrl.searchParams.get("contact") === c)
      : undefined;

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

    /* The four follow-up chip badges. Opt-in, so no existing caller pays for four
       extra COUNTs, and built by running the same `clientWhere` the list uses with
       each bucket applied — so a badge can never disagree with the rows that chip
       returns. The active `followUp` filter is overridden per bucket inside the
       helper; counting with it still applied would make every badge identical. */
    const wantFollowUpCounts = request.nextUrl.searchParams.get("followUpCounts") === "1";

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
      wantFollowUpCounts ? countClientsByFollowUp(filters) : undefined,
    ]);
    const [custom, allClients, archivedCount, loaded, followUpCounts] = result;
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
      // Only when asked for, and never alongside `idsOnly` (which a bulk-selector
      // polls; four COUNTs per poll would be pure waste).
      ...(followUpCounts && !idsOnly ? { followUpCounts } : {}),
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
    return invalidDetails(parsed.error);

  const { notes, ...rest } = parsed.data;
  const acquisitionChannel = parseChannel(rest.acquisitionChannel);
  if (!acquisitionChannel)
    return NextResponse.json({ error: "Invalid acquisition channel" }, { status: 400 });

  try {
    const client = await createClient(
      { ...rest,
        // These four are optional in the schema now, but the stored row and every
        // reader still expect a string, so "absent" becomes "" on the way in
        // rather than null — the same shape a form that leaves them blank sent
        // before the schema was relaxed.
        project: rest.project ?? "",
        location: rest.location ?? "",
        operationToTake: rest.operationToTake ?? "",
        firstContactPerson: rest.firstContactPerson ?? "",
        secondContactPerson: rest.secondContactPerson ?? "",
        acquisitionChannel,
        notes },
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
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  /* Bulk form: `{ ids, status }` (or any other patchable field) applied to many
     rows in one call. Checked BEFORE the single-client schema, which requires an
     `id` and would otherwise reject the whole payload with a validation error
     that says nothing about what was actually wrong. */
  const rawIds = Array.isArray(raw.ids) ? raw.ids.map(String).filter(Boolean) : [];
  if (rawIds.length > 0) {
    const { ids: _ids, ...fields } = raw;
    const parsedBulk = patchSchema.omit({ id: true }).safeParse(fields);
    if (!parsedBulk.success)
      return invalidDetails(parsedBulk.error);

    const patch: ClientPatch = { ...parsedBulk.data };
    if (patch.acquisitionChannel !== undefined) {
      const channel = parseChannel(patch.acquisitionChannel);
      if (!channel)
        return NextResponse.json({ error: "Invalid acquisition channel" }, { status: 400 });
      patch.acquisitionChannel = channel;
    }
    /* Archiving stays admin-only here too. The single-client branch below
       enforces it on `archived`, and a bulk archive would otherwise be a way
       around that check. */
    if (patch.archived !== undefined && (await roleOf(request)) !== "Admin") {
      return NextResponse.json({ error: "Only admins can archive or restore clients" }, { status: 403 });
    }

    try {
      const result = await bulkUpdateClients(rawIds, patch, await actorOf(request));
      return NextResponse.json({ source: "postgres", ...result, requested: rawIds.length });
    } catch (error) {
      return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
    }
  }

  /* Single-client form. The id is read before validating, because the next step
     validates only what CHANGED — which needs the stored row in hand.

     This is the invariant that was missing. The edit form posts the whole client
     back, and the schema used to validate all of it, so one stored empty value —
     a `status` with nothing in it, a short phone, an empty project — failed its
     `min(1)` and took the ENTIRE save down with it, including the follow-up date
     the user had just set. That is why "set a follow-up date" reliably produced
     "Some client details are missing": the date was never the problem. */
  const rawId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!rawId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const existing = await findClient(rawId).catch(() => null);
  const candidate = existing ? dropUnchanged(raw, existing) : raw;

  const parsed = patchSchema.safeParse(candidate);
  if (!parsed.success)
    return invalidDetails(parsed.error);

  const { archived, ...rest } = parsed.data;

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

    const result = await updateClient(rawId, patch, await actorOf(request));

    if (result.outcome === "not_found")
      return NextResponse.json({ error: "Client not found" }, { status: 404 });

    if (result.outcome === "no_changes") {
      const current = await findClient(rawId);
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
