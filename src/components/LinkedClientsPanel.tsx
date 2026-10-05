"use client";

/**
 * Slide-in list of the clients holding one reference value.
 *
 * The Options page could already say "used by 42", but not WHICH 42. That number
 * is the whole question an admin is actually asking before renaming or deleting a
 * status, channel or location — and answering it meant no in-app way to find out,
 * so the only option was to guess and rename 42 rows blind.
 *
 * Deliberately bounded: it asks for one page of 200 with `?paged=1`, which also
 * strips `activityLog` (the bulk of a client's payload and never rendered here).
 * A value used by more than 200 clients says so explicitly instead of silently
 * showing a truncated list as if it were complete.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, UsersRound, X as XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import StatusPill from "@/components/StatusPill";
import { dateLocale } from "@/lib/format";
import type { RefKind } from "@/lib/ref-options";

/** Query parameter each reference kind filters clients by. */
const PARAM: Record<RefKind, string> = {
  statuses: "status",
  channels: "channel",
  locations: "location",
};

/** Matches the server's own MAX_PAGE_SIZE; asking for more is silently capped. */
const LIMIT = 200;

type Row = {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  firstContactPerson: string;
  lastUpdateDate?: string;
  archived?: boolean;
  archivedAt?: string | null;
};

export default function LinkedClientsPanel({
  kind,
  value,
  label,
  onClose,
  t,
  lang,
}: {
  kind: RefKind;
  value: string;
  /** The admin-facing name of this value, shown in the header. */
  label: string;
  onClose: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  lang: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({
      paged: "1",
      pageSize: String(LIMIT),
      includeArchived: "1",
      [PARAM[kind]]: value,
    });
    fetch(`/api/crm/clients?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("request failed"))))
      .then((d: { clients?: Row[]; total?: number }) => {
        if (!live) return;
        setRows(d.clients ?? []);
        setTotal(d.total ?? (d.clients ?? []).length);
      })
      .catch(() => {
        // Leaves the list null, which renders the "could not load" line rather
        // than an empty list — the difference between "none use this" and
        // "we could not find out".
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [kind, value]);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel linked-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <div>
            <div className="breadcrumb"><UsersRound size={14} />{t("linked.title")}</div>
            <h2>{label}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={18} />
          </button>
        </div>
        <div className="detail-body">
          <p className="linked-count">
            {failed
              ? t("linked.failed")
              : rows === null
                ? t("common.loading")
                : t("linked.count", { n: total })}
          </p>
          {/* Shown only when the list really is partial. `total` comes from the
              server's COUNT, not from the page length, so this can never claim a
              truncation that did not happen. */}
          {rows !== null && !failed && total > rows.length && (
            <p className="linked-truncated">{t("linked.truncated", { shown: rows.length, total })}</p>
          )}
          {rows !== null && !failed && rows.length === 0 && (
            <div className="empty-state">{t("linked.empty")}</div>
          )}
          <ul className="linked-list">
            {rows?.map((c) => (
              <li key={c.id} className={`linked-row${c.archived ? " linked-row-archived" : ""}`}>
                <span className="linked-id">#{c.id}</span>
                <span className="linked-main">
                  <b className="linked-name">
                    {c.name}
                    {c.archived && (
                      <span className="linked-archived-badge" title={t("archive.archivedLabel")}>
                        {t("archive.archivedLabel")}
                      </span>
                    )}
                  </b>
                  <span className="linked-sub">
                    <span className="ltr-num">{c.phoneNumber}</span>
                    {c.firstContactPerson && <> · {c.firstContactPerson}</>}
                    {c.lastUpdateDate && (
                      <> · {new Date(c.lastUpdateDate).toLocaleDateString(dateLocale(lang))}</>
                    )}
                  </span>
                </span>
                <StatusPill status={c.status} t={t} variant="badge" />
                <button
                  className="icon-btn-sm"
                  title={t("detail.timeline")}
                  onClick={() => {
                    onClose();
                    setTimeout(() => router.push(`/clients/${c.id}`), 200);
                  }}
                >
                  <ArrowUpRight size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}