// One-off: removes ALL demo-named clients (used to recover from a double
// seed caused by parallel execution). Deleted after use.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const names = [
  "Mohammed Al-Harbi", "Sarah Al-Qahtani", "Abdulaziz Al-Otaibi", "Nourah Al-Shehri",
  "Faisal Al-Dossari", "Reem Al-Anazi", "Khalid Al-Mutairi", "Layla Al-Ghamdi",
  "Bandar Al-Subaie", "Hessa Al-Shammari", "Turki Al-Sabhan", "Maha Al-Rasheed",
  "Omar Bahareth", "Rania Zaher", "Yousef Malki",
];
const res = await prisma.client.deleteMany({ where: { name: { in: names } } });
console.log("deleted demo rows:", res.count);
console.log("clients remaining:", await prisma.client.count());
await prisma.$disconnect();
