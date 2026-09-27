import { NextRequest, NextResponse } from "next/server";
import { canWrite, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { addSettingValue, countClients, databaseErrorMessage, listClients, readSetting, removeSettingValue } from "@/lib/db";

const DEFAULT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"];

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const [custom, clients] = await Promise.all([
      readSetting("channels"),
      listClients({ includeArchived: true }),
    ]);
    const all = [...DEFAULT_CHANNELS, ...custom];
    return NextResponse.json({
      channels: all,
      // Client counts per channel, so the delete flow can warn before removing
      // a value that is still in use.
      usage: Object.fromEntries(all.map((ch) => [ch, clients.filter((c) => c.acquisitionChannel === ch).length])),
      // Only saved channels can be removed; the built-ins are code constants.
      removable: custom,
    });
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

/**
 * Removes a SAVED (custom) channel from the reference list.
 *
 * Admin-only, matching locations. Clients already on the channel keep it, so the
 * UI confirms with the usage count before calling this.
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim().toUpperCase();
  if (!label) return NextResponse.json({ error: "Channel name required" }, { status: 400 });

  try {
    const custom = await readSetting("channels");
    if (DEFAULT_CHANNELS.includes(label)) {
      return NextResponse.json({ error: "Cannot remove a built-in channel" }, { status: 400 });
    }
    // Enforced here as well as in the UI: a value still attached to clients must
    // stay in the list, or those clients end up pointing at something that no
    // longer exists anywhere in the app.
    const inUse = await countClients({ acquisitionChannel: label });
    if (inUse > 0) {
      return NextResponse.json(
        { error: "Channel is still used by existing clients", usage: inUse },
        { status: 409 },
      );
    }
    await removeSettingValue("channels", label);
    const remaining = await readSetting("channels");
    return NextResponse.json({ ok: true, channels: [...DEFAULT_CHANNELS, ...remaining] });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
