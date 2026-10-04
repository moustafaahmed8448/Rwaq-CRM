import { NextRequest, NextResponse } from "next/server";
import { canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import {
  BUILTIN_LOCATION_KEYS,
  BUCKETS_SETTING_KEY,
  PREDEFINED_STATUSES,
  channelValues,
  coerceStatusBuckets,
  STATUS_OUTCOMES,
  type StatusBuckets,
  type StatusOutcome,
} from "@/lib/reporting";
import {
  addSettingValue,
  countClients,
  databaseErrorMessage,
  listClients,
  readSetting,
  readSettingObject,
  removeSettingValue,
  renameOptionValue,
  writeSettingObject,
} from "@/lib/db";
import {
  COLORS_SETTING_KEY,
  REF_KINDS,
  coerceColors,
  isBuiltinOption,
  normalizeColor,
  normalizeOptionLabel,
  type RefKind,
} from "@/lib/ref-options";

/**
 * Admin management surface for the three reference lists, and the one endpoint
 * that carries their colours.
 *
 * This deliberately sits ALONGSIDE /api/channels, /api/locations and the status
 * PUT on /api/crm/clients rather than replacing them: those three are already
 * wired into the pickers on the clients, kanban, client-detail and marketing
 * screens, and rewriting all of them in one go would put four working flows at
 * risk for no benefit. They keep behaving exactly as before. What is new here is
 * that all three kinds are manageable in one place, that a value can be given a
 * colour, and that colours are readable by every signed-in role — the dashboard
 * and the clients table need them to render a value's dot at all.
 *
 * Permissions mirror the existing endpoints rather than being tightened: any
 * role that can write the workspace (Sales/CRM/Admin) may add a value, only an
 * Admin may recolour or delete one, and a value still referenced by clients can
 * never be deleted. This is the real enforcement; the admin page also hides the
 * buttons, but that alone would be cosmetic.
 */

/** Stored list of user-defined values, per kind. Built-ins live in code. */
const SETTING_KEY: Record<RefKind, "statuses" | "channels" | "locations"> = {
  statuses: "statuses",
  channels: "channels",
  locations: "locations",
};

/** Code constants that ship with the app and therefore cannot be deleted. */
const BUILTIN: Record<RefKind, string[]> = {
  statuses: PREDEFINED_STATUSES,
  channels: channelValues,
  locations: BUILTIN_LOCATION_KEYS,
};

/** The Client column that holds this kind of value. */
const CLIENT_FIELD: Record<RefKind, "status" | "acquisitionChannel" | "location"> = {
  statuses: "status",
  channels: "acquisitionChannel",
  locations: "location",
};

type ValueClient = { status: string; acquisitionChannel: string; location: string };

/** Narrows an untrusted `kind` string to a RefKind, or rejects it. */
const isRefKind = (value: string): value is RefKind =>
  (REF_KINDS as readonly string[]).includes(value);
/**
 * Every value of one kind: built-ins first, then the saved list, then anything
 * only ever typed on a client — de-duplicated case-insensitively while
 * preserving order. Including that last group is what lets an admin colour (or
 * delete) a location the reference list never had.
 */
async function allValues(kind: RefKind, clients: ValueClient[]) {
  const custom = await readSetting(SETTING_KEY[kind]);
  const inUse = clients.map((c) => c[CLIENT_FIELD[kind]]);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of [...BUILTIN[kind], ...custom, ...inUse]) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return { values, removable: custom };
}

/** Client count per value, for the "still in use" warning on the admin page. */
function usageFor(kind: RefKind, values: string[], clients: ValueClient[]) {
  const field = CLIENT_FIELD[kind];
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = clients.filter((c) =>
      // Locations compare case-insensitively, matching the delete guard in
      // /api/locations — otherwise "riyadh" and "Riyadh" read as two values.
      kind === "locations"
        ? c.location.toLowerCase() === value.toLowerCase()
        : c[field] === value,
    ).length;
  }
  return counts;
}

/**
 * Writes one value's colour into the shared row.
 *
 * Read-modify-write rather than a targeted update: the row holds all three kinds
 * at once, so a partial update would need a path Prisma's `set` does not expose
 * for a nested key. `null` removes the entry so the built-in colour applies again.
 */
