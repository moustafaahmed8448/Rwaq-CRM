import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getSessionUser, unauthorized } from "@/lib/auth";
import { clearSettingValue, databaseErrorMessage, readSettingValue, writeSettingValue } from "@/lib/db";
import { MAX_STORED_LOGO_CHARS } from "@/lib/logo-constants";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    return NextResponse.json({ logo: (await readSettingValue("logo")) ?? "" });
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
