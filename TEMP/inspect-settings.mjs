import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows = await prisma.setting.findMany({
  where: { key: { startsWith: "savedViews" } },
});
console.log(`rows with a savedViews key: ${rows.length}`);
for (const r of rows) {
  console.log(`  key=${r.key}`);
  console.log(`  isArray=${Array.isArray(r.value)}  value=${JSON.stringify(r.value).slice(0, 300)}`);
}
// Also show every setting key so an unexpected one is obvious.
const all = await prisma.setting.findMany({ select: { key: true } });
console.log(`\nall Setting keys (${all.length}):`);
for (const r of all) console.log(`  ${r.key}`);
await prisma.$disconnect();