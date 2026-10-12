"use client";

/**
 * "Last import" status strip — the Google Sheet sync state, visible OUTSIDE
 * the import modal.
 *
 * `SyncRun` has recorded every import since the beginning, but the only way to
 * READ it was to open the import dialog, which you would only do to run one.
 * This strip answers the two questions an admin actually asks on a normal day:
 *
 *   1. Did the last import succeed, and what did it write?
 *   2. Have the rows on screen been edited since that write? (`rowsNewer`
 *      compares max(lastUpdateDate) with the run's finish time — if true, the
 *      next import diff will show manual edits as "changed" rows.)
 *
 * Read-only and admin-only: the underlying GET /api/import/clients enforces
 * the role, and this component renders nothing when that fetch fails, so a
 * non-admin (or a broken endpoint) sees no chrome at all rather than an error
 * for data they were never allowed to see. `refreshKey` lets the page bump the
 * component after an import commits so the strip re-reads without a reload.
 */
import { useEffect, useState } from "react";
import { CloudDownload } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { formatDateTime, useTimeFormat } from "@/lib/time-format";

type SyncRun = {
  status: string;
  recordsRead: number;
  recordsWritten: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

type Health = {
  lastSyncRun?: SyncRun | null;
  latestClientUpdate?: string | null;
  rowsNewerThanLastImport?: boolean;
};

/** SyncRun.status → dictionary key. Unknown statuses fall back to the raw token. */
const STATUS_KEY: Record<string, string> = {
  ok: "import.statusOk",
  noop: "import.statusNoop",
  error: "import.statusError",
};

export default function ImportStatusStrip({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t, lang } = useLang();
  const [timeFormat] = useTimeFormat();
  // `null` = still loading. `{}` = loaded with nothing to show (or refused).
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/import/clients")
      .then((r) => (r.ok ? r.json() : null))
      // A refused or failed fetch leaves the state at `null`, i.e. "render
      // nothing": a non-admin (403) or a broken endpoint must not produce a
      // misleading "No imports yet" strip. A SUCCESSFUL response with no run
      // still arrives as an object and shows that honestly.
      .then((d: Health | null) => { if (alive && d) setHealth(d); })
      .catch(() => { /* leave `null` — stay invisible */ });
    return () => { alive = false; };
  }, [refreshKey]);

  if (!health) return null;
  const run = health.lastSyncRun ?? null;
  if (!run) {
    return (
      <div className="import-status-strip">
        <span className="import-status-title"><CloudDownload size={13} />{t("import.stripTitle")}</span>
        <span className="muted">{t("import.never")}</span>
      </div>
    );
  }

  const statusKey = STATUS_KEY[run.status];
  const statusLabel = statusKey ? t(statusKey) : run.status;
  const finished = run.finishedAt ?? run.startedAt;
  const newer = Boolean(health.rowsNewerThanLastImport);

  return (
    <div className="import-status-strip" title={run.error ?? undefined}>
      <span className="import-status-title"><CloudDownload size={13} />{t("import.stripTitle")}</span>
      <span className={`import-status-dot ${run.status === "error" ? "err" : run.status === "ok" ? "ok" : "warn"}`} />
      <span>
        {t("import.lastImport")}{" "}
        {Number.isNaN(new Date(finished).getTime())
          ? "—"
          : formatDateTime(finished, lang, timeFormat)}
      </span>
      <span className={run.status === "error" ? "import-status-bad" : ""}>{statusLabel}</span>
      <span className="muted">
        {t("import.records", { written: run.recordsWritten, read: run.recordsRead })}
      </span>
      <span className={newer ? "import-status-warn" : "muted"}>
        {newer ? t("import.newer") : t("import.fresh")}
      </span>
    </div>
  );
}