async function setOptionColor(kind: RefKind, label: string, color: string | null) {
  const stored = (await readSettingObject(COLORS_SETTING_KEY)) ?? {};
  const group = { ...((stored[kind] as Record<string, unknown> | undefined) ?? {}) };
  if (color) group[label] = color;
  else delete group[label];
  await writeSettingObject(COLORS_SETTING_KEY, { ...stored, [kind]: group });
}

/**
 * Writes one status's bucket, or clears the assignment when `bucket` is null.
 *
 * Read-modify-write for the same reason as `setOptionColor`: the row is one
 * JSON blob, so a partial update would need a path Prisma's `set` does not
 * expose for a nested key. Clearing removes the entry, which hands the status
 * back to its built-in outcome.
 */
async function setStatusBucket(status: string, bucket: StatusBuckets[string] | null) {
  const stored = coerceStatusBuckets(await readSettingObject(BUCKETS_SETTING_KEY));
  if (bucket) stored[status] = bucket;
  else delete stored[status];
  await writeSettingObject(BUCKETS_SETTING_KEY, stored);
}

/** Validates `kind` and the normalized `label` from a request body. */
function parseTarget(
  body: Record<string, unknown>,
): { kind: RefKind; label: string } | NextResponse {
  const rawKind = String(body.kind ?? "").trim();
  if (!isRefKind(rawKind)) {
    return NextResponse.json({ error: "Unknown option type" }, { status: 400 });
  }
  const label = normalizeOptionLabel(rawKind, String(body.label ?? ""));
  if (!label) {
    return NextResponse.json({ error: "Option name required" }, { status: 400 });
  }
  return { kind: rawKind, label };
}

