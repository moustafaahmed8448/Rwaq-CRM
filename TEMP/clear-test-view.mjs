import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
// Removes only the saved-views test row, leaving every other Setting untouched.
const res = await prisma.setting.deleteMany({ where: { key: { startsWith: "savedViews" } } });
console.log(`deleted ${res.count} savedViews row(s)`);
const left = await prisma.setting.findMany({ select: { key: true } });
console.log(`remaining Setting keys: ${left.map((r) => r.key).join(", ")}`);
await prisma.$disconnect();