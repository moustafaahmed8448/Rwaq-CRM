import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { createMetric, databaseErrorMessage, deleteMetric, deleteMetrics, listMetrics, updateMetric } from "@/lib/db";
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

    /* ── Per-channel roll-up (ADDITIVE) ─────────────────────────────────────
       The table below still receives exactly `metrics` / `totalSpend` /
       `totalReach` as before; `byChannel` is extra drill-down metadata so a
       reader can answer "which channel is actually efficient?" without
       re-deriving the sums in every consumer. Conversions and CPA are NOT
       computed here — they need client outcomes, which live in the analytics
       weekly aggregator (the only place that already pairs listMetrics with
       listClients under one period and assignment scope). */
    const rollup = new Map<string, { channel: string; campaigns: number; spend: number; reach: number; impressions: number; clicks: number }>();
    for (const m of metrics) {
      const row = rollup.get(m.channel) ?? { channel: m.channel, campaigns: 0, spend: 0, reach: 0, impressions: 0, clicks: 0 };
      row.campaigns += 1;
      row.spend += Number(m.spend ?? 0);
      row.reach += Number(m.reach ?? 0);
      row.impressions += Number(m.impressions ?? 0);
      row.clicks += Number(m.clicks ?? 0);
      rollup.set(m.channel, row);
    }
    const byChannel = [...rollup.values()]
      .map((row) => ({
        ...row,
        spend: Math.round(row.spend * 100) / 100,
        /* Fractions, not percentages: the UI decides how many digits to show. */
        ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
        costPerClick: row.clicks > 0 ? row.spend / row.clicks : 0,
        costPerMille: row.impressions > 0 ? (row.spend / row.impressions) * 1000 : 0,
      }))
      .sort((a, b) => b.spend - a.spend || a.channel.localeCompare(b.channel));

    return NextResponse.json({
      metrics,
      totalSpend: metrics.reduce((s, m) => s + m.spend, 0),
      totalReach: metrics.reduce((s, m) => s + m.reach, 0),
      byChannel,
      // Echo of the applied filter, so a drill-down link can be rebuilt exactly.
      drilldown: { from: from ?? null, to: to ?? null, channels, campaigns: metrics.length },
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
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
      name,
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
  if (body.name !== undefined) patch.name = String(body.name).trim();
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

  /* Bulk form: `{ ids: [...] }`, checked first. "Delete selected" on the entries
     table would otherwise need one request per row, with no way to report which
     of them actually went if a later one failed. */
  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((id: unknown): id is string => typeof id === "string" && id.trim() !== "");
    if (ids.length === 0) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
    try {
      const deleted = await deleteMetrics(ids);
      return NextResponse.json({ deleted, requested: ids.length });
    } catch (error) {
      return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
    }
  }

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