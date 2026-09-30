"use client";

/**
 * Import dialog for the public Google Sheet.
 *
 * Preview is mandatory. The button stays disabled until a preview has run, so
 * a misconfigured sheet or a half-typed gid can never write a few hundred rows
 * unseen — the counts, the status mapping and the new reference values are all
 * shown first, and the commit button reports exactly that many rows.
 */
import { useState } from "react";
import { AlertCircle, Check, Download, Loader2, X as XIcon } from "lucide-react";
import { apiErrorMessage } from "@/lib/api-errors";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

type SkipReason = "no_name" | "no_phone" | "duplicate_in_sheet" | "already_in_db";

type Summary = {
  source: string;
  toCreate: number;
  skipped: number;
  skippedByReason: Partial<Record<SkipReason, number>>;
  dateAssumed: number;
  newStatuses: string[];
  newChannels: string[];
  newLocations: string[];
  statusMapping: Array<{ from: string; to: string; count: number }>;
  repairedRows: Array<{ rowNumber: number; fields: string[] }>;
  skippedSample: Array<{ rowNumber: number; name: string; phone: string; reason: SkipReason }>;
};

/** Dictionary key per skip reason, used for the skip breakdown. */
const SKIP_LABEL: Record<SkipReason, string> = {
  no_name: "importer.skipNoName",
  no_phone: "importer.skipNoPhone",
  duplicate_in_sheet: "importer.skipDuplicate",
  already_in_db: "importer.skipExisting",
};

/** Long lists are collapsed; the full set is still counted in the heading. */
const PREVIEW_LIMIT = 12;

/** A titled block of comma-separated reference values, with a +N overflow note. */
function RefList({ title, values, t }: { title: string; values: string[]; t: TFn }) {
  if (values.length === 0) return null;
  const shown = values.slice(0, PREVIEW_LIMIT);
  const rest = values.length - shown.length;
  return (
    <div className="imp-block">
      <span className="imp-block-title">{t(title, { n: values.length })}</span>
      <p className="imp-values">
        {shown.join("، ")}
        {rest > 0 && <span className="imp-more"> +{rest}</span>}
      </p>
    </div>
  );
}

export default function ImportClientsModal({
  onClose,
  onImported,
  t,
}: {
  onClose: () => void;
  /** Called with the imported count (0 on a no-op) so the parent can toast + refetch. */
  onImported: (imported: number) => void;
  t: TFn;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState("");

  const call = async (mode: "preview" | "commit"): Promise<void> => {
    setBusy(mode);
    setError("");
    try {
      const res = await fetch("/api/import/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: unknown };
        setError(apiErrorMessage(t, body.error));
        return;
      }
      const data = (await res.json()) as Summary & { imported?: number };
      if (mode === "commit") {
        onImported(data.imported ?? 0);
        onClose();
        return;
      }
      setSummary(data);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const toCreate = summary?.toCreate ?? 0;
  // The commit button stays disabled until a preview has run, so nothing is ever
  // written blind.
  const canImport = summary !== null && toCreate > 0 && busy === null;

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("importer.title")}</h2>
          <button className="modal-close" onClick={onClose} disabled={busy !== null} aria-label={t("common.close")}>
            <XIcon size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="imp-sub">{t("importer.subtitle")}</p>
          {summary && (
            <p className="imp-source">
              <span className="muted">{t("importer.source")}: </span>
              <a href={summary.source} target="_blank" rel="noreferrer noopener" dir="ltr">{summary.source}</a>
            </p>
          )}

          {error && <div className="imp-error"><AlertCircle size={15} />{error}</div>}

          {busy === "preview" && !summary && (
            <p className="imp-busy"><Loader2 size={15} className="imp-spin" />{t("importer.previewing")}</p>
          )}

          {summary && (
            <div className="imp-report">
              <div className="imp-stats">
                <div className="imp-stat">
                  <strong>{summary.toCreate}</strong>
                  <span>{t("importer.willCreate", { n: summary.toCreate })}</span>
                </div>
                <div className="imp-stat">
                  <strong>{summary.skipped}</strong>
                  <span>{t("importer.willSkip", { n: summary.skipped })}</span>
                </div>
              </div>

              {summary.toCreate === 0 && <p className="imp-note">{t("importer.noNew")}</p>}
              {summary.dateAssumed > 0 && <p className="imp-note">{t("importer.dateAssumed", { n: summary.dateAssumed })}</p>}
              {summary.repairedRows.length > 0 && <p className="imp-note">{t("importer.repaired", { n: summary.repairedRows.length })}</p>}

              {/* Every skip reason, so a surprising count is explainable here
                  rather than requiring a trip to the sheet. */}
              {summary.skipped > 0 && (
                <ul className="imp-skips">
                  {(Object.keys(SKIP_LABEL) as SkipReason[])
                    .filter((reason) => (summary.skippedByReason[reason] ?? 0) > 0)
                    .map((reason) => (
                      <li key={reason}>
                        <span>{t(SKIP_LABEL[reason])}</span>
                        <strong>{summary.skippedByReason[reason]}</strong>
                      </li>
                    ))}
                </ul>
              )}

              <RefList title="importer.newStatuses" values={summary.newStatuses} t={t} />
              <RefList title="importer.newChannels" values={summary.newChannels} t={t} />
              <RefList title="importer.newLocations" values={summary.newLocations} t={t} />

              <div className="imp-block">
                <span className="imp-block-title">{t("importer.statusMap")}</span>
                <p className="imp-hint">{t("importer.statusMapHint")}</p>
                <ul className="imp-map">
                  {summary.statusMapping.map((row) => (
                    <li key={row.from}>
                      <span className="imp-map-from">{row.from}</span>
                      <span className="imp-map-arrow">→</span>
                      <span className="imp-map-to">{row.to}</span>
                      <span className="imp-map-count">×{row.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy !== null}>{t("common.cancel")}</button>
          <button className="btn-outline" onClick={() => void call("preview")} disabled={busy !== null}>
            {busy === "preview" ? <Loader2 size={15} className="imp-spin" /> : <Download size={15} />}
            {t("importer.preview")}
          </button>
          <button className="btn-primary" onClick={() => void call("commit")} disabled={!canImport}>
            {busy === "commit" ? <Loader2 size={15} className="imp-spin" /> : <Check size={15} />}
            {busy === "commit" ? t("importer.importing") : t("importer.commit", { n: toCreate })}
          </button>
        </div>
      </div>
    </div>
  );
}

