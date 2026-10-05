// Phase 0 verification: do the five columns added after the last `prisma generate`
// actually exist in the live database? The stale client hid this: TypeScript
// complained, but the runtime failure only surfaced as a 500 on one endpoint.
//
// Read-only. Exits non-zero if anything is missing so it can gate the next step.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXPECTED = [
  ["Client", "nextFollowUpAt"],
  ["AppUser", "avatar"],
  ["AppUser", "phone"],
  ["AppUser", "jobTitle"],
  ["AppUser", "notes"],
  ["AppUser", "userColumns"],
  ["AppUser", "clientColumns"],
  ["AppUser", "marketingColumns"],
  ["MarketingMetric", "name"],
];

const tuples = EXPECTED.map(([t, c]) => `('${t}', '${c}')`).join(", ");

const rows = await prisma.$queryRawUnsafe(`
  SELECT table_name AS "table", column_name AS "column"
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (${tuples})
`);

const present = new Set(rows.map((r) => `${r.table}.${r.column}`));
const missing = EXPECTED.filter(([t, c]) => !present.has(`${t}.${c}`));

console.log(`Found ${present.size}/${EXPECTED.length} expected columns in the database.`);
if (missing.length) {
  console.log("MISSING:");
  for (const [t, c] of missing) console.log(`  - ${t}.${c}`);
} else {
  console.log("All expected columns are present.");
}

// Prove the queries that were failing now work end to end.
try {
  const withFollowUp = await prisma.client.count({ where: { nextFollowUpAt: { not: null } } });
  console.log(`OK  client.count({ nextFollowUpAt }) = ${withFollowUp}`);
} catch (e) {
  console.log(`FAIL client.count({ nextFollowUpAt }): ${e.message.split("\n")[0]}`);
}

try {
  const users = await prisma.appUser.findMany({ select: { username: true, avatar: true } });
  console.log(`OK  appUser.findMany(avatar) = ${users.length} row(s)`);
} catch (e) {
  console.log(`FAIL appUser.findMany(avatar): ${e.message.split("\n")[0]}`);
}

try {
  const total = await prisma.client.count();
  console.log(`OK  client.count() = ${total}`);
} catch (e) {
  console.log(`FAIL client.count(): ${e.message.split("\n")[0]}`);
}

await prisma.$disconnect();
process.exit(missing.length ? 1 : 0);