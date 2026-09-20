import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { addSettingValue, databaseErrorMessage, listClients, readSetting } from "@/lib/db";

const DEFAULT_LOCATIONS = ["New Cairo", "6th of October", "North Coast"];

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
    return NextResponse.json({ locations: unique });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
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
