import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getSessionUser, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, readSettingValue, writeSettingValue } from "@/lib/db";

/**
 * Workspace NAME (the text beside the logo mark) — the white-label counterpart
 * of /api/settings/logo.
 *
 * GET is public for exactly the reason the logo's is: the login page must show
 * the tenant's name before anyone has signed in. The value is a short display
 * string — no PII, no tenant secrets — and every signed-in user already sees it
 * in the header. Writes are admin-only.
 *
 * Stored as one `Setting` KV row (`brand`), so adapting the app to a different
 * company needs NO migration — same pattern as the logo.
 */
export async function GET() {
  try {
    return NextResponse.json(
      { name: ((await readSettingValue("brand")) as string | null) ?? "" },
      // Public and cacheable would let an admin keep seeing the old name after
      // a save; no-store keeps every surface in step, like the logo route.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/** Admin only: the name is workspace-wide branding, like the logo. */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  // 2–40: one character is the fallback-badge case (which needs no row at all),
  // and anything longer is a sentence, not a name, and would overflow the header.
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (name.length < 2 || name.length > 40) {
    return NextResponse.json({ error: "Name must be 2 to 40 characters" }, { status: 400 });
  }

  try {
    await writeSettingValue("brand", name);
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}