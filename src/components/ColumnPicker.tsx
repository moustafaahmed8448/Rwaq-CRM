"use client";

/**
 * Column visibility picker for the clients table.
 *
 * Widths are not edited here — they are dragged directly on the header divider.
 * This handles only show/hide, plus a reset, because a number input next to a
 * checkbox is a worse way to set a width than simply dragging.
 *
 * Locked columns are listed but disabled, with the reason explained, rather than
 * hidden entirely: silently omitting them would leave a user wondering where the
 * select checkbox went.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Lock, SlidersHorizontal, X } from "lucide-react";
import { CLIENT_COLUMNS, resolveColumns, type ResolvedColumn } from "@/lib/client-columns";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export default function ColumnPicker({
  columns, onChange, t,
}: {
  columns: ResolvedColumn[];
  onChange: (c: ResolvedColumn[]) => void;
  t: TFn;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = (key: ResolvedColumn["key"]) => {
    onChange(columns.map(c => (c.key === key ? { ...c, hidden: !c.hidden } : c)));
  };

  const showAll = () => onChange(columns.map(c => ({ ...c, hidden: false })));

  const reset = () =>
    // Straight from the registry: resets both widths and visibility, which is
    // what "restore defaults" should mean after columns have been hidden.
    onChange(resolveColumns(null));

  const hiddenCount = columns.filter(c => c.hidden).length;

  return (
    <div className="col-picker" ref={wrapRef}>
      <button
        type="button"
        className={`btn-outline col-picker-trigger ${hiddenCount > 0 ? "active" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(o => !o)}
      >
        <SlidersHorizontal size={15} />
        {t("cols.button")}
        {hiddenCount > 0 && <span className="col-picker-count">{hiddenCount}</span>}
      </button>
      {open && (
        <div className="col-picker-menu" role="dialog" aria-label={t("cols.title")}>
          <div className="col-picker-head">
            <strong>{t("cols.title")}</strong>
            <button className="col-picker-close" onClick={() => setOpen(false)} aria-label={t("common.close")}><X size={14} /></button>
          </div>
          <p className="col-picker-hint">{t("cols.hint")}</p>
          <div className="col-picker-list">
            {columns.map(col => {
              const def = CLIENT_COLUMNS.find(d => d.key === col.key)!;
              const name = col.labelKey ? t(col.labelKey) : col.key === "select" ? t("cols.select") : t("cols.actions");
              return (
                <label key={col.key} className={`col-picker-row ${col.locked ? "locked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={!col.hidden}
                    disabled={col.locked}
                    onChange={() => toggle(col.key)}
                  />
                  <span className="col-picker-name">{name}</span>
                  {col.locked
                    ? <Lock size={12} className="col-picker-lock" aria-label={t("cols.locked")} />
                    : <span className="col-picker-w">{col.w === def.w ? "—" : `${col.w}px`}</span>}
                </label>
              );
            })}
          </div>
          <div className="col-picker-foot">
            <button onClick={showAll}><Check size={13} />{t("cols.showAll")}</button>
            <button onClick={reset}><X size={13} />{t("cols.reset")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
