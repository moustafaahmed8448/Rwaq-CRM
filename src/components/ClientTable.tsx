"use client";

/**
 * The clients data grid: resizable, reorderable, sortable, with row selection
 * and a per-cell renderer.

 * Extracted from src/app/page.tsx for the same reason as ClientFilterBar — so the
 * profile page shows a real table rather than a simplified stand-in. Both header
 * and body rows share the `.client-row` grid driven by `--ct-cols`, which is what
 * keeps them aligned while a column is being dragged.

 * Purely presentational: every action arrives as a callback, so the host decides what
 * a click means (edit, delete, archive, open detail).
 */
import { useEffect, useRef, useState } from "react";
import { Archive, MessageSquare, Pencil, Trash2 } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import { useLang } from "@/lib/i18n";
import { dateLocale, isOverdue } from "@/lib/format";
import { useOptionColors } from "@/lib/option-colors";
import { channelLabel } from "@/lib/reporting";
import { optionColor } from "@/lib/ref-options";
import { CLIENT_COLUMNS, gridTemplate, type ColumnKey, type ResolvedColumn } from "@/lib/client-columns";
import type { Client, TFn } from "@/lib/client-types";

/**
 * Renders one table cell for a column key.
 *
 * A lookup rather than a switch inside the row so the header and body can never
 * drift out of column order — the grid assigns cells positionally, so one extra
 * or missing cell shifts every cell after it.
 */
function ClientCell({ col, c, t, lang, onOpenDetail, canEdit, isAdmin, onOpenEdit, onOpenDelete, onArchive }: {
  col: ResolvedColumn;
  c: Client;
  t: TFn;
  lang: string;
  onOpenDetail: (c: Client) => void;
  canEdit?: boolean;
  isAdmin?: boolean;
  onOpenEdit: (c: Client) => void;
  onOpenDelete: (ids: string[], names: string[]) => void;
  onArchive?: (id: string) => void | Promise<void>;
}) {
  // Same shared colour map as the rest of the app, so a channel recoloured on
  // the options page shows here without this component knowing the option exists.
  const colors = useOptionColors();
  switch (col.key) {
    case "id":
      return <span className="id-cell" title={t("th.id")}>#{c.id}</span>;
    case "client":
      return (
        <span className="person-cell" onClick={() => onOpenDetail(c)}>
          <b>{c.name}</b>
          <small><span className="ltr-num">{c.phoneNumber}</span></small>
          {c.notes && <span className="notes-indicator"><MessageSquare size={10} /></span>}
        </span>
      );
    case "status":
      return <StatusPill status={c.status} t={t} />;
    case "channel":
      return <span className="chan-tag"><i className="dot" style={{ background: optionColor("channels", c.acquisitionChannel, colors) }} />{channelLabel(t, c.acquisitionChannel)}</span>;
    case "project":
      return <span>{c.project}</span>;
    case "location":
      // Locations gained a colour here for the first time; previously this cell
      // was plain text with nothing to distinguish one city from another.
      return <span className="loc-tag"><i className="dot" style={{ background: optionColor("locations", c.location, colors) }} />{c.location}</span>;
    case "registeredAt":
      return <span className="muted">{c.createdAt ? new Date(c.createdAt).toLocaleDateString(dateLocale(lang)) : "—"}</span>;
    case "operation":
      return <span className="op-text">{c.operationToTake}</span>;
    case "firstContact":
      return <span className="muted">{c.firstContactPerson || "—"}</span>;
    case "secondContact":
      return <span className="muted">{c.secondContactPerson || "—"}</span>;
    case "lastUpdateDate":
      return <span className="muted">{c.lastUpdateDate ? new Date(c.lastUpdateDate).toLocaleDateString(dateLocale(lang)) : "—"}</span>;
    case "nextFollowUp":
      // An unset date reads as an em-dash rather than an empty cell, so "not set"
      // is visibly different from a blank that could be a rendering failure.
      // Overdue is the one state that needs action, so it alone is coloured.
      return c.nextFollowUpAt ? (
        <span className={isOverdue(c.nextFollowUpAt) ? "followup-cell is-overdue" : "followup-cell"}>
          {new Date(c.nextFollowUpAt).toLocaleDateString(dateLocale(lang))}
        </span>
      ) : <span className="muted">—</span>;
    case "actions":
      return (
        <span className="actions-cell no-detail">
          {canEdit && <button className="icon-btn" title={t("common.edit")} onClick={e => { e.stopPropagation(); onOpenEdit(c); }}><Pencil size={14} /></button>}
          {isAdmin && <><button className="icon-btn danger" title={t("common.delete")} onClick={e => { e.stopPropagation(); onOpenDelete([c.id], [c.name]); }}><Trash2 size={14} /></button>
            <button className="icon-btn" title={t("nav.archived")} onClick={e => { e.stopPropagation(); onArchive && onArchive(c.id); }}><Archive size={14} /></button></>}
        </span>
      );
    default:
      return null;
  }
}

