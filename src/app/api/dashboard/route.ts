import { NextRequest, NextResponse } from "next/server";
import { assigneeScope, getSessionUser, isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, listClients, listMetrics } from "@/lib/db";
import { channelLabels, isWon } from "@/lib/reporting";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  try {
    const [clients, metrics] = await Promise.all([
      listClients({ includeArchived: true, assignee: assigneeScope(await getSessionUser(request)) }),
      listMetrics(),
    ]);

    const channels = metrics.map((metric) => ({
      name: channelLabels[metric.channel] ?? metric.channel,
      short: String(metric.channel).slice(0, 1),
      accent: "#7266d7",
      spend: metric.spend,
      customers: clients.filter(
        (c) => c.acquisitionChannel === metric.channel && isWon(c.status),
      ).length,
      reach: String(metric.reach),
      trend: 0,
    }));

    const leads = clients.map((c) => ({
      id: c.id,
      clientName: c.name,
      phone: c.phoneNumber,
      status: c.status,
      project: c.project,
      location: c.location,
      channel: channelLabels[c.acquisitionChannel] ?? c.acquisitionChannel,
      nextAction: c.operationToTake,
      assignee: c.firstContactPerson,
      updated: c.lastUpdateDate,
    }));

    return NextResponse.json({ channels, leads, source: "postgres" });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
