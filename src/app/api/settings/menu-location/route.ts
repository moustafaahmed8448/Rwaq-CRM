import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, readSettingObject, writeSettingObject } from "@/lib/db";

/** Workspace-wide navigation placement: "header" (topbar tabs) or "sidebar". */
type MenuLocation = "header" | "sidebar";

const DEFAULT_MENU_LOCATION: MenuLocation = "header";

function coerceMenuLocation(value: unknown): MenuLocation {
  if (value === "header" || value === "sidebar") return value;
  return DEFAULT_MENU_LOCATION;
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const menuLocation = coerceMenuLocation(
      (await readSettingObject("menuLocation"))?.menuLocation,
    );
    return NextResponse.json({ menuLocation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  const currentUser = await getSessionUser(request);
  if (!currentUser || currentUser.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid menu location" }, { status: 400 });
  }

  const menuLocation = coerceMenuLocation((body as Record<string, unknown>).menuLocation);
  try {
    await writeSettingObject("menuLocation", { menuLocation });
    return NextResponse.json({ ok: true, menuLocation });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
