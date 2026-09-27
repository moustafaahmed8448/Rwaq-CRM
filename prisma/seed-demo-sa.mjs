// Saudi demo data seed — idempotent: clients whose name already exists are
// skipped, and Saudi cities are merged into the "locations" setting.
// Run:  node --env-file=.env prisma/seed-demo-sa.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SAUDI_LOCATIONS = ["Riyadh", "Jeddah", "Makkah", "Madinah", "Dammam", "Khobar", "Dhahran", "Taif", "Abha", "Tabuk"];

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const act = (id, timestamp, action, summary, extra = {}) => ({
  id, timestamp: timestamp.toISOString(), actor: "Moustafa", action, summary, ...extra,
});
const slug = (name) => name.replace(/\W/g, "");

const demo = [
  { name: "Mohammed Al-Harbi", phone: "+966 55 123 4567", status: "WON", location: "Riyadh", channel: "INSTAGRAM", op: "Contract signing", days: 41,
    project: "Diriyah Gate — Phase 2 villas. Premium finishing package with private garden and smart-home setup.",
    notes: "Closed after two site visits. Prefers WhatsApp for updates.", won: 12 },
  { name: "Sarah Al-Qahtani", phone: "+966 56 234 5678", status: "WAITING", location: "Jeddah", channel: "FACEBOOK", op: "Follow-up call", days: 12,
    project: "Jeddah Waterfront — 3-bedroom sea-view apartment, ready to move.",
    notes: "Waiting for her husband to return from travel before the site visit." },
  { name: "Abdulaziz Al-Otaibi", phone: "+966 50 345 6789", status: "WON", location: "Khobar", channel: "WHATSAPP", op: "Payment plan discussion", days: 33,
    project: "Al Khobar Corniche Towers — corner unit on the 14th floor with sea view.",
    notes: "Negotiated a 12-month payment plan. Referral: his brother bought last year.", won: 8 },
  { name: "Nourah Al-Shehri", phone: "+966 53 456 7890", status: "WAITING", location: "Riyadh", channel: "TIKTOK", op: "Send updated brochure", days: 6,
    project: "King Abdullah Financial District (KAFD) — office space for her new clinic group.",
    notes: "Compares our offer with two competitors. Send the updated price list Monday." },
  { name: "Faisal Al-Dossari", phone: "+966 54 567 8901", status: "LOST", location: "Dammam", channel: "GOOGLE_ADS", op: "Closed — budget", days: 28,
    project: "Dammam Corniche residence — duplex unit with maid's room.",
    notes: "Chose a competitor with 5% lower price. Keep in the newsletter.", lost: 20 },
  { name: "Reem Al-Anazi", phone: "+966 55 678 9012", status: "WON", location: "Makkah", channel: "CALLS", op: "Unit booking", days: 19,
    project: "Mecca Gate Towers — hotel apartments investment, guaranteed 7% rental yield.",
    notes: "Investor. Wants the booking contract in both Arabic and English.", won: 5 },
  { name: "Khalid Al-Mutairi", phone: "+966 59 789 0123", status: "WAITING", location: "Dhahran", channel: "SALES", op: "Mortgage approval pending", days: 9,
    project: "Dhahran Hills — family villa near KAUST with solar panels pre-installed.",
    notes: "Bank is finalizing the mortgage valuation. Follow up Thursday." },
  { name: "Layla Al-Ghamdi", phone: "+966 58 890 1234", status: "LOST", location: "Abha", channel: "X", op: "Closed — location", days: 37,
    project: "Abha mountain resort chalets, installment plan over four years.",
    notes: "Wanted a different city. Not interested anymore.", lost: 25 },
  { name: "Bandar Al-Subaie", phone: "+966 50 901 2345", status: "WON", location: "Madinah", channel: "INSTAGRAM", op: "Keys handover", days: 45,
    project: "Madinah Knowledge Economic City — retail unit facing the central station, handed over in shell condition with the landlord covering the finishing allowance up to 800 SAR per square meter, which we confirmed in writing before the signing meeting.",
    notes: "Smoothest deal this quarter. Send him the handover photos.", won: 15 },
  { name: "Hessa Al-Shammari", phone: "+966 56 012 3456", status: "WAITING", location: "Taif", channel: "FACEBOOK", op: "Site visit scheduling", days: 4,
    project: "Taif Al-Hada highland villas — weekend house with terraced garden.",
    notes: "Asked for weekend-only viewings. Saturday morning works best." },
  { name: "Turki Al-Sabhan", phone: "+966 53 123 0987", status: "LOST", location: "Riyadh", channel: "GOOGLE_ADS", op: "Closed — timing", days: 22,
    project: "Riyadh Front exhibition and residential mix-use plot.",
    notes: "Postponed all purchasing decisions to next year. Revisit in Q1.", lost: 10 },
  { name: "Maha Al-Rasheed", phone: "+966 54 234 1876", status: "LOST", location: "Jeddah", channel: "TIKTOK", op: "Closed — specification", days: 31,
    project: "Al Shati district penthouse — requested a private elevator which the developer rejected.",
    notes: "Very specific requirements. Only re-contact if a matching unit appears.", lost: 18 },
  { name: "Omar Bahareth", phone: "+966 55 345 2765", status: "WON", location: "Khobar", channel: "WHATSAPP", op: "Second unit purchase", days: 26,
    project: "Prince Faisal bin Fahd Road — investment studio unit, second purchase with us.",
    notes: "Loyal client. Gives strong referrals, ask him for introductions.", won: 9 },
  { name: "Rania Zaher", phone: "+966 57 456 3854", status: "LOST", location: "Tabuk", channel: "CALLS", op: "Closed — relocation", days: 15,
    project: "NEOM staff housing registration — her transfer to Tabuk was cancelled.",
    notes: "Left the country. Archive if no response by year end.", lost: 7 },
  { name: "Yousef Malki", phone: "+966 52 567 4943", status: "WAITING", location: "Riyadh", channel: "WHATSAPP", op: "Awaiting family decision", days: 8,
    project: "Olaya Towers — sky-lobby duplex with a 360-degree city panorama, semi-furnished with imported kitchen fittings, private cinema room, and two dedicated parking bays in basement levels B2 and B3, sold as one bundle together with storage room number S-118 on the same floor.",
    notes: "Very interested but the whole family must see it together. Proposed Friday evening." },
];

