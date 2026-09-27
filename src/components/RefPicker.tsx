"use client";

/**
 * Picker for reference values (location, channel, status) with add + delete.
 *
 * This started life as a native <select> local to src/app/page.tsx, which
 * structurally cannot host a delete control — so values could be added in one
 * place and only removed in another, and the marketing page had no delete at
 * all. It now lives here so the clients and marketing forms share one
 * behaviour.
 *
 * `onRemove` is only ever passed for admin, and a value must also be unused: a
 * saved location/channel still attached to clients cannot be deleted, because
 * removing it from the list would leave those clients pointing at a value that
 * no longer exists anywhere in the UI.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { num } from "@/lib/format";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export default function RefPicker({
  value,
  options,
  onChange,
  onAdd,
  onRemove,
  removable,
  removeUsage,
  render,
  placeholder,
  t,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onAdd?: (v: string) => Promise<string | void>;
  onRemove?: (v: string) => void;
  /** Only values in this list may be removed; built-ins are code constants. */
  removable?: string[];
  /** Client count per value, used to block deleting something in use. */
  removeUsage?: Record<string, number>;
  render?: (v: string) => string;
  placeholder?: string;
  t: TFn;
}) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const lab = (v: string) => (render ? render(v) : v);

  const confirmAdd = async () => {
    const val = text.trim();
    if (!val) { setAdding(false); return; }
    const res = onAdd ? await onAdd(val) : val;
    const final = typeof res === "string" && res ? res : val;
    onChange(final);
    setAdding(false); setText(""); setOpen(false);
  };

  if (adding) {
    return (
      <div className="ref-add-row">
        <input
          autoFocus
          value={text}
          placeholder={placeholder ?? t("form.newValuePh")}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") confirmAdd(); else if (e.key === "Escape") { setAdding(false); setText(""); } }}
        />
        <button type="button" className="btn-sm" onClick={confirmAdd}><Check size={14} />{t("form.addBtn")}</button>
        <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setText(""); }}>{t("common.cancel")}</button>
      </div>
    );
  }

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ms-trigger picker-trigger ${value ? "ms-active" : ""}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="ms-value">{value ? lab(value) : (placeholder ?? t("form.statusPh"))}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ms-menu">
          {options.length === 0 && <div className="ms-empty">{t("common.noData")}</div>}
          {options.map(o => {
            const used = removeUsage?.[o] ?? 0;
            // Only saved values, and only while nothing references them.
            const canRemove = Boolean(onRemove && removable?.includes(o) && used === 0);
            return (
              <div key={o} className={`ms-opt-row ${o === value ? "ms-opt-on" : ""}`}>
                <button type="button" className="ms-opt" onClick={() => { onChange(o); setOpen(false); }}>
                  <span className="ms-check">{o === value && <Check size={11} />}</span>
                  {lab(o)}
                  {used > 0 && <span className="ms-opt-count" title={t("refData.inUseBy", { n: used })}>{num(used)}</span>}
                </button>
                {canRemove && (
                  <button
                    type="button"
                    className="ms-opt-del"
                    title={t("refData.removeTitle")}
                    aria-label={t("refData.removeAria", { value: lab(o) })}
                    onClick={() => { if (confirm(t("refData.removeConfirm", { value: lab(o) }))) { onRemove?.(o); } }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="ms-clear" onClick={() => { setAdding(true); setOpen(false); }}>{t("form.addNewOpt")}</button>
        </div>
      )}
    </div>
  );
}
