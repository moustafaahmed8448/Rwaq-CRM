// One-time (idempotent) import of the legacy JSON files into Postgres.
//
//   npx prisma db seed
//
// Safe to run repeatedly: everything is upserted.
// Clients are intentionally NOT imported — the live client data already lives in
// Postgres, and data/rwaq-clients.json is only a stale local snapshot.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dataPath = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(dataPath(name), "utf-8"));
  } catch {
    console.log(`  · ${name} not found — skipped`);
    return fallback;
  }
}

/** Merge new values into an existing string list, preserving order and case-insensitive uniqueness. */
function mergeUnique(existing, incoming) {
  const seen = new Set(existing.map((v) => String(v).toLowerCase()));
  const out = [...existing];
  for (const value of incoming) {
    const key = String(value).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

async function seedUsers() {
  const users = await readJson("rwaq-users.json", []);
  let count = 0;
  for (const user of users) {
    if (!user?.username || !user?.hash) continue;
    const username = String(user.username).toLowerCase();
    const data = {
      name: user.name || username,
      email: user.email || null,
      role: user.role || "Sales",
      hash: user.hash,
    };
    await prisma.appUser.upsert({
      where: { username },
      update: data,
      create: { username, ...data },
    });
    count += 1;
  }
  console.log(`  ✓ AppUser: ${count} record(s)`);
}

async function seedSettings() {
  const files = [
    ["channels", "rwaq-channels.json", "channels"],
    ["statuses", "rwaq-custom-statuses.json", "statuses"],
    ["locations", "rwaq-locations.json", "locations"],
  ];

  for (const [key, fileName, field] of files) {
    const payload = await readJson(fileName, null);
    const incoming = Array.isArray(payload?.[field]) ? payload[field] : [];
    if (incoming.length === 0) {
      console.log(`  ✓ Setting "${key}": nothing to import`);
      continue;
    }
    const existing = await prisma.setting.findUnique({ where: { key } });
    const current = Array.isArray(existing?.value) ? existing.value : [];
    const merged = mergeUnique(current, incoming);
    await prisma.setting.upsert({
      where: { key },
      update: { value: merged },
      create: { key, value: merged },
    });
    console.log(`  ✓ Setting "${key}": ${merged.length} value(s)`);
  }
}

async function seedMetrics() {
  const metrics = await readJson("rwaq-marketing-metrics.json", []);
  let count = 0;
  for (const metric of metrics) {
    if (!metric?.id || !metric?.channel || !metric?.startDate || !metric?.endDate) continue;
    const data = {
      startDate: new Date(`${String(metric.startDate).slice(0, 10)}T00:00:00.000Z`),
      endDate: new Date(`${String(metric.endDate).slice(0, 10)}T00:00:00.000Z`),
      channel: String(metric.channel).toUpperCase(),
      spend: Number(metric.spend ?? 0),
      reach: Number(metric.reach ?? 0),
      impressions: Number(metric.impressions ?? 0),
      clicks: Number(metric.clicks ?? 0),
      notes: metric.notes ? String(metric.notes) : null,
    };
    await prisma.marketingMetric.upsert({
      where: { id: String(metric.id) },
      update: data,
      create: { id: String(metric.id), ...data },
    });
    count += 1;
  }
  console.log(`  ✓ MarketingMetric: ${count} record(s)`);
}

async function seedClients() {
  const clients = await readJson("rwaq-clients.json", []);
  let count = 0;
  for (const client of clients) {
    if (!client?.id || !client?.name) continue;
    const data = {
      name: String(client.name),
      phoneNumber: String(client.phoneNumber ?? ""),
      status: String(client.status ?? "WAITING"),
      project: String(client.project ?? ""),
      location: String(client.location ?? ""),
      acquisitionChannel: String(client.acquisitionChannel ?? "SALES"),
      operationToTake: String(client.operationToTake ?? ""),
      firstContactPerson: String(client.firstContactPerson ?? ""),
      secondContactPerson: String(client.secondContactPerson ?? ""),
      notes: client.notes ? String(client.notes) : null,
      archived: Boolean(client.archived ?? false),
      archivedAt: client.archivedAt ? new Date(client.archivedAt) : null,
      activityLog: Array.isArray(client.activityLog) ? client.activityLog : null,
      createdAt: client.createdAt ? new Date(client.createdAt) : new Date(),
      lastUpdateDate: client.lastUpdateDate ? new Date(client.lastUpdateDate) : new Date(),
    };
    await prisma.client.upsert({
      where: { id: String(client.id) },
      update: data,
      create: { id: String(client.id), ...data },
    });
    count += 1;
  }
  console.log(`  ✓ Client: ${count} record(s)`);
}

async function seedNotifications() {
  const notifications = await readJson("rwaq-notifications.json", []);
  let count = 0;
  for (const item of notifications) {
    if (!item?.id || !item?.recipient || !item?.message) continue;
    const data = {
      recipient: String(item.recipient),
      type: String(item.type ?? "INFO"),
      message: String(item.message),
      clientId: item.clientId ?? null,
      clientName: item.clientName ?? null,
      read: Boolean(item.read),
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    };
    await prisma.notification.upsert({
      where: { id: String(item.id) },
      update: data,
      create: { id: String(item.id), ...data },
    });
    count += 1;
  }
  console.log(`  ✓ Notification: ${count} record(s)`);
}

async function main() {
  // --only=users,settings   → run just those groups
  // --skip=metrics,notifications → run everything except those groups
  const args = process.argv.slice(2);
  const parse = (name) =>
    (args.find((a) => a.startsWith(`--${name}=`)) ?? "")
      .split("=")[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const only = parse("only");
  const skip = parse("skip");
  const enabled = (name) => (only.length ? only.includes(name) : !skip.includes(name));

  console.log("Seeding Rwaq CRM from legacy JSON…");
  if (enabled("users")) await seedUsers();
  if (enabled("settings")) await seedSettings();
  if (enabled("clients")) await seedClients();
  if (enabled("metrics")) await seedMetrics();
  if (enabled("notifications")) await seedNotifications();
  console.log("Done.");
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error instanceof Error ? error.message : error);
    if (String(error?.message ?? "").includes("DATABASE_URL")) {
      console.error("Set DATABASE_URL (see .env.example) before seeding.");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
