import { readFile } from "node:fs/promises";
import path from "node:path";
import { countUsers, createUser } from "./db";

let attempted = false;

/**
 * Safety net for the JSON -> Postgres cutover.
 *
 * Auth now reads Postgres, but the only copy of the user list historically
 * lived in data/rwaq-users.json. If the AppUser table is empty (e.g. the
 * operator forgot to run `npx prisma db seed`), import it once so nobody —
 * including the workspace owner — gets locked out.
 */
export async function ensureUsersBootstrapped(): Promise<void> {
  if (attempted) return;
  attempted = true;

  try {
    if ((await countUsers()) > 0) return;

    const file = path.join(process.cwd(), "data", "rwaq-users.json");
    const raw = await readFile(file, "utf-8");
    const users = JSON.parse(raw) as Array<{
      username: string;
      name?: string;
      email?: string;
      role?: string;
      hash: string;
    }>;

    let imported = 0;
    for (const user of users) {
      if (!user?.username || !user?.hash) continue;
      try {
        await createUser({
          username: user.username,
          name: user.name || user.username,
          email: user.email || undefined,
          role: user.role || "Sales",
          hash: user.hash,
        });
        imported += 1;
      } catch {
        // Already present — nothing to do.
      }
    }
    console.log(`[bootstrap] imported ${imported} user(s) from data/rwaq-users.json`);
  } catch (error) {
    console.warn("[bootstrap] skipped:", error instanceof Error ? error.message : error);
  }
}
