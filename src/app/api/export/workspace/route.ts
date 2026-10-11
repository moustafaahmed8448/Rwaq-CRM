import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  databaseErrorMessage,
  listClients,
  listMetrics,
  listUsers,
  readSetting,
  readSettingObject,
} from "@/lib/db";

/**
 * Full-workspace JSON backup (admin only).
 *
 * The clients and marketing exports are spreadsheet-shaped for reading; this one
 * is a machine-readable SNAPSHOT of the whole workspace — every client (including
 * archived rows and their activity logs), every marketing metric, the team (public
 * fields only, never password hashes), and the reference lists an admin has
 * curated. It is the artifact you keep so the data can be reconstructed if the
 * database is ever lost.
 *
 * Deliberately export-only. There is no matching import/restore here: replaying a
 * snapshot into a live database is exactly where silent data-loss mistakes happen
 * (merging vs. overwriting, duplicate ids, half-applied batches). Restoring is a
 * separate, careful operation, not a button next to this one.
 *
 * Scoped to Admin via requireRole — a snapshot of the whole book is the single most
 * sensitive export in the app.
 */
export async function GET(request: NextRequest) {
  const admin = await requireRole(request, ["Admin"]);
  if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  try {
    // includeArchived so the backup is complete — an archived client is still a
    // client, and a restore that silently dropped them would be a data loss.
    const [clients, metrics, users, channels, statuses, locations, optionColors, statusBuckets, statusLabels] =
      await Promise.all([
        listClients({ includeArchived: true }),
        listMetrics(),
        listUsers(),
        readSetting("channels"),
        readSetting("statuses"),
        readSetting("locations"),
        readSettingObject("optionColors"),
        readSettingObject("statusBuckets"),
        readSettingObject("statusLabels"),
      ]);

    const payload = {
      // A version + timestamp so a restored file can be identified and, later, a
      // migration can decide how to read it.
      app: "rwaq-crm",
      kind: "workspace-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: admin.name,
      counts: {
        clients: clients.length,
        metrics: metrics.length,
        users: users.length,
      },
      // Public user shape only — username/name/email/role/profile. `hash` is never
      // included, so a leaked backup file cannot be used to log in.
      users: users.map((u) => ({
        username: u.username,
        name: u.name,
        email: u.email ?? null,
        role: u.role,
        phone: u.phone ?? null,
        jobTitle: u.jobTitle ?? null,
        notes: u.notes ?? null,
        language: u.language,
      })),
      clients,
      metrics,
      settings: {
        channels,
        statuses,
        locations,
        optionColors,
        statusBuckets,
        statusLabels,
      },
    };

    const json = JSON.stringify(payload, null, 2);
    const stamp = payload.exportedAt.slice(0, 10);
    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // `filename*` with the UTF-8 form so a non-ASCII-safe client still reads it.
        "Content-Disposition": `attachment; filename="rwaq-backup-${stamp}.json"; filename*=UTF-8''rwaq-backup-${stamp}.json`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
