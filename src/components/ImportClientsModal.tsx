"use client";

/**
 * Import dialog for the public Google Sheet.
 *
 * Preview is mandatory. The button stays disabled until a preview has run, so
 * a misconfigured sheet or a half-typed gid can never write a few hundred rows
 * unseen — the counts, the status mapping and the new reference values are all
 * shown first, and the commit button reports exactly that many rows.
 */
import { useMemo, useState } from "react";
import { AlertCircle, Check, Download, Loader2, X as XIcon } from "lucide-react";
import { apiErrorMessage } from "@/lib/api-errors";
import { activityFieldLabel, activityValueLabel } from "@/lib/reporting";
import type { DiffKind, DiffRow, FieldChange } from "@/lib/import-clients";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

type SkipReason = "no_name" | "no_phone" | "duplicate_in_sheet";

type DbOnlyClient = {
  id: string;
  name: string;
  phoneNumber: string;
};

type Summary = {
  source: string;
  toCreate: number;
  toUpdate: number;
  identical: number;
  skipped: number;
  skippedByReason: Partial<Record<SkipReason, number>>;
  dateAssumed: number;
  newStatuses: string[];
  newChannels: string[];
  newLocations: string[];
  statusMapping: Array<{ from: string; to: string; count: number }>;
  repairedRows: Array<{ rowNumber: number; fields: string[] }>;
  skippedSample: Array<{ rowNumber: number; name: string; phone: string; reason: SkipReason }>;
  diff: DiffRow[];
  dbOnly: DbOnlyClient[];
};

/** Dictionary key per skip reason, used for the skip breakdown. */
const SKIP_LABEL: Record<SkipReason, string> = {
  no_name: "importer.skipNoName",
  no_phone: "importer.skipNoPhone",
  duplicate_in_sheet: "importer.skipDuplicate",
};

/** Tabs in display order. db_only is reported separately, not as a tab. */
const TABS: DiffKind[] = ["new", "changed", "identical", "skipped"];
const TAB_KEY: Record<DiffKind, string> = {
  new: "importer.tabNew",
  changed: "importer.tabChanged",
  identical: "importer.tabIdentical",
  skipped: "importer.tabSkipped",
  db_only: "importer.tabDbOnly",
};

/**
 * One row to act on, mapped to the differing fields the user chose to KEEP.
 * Absence from the map means the row is skipped.
 */
type Picked = Map<number, Set<string>>;

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

/** Localized, human-readable value for one side of a change. */
function valueOf(t: TFn, change: FieldChange, side: "db" | "sheet"): string {
  return activityValueLabel(t, change.field, change[side]) || t("form.unassigned");
}

/** Stable empty array, so `summary?.diff ?? EMPTY` does not hand useMemo a fresh
 *  reference on every render and defeat the memo. */
const EMPTY: DiffRow[] = [];

