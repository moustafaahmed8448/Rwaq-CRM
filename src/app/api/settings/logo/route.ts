import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getSessionUser, unauthorized } from "@/lib/auth";
import { clearSettingValue, databaseErrorMessage, readSettingValue, writeSettingValue } from "@/lib/db";
import { MAX_STORED_LOGO_CHARS } from "@/lib/logo-constants";

/**
 * Public on purpose. The login page is shown to people who are not signed in,
 * so gating this would make the logo unreachable exactly where it matters most
 * and silently fall back to the "R" badge. The value is an admin-set data URL
 * of workspace branding — no PII, no tenant data — and it is already rendered
 * to every signed-in user in the header. Writes stay admin-only (see below).
 */
export async function GET() {
  try {
    return NextResponse.json(
      { logo: (await readSettingValue("logo")) ?? "" },
      // Now that the response is public it is CDN-cacheable; without this an
      // admin could keep seeing a stale logo after uploading a new one.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

/** Admin only: the logo is workspace-wide branding. */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const logo = String(body.logo ?? "").trim();
  if (!logo) return NextResponse.json({ error: "Logo required" }, { status: 400 });
  if (!logo.startsWith("data:image/")) {
    return NextResponse.json({ error: "Invalid image data" }, { status: 400 });
  }
  if (logo.length > MAX_STORED_LOGO_CHARS) {
    return NextResponse.json({ error: "Image is too large (max 2MB)." }, { status: 400 });
  }

  try {
    await writeSettingValue("logo", logo);
    return NextResponse.json({ ok: true, logo });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    await clearSettingValue("logo");
    return NextResponse.json({ ok: true, logo: "" });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
