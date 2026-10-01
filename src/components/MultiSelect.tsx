"use client";

/**
 * Multi-select filter dropdown with a search box, usage-counted delete guard and
 * a per-menu "clear selection".
 *
 * Extracted from src/app/page.tsx, which was the only place it lived. It is now
 * shared with the marketing and archived filter bars so all three pages get the
 * same behaviour — the same reason RefPicker and Select were extracted. Copying
 * it instead would have been simpler and is exactly how the three combobox
 * components drifted apart in the first place.
 *
 * The `removeUsage` guard is deliberately part of this component: a value still
 * attached to clients cannot be deleted, because removing it from the list would
 * leave those clients pointing at a value that exists nowhere in the UI.
 */
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { num } from "@/lib/format";
import { useCombobox, type TFn } from "@/lib/use-combobox";

export default function MultiSelect({ label, options, selected, onChange, render, onRemove, removable, removeUsage, t }: {
  label: string; options: string[]; selected: string[];
  onChange: (values: string[]) => void; render?: (v: string) => string;
  /** Deletes the value from the saved reference list (admin only, server-gated). */
  onRemove?: (value: string) => void;
  /** Only values in this list may be removed; built-ins are code constants. */
  removable?: string[];
  /** Client count per value, used to warn before removing something in use. */
  removeUsage?: Record<string, number>;
  t: TFn;
}) {
  const lab = (v: string) => (render ? render(v) : v);
  const toggleValue = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };

  const cb = useCombobox({
    options, labelOf: lab, selected, onSelect: toggleValue, closeOnSelect: false,
    // Backspace on an empty search removes the most recent pick, so a
    // mis-filtered multi-select can be corrected without reaching for a mouse.
    onRemoveLast: () => { if (selected.length) onChange(selected.slice(0, -1)); },
  });

  return (
    <div className="ms-wrap cbx" data-cbx-root={cb.rootId}>
      <button
        id={cb.triggerId}
        type="button"
        className={`ms-trigger ${selected.length > 0 ? "ms-active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={cb.open}
        onClick={cb.toggle}
      >
        <span className="ms-value">
          {selected.length === 0 ? label
            : selected.length === 1 ? lab(selected[0])
            : `${lab(selected[0])} +${selected.length - 1}`}
        </span>
        <ChevronDown size={12} />
      </button>
      {cb.open && (
        <div className="ms-menu">
          <div className="ms-search-row">
            <input
              id={cb.inputId}
              className="ms-search"
              role="combobox"
              aria-expanded
              aria-controls={cb.menuId}
              aria-autocomplete="list"
              aria-activedescendant={cb.filtered[cb.active] ? cb.optionId(cb.active) : undefined}
              value={cb.query}
              placeholder={t("common.search")}
              onChange={e => cb.setQuery(e.target.value)}
              onKeyDown={cb.onKeyDown}
            />
          </div>
          {/* The listbox role sits here, not on .ms-menu: the options are direct
              children of this element, which is what the role requires. */}
          <div className="ms-list" id={cb.menuId} role="listbox">
            {cb.filtered.length === 0 && <div className="ms-empty">{t("common.noMatches")}</div>}
            {cb.filtered.map((o, i) => {
              // Only saved (custom) values, and only while nothing references them.
              // A value still attached to clients cannot be removed: deleting it from
              // the list would leave those clients pointing at a value that no longer
              // exists anywhere in the UI. The count on the row explains why.
              const used = removeUsage?.[o] ?? 0;
              const canRemove = Boolean(onRemove && removable?.includes(o) && used === 0);
              return (
                <div
                  key={o}
                  /* role="none" keeps this wrapper out of the a11y tree so the
                     option is a direct child of the listbox; a role="option"
                     here would wrap a nested button, which is invalid ARIA. */
                  role="none"
                  className={`ms-opt-row ${selected.includes(o) ? "ms-opt-on" : ""} ${i === cb.active ? "ms-opt-active" : ""}`}
                  onMouseEnter={() => cb.setActive(i)}
                >
                  <button
                    id={cb.optionId(i)}
                    type="button"
                    role="option"
                    aria-selected={selected.includes(o)}
                    className="ms-opt"
                    tabIndex={-1}
                    onClick={() => toggleValue(o)}
                  >
                    <span className="ms-check">{selected.includes(o) && <Check size={11} />}</span>
                    <span className="ms-opt-label">{lab(o)}</span>
                    {used > 0 && <span className="ms-opt-count">{num(used)}</span>}
                  </button>
                  {canRemove && (
                    <button
                      type="button"
                      className="ms-opt-del"
                      title={t("refData.removeTitle")}
                      aria-label={t("refData.removeAria", { value: lab(o) })}
                      onClick={() => {
                        // Removing the value from the saved list does NOT touch
                        // clients already using it, so say so before doing it.
                        const msg = used > 0
                          ? t("refData.removeUsedConfirm", { value: lab(o), n: used })
                          : t("refData.removeConfirm", { value: lab(o) });
                        if (!confirm(msg)) return;
                        onChange(selected.filter(x => x !== o));
                        onRemove?.(o);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {selected.length > 0 && <button type="button" className="ms-clear" onClick={() => onChange([])}>{t("clients.clearSelection")}</button>}
        </div>
      )}
    </div>
  );
}