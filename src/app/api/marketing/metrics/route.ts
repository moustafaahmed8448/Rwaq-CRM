import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { createMetric, databaseErrorMessage, deleteMetric, listMetrics, updateMetric } from "@/lib/db";
import { parseChannel } from "@/lib/reporting";

/** Every method here is admin-only. */
async function guard(request: NextRequest) {
  if (!(await isAuthenticated(request))) return { error: unauthorized() as NextResponse };
  const user = await getSessionUser(request);
  if (user?.role !== "Admin") {
    return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { user };
}

const isUniqueViolation = (message: string) =>
  message.includes("Unique constraint") || message.includes("unique constraint");

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;

  const { searchParams } = new URL(request.url);
  const rawChannels = searchParams.get("channels") ?? searchParams.get("channel") ?? "";
  const channels = rawChannels
    .split(",")
    .map((c) => parseChannel(c.trim()))
    .filter((c): c is string => Boolean(c));
  const from = searchParams.get("from")?.trim() || undefined;
  const to = searchParams.get("to")?.trim() || undefined;

  try {
    const metrics = await listMetrics({ channels, from, to });
    return NextResponse.json({
      metrics,
      totalSpend: metrics.reduce((s, m) => s + m.spend, 0),
      totalReach: metrics.reduce((s, m) => s + m.reach, 0),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;

  const body = await request.json().catch(() => ({}));
  const channel = parseChannel(String(body.channel ?? ""));
  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const spend = Number(body.spend ?? 0);
  const reach = Number(body.reach ?? 0);
  const impressions = Number(body.impressions ?? 0);
  const clicks = Number(body.clicks ?? 0);
  const notes = String(body.notes ?? "").trim();

  if (!channel || !startDate || !endDate)
    return NextResponse.json(
      { error: "Channel, start date, and end date are required" },
      { status: 400 },
    );
  if (startDate > endDate)
    return NextResponse.json({ error: "End date must be on or after the start date" }, { status: 400 });
  if (![spend, reach, impressions, clicks].every((n) => Number.isFinite(n) && n >= 0))
    return NextResponse.json({ error: "Numbers must be non-negative" }, { status: 400 });

  try {
    const metric = await createMetric({
      startDate,
      endDate,
      channel,
      spend,
      reach,
      impressions,
      clicks,
      notes,
    });
    return NextResponse.json({ metric }, { status: 201 });
  } catch (error) {
    const message = databaseErrorMessage(error);
    if (isUniqueViolation(message)) {
      return NextResponse.json(
        { error: "A metric already exists for this channel and date range" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const patch: Parameters<typeof updateMetric>[1] = {};
  if (body.channel !== undefined) {
    const channel = parseChannel(String(body.channel));
    if (!channel) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    patch.channel = channel;
  }
  if (body.spend !== undefined) patch.spend = Number(body.spend);
  if (body.reach !== undefined) patch.reach = Number(body.reach);
  if (body.impressions !== undefined) patch.impressions = Number(body.impressions);
  if (body.clicks !== undefined) patch.clicks = Number(body.clicks);
  if (body.notes !== undefined) patch.notes = String(body.notes);
  if (body.startDate !== undefined) patch.startDate = String(body.startDate).trim();
  if (body.endDate !== undefined) patch.endDate = String(body.endDate).trim();

  try {
    const metric = await updateMetric(id, patch);
    if (!metric) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ metric });
  } catch (error) {
    const message = databaseErrorMessage(error);
    if (isUniqueViolation(message)) {
      return NextResponse.json(
        { error: "A metric already exists for this channel and date range" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const deleted = await deleteMetric(id);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}