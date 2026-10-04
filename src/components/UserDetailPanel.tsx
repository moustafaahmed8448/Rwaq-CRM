"use client";

/**
 * The user slide-in profile panel, opened by clicking a row on /users.
 *
 * Reuses ClientDetailPanel's chrome verbatim — `.detail-overlay`,
 * `.detail-panel`, `.detail-header`, `.detail-body`, `.detail-meta`,
 * `.meta-item`, `.detail-actions` — so the panel slides in from the same edge,
 * at the same width, with the same dark-mode treatment. Defining a parallel set
 * of classes here would be a second copy of one panel's layout to keep in step
 * with every theme change.
 *
 * Action buttons render only when the host supplies a handler, which is how the
 * page avoids offering "Delete" to a role that cannot delete.
 */
import { Pencil, Trash2, UserRound, X as XIcon } from "lucide-react";
import { dateLocale } from "@/lib/format";
import { roleLabel } from "@/lib/reporting";
import { initialsOf } from "@/lib/avatar";
import type { ManagedUser } from "@/components/UserTable";

export default function UserDetailPanel({ user, onClose, onEdit, onDelete, onOpenProfile, t, lang }: {
  user: ManagedUser;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /**
   * Opens the full profile page for this person. Optional because the panel is
   * reused by callers that only want to edit or delete; when it is absent the
   * button is simply not rendered.
   */
  onOpenProfile?: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  lang: string;
}) {
  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <div>
            <div className="breadcrumb"><UserRound size={14} />{t("users.profile")}</div>
            <div className="user-panel-head">
              <span className="user-avatar-lg" aria-hidden="true">
                {user.avatar ? <img src={user.avatar} alt="" /> : initialsOf(user.name)}
              </span>
              <h2>{user.name}</h2>
            </div>
            <span className={`role-badge ${user.role.toLowerCase()}`}>{roleLabel(t, user.role)}</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}><XIcon size={18} /></button>
        </div>
        <div className="detail-body">
          <div className="detail-meta">
            <div className="meta-item">
              <span className="meta-label">{t("users.username")}</span>
              {/* Forced LTR so the "@" keeps its place in an Arabic layout. */}
              <span className="meta-value ltr-num">@{user.username}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">{t("users.email")}</span>
              <span className="meta-value" dir="ltr">{user.email || "—"}</span>
            </div>
            {user.phone && (
              <div className="meta-item">
                <span className="meta-label">{t("users.phone")}</span>
                <span className="meta-value ltr-num">{user.phone}</span>
              </div>
            )}
            {user.jobTitle && (
              <div className="meta-item">
                <span className="meta-label">{t("users.jobTitle")}</span>
                <span className="meta-value">{user.jobTitle}</span>
              </div>
            )}
            {user.notes && (
              <div className="meta-item full">
                <span className="meta-label">{t("users.notes")}</span>
                <p className="notes-text">{user.notes}</p>
              </div>
            )}
            <div className="meta-item full">
              <span className="meta-label">{t("users.memberSince")}</span>
              <span className="meta-value muted">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString(dateLocale(lang)) : "—"}
              </span>
            </div>
          </div>
          <div className="detail-actions">
            {onOpenProfile && (
              <button className="btn-outline" onClick={onOpenProfile}><UserRound size={14} />{t("users.viewProfile")}</button>
            )}
            {onEdit && <button className="btn-outline" onClick={onEdit}><Pencil size={14} />{t("settings.editUser")}</button>}
            {onDelete && <button className="btn-danger-outline" onClick={onDelete}><Trash2 size={14} />{t("detail.delete")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