async function main() {
  // 1. Merge Saudi cities into the "locations" setting (case-insensitive).
  const setting = await prisma.setting.findUnique({ where: { key: "locations" } });
  const existing = Array.isArray(setting?.value) ? setting.value.map(String) : [];
  const seen = new Set(existing.map((l) => l.toLowerCase()));
  const merged = [...existing, ...SAUDI_LOCATIONS.filter((l) => !seen.has(l.toLowerCase()))];
  await prisma.setting.upsert({
    where: { key: "locations" },
    update: { value: merged },
    create: { key: "locations", value: merged },
  });
  console.log(`locations setting: ${existing.length} existing + ${merged.length - existing.length} Saudi cities = ${merged.length}`);

  // 2. Insert demo clients, skipping any name that already exists.
  const names = demo.map((d) => d.name);
  const already = new Set(
    (await prisma.client.findMany({ where: { name: { in: names } }, select: { name: true } })).map((c) => c.name),
  );
  const rows = demo.filter((d) => !already.has(d.name)).map((d) => {
    const createdAt = daysAgo(d.days);
    const log = [act(`act-${slug(d.name)}-c`, createdAt, "CREATED", "Client created")];
    if (d.won) log.push(act(`act-${slug(d.name)}-w`, daysAgo(d.won), "STATUS_CHANGE", "Status changed: WAITING → WON", { field: "Status", oldValue: "WAITING", newValue: "WON" }));
    if (d.lost) log.push(act(`act-${slug(d.name)}-l`, daysAgo(d.lost), "STATUS_CHANGE", "Status changed: WAITING → LOST", { field: "Status", oldValue: "WAITING", newValue: "LOST" }));
    log.push(act(`act-${slug(d.name)}-n`, daysAgo(Math.max(d.days - 3, 0)), "NOTE_EDIT", "Notes updated", { field: "Notes" }));
    return {
      name: d.name,
      phoneNumber: d.phone,
      status: d.status,
      project: d.project,
      location: d.location,
      acquisitionChannel: d.channel,
      operationToTake: d.op,
      firstContactPerson: "Moustafa",
      secondContactPerson: "",
      notes: d.notes,
      createdAt,
      activityLog: log,
    };
  });

  if (rows.length > 0) {
    const res = await prisma.client.createMany({ data: rows });
    console.log(`inserted ${res.count} demo clients, skipped ${already.size} existing`);
  } else {
    console.log(`nothing to insert — all ${already.size} demo clients already exist`);
  }
  for (const d of demo) console.log(`  ${already.has(d.name) ? "skip" : " +  "} ${d.name} (${d.status}, ${d.location})`);
  console.log("total clients in DB:", await prisma.client.count());
}

main()
  .catch((e) => { console.error("seed failed:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