export default function ImportClientsModal({
  onClose,
  onImported,
  t,
}: {
  onClose: () => void;
  /** Called with what was created and what was updated, so the parent can toast + refetch. */
  onImported: (result: { imported: number; updated: number }) => void;
  t: TFn;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<DiffKind>("new");
  const [picked, setPicked] = useState<Picked>(new Map());

  const call = async (mode: "preview" | "commit"): Promise<void> => {
    setBusy(mode);
    setError("");
    try {
      const res = await fetch("/api/import/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only row numbers and kept field names cross the wire. The server
        // re-reads the sheet and rebuilds the plan, so nothing here can name a
        // client to overwrite.
        body: JSON.stringify(
          mode === "commit"
            ? { mode, rows: [...picked].map(([rowNumber, keep]) => ({ rowNumber, keep: [...keep] })) }
            : { mode },
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: unknown };
        setError(apiErrorMessage(t, body.error));
        return;
      }
      const data = (await res.json()) as Summary & { imported?: number; updated?: number };
      if (mode === "commit") {
        onImported({ imported: data.imported ?? 0, updated: data.updated ?? 0 });
        onClose();
        return;
      }
      setSummary(data);
      // New and changed rows are pre-selected; an empty keep-set means "take the
      // sheet value for every field that differs". Identical rows have nothing to
      // write, so they start unselected.
      const seed = new Map<number, Set<string>>();
      for (const row of data.diff) {
        if (row.rowNumber === null) continue;
        if (row.kind === "new" || row.kind === "changed") seed.set(row.rowNumber, new Set());
      }
      setPicked(seed);
      setTab(TABS.find((k) => data.diff.some((r) => r.kind === k)) ?? "new");
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const rows = summary?.diff ?? EMPTY;
  const byKind = useMemo(() => {
    const map = new Map<DiffKind, DiffRow[]>();
    for (const row of rows) {
      const list = map.get(row.kind);
      if (list) list.push(row);
      else map.set(row.kind, [row]);
    }
    return map;
  }, [rows]);

  const visible = byKind.get(tab) ?? [];

  /** What the button will actually do: picked rows, minus the fields kept. */
  const totals = useMemo(() => {
    let creates = 0;
    let updates = 0;
    const byRow = new Map(rows.map((r) => [r.rowNumber, r]));
    for (const [rowNumber, keep] of picked) {
      const row = byRow.get(rowNumber);
      if (!row) continue;
      if (row.kind === "new") creates += 1;
      // A changed row where every field is kept has nothing left to write.
      else if (row.kind === "changed" && row.changes.some((c) => !keep.has(c.field))) updates += 1;
    }
    return { creates, updates };
  }, [picked, rows]);

  const setAll = (on: boolean): void => {
    setPicked((prev) => {
      const next = new Map(prev);
      for (const row of visible) {
        if (row.rowNumber === null) continue;
        if (on) {
          if (!next.has(row.rowNumber)) next.set(row.rowNumber, new Set());
        } else {
          next.delete(row.rowNumber);
        }
      }
      return next;
    });
  };

  const toggleRow = (row: DiffRow): void => {
    setPicked((prev) => {
      const next = new Map(prev);
      const key = row.rowNumber as number;
      if (next.has(key)) next.delete(key);
      else next.set(key, new Set());
      return next;
    });
  };

  /** Flips one field between "take the sheet value" and "keep the CRM value". */
  const toggleField = (row: DiffRow, field: string): void => {
    setPicked((prev) => {
      const key = row.rowNumber as number;
      const keep = new Set(prev.get(key));
      if (keep.has(field)) keep.delete(field);
      else keep.add(field);
      return new Map(prev).set(key, keep);
    });
  };

  const canImport = totals.creates + totals.updates > 0 && busy === null;

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
                  <strong>{summary.toUpdate}</strong>
                  <span>{t("importer.willUpdate", { n: summary.toUpdate })}</span>
                </div>
                <div className="imp-stat">
                  <strong>{summary.identical}</strong>
                  <span>{t("importer.unchanged", { n: summary.identical })}</span>
                </div>
              </div>

              {summary.toCreate === 0 && summary.toUpdate === 0 && <p className="imp-note">{t("importer.noNew")}</p>}
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

              {/* ── Per-row diff ─────────────────────────────────────── */}
              <div className="imp-diff">
                <div className="imp-tabs" role="tablist">
                  {TABS.map((kind) => (
                    <button
                      key={kind}
                      role="tab"
                      type="button"
                      aria-selected={tab === kind}
                      className={`imp-tab ${tab === kind ? "active" : ""}`}
                      onClick={() => setTab(kind)}
                    >
                      {t(TAB_KEY[kind])}
                      <span className="imp-tab-n">{byKind.get(kind)?.length ?? 0}</span>
                    </button>
                  ))}
                </div>

                <div className="imp-diff-bar">
                  <button type="button" className="btn-ghost imp-mini" onClick={() => setAll(true)} disabled={visible.length === 0}>
                    {t("importer.selectAll")}
                  </button>
                  <button type="button" className="btn-ghost imp-mini" onClick={() => setAll(false)} disabled={visible.length === 0}>
                    {t("importer.selectNone")}
                  </button>
                  <span className="imp-diff-hint">
                    {tab === "changed" ? t("importer.changedHint") : t("importer.tabHint")}
                  </span>
                </div>

                <div className="imp-rows">
                  {visible.length === 0 && <p className="imp-empty">{t("importer.tabEmpty")}</p>}
                  {visible.map((row) => {
                    const on = row.rowNumber !== null && picked.has(row.rowNumber);
                    const keep = picked.get(row.rowNumber ?? -1) ?? new Set<string>();
                    return (
                      <div key={`${row.kind}-${row.rowNumber ?? row.clientId}`} className={`imp-row imp-row-${row.kind}`}>
                        {row.rowNumber !== null && row.kind !== "skipped" && (
                          <label className="imp-row-check">
                            <input type="checkbox" checked={on} onChange={() => toggleRow(row)} aria-label={row.name} />
                          </label>
                        )}
                        <div className="imp-row-main">
                          <div className="imp-row-head">
                            <strong className="imp-row-name">{row.name || t("form.unnamedClient")}</strong>
                            {row.phone && <span className="imp-row-phone ltr-num">{row.phone}</span>}
                            {row.rowNumber !== null && (
                              <span className="imp-row-src">{t("importer.sheetRow", { n: row.rowNumber })}</span>
                            )}
                            {row.archived && <span className="imp-flag">{t("importer.archivedMatch")}</span>}
                            {row.reason && <span className="imp-flag">{t(SKIP_LABEL[row.reason])}</span>}
                          </div>

                          {row.kind === "new" && (
                            <div className="imp-row-meta">
                              <span>{`${t("form.status")}: ${activityValueLabel(t, "status", row.status)}`}</span>
                              <span>{`${t("form.channel")}: ${activityValueLabel(t, "acquisitionChannel", row.channel)}`}</span>
                              {row.location && <span>{row.location}</span>}
                            </div>
                          )}

                          {row.kind === "changed" && (
                            <ul className="imp-fields">
                              {row.changes.map((change) => {
                                const kept = keep.has(change.field);
                                return (
                                  <li key={change.field} className={kept ? "kept" : ""}>
                                    <span className="imp-field-name">{activityFieldLabel(t, change.field)}</span>
                                    <span className="imp-field-pair">
                                      <span className="imp-field-val old">{valueOf(t, change, "db")}</span>
                                      <span className="imp-field-arrow">→</span>
                                      <span className="imp-field-val new">{valueOf(t, change, "sheet")}</span>
                                    </span>
                                    <button
                                      type="button"
                                      className="imp-field-toggle"
                                      onClick={() => toggleField(row, change.field)}
                                      disabled={!on}
                                      title={t("importer.toggleField")}
                                    >
                                      {kept ? t("importer.keepCrm") : t("importer.useSheet")}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {row.kind === "identical" && (
                            <div className="imp-row-meta">{t("importer.unchangedHint")}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── CRM-only clients: reported, never actioned ───────── */}
              {summary.dbOnly.length > 0 && (
                <div className="imp-block">
                  <span className="imp-block-title">{`${t("importer.tabDbOnly")} (${summary.dbOnly.length})`}</span>
                  <p className="imp-hint">{t("importer.dbOnlyHint")}</p>
                  <div className="imp-rows imp-rows-static">
                    {summary.dbOnly.slice(0, 30).map((c) => (
                      <div key={c.id} className="imp-row imp-row-db_only">
                        <div className="imp-row-main">
                          <div className="imp-row-head">
                            <strong className="imp-row-name">{c.name}</strong>
                            {c.phoneNumber && <span className="imp-row-phone ltr-num">{c.phoneNumber}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                    {summary.dbOnly.length > 30 && <p className="imp-empty">{`+${summary.dbOnly.length - 30}`}</p>}
                  </div>
                </div>
              )}
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
            {busy === "commit"
              ? t("importer.importing")
              : t("importer.commitMixed", { a: totals.creates, b: totals.updates })}
          </button>
        </div>
      </div>
    </div>
  );
}

