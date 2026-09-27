import { NextRequest, NextResponse } from "next/server";
import { canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { BUILTIN_LOCATION_KEYS } from "@/lib/reporting";
import { addSettingValue, countClients, databaseErrorMessage, listClients, readSetting, removeSettingValue } from "@/lib/db";

// Built-in cities come from the shared registry (see BUILTIN_LOCATIONS in
// src/lib/reporting.ts). This list used to be duplicated here and in
// src/app/page.tsx, which meant the two could disagree about which values
// are built-ins — and therefore which are deletable.
const DEFAULT_LOCATIONS = BUILTIN_LOCATION_KEYS;

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    // Locations come from the live client table, not a stale JSON snapshot.
    const clients = await listClients({ includeArchived: true });
    const clientLocations = [...new Set(clients.map((c) => c.location).filter(Boolean))];
    const custom = await readSetting("locations");
    const all = [...DEFAULT_LOCATIONS, ...clientLocations, ...custom];

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const loc of all) {
      const key = loc.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(loc);
      }
    }
    return NextResponse.json({
      locations: unique,
      // How many clients currently use each location. The delete flow warns with
      // this, because removing a value from the saved list does NOT touch the
      // clients already set to it.
      usage: Object.fromEntries(unique.map((loc) => [loc, clients.filter((c) => c.location === loc).length])),
      // Only these can be removed; the built-ins are code constants.
      removable: custom,
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Removes a SAVED (custom) location from the reference list.
 *
 * Admin-only: this is shared, workspace-wide reference data, matching how
 * archiving and deleting clients are gated. Clients already using the value keep
 * it — nothing is rewritten — so the UI warns with the usage count first.
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Location name required" }, { status: 400 });

  try {
    const custom = await readSetting("locations");
    // Built-ins are code constants, not rows, so they cannot be removed here.
    if (DEFAULT_LOCATIONS.some((d) => d.toLowerCase() === label.toLowerCase())) {
      return NextResponse.json({ error: "Cannot remove a built-in location" }, { status: 400 });
    }
    // Enforced here as well as in the UI: a value still attached to clients must
    // stay in the list, or those clients end up pointing at something that no
    // longer exists anywhere in the app.
    const inUse = await countClients({
      OR: [
        { location: { equals: label, mode: "insensitive" } },
        { location: { equals: label.toLowerCase(), mode: "insensitive" } },
      ],
    });
    if (inUse > 0) {
      return NextResponse.json(
        { error: "Location is still used by existing clients", usage: inUse },
        { status: 409 },
      );
    }
    await removeSettingValue("locations", label);
    const remaining = await readSetting("locations");
    return NextResponse.json({ ok: true, locations: [...DEFAULT_LOCATIONS, ...remaining] });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  // Workspace-wide reference data: read-only roles may not change it.
  if (!canWrite((await getSessionUser(request))?.role)) {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (!label || label.length < 2)
    return NextResponse.json({ error: "Location name required" }, { status: 400 });

  try {
    const current = await readSetting("locations");
    if (current.some((l) => l.toLowerCase() === label.toLowerCase()))
      return NextResponse.json({ error: "Location already exists" }, { status: 409 });
    await addSettingValue("locations", label);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
