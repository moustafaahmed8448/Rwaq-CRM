import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { readCustomStatuses, writeCustomStatuses } from "@/lib/storage";

const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];
const CHANNELS_FILE = "data/rwaq-channels.json";
import path from "path";
import fs from "fs";

function getChannelsPath() {
  return path.join(process.cwd(), CHANNELS_FILE);
}

function readCustomChannels(): string[] {
  try {
    const raw = fs.readFileSync(getChannelsPath(), "utf-8");
    const data = JSON.parse(raw) as { channels: string[] };
    return data.channels ?? [];
  } catch {
    return [];
  }
}

function writeCustomChannels(channels: string[]) {
  fs.mkdirSync(path.dirname(getChannelsPath()), { recursive: true });
  fs.writeFileSync(getChannelsPath(), JSON.stringify({ channels }, null, 2));
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const all = [...DEFAULT_CHANNELS, ...readCustomChannels()];
  return NextResponse.json({ channels: all });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim().toUpperCase();
  if (!label || label.length < 2)
    return NextResponse.json({ error: "Channel name required" }, { status: 400 });
  if (DEFAULT_CHANNELS.includes(label))
    return NextResponse.json({ error: "Channel already exists" }, { status: 409 });
  const current = readCustomChannels();
  if (current.includes(label))
    return NextResponse.json({ error: "Channel already exists" }, { status: 409 });
  writeCustomChannels([...current, label]);
  return NextResponse.json({ ok: true });
}
