import { defineConfig } from "prisma/config";

// Once a Prisma config file exists, the CLI no longer auto-loads .env -- so we
// load it here explicitly. process.loadEnvFile() is built into Node (>= 20.12),
// so this needs no dotenv dependency.
try {
  process.loadEnvFile();
} catch {
  // No .env on disk -- normal on Vercel, where the platform injects the
  // variables (DATABASE_URL, DATABASE_URL_UNPOOLED) into the environment.
}

// Replaces the deprecated `prisma` key in package.json.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mjs",
  },
});