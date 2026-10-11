"use client";

/**
 * Per-owner performance panel.
 *
 * Backs /api/analytics/team. The clients screen already answers "what is due"
 * and "what went quiet"; this answers "who is carrying the book", which no
 * existing surface does — the imbalance it exposes is the reason follow-ups get
 * missed in a busy team.
 *
 * Read-only and self-scoping: the API returns one row for a rep and the whole
 * team for an admin, so nothing here needs a role check.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Users } from "lucide-react";
import { dateLocale } from "@/lib/format";
import { roleLabel } from "@/lib/reporting";

type Owner = {
  name: string;
  role: string;
  active: boolean;
  total: number;
  won: number;
  lost: number;
  inProgress: number;
  open: number;
  archived: number;
  overdueFollowUps: number;
  dueFollowUps: number;
  winRate: number;
  lastTouch: string | null;
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Busiest-book share above which the row is called out. */
const LOAD_FLAG = 0.4;

export default function TeamReportPanel({ t, lang }: { t: TFn; lang: string }) {
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/analytics/team", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: { owners?: Owner[] }) => {
        if (active) setOwners(d.owners ?? []);
      })
      .catch(() => {
        if (active) setError(t("errors.generic"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  if (error) return <p className="muted" style={{ fontSize: 12 }}>{error}</p>;
  if (!owners) return <p className="muted" style={{ fontSize: 12 }}>{t("common.loading")}</p>;
  if (owners.length === 0) {
    return <p className="muted" style={{ fontSize: 12, padding: "8px 0" }}>{t("team.empty")}</p>;
  }

  const liveTotal = owners.reduce((sum, o) => sum + o.total - o.archived, 0);

  return (
    <section className="panel team-panel">
      <div className="followup-workspace-head">
        <h3>
          <Users size={15} />
          {t("team.title")}
        </h3>
        <span className="muted" style={{ fontSize: 11 }}>
          {t("team.subtitle", { n: owners.length, clients: liveTotal })}
        </span>
      </div>

      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th>{t("th.first")}</th>
              <th>{t("team.role")}</th>
              <th className="r-num">{t("team.leads")}</th>
              <th className="r-num">{t("team.won")}</th>
              <th className="r-num">{t("team.lost")}</th>
              <th className="r-num">{t("team.winRate")}</th>
              <th className="r-num">{t("team.overdue")}</th>
              <th>{t("team.lastTouch")}</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((owner) => {
              const live = owner.total - owner.archived;
              const share = liveTotal > 0 ? live / liveTotal : 0;
              return (
                <tr key={owner.name}>
                  <td>
                    <strong>{owner.name}</strong>
                    {/* A name carrying leads but absent from the roster is a
                        leaver or free text — worth surfacing, not hiding. */}
                    {!owner.active && (
                      <span className="team-flag" title={t("team.notOnTeam")}>
                        <AlertTriangle size={11} />
                      </span>
                    )}
                  </td>
                  <td className="muted">{owner.role ? roleLabel(t, owner.role) : "—"}</td>
                  <td className="r-num">
                    {share > LOAD_FLAG && owners.length > 1
                      ? <span className="team-load" title={t("team.loadHint")}>{live}</span>
                      : live}
                  </td>
                  <td className="r-num">{owner.won}</td>
                  <td className="r-num">{owner.lost}</td>
                  <td className="r-num">
                    {owner.won + owner.lost > 0 ? `${owner.winRate}%` : "—"}
                  </td>
                  <td className="r-num">
                    {owner.overdueFollowUps > 0
                      ? <span className="team-overdue">{owner.overdueFollowUps}</span>
                      : "—"}
                  </td>
                  <td className="muted">
                    {/* A date, not "3 days ago": this column is scanned for the
                        OLDEST touch across a row of owners, and a relative
                        phrase is hard to compare down a column. */}
                    {owner.lastTouch ? new Date(owner.lastTouch).toLocaleDateString(dateLocale(lang)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
