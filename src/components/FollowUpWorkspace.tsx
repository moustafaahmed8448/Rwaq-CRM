"use client";

/**
 * Follow-up workspace: overdue / today / upcoming in one triage list.
 *
 * The dashboard tiles and table chips can FILTER to a bucket, but neither
 * answers "what do I do next". This panel groups the dated rows, surfaces
 * the assignee and the operation note, and offers one-click Done (+1/+3/+7
 * snooze or clear) without opening the edit modal per row.
 */
import { useMemo, useState } from "react";
import { CalendarClock, Check, Phone } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import ContactButtons from "@/components/ContactButtons";
import { dateLocale, dateInputValue } from "@/lib/format";
import type { Client, TFn } from "@/lib/client-types";

type Bucket = "overdue" | "today" | "upcoming";

function bucketOf(nextFollowUpAt?: string | null, now = new Date()): Bucket | null {
  const key = dateInputValue(nextFollowUpAt);
  if (!key) return null;
  const today = dateInputValue(now.toISOString());
  if (key < today) return "overdue";
  if (key === today) return "today";
  return "upcoming";
}

export default function FollowUpWorkspace({
  clients,
  onSnooze,
  onDone,
  onOpenDetail,
  onCall,
  t,
  lang,
}: {
  clients: Client[];
  onSnooze: (id: string, days: number) => void | Promise<void>;
  onDone: (id: string) => void | Promise<void>;
  onOpenDetail: (c: Client) => void;
  onCall?: (phone: string) => void;
  t: TFn;
  lang: string;
}) {
  const [tab, setTab] = useState<Bucket>("overdue");
  const groups = useMemo(() => {
    const out: Record<Bucket, Client[]> = { overdue: [], today: [], upcoming: [] };
    for (const c of clients) {
      if (c.archived) continue;
      const b = bucketOf(c.nextFollowUpAt);
      if (b) out[b].push(c);
    }
    const byDate = (a: Client, b: Client) =>
      String(a.nextFollowUpAt ?? "").localeCompare(String(b.nextFollowUpAt ?? ""));
    (Object.keys(out) as Bucket[]).forEach((k) => out[k].sort(byDate));
    return out;
  }, [clients]);
  const rows = groups[tab];

  return (
    <section className="panel followup-workspace">
      <div className="followup-workspace-head">
        <h3>
          <CalendarClock size={15} />
          {t("followupWorkspace.title")}
        </h3>
        <div className="segmented" role="tablist" aria-label={t("followupWorkspace.title")}>
          {(["overdue", "today", "upcoming"] as Bucket[]).map((b) => (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={tab === b}
              className={tab === b ? "seg-active" : ""}
              onClick={() => setTab(b)}
            >
              {t(`followupWorkspace.${b}`)} ({groups[b].length})
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">{t("followupWorkspace.empty")}</div>
      ) : (
        <ul className="followup-workspace-list">
          {rows.map((c) => (
            <li key={c.id} className={`followup-workspace-row is-${tab}`}>
              <button type="button" className="followup-workspace-main" onClick={() => onOpenDetail(c)}>
                <b className="linked-name">
                  <span className="linked-id">#{c.id}</span> {c.name}
                </b>
                <span className="linked-sub">
                  <span className="ltr-num">{c.phoneNumber}</span>
                  {c.nextFollowUpAt && (
                    <> · {new Date(c.nextFollowUpAt).toLocaleDateString(dateLocale(lang))}</>
                  )}
                  {c.firstContactPerson && <> · {c.firstContactPerson}</>}
                </span>
                {c.operationToTake && <span className="card-op">{c.operationToTake}</span>}
              </button>
              <StatusPill status={c.status} t={t} variant="badge" />
              <span className="followup-workspace-actions">
                <ContactButtons phone={c.phoneNumber} t={t} compact />
                {onCall && c.phoneNumber && (
                  <button
                    type="button"
                    className="icon-btn-sm"
                    title={t("followupWorkspace.call")}
                    onClick={() => onCall(c.phoneNumber)}
                  >
                    <Phone size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  title={t("followupWorkspace.snooze1")}
                  onClick={() => void onSnooze(c.id, 1)}
                >
                  +1
                </button>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  title={t("followupWorkspace.snooze3")}
                  onClick={() => void onSnooze(c.id, 3)}
                >
                  +3
                </button>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  title={t("followupWorkspace.snooze7")}
                  onClick={() => void onSnooze(c.id, 7)}
                >
                  +7
                </button>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  title={t("followupWorkspace.done")}
                  onClick={() => void onDone(c.id)}
                >
                  <Check size={13} />
                  {t("followupWorkspace.done")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
