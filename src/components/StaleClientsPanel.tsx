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

const PRESETS = [7, 14, 30, 60];
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 14;

/** Whole days between a stored timestamp and local today (negative = future). */
function daysAgo(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(new Date(timestamp).getFullYear(), new Date(timestamp).getMonth(), new Date(timestamp).getDate()).getTime();
  return Math.round((startOfToday - startOfDay) / 86400000);
}

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
  const [days, setDays] = useState(DEFAULT_DAYS);
  /* Text buffer so clearing the field to type "30" does not snap back to 14
     mid-keystroke. Committed to `days` on blur / Enter / preset click. */
  const [daysText, setDaysText] = useState(String(DEFAULT_DAYS));
  const [daysError, setDaysError] = useState("");

  const commitDays = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setDaysText(String(days));
      setDaysError("");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < MIN_DAYS || parsed > MAX_DAYS) {
      setDaysError(t("stale.invalid"));
      setDaysText(String(days));
      return;
    }
    setDaysError("");
    setDays(Math.floor(parsed));
    setDaysText(String(Math.floor(parsed)));
  };

  const rows = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    /* Inclusive window: "30 days" means the last 30 calendar days including
       today, so the cutoff is start-of-today minus (days - 1). Using raw
       Date.now() - days * 86400s shifted the boundary by hours and excluded
       rows updated earlier today around midnight. */
    const cutoff = startOfToday - (days - 1) * 86400000;
    const todayKey = dateInputValue(new Date().toISOString());
    return clients
      .filter((c) => {
        if (c.archived) return false;
        /* Day granularity: a row updated at any hour today counts as today.
           Missing timestamp counts as infinitely stale, not as fresh. */
        const dayStart = c.lastUpdateDate
          ? (() => {
              const d = new Date(c.lastUpdateDate);
              return Number.isNaN(d.getTime()) ? 0 : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            })()
          : 0;
        if (!(dayStart < cutoff)) return false;
        const fu = dateInputValue(c.nextFollowUpAt);
        return !fu || fu < todayKey;
      })
      .sort((a, b) => String(a.lastUpdateDate ?? "").localeCompare(String(b.lastUpdateDate ?? "")))
      .slice(0, 100);
  }, [clients, days]);

  return (
    <section className="panel stale-panel">
      <div className="followup-workspace-head">
        <h3>
          <AlarmClock size={15} />
          {t("stale.title")}
        </h3>
        <div className="stale-controls">
          <div className="stale-presets" role="group" aria-label={t("stale.title")}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={days === preset ? "active" : ""}
                aria-pressed={days === preset}
                onClick={() => {
                  setDays(preset);
                  setDaysText(String(preset));
                  setDaysError("");
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <label className="stale-days">
            <input
              type="number"
              min={MIN_DAYS}
              max={MAX_DAYS}
              inputMode="numeric"
              value={daysText}
              aria-label={t("stale.daysLabel")}
              onChange={(e) => {
                setDaysText(e.target.value);
                if (daysError) setDaysError("");
              }}
              onBlur={(e) => commitDays(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            {t("stale.days", { n: days })}
          </label>
        </div>
      </div>
      <p className="muted">{t("stale.sub", { n: days })}</p>
      {daysError && <p className="stale-error" role="alert">{daysError}</p>}
      <p className="muted stale-count">{t("stale.count", { n: rows.length })}</p>
      {rows.length === 0 ? (
        <div className="empty-state">{t("stale.empty")}</div>
      ) : (
        <ul className="linked-list">
          {rows.map((c) => {
            const quiet = daysAgo(c.lastUpdateDate);
            return (
              <li key={c.id} className="linked-row">
                <span className="linked-id">#{c.id}</span>
                <span className="linked-main">
                  <b className="linked-name">{c.name}</b>
                  <span className="linked-sub">
                    <span className="ltr-num">{c.phoneNumber}</span>
                    {c.lastUpdateDate && (
                      <> · {new Date(c.lastUpdateDate).toLocaleDateString(dateLocale(lang))}</>
                    )}
                    {quiet !== null && quiet >= 0 && (
                      <span className="stale-ago">{t("stale.daysAgo", { n: quiet })}</span>
                    )}
                  </span>
                </span>
                <span className="linked-side">
                  <StatusPill status={c.status} t={t} variant="badge" />
                  <ContactButtons phone={c.phoneNumber} t={t} compact />
                  <button type="button" className="btn-outline btn-sm" onClick={() => onOpenDetail(c)}>
                    {t("stale.open")}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
