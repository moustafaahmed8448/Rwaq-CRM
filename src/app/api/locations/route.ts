import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { readCustomLocations, writeCustomLocations, readClients } from "@/lib/storage";

const DEFAULT_LOCATIONS = ["New Cairo", "6th of October", "North Coast"];

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const allClients = readClients();
  const clientLocations = [...new Set(allClients.map(c => c.location).filter(Boolean))] as string[];
  const custom = readCustomLocations();
  const all = [...DEFAULT_LOCATIONS, ...clientLocations, ...custom];
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const loc of all) {
    const key = loc.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(loc); }
  }
  return NextResponse.json({ locations: unique });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (!label || label.length < 2)
    return NextResponse.json({ error: "Location name required" }, { status: 400 });
  const current = readCustomLocations();
  if (current.includes(label))
    return NextResponse.json({ error: "Location already exists" }, { status: 409 });
  writeCustomLocations([...current, label]);
  return NextResponse.json({ ok: true });
}
