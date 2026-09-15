import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { readMetrics, writeMetrics, type MarketingMetric } from "@/lib/marketing";
import { channelLabels } from "@/lib/reporting";

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period"); // "week" or "month"
  const year = parseInt(searchParams.get("year") ?? "");
  const month = parseInt(searchParams.get("month") ?? "");

  const all = readMetrics().sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (period === "week") {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const filtered = all.filter(m => new Date(m.startDate) >= weekStart);
    return NextResponse.json({ metrics: filtered, totalSpend: filtered.reduce((s, m) => s + Number(m.spend ?? 0), 0), totalReach: filtered.reduce((s, m) => s + Number(m.reach ?? 0), 0) });
  }

  if (period === "month" && year && month) {
    const filtered = all.filter(m => {
      const d = new Date(m.startDate);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
    return NextResponse.json({ metrics: filtered, totalSpend: filtered.reduce((s, m) => s + Number(m.spend ?? 0), 0), totalReach: filtered.reduce((s, m) => s + Number(m.reach ?? 0), 0) });
  }

  return NextResponse.json({ metrics: all, totalSpend: all.reduce((s, m) => s + Number(m.spend ?? 0), 0), totalReach: all.reduce((s, m) => s + Number(m.reach ?? 0), 0) });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const channel = String(body.channel ?? "").toUpperCase();
  const spend = Number(body.spend ?? 0);
  const reach = Number(body.reach ?? 0);
  const impressions = Number(body.impressions ?? 0);
  const clicks = Number(body.clicks ?? 0);
  const startDate = body.startDate;
  const endDate = body.endDate;
  const notes = String(body.notes ?? "").trim();

  if (!channel || !startDate || !endDate)
    return NextResponse.json({ error: "Channel, start date, and end date are required" }, { status: 400 });
  if (spend < 0 || reach < 0)
    return NextResponse.json({ error: "Spend and reach must be non-negative" }, { status: 400 });

  const now = new Date().toISOString();
  const metric: MarketingMetric = {
    id: `m-${Date.now()}`,
    channel,
    spend,
    reach,
    impressions,
    clicks,
    notes,
    startDate,
    endDate,
    createdAt: now,
    updatedAt: now,
  };

  const metrics = readMetrics();
  metrics.push(metric);
  writeMetrics(metrics);
  return NextResponse.json({ metric }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const metrics = readMetrics();
  const idx = metrics.findIndex(m => m.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: Partial<MarketingMetric> = {};
  if (body.channel !== undefined) updates.channel = String(body.channel).toUpperCase();
  if (body.spend !== undefined) updates.spend = Number(body.spend);
  if (body.reach !== undefined) updates.reach = Number(body.reach);
  if (body.impressions !== undefined) updates.impressions = Number(body.impressions);
  if (body.clicks !== undefined) updates.clicks = Number(body.clicks);
  if (body.startDate !== undefined) updates.startDate = String(body.startDate);
  if (body.endDate !== undefined) updates.endDate = String(body.endDate);
  if (body.notes !== undefined) updates.notes = String(body.notes);
  updates.updatedAt = new Date().toISOString();

  metrics[idx] = { ...metrics[idx], ...updates };
  writeMetrics(metrics);
  return NextResponse.json({ metric: metrics[idx] });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const metrics = readMetrics().filter(m => m.id !== id);
  writeMetrics(metrics);
  return NextResponse.json({ deleted: id });
}
