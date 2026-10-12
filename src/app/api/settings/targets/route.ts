import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, readSettingObject, writeSettingObject } from "@/lib/db";
import { coerceMonthlyTargets } from "@/lib/targets";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();
  try {
    const targets = coerceMonthlyTargets(await readSettingObject("targets"));
    return NextResponse.json({ targets }, { headers: { "Cache-Control": "no-store" } });
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
    return NextResponse.json({ error: "Invalid target values" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const monthlyWon = raw.monthlyWon;
  const monthlySpendCeiling = raw.monthlySpendCeiling;
  if (!Number.isSafeInteger(monthlyWon) || Number(monthlyWon) < 1) {
    return NextResponse.json({ error: "Monthly won target must be a positive whole number" }, { status: 400 });
  }
  if (
    monthlySpendCeiling !== null &&
    monthlySpendCeiling !== undefined &&
    (typeof monthlySpendCeiling !== "number" || !Number.isFinite(monthlySpendCeiling) || monthlySpendCeiling <= 0)
  ) {
    return NextResponse.json({ error: "Monthly spend ceiling must be a positive number" }, { status: 400 });
  }

  const targets = {
    monthlyWon: Number(monthlyWon),
    monthlySpendCeiling: typeof monthlySpendCeiling === "number" ? monthlySpendCeiling : null,
  };
  try {
    await writeSettingObject("targets", targets);
    return NextResponse.json({ ok: true, targets });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
