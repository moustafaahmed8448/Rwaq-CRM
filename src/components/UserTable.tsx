"use client";

/**
 * The users grid: resizable columns over the team directory.
 *
 * Structurally the same as ClientTable — pointer + keyboard resize, a live drag
 * preview committed once on release, and a `grid-template-columns` derived from
 * the same `column-registry` helpers. The widths persist under their own
 * `userColumns` blob so a change here cannot move a column on the clients table.
 *
 * Reuses the `.client-table` / `.client-row` classes rather than defining a
 * second grid system. Those rules are generic (a `--ct-cols` custom property, a
 * shared scrollbar treatment) and carry no client-specific assumptions — the
 * dashboard's "recent clients" widget already reuses `.recent-table` the same
 * way. A parallel set of classes would be a second copy of the same grid to keep
 * in step with every theme change.
 *
 * No checkbox gutter: there is no bulk action on this page, so a `select`
 * column would be a control that does nothing.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { Pencil, Trash2, UserRound } from "lucide-react";
import { roleLabel } from "@/lib/reporting";
import { initialsOf } from "@/lib/avatar";
import {
  USER_COLUMNS,
  gridTemplate,
  type ResolvedUserColumn,
  type UserColumnKey,
} from "@/lib/user-columns";
import type { TFn } from "@/lib/client-types";

/**
 * A team member, as /api/users returns them.
 *
 * The profile fields after `role` are all nullable: they are shown in the panel
 * and the edit form, and an unset one simply does not render.
 */
export interface ManagedUser {
  username: string;
  name: string;
  email?: string | null;
  role: string;
  avatar?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

export default function UserTable({ users, columns, onColumnsChange, rtl, t, onEdit, onDelete, onOpenDetail, onOpenProfile }: {
  users: ManagedUser[];
  columns: ResolvedUserColumn[];
  onColumnsChange: (c: ResolvedUserColumn[]) => void;
  rtl: boolean;
  t: TFn;
  onEdit: (u: ManagedUser) => void;
  onDelete: (u: ManagedUser) => void;
  /** Opens the profile side panel. Omitted by a host with no panel to show. */
  onOpenDetail?: (u: ManagedUser) => void;
  /**
   * Opens that person's PROFILE PAGE instead of the side panel.
   *
   * Separate from `onOpenDetail` on purpose: /users row-click opens the panel, and
   * mixing the two would make a click anywhere on a row navigate away from the
   * table you were working in. Only the profile icon goes to the page — the panel
   * stays one click away on the row itself.
   */
  onOpenProfile?: (u: ManagedUser) => void;
}) {
  // Width changes preview live during the drag and commit once on release —
  // otherwise a drag would fire a save per pixel.
  const [draft, setDraft] = useState<{ key: UserColumnKey; w: number } | null>(null);
  const drag = useRef<{ key: UserColumnKey; startX: number; startW: number } | null>(null);
  // Suppress text selection while dragging, or the drag selects the row text.
  useEffect(() => {
    if (!draft) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => { document.body.style.userSelect = prev; };
  }, [draft]);

  const startResize = (e: React.PointerEvent, col: ResolvedUserColumn) => {
    if (col.locked) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key: col.key, startX: e.clientX, startW: col.w };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft({ key: col.key, w: col.w });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // In RTL the grid flows right-to-left, so moving the pointer RIGHT NARROWS
    // the column — the same inversion the clients table applies.
    const delta = rtl ? d.startX - e.clientX : e.clientX - d.startX;
    const col = columns.find(c => c.key === d.key);
    if (!col) return;
    setDraft({ key: d.key, w: Math.min(col.max, Math.max(col.min, d.startW + delta)) });
  };

  const endResize = () => {
    const done = draft;
    drag.current = null;
    setDraft(null);
    if (!done) return;
    onColumnsChange(columns.map(c => (c.key === done.key ? { ...c, w: done.w } : c)));
  };

  /** Double-click a divider to restore that column's default width. */
  const resetColumn = (col: ResolvedUserColumn) => {
    const def = USER_COLUMNS.find(d => d.key === col.key);
    if (!def || col.locked) return;
    onColumnsChange(columns.map(c => (c.key === col.key ? { ...c, w: def.w } : c)));
  };