/* ── GET ──────────────────────────────────────────────────────────────────
   Open to every signed-in role, not just admins: the dashboard, clients table
   and pickers all resolve a value's colour through this response, so gating it
   would leave every non-admin screen rendering uncoloured dots. */

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const [clients, colors, buckets] = await Promise.all([
      listClients({ includeArchived: true }),
      readSettingObject(COLORS_SETTING_KEY),
      readSettingObject(BUCKETS_SETTING_KEY),
    ]);
    const resolved = {} as Record<RefKind, { values: string[]; removable: string[]; usage: Record<string, number> }>;
    for (const kind of REF_KINDS) {
      const { values, removable } = await allValues(kind, clients);
      resolved[kind] = { values, removable, usage: usageFor(kind, values, clients) };
    }
    return NextResponse.json({
      ...resolved,
      // Coerced, so a hand-edited row carrying a bad colour is dropped here
      // rather than reaching a style attribute further down.
      colors: coerceColors(colors),
      /* Readable by every signed-in role for the same reason the colours are:
         the dashboard renders its KPI cards, funnel and stage panel from it, so
         gating it would leave non-admins seeing numbers that disagree with the
         admin's configuration. Only the WRITE is admin-only. */
      buckets: coerceStatusBuckets(buckets),
      role: (await getSessionUser(request))?.role ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/** Creates a value in one of the three lists, optionally with its colour. */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  // Workspace-wide reference data: read-only roles may not change it.
  if (!canWrite((await getSessionUser(request))?.role)) {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const target = parseTarget(body);
  if (target instanceof NextResponse) return target;
  const { kind, label } = target;
  if (label.length < 2) {
    return NextResponse.json({ error: "Option name too short" }, { status: 400 });
  }

  try {
    const current = await readSetting(SETTING_KEY[kind]);
    if (current.some((v) => v.toLowerCase() === label.toLowerCase()) || isBuiltinOption(kind, label)) {
      return NextResponse.json({ error: "Option already exists" }, { status: 409 });
    }
    await addSettingValue(SETTING_KEY[kind], label);
    // Applied only when supplied. An added value otherwise resolves to its
    // stable hash colour until an admin picks one, so nothing is forced here.
    const color = normalizeColor(body.color);
    if (color) await setOptionColor(kind, label, color);
    return NextResponse.json({ ok: true, label });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Renames a value everywhere it is stored. Admin only.
 *
 * This is the destructive one. A reference value is a plain string on every
 * client row, so "rename" means rewriting every client that holds it — 339 rows
 * for a widely-used status. Clients already holding the value keep it; nothing is
 * orphaned.
 */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const session = await getSessionUser(request);
  if (session?.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const target = parseTarget(body);
  if (target instanceof NextResponse) return target;
  const { kind, label: from } = target;

  const to = normalizeOptionLabel(kind, String(body.to ?? ""));
  if (!to || to.length < 2) {
    return NextResponse.json({ error: "Option name too short" }, { status: 400 });
  }
  if (to.toLowerCase() === from.toLowerCase()) {
    return NextResponse.json({ error: "Option name unchanged" }, { status: 400 });
  }

  try {
    const current = await readSetting(SETTING_KEY[kind]);
    const clients = await listClients({ includeArchived: true });

    // Resolve the canonical casing the list actually holds. Needed because the
    // rename below matches stored values, and locations compare case-insensitively.
    const { values } = await allValues(kind, clients);
    const canonical = values.find((v) => v.toLowerCase() === from.toLowerCase());
    if (!canonical) return NextResponse.json({ error: "Option not found" }, { status: 404 });

    // Refuse rather than silently merge: renaming onto an existing value would
    // leave two list entries pointing at one meaning, and the duplicate could
    // never be deleted independently afterwards.
    const targetExists = values.some((v) => v.toLowerCase() === to.toLowerCase() && v !== canonical);
    if (targetExists) return NextResponse.json({ error: "Option already exists" }, { status: 409 });

    // Built-in statuses drive `classifyStatus`, which buckets every client into
    // won/lost/progress/other. Renaming one would silently move those clients
    // into the "other" bucket and change the KPIs, funnel and win rate — so it
    // is refused rather than allowed to corrupt the reporting.
    if (kind === "statuses" && isBuiltinOption(kind, canonical)) {
      return NextResponse.json({ error: "Cannot rename a built-in status" }, { status: 400 });
    }

    const result = await renameOptionValue(CLIENT_FIELD[kind], canonical, to, session?.name ?? "Admin");
    if (!result.ok) {
      // The unique(startDate, endDate, channel) constraint on MarketingMetric.
      return NextResponse.json({ error: "Channel name clashes with an existing campaign period", usage: 1 }, { status: 409 });
    }

    // Swap the label in the saved list. A built-in is not in that list, so a
    // rename of one is a no-op here (and refused above for statuses anyway).
    if (current.some((v) => v.toLowerCase() === canonical.toLowerCase())) {
      await addSettingValue(SETTING_KEY[kind], to);
      await removeSettingValue(SETTING_KEY[kind], canonical);
    }

    // Carry the colour across, so an admin-set colour survives a rename instead
    // of silently reverting to the hash fallback.
    await moveOptionColor(kind, canonical, to);

    return NextResponse.json({
      ok: true,
      from: canonical,
      to,
      clients: result.clients,
      metrics: result.metrics,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Moves a value's colour from one key to another.
 *
 * Delete-then-set rather than a single write: if the two keys are the same the
 * set would run after the delete and clear the colour, so an early return keeps
 * a no-op rename from wiping it.
 */
async function moveOptionColor(kind: RefKind, from: string, to: string) {
  if (from === to) return;
  const stored = (await readSettingObject(COLORS_SETTING_KEY)) ?? {};
  const group = { ...((stored[kind] as Record<string, unknown> | undefined) ?? {}) };
  const color = normalizeColor(group[from]);
  if (!color) return;
  group[to] = color;
  delete group[from];
  await writeSettingObject(COLORS_SETTING_KEY, { ...stored, [kind]: group });
}

/** Sets or clears the colour for one value. Admin only. */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  if ((await getSessionUser(request))?.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const target = parseTarget(body);
  if (target instanceof NextResponse) return target;
  const { kind, label } = target;

  /* The bucket assignment is only meaningful for statuses — it decides which
     KPI card a client is counted in. Sending one for a channel or location is a
     caller bug, and rejecting it is better than storing an entry nothing reads. */
  if (body.bucket !== undefined && kind !== "statuses") {
    return NextResponse.json({ error: "Buckets apply to statuses only" }, { status: 400 });
  }
  // null clears the assignment; a string must be one of the four real buckets.
  const bucket = body.bucket === null || body.bucket === undefined
    ? undefined
    : STATUS_OUTCOMES.includes(body.bucket as StatusOutcome)
      ? (body.bucket as StatusOutcome)
      : null;
  if (bucket === null) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }

  // An explicit null CLEARS the override, handing the value back to its
  // built-in colour — which is why the payload allows null and not just a string.
  const color = body.color === null ? null : normalizeColor(body.color);
  if (color === null && body.color !== null) {
    return NextResponse.json({ error: "Invalid color" }, { status: 400 });
  }
  // A PATCH that carries neither field would otherwise report success while
  // changing nothing, which reads as "saved" on a screen that shows a spinner.
  if (bucket === undefined && color === null && body.color === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const clients = await listClients({ includeArchived: true });
    const { values } = await allValues(kind, clients);
    // Resolve against the canonical casing the list actually holds, so the
    // colour lands on the same key the rest of the app looks up.
    const stored = values.find((v) => v.toLowerCase() === label.toLowerCase());
    if (!stored) return NextResponse.json({ error: "Option not found" }, { status: 404 });

    if (body.color !== undefined) await setOptionColor(kind, stored, color);
    // The whole map is returned, not just the entry that changed: the dashboard
    // rebuilds its cards, funnel and stage panel from it, and a partial reply
    // would leave the client holding a stale map.
    const buckets = bucket === undefined
      ? coerceStatusBuckets(await readSettingObject(BUCKETS_SETTING_KEY))
      : await setStatusBucket(stored, bucket).then(async () => coerceStatusBuckets(await readSettingObject(BUCKETS_SETTING_KEY)));
    return NextResponse.json({ ok: true, buckets });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Removes one or more values from a saved list.
 *
 * Admin only, never a built-in, and never while clients still reference it:
 * removing an in-use value would leave those clients pointing at something that
 * exists nowhere else in the app. Clients already holding it keep it — nothing is
 * rewritten — so the admin page warns with the usage count before calling this.
 *
 * Accepts either `label` (single) or `labels` (bulk). Bulk reports PER-ITEM
 * results rather than failing the whole batch: a mixed selection where one value
 * is in use and the rest are not would otherwise either delete nothing or report
 * a single opaque failure. The response says exactly what was removed and exactly
 * what was refused, and why.
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  if ((await getSessionUser(request))?.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const rawKind = String(body.kind ?? "").trim();
  if (!isRefKind(rawKind)) return NextResponse.json({ error: "Unknown option type" }, { status: 400 });
  const kind = rawKind;

  // Both shapes accepted so the existing single-value callers (the RefPicker on
  // the clients page and the client-detail page) keep working untouched.
  const requested = Array.isArray(body.labels)
    ? body.labels.map((l) => normalizeOptionLabel(kind, String(l ?? ""))).filter(Boolean)
    : [normalizeOptionLabel(kind, String(body.label ?? ""))].filter(Boolean);

  if (requested.length === 0) {
    return NextResponse.json({ error: "Option name required" }, { status: 400 });
  }

  try {
    const current = await readSetting(SETTING_KEY[kind]);
    const field = CLIENT_FIELD[kind];
    const removed: string[] = [];
    // Refusals are collected, not thrown: one bad value must not silently take
    // the rest of a bulk selection down with it.
    const refused: Array<{ label: string; reason: string; usage?: number }> = [];

    for (const label of requested) {
      if (isBuiltinOption(kind, label)) {
        refused.push({ label, reason: "builtin" });
        continue;
      }
      const stored = current.find((v) => v.toLowerCase() === label.toLowerCase());
      if (!stored) {
        refused.push({ label, reason: "notFound" });
        continue;
      }
      const inUse = await countClients(
        kind === "locations"
          ? { location: { equals: stored, mode: "insensitive" } }
          : { [field]: stored },
      );
      if (inUse > 0) {
        refused.push({ label: stored, reason: "inUse", usage: inUse });
        continue;
      }
      await removeSettingValue(SETTING_KEY[kind], stored);
      // Drop the colour with the value, so re-adding the same name later starts
      // from the default rather than inheriting a colour set for the old one.
      await setOptionColor(kind, stored, null);
      removed.push(stored);
    }

    // A single-value request keeps the old all-or-nothing contract, so the
    // existing pickers still surface the exact 400/404/409 they did before.
    if (requested.length === 1 && refused.length === 1) {
      const [r] = refused;
      if (r.reason === "builtin") {
        return NextResponse.json({ error: "Cannot remove a built-in option" }, { status: 400 });
      }
      if (r.reason === "notFound") {
        return NextResponse.json({ error: "Option not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Option is still used by existing clients", usage: r.usage },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: removed.length > 0, removed, refused });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}