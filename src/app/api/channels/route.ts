import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { addSettingValue, databaseErrorMessage, readSetting } from "@/lib/db";

const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const custom = await readSetting("channels");
    return NextResponse.json({ channels: [...DEFAULT_CHANNELS, ...custom] });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim().toUpperCase();
  if (!label || label.length < 2)
    return NextResponse.json({ error: "Channel name required" }, { status: 400 });
  if (DEFAULT_CHANNELS.includes(label))
    return NextResponse.json({ error: "Channel already exists" }, { status: 409 });

  try {
    const current = await readSetting("channels");
    if (current.includes(label))
      return NextResponse.json({ error: "Channel already exists" }, { status: 409 });
    await addSettingValue("channels", label);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