  const onResizeKey = (e: React.KeyboardEvent, col: ResolvedUserColumn) => {
    if (col.locked) return;
    const step = e.shiftKey ? 24 : 8;
    let w: number | null = null;
    // Arrow keys are mirrored in RTL, same as the drag.
    if (e.key === "ArrowRight") w = col.w + (rtl ? -step : step);
    else if (e.key === "ArrowLeft") w = col.w + (rtl ? step : -step);
    if (w === null) return;
    e.preventDefault();
    e.stopPropagation();
    onColumnsChange(columns.map(c => (c.key === col.key ? { ...c, w: Math.min(col.max, Math.max(col.min, w)) } : c)));
  };

  // The live drag width, so the header and every body row move together.
  const layout = draft ? columns.map(c => (c.key === draft.key ? { ...c, w: draft.w } : c)) : columns;
  const shown = layout.filter(col => !col.hidden);

  const cell = (col: ResolvedUserColumn, u: ManagedUser) => {
    switch (col.key) {
      case "name":
        // Photo when there is one, initials otherwise — the same fallback the
        // panel and the settings avatar use, so a member looks the same in all three.
        return (
          <span className="user-name-cell">
            <span className="user-avatar-sm" aria-hidden="true">
              {u.avatar ? <img src={u.avatar} alt="" /> : initialsOf(u.name)}
            </span>
            <b>{u.name}</b>
          </span>
        );
      case "username":
        // Forced LTR: a username is an identifier, and an Arabic layout would
        // otherwise reorder the "@" and the characters around it.
        return <span className="ltr-num muted">@{u.username}</span>;
      case "email":
        return <span className="muted" dir="ltr">{u.email || "—"}</span>;
      case "role":
        return <span className={`role-badge ${u.role.toLowerCase()}`}>{roleLabel(t, u.role)}</span>;
      case "actions":
        return (
          <span className="actions-cell no-detail">
            {/* Profile first, so it is the leftmost (first in tab order) of the
                three. Rendered only when the host supplied a way to act on it —
                `onOpenProfile` (go to that person's profile page) wins, else
                `onOpenDetail` (the side panel), so a host with neither never
                shows a button that cannot do anything. */}
            {(onOpenProfile || onOpenDetail) && (
              <button className="icon-btn" title={t("users.profile")} onClick={e => {
                e.stopPropagation();
                if (onOpenProfile) onOpenProfile(u);
                else onOpenDetail?.(u);
              }}>
                <UserRound size={14} />
              </button>
            )}
            <button className="icon-btn" title={t("common.edit")} onClick={e => { e.stopPropagation(); onEdit(u); }}><Pencil size={14} /></button>
            <button className="icon-btn danger" title={t("common.delete")} onClick={e => { e.stopPropagation(); onDelete(u); }}><Trash2 size={14} /></button>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="table-scroll-wrapper">
      {/* The template is built from `shown` — the same list that produces the
          cells below. Deriving it from the full `layout` instead would emit a
          track for every hidden column and shift each remaining one left. */}
      <div className="client-table" style={{ ["--ct-cols" as string]: gridTemplate(shown) }}>
        <div className="client-row client-head">
          {shown.map(col => (
            <span key={col.key} className="col-head-cell">
              {col.labelKey ? t(col.labelKey) : null}
              {/* The locked `actions` gutter is a fixed width, so there is nothing
                  to resize and no handle to show. */}
              {!col.locked && (
                <span
                  className="col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("cols.resize", { name: col.labelKey ? t(col.labelKey) : col.key })}
                  aria-valuenow={col.w}
                  aria-valuemin={col.min}
                  aria-valuemax={col.max}
                  tabIndex={0}
                  title={t("cols.resizeHint")}
                  onPointerDown={e => startResize(e, col)}
                  onPointerMove={onMove}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={e => { e.stopPropagation(); resetColumn(col); }}
                  onKeyDown={e => onResizeKey(e, col)}
                />
              )}
            </span>
          ))}
        </div>
        {users.map(u => (
          <div className="client-row client-row-clickable" key={u.username} onClick={onOpenDetail ? (e) => {
            // Same guard the clients table uses: the action buttons and the
            // avatar upload control live inside this row and handle themselves.
            const el = e.target as HTMLElement;
            if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.closest(".no-detail")) return;
            onOpenDetail(u);
          } : undefined}>
            {/* Keyed Fragment, not the bare element: `cell()` returns a single
                element with no key of its own, so an array of them without one
                made React log "Each child in a list should have a unique key". */}
            {shown.map(col => <Fragment key={col.key}>{cell(col, u)}</Fragment>)}
          </div>
        ))}
        {users.length === 0 && <div className="empty-state">{t("users.noMatches")}</div>}
      </div>
    </div>
  );
}

