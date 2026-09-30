// One-time (idempotent) creation of a login for every salesperson who appears
// on a client.
//
//   node prisma/seed-sales-users.mjs
//
// Why this exists: `Client.firstContactPerson` / `secondContactPerson` are
// free-text display names, and `assigneeScope` (src/lib/auth.ts) scopes a
// Sales/CRM user to their own book by matching `AppUser.name` against those
// columns with `equals`. Until an account exists for a salesperson, nobody can
// log in and see their own clients.
//
// Two deliberate details:
//
// 1. The display `name` is copied VERBATIM from the client rows. The match is
//    case-insensitive but NOT accent-insensitive, so re-typing "ابو شيخة" as
//    "أبو شيخة" would leave the user permanently locked out of their own book.
//    Reading the values from the database makes that impossible.
//
// 2. Usernames are a curated map, not algorithmic transliteration. The app
//    lowercases usernames and the login form is Latin-oriented, so each entry
//    is spelled out to stay predictable and collision-free. The password is the
//    username, as requested.
//
// Safe to run repeatedly: a name that already has a user is skipped.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Curated Latin username per salesperson. Falls back to a slug of the name. */
const USERNAMES = {
  "هشام": "hisham",
  "ابو شيخة": "abushekha",
  "محمد حسام": "mohamedhisham",
  "العجمي": "alajmi",
  "عاطف": "atef",
  "حلمى": "helmy",
  "عاصم": "asem",
  "عبدالعزيز": "abdelaziz",
  "محمود ربيع": "mahmoudrbea",
  "طارق": "tareq",
  "الدميري": "aldemiri",
  "الخولي": "alkhawli",
};

/**
 * Last-resort slug for a name not in the map above: strip anything that is not
 * a Latin letter or digit, so the result can only collide on a genuinely
 * identical name.
 */
const fallbackUsername = (name) =>
  name
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "sales";

/** Distinct, non-empty contact names across both contact columns. */
async function collectSalespeople() {
  const rows = await prisma.client.findMany({
    select: { firstContactPerson: true, secondContactPerson: true },
  });
  const counts = new Map();
  for (const row of rows) {
    for (const name of [row.firstContactPerson, row.secondContactPerson]) {
      const value = String(name ?? "").trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  // Most-assigned first, so the report reads in order of workload.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const people = await collectSalespeople();
  if (people.length === 0) {
    console.log("No salespeople found on any client — nothing to create.");
    return;
  }

  const existing = new Set(
    (await prisma.appUser.findMany({ select: { name: true } })).map((u) =>
      String(u.name ?? "").trim().toLowerCase(),
    ),
  );
  const takenUsernames = new Set(
    (await prisma.appUser.findMany({ select: { username: true } })).map((u) =>
      String(u.username).toLowerCase(),
    ),
  );

  const created = [];
  const skipped = [];

  for (const [name, clientCount] of people) {
    if (existing.has(name.toLowerCase())) {
      skipped.push({ name, reason: "already has a user" });
      continue;
    }

    const base = USERNAMES[name] ?? fallbackUsername(name);
    let username = base;
    // A name with no curated entry could collide with an existing username.
    if (takenUsernames.has(username)) {
      username = `${base}${clientCount}`;
    }
    if (takenUsernames.has(username)) {
      skipped.push({ name, reason: `username "${username}" already taken` });
      continue;
    }

    const password = username;
    await prisma.appUser.create({
      data: {
        username,
        name,
        role: "Sales",
        hash: await bcrypt.hash(password, 10),
      },
    });

    takenUsernames.add(username);
    existing.add(name.toLowerCase());
    created.push({ name, username, password, clientCount });
  }

  console.log(`\n  Salespeople found: ${people.length}\n`);
  for (const row of created) {
    console.log(`  ✓ ${row.username.padEnd(16)} ${row.name}  (${row.clientCount} clients)`);
  }
  for (const row of skipped) {
    console.log(`  · ${row.name} — skipped: ${row.reason}`);
  }
  console.log(`\n  Created: ${created.length}   Skipped: ${skipped.length}\n`);
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
