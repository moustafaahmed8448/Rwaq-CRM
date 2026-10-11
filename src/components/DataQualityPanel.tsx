"use client";

/**
 * Data-quality panel.
 *
 * Backs /api/analytics/data-quality. The clients table shows what is stored; it
 * cannot show what is MISSING, so an unusable row stays invisible until someone
 * tries to call it. This lists the gaps grouped by kind, worst first.
 *
 * Read-only: nothing here repairs a row. Fixing means opening the client, which
 * is what the sample rows are for.
 */
import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { downloadFile } from "@/lib/download";

type Group = {
  kind: string;
  count: number;
  sample: Array<{ clientId: string; name: string; detail: string }>;
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** The route's own kind values, so a new one cannot render as a raw token. */
const KINDS = [
  "no_name", "no_phone", "bad_phone", "no_owner", "no_project",
  "no_location", "no_next_action", "unknown_channel", "unknown_status",
] as const;

export default function DataQualityPanel({ t, canExport }: { t: TFn; canExport: boolean }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; clientCount: number; scanned: number } | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/analytics/data-quality", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: { issues?: Group[]; total?: number; clientCount?: number; scanned?: number }) => {
        if (!active) return;
        setGroups(d.issues ?? []);
        setMeta({
          total: d.total ?? 0,
          clientCount: d.clientCount ?? 0,
          scanned: d.scanned ?? 0,
        });
      })
      .catch(() => {
        if (active) setError(t("errors.generic"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  /**
   * Hands the whole audit trail to the browser.
   *
   * A plain navigation rather than fetch: the route streams a binary .xlsx with
   * a Content-Disposition filename, and letting the browser handle it is what
   * makes "Save as…" appear. A 403 (non-admin) shows the browser's own body, so
   * the button is only rendered for admins in the first place.
   */
  const exportLog = () => {
    setExporting(true);
    void downloadFile("/api/export/activity", "activity-log.xlsx")
      .catch(() => setError(t("errors.generic")))
      .finally(() => setExporting(false));
  };

  if (error) return <p className="muted" style={{ fontSize: 12 }}>{error}</p>;
  if (!groups || !meta) return <p className="muted" style={{ fontSize: 12 }}>{t("common.loading")}</p>;

  return (
    <section className="panel dq-panel">
      <div className="followup-workspace-head">
        <h3>
          <ClipboardCheck size={15} />
          {t("dq.title")}
        </h3>
        <span className="muted" style={{ fontSize: 11 }}>
          {meta.total > 0
            ? t("dq.subtitle", { n: meta.total, rows: meta.clientCount })
            : t("dq.subtitle", { n: 0, rows: 0 })}
        </span>
      </div>

      {meta.total === 0 ? (
        <p className="muted" style={{ fontSize: 12, padding: "8px 0" }}>{t("dq.clean")}</p>
      ) : (
        <div className="dq-table-wrap">
          <table className="dq-table">
            <thead>
              <tr>
                <th>{t("dq.title")}</th>
                <th className="r-num">{t("team.leads")}</th>
                <th>{t("dq.sampleHead")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.kind}>
                  <td className="dq-kind">
                    {/* Localized when known; the raw token is better than a blank
                        if the server ever adds a check this build lacks. */}
                    {KINDS.includes(group.kind as typeof KINDS[number]) ? t(`dq.${group.kind}`) : group.kind}
                  </td>
                  <td className="r-num"><span className="dq-count">{group.count}</span></td>
                  <td>
                    <p className="dq-sample">
                      {group.sample
                        .slice(0, 4)
                        .map((row) => row.detail ? `${row.name} (${row.detail})` : row.name)
                        .join(" · ")}
                      {group.sample.length > 4 && ` +${group.count - 4}`}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Only an admin can fetch this route, so the button is admin-only too —
          a rep clicking it would download the route's HTML error body. */}
      {canExport && (
        <div className="dq-actions">
          <button className="btn-outline" onClick={exportLog} disabled={exporting}>
            {exporting ? t("common.loading") : t("dq.export")}
          </button>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            {t("dq.scanned", { n: meta.scanned })}
          </p>
        </div>
      )}
    </section>
  );
}
