import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const users = await prisma.appUser.findMany({
  select: { username: true, name: true, role: true, avatar: true },
  orderBy: { role: "asc" },
});
for (const u of users) {
  console.log(`${u.username}\t${u.role}\t${u.name}\tavatar=${u.avatar ? `${u.avatar.slice(0, 24)}...` : "none"}`);
}
await prisma.$disconnect();