"use client";

/**
 * Global activity feed: latest timeline entries across the live book.
 *
 * Each client already stores its own `activityLog`; this reads the loaded
 * rows (no new endpoint), flattens the entries, and filters by actor.
 * Uses the shared `describeActivity` localizer so entries read the same as
 * the per-client timeline.
 */
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { dateLocale } from "@/lib/format";
import { describeActivity } from "@/lib/reporting";
import type { Client, TFn } from "@/lib/client-types";
import type { ActivityEntry } from "@/lib/types";

type FeedEntry = ActivityEntry & { clientId: string; clientName: string };

export default function ActivityFeedPanel({
  clients,
  onOpenDetail,
  t,
  lang,
}: {
  clients: (Client & { activityLog?: ActivityEntry[] })[];
  onOpenDetail: (id: string) => void;
  t: TFn;
  lang: string;
}) {
  const [actor, setActor] = useState("");
  const entries = useMemo<FeedEntry[]>(() => {
    const all: FeedEntry[] = [];
    for (const c of clients) {
      for (const e of c.activityLog ?? []) {
        all.push({ ...e, clientId: c.id, clientName: c.name });
      }
    }
    return all
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, 100);
  }, [clients]);
  const actors = useMemo(
    () => [...new Set(entries.map((e) => e.actor).filter(Boolean))].sort(),
    [entries],
  );
  const shown = actor ? entries.filter((e) => e.actor === actor) : entries;

  return (
    <section className="panel activity-feed-panel">
      <div className="followup-workspace-head">
        <h3>
          <History size={15} />
          {t("activityFeed.title")}
        </h3>
        <select
          className="activity-feed-actor"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          aria-label={t("activityFeed.allActors")}
        >
          <option value="">{t("activityFeed.allActors")}</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      {/* The subtitle claims the feed covers all clients — showing it above
          "No activity yet" contradicts itself, so it only appears when there
          is something to describe. */}
      {shown.length > 0 && <p className="muted">{t("activityFeed.sub")}</p>}
      {shown.length === 0 ? (
        <div className="empty-state">{t("activityFeed.empty")}</div>
      ) : (
        <ul className="linked-list">
          {shown.map((e) => (
            <li key={e.id} className="linked-row">
              <span className="linked-main">
                <b className="linked-name">{e.clientName}</b>
                <span className="linked-sub">
                  {describeActivity(t, e)} · {e.actor} ·{" "}
                  {new Date(e.timestamp).toLocaleString(dateLocale(lang))}
                </span>
              </span>
              <button type="button" className="btn-outline btn-sm" onClick={() => onOpenDetail(e.clientId)}>
                {t("stale.open")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
