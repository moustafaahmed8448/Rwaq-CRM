"use client";

/**
 * Stale-book attention list: live rows with no update in N days and no
 * upcoming follow-up.
 *
 * Follow-ups answer "what is due"; this answers "what went quiet". N is
 * adjustable because "stale" is a workspace judgement, not a constant.
 */
import { useMemo, useState } from "react";
import { AlarmClock } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import ContactButtons from "@/components/ContactButtons";
import { dateInputValue, dateLocale } from "@/lib/format";
import type { Client, TFn } from "@/lib/client-types";

export default function StaleClientsPanel({
  clients,
  onOpenDetail,
  t,
  lang,
}: {
  clients: Client[];
  onOpenDetail: (c: Client) => void;
  t: TFn;
  lang: string;
}) {
  const [days, setDays] = useState(14);
  const rows = useMemo(() => {
    const cutoff = Date.now() - days * 86400000;
    const todayKey = dateInputValue(new Date().toISOString());
    return clients
      .filter((c) => {
        if (c.archived) return false;
        const updated = c.lastUpdateDate ? new Date(c.lastUpdateDate).getTime() : 0;
        if (!(updated < cutoff)) return false;
        const fu = dateInputValue(c.nextFollowUpAt);
        return !fu || fu < todayKey;
      })
      .sort((a, b) => String(a.lastUpdateDate ?? "").localeCompare(String(b.lastUpdateDate ?? "")))
      .slice(0, 50);
  }, [clients, days]);

  return (
    <section className="panel stale-panel">
      <div className="followup-workspace-head">
        <h3>
          <AlarmClock size={15} />
          {t("stale.title")}
        </h3>
        <label className="stale-days">
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 14))}
          />
          {t("stale.days", { n: days })}
        </label>
      </div>
      <p className="muted">{t("stale.sub", { n: days })}</p>
      {rows.length === 0 ? (
        <div className="empty-state">{t("stale.empty")}</div>
      ) : (
        <ul className="linked-list">
          {rows.map((c) => (
            <li key={c.id} className="linked-row">
              <span className="linked-id">#{c.id}</span>
              <span className="linked-main">
                <b className="linked-name">{c.name}</b>
                <span className="linked-sub">
                  <span className="ltr-num">{c.phoneNumber}</span>
                  {c.lastUpdateDate && (
                    <> · {new Date(c.lastUpdateDate).toLocaleDateString(dateLocale(lang))}</>
                  )}
                </span>
              </span>
              <StatusPill status={c.status} t={t} variant="badge" />
              <ContactButtons phone={c.phoneNumber} t={t} compact />
              <button type="button" className="btn-outline btn-sm" onClick={() => onOpenDetail(c)}>
                {t("stale.open")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