export default function ClientTable({ clients, selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenDelete, onOpenDetail, isAdmin, canEdit, onArchive, tableRef, columns, onColumnsChange, rtl, hideSelect, t }: {
  clients: Client[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  onOpenEdit: (c: Client) => void;
  onOpenDelete: (ids: string[], names: string[]) => void;
  onOpenDetail: (c: Client) => void;
  isAdmin?: boolean;
  canEdit?: boolean;
  onArchive?: (id: string) => void | Promise<void>;
  /* `| null` on the inner type is React 19's `useRef<T>(null)` shape. Declaring it
     as `RefObject<HTMLDivElement>` made every caller that keeps a real ref fail to
     typecheck, so hosts passed `null` and lost the scroll indicators. */
  tableRef?: React.RefObject<HTMLDivElement | null> | null;
  columns: ResolvedColumn[];
  onColumnsChange: (c: ResolvedColumn[]) => void;
  rtl: boolean;
  t: TFn;
  /**
   * Hides the select checkbox column.
   *
   * For hosts that render the table as a read-only list (the profile page) —
   * a checkbox column whose tick does nothing is worse than no checkbox at all.
   */
  hideSelect?: boolean;
}) {
  const { lang } = useLang();
  const allSelected = clients.length > 0 && clients.every(c => selectedIds.has(c.id));

  // Width changes preview live during the drag and commit once on release —
  // otherwise a drag would fire a save per pixel.
  const [draft, setDraft] = useState<{ key: ColumnKey; w: number } | null>(null);
  const drag = useRef<{ key: ColumnKey; startX: number; startW: number } | null>(null);
  // Suppress text selection while dragging, or the drag selects the row text.
  useEffect(() => {
    if (!draft) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => { document.body.style.userSelect = prev; };
  }, [draft]);

  const startResize = (e: React.PointerEvent, col: ResolvedColumn) => {
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
    // the column. Without this inversion every drag runs backwards for Arabic
    // users — the app's default language.
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
  const resetColumn = (col: ResolvedColumn) => {
    const def = CLIENT_COLUMNS.find(d => d.key === col.key);
    if (!def || col.locked) return;
    onColumnsChange(columns.map(c => (c.key === col.key ? { ...c, w: def.w } : c)));
  };

  const onResizeKey = (e: React.KeyboardEvent, col: ResolvedColumn) => {
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
  const shown = layout.filter(col => !col.hidden && !(hideSelect && col.key === "select"));

  return (
    <div className="table-scroll-wrapper">
      <div className="scroll-indicator-left hidden" ref={(el) => { if (el) { const t2 = tableRef?.current; if (t2) { const check = () => { el.classList.toggle("hidden", t2.scrollLeft <= 0); }; check(); t2.addEventListener("scroll", check, { passive: true }); } } }} />
      <div className="scroll-indicator-right hidden" />
      <div
        className="client-table"
        ref={tableRef}
        /* Built from `shown`, NOT `layout`. The template must describe exactly the
           cells that are rendered: with `hideSelect` (the profile page) the select
           column produces no cell, so emitting its 30px track anyway shifted every
           remaining column one track to the left — the ids sat in the checkbox
           gutter and the row ended in a blank 50px gap. On the clients page
           `hideSelect` is off and the two are identical, so nothing changes there. */
        style={{ ["--ct-cols" as string]: gridTemplate(shown) }}
      >
        <div className="client-row client-head">
          {shown.map(col => (
            <span key={col.key} className="col-head-cell">
              {col.key === "select"
                ? <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="cb" />
                : col.labelKey ? t(col.labelKey) : null}
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
        {clients.map(c => (
          <div className={`client-row client-row-clickable ${selectedIds.has(c.id) ? "selected" : ""}`} key={c.id} onClick={e => { (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "SELECT" && !(e.target as HTMLElement).closest(".no-detail") && onOpenDetail(c) }}>
            {shown.map(col => (
              col.key === "select"
                ? <input key={col.key} type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="cb" onClick={e => e.stopPropagation()} />
                : <ClientCell key={col.key} col={col} c={c} t={t} lang={lang} onOpenDetail={onOpenDetail} canEdit={canEdit} isAdmin={isAdmin} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onArchive={onArchive} />
            ))}
          </div>
        ))}
        {clients.length === 0 && <div className="empty-state">{t("clients.noResults")}</div>}
      </div>
    </div>
  );
}
