"use client";

/**
 * The client slide-in detail panel, shared by the clients page and the archived
 * page.
 *
 * It used to be inlined in src/app/page.tsx, which meant /archived — a separate
 * route with its own client list — had no way to show it, so an archived client
 * could only be inspected by opening its own /clients/[id] page. Extracting the
 * markup is what lets both routes render the identical panel.
 *
 * Everything that differs between the two hosts is a prop:
 *   - `onEdit` / `onDelete` / `onArchive` are omitted by the archived page,
 *     whose buttons are Restore and Delete-for-good instead. The action row
 *     renders only the handlers that were supplied, so neither route shows a
 *     control it cannot honour.
 *   - `statusControl` lets the clients page inject its editable status picker
 *     while the archived page shows a read-only pill: an archived client is out
 *     of the book, so editing its status from here would be misleading.
 */
import { ArrowUpRight, Archive, Pencil, Trash2, UsersRound, X as XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import StatusPill from "@/components/StatusPill";
import { dateLocale, isOverdue } from "@/lib/format";
import { useOptionColors } from "@/lib/option-colors";
import { channelLabel } from "@/lib/reporting";
import { optionColor } from "@/lib/ref-options";

export type DetailClient = {
  id: string; name: string; phoneNumber: string;
  status: string; project: string; location: string;
  acquisitionChannel: string; operationToTake: string;
  firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string;
  /** ISO string, or null when no follow-up is set. */
  nextFollowUpAt?: string | null;
};

export default function ClientDetailPanel({
  client, onClose, onEdit, onDelete, onArchive, statusControl, t, lang,
}: {
  client: DetailClient;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  /**
   * Rendered in place of the read-only status pill. Only the clients page
   * passes one; the archived page deliberately does not.
   */
  statusControl?: React.ReactNode;
  t: (key: string, vars?: Record<string, string | number>) => string;
  lang: string;
}) {
  const router = useRouter();
  // Same shared colour map the table, kanban and dashboard resolve through, so
  // a status or channel recoloured on the options page matches here too.
  const colors = useOptionColors();

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <div>
            <div className="breadcrumb"><UsersRound size={14} />{t("detail.info")}</div>
            <h2>{client.name}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}><XIcon size={18} /></button>
        </div>
        <div className="detail-body">
          <div className="detail-meta">
            <div className="meta-item"><span className="meta-label">{t("form.phone")}</span><span className="meta-value"><span className="ltr-num">{client.phoneNumber}</span></span></div>
            <div className="meta-item">
              <span className="meta-label">{t("form.status")}</span>
              {statusControl ?? <StatusPill status={client.status} t={t} />}
            </div>
            <div className="meta-item"><span className="meta-label">{t("form.channel")}</span><span className="chan-tag-inline"><i className="dot" style={{ background: optionColor("channels", client.acquisitionChannel, colors) }} />{channelLabel(t, client.acquisitionChannel)}</span></div>
            <div className="meta-item"><span className="meta-label">{t("form.project")}</span><span className="meta-value">{client.project}</span></div>
            <div className="meta-item"><span className="meta-label">{t("form.location")}</span><span className="meta-value"><i className="dot" style={{ background: optionColor("locations", client.location, colors) }} />{client.location}</span></div>
            <div className="meta-item"><span className="meta-label">{t("form.firstContact")}</span><span className="meta-value">{client.firstContactPerson}</span></div>
            <div className="meta-item"><span className="meta-label">{t("form.secondContact")}</span><span className="meta-value">{client.secondContactPerson || "—"}</span></div>
            <div className="meta-item full"><span className="meta-label">{t("form.operation")}</span><span className="meta-value op-value">{client.operationToTake}</span></div>
            {/* WHEN to chase, beside the WHAT above. Overdue is flagged because it
                is the one state that needs action today; a future date is shown
                plainly so it does not read as an error. */}
            <div className="meta-item full">
              <span className="meta-label">{t("form.nextFollowUp")}</span>
              {client.nextFollowUpAt
                ? (
                  <span className={isOverdue(client.nextFollowUpAt) ? "meta-value followup-panel is-overdue" : "meta-value followup-panel"}>
                    {new Date(client.nextFollowUpAt).toLocaleDateString(dateLocale(lang))}
                    {isOverdue(client.nextFollowUpAt) && <em className="followup-overdue">{t("followUp.overdue")}</em>}
                  </span>
                )
                : <span className="meta-value muted">—</span>}
            </div>
            {client.notes && <div className="meta-item full"><span className="meta-label">{t("form.notes")}</span><p className="notes-text">{client.notes}</p></div>}
            <div className="meta-item full"><span className="meta-label">{t("client.field.created")}</span><span className="meta-value muted">{client.createdAt ? new Date(client.createdAt).toLocaleDateString(dateLocale(lang)) : "—"}</span></div>
            <div className="meta-item full"><span className="meta-label">{t("detail.lastUpdate")}</span><span className="meta-value muted">{client.lastUpdateDate ? new Date(client.lastUpdateDate).toLocaleString(dateLocale(lang)) : "—"}</span></div>
          </div>
          {/* Only the actions this host can actually perform are rendered, so the
              archived page never offers "Archive" on a client that is already
              archived, and a read-only role never sees "Delete". */}
          <div className="detail-actions">
            {onEdit && <button className="btn-outline" onClick={onEdit}><Pencil size={14} />{t("detail.edit")}</button>}
            <button className="btn-outline" onClick={() => { onClose(); setTimeout(() => router.push(`/clients/${client.id}`), 200); }}><ArrowUpRight size={14} />{t("detail.timeline")}</button>
            {onDelete && <button className="btn-danger-outline" onClick={onDelete}><Trash2 size={14} />{t("detail.delete")}</button>}
            {onArchive && <button className="btn-outline" onClick={onArchive}><Archive size={14} />{t("nav.archived")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}