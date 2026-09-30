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
import { useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { num } from "@/lib/format";
import { useCombobox, type TFn } from "@/lib/use-combobox";

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
  const [creating, setCreating] = useState(false);

  const lab = (v: string) => (render ? render(v) : v);

  /**
   * Creates the typed value and selects the STORED one, not the raw text: the
   * channel/location endpoints upper-case and trim, so selecting what was typed
   * would leave the field holding a value that does not match the list.
   */
  const createValue = async (text: string): Promise<void> => {
    if (!onAdd || creating) return;
    setCreating(true);
    try {
      const res = await onAdd(text);
      onChange(typeof res === "string" && res ? res : text);
      cb.setQuery("");
      cb.close();
    } finally {
      setCreating(false);
    }
  };

  const cb = useCombobox({
    options, labelOf: lab, selected: value ? [value] : [],
    onSelect: (v) => onChange(v),
    onCreate: onAdd ? (text) => void createValue(text) : undefined,
  });

  return (
    <div className="ms-wrap cbx" data-cbx-root={cb.rootId}>
      <button
        id={cb.triggerId}
        type="button"
        className={`ms-trigger picker-trigger ${value ? "ms-active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={cb.open}
        onClick={cb.toggle}
      >
        <span className="ms-value">{value ? lab(value) : (placeholder ?? t("form.statusPh"))}</span>
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
              const used = removeUsage?.[o] ?? 0;
              // Only saved values, and only while nothing references them.
              const canRemove = Boolean(onRemove && removable?.includes(o) && used === 0);
              return (
                <div
                  key={o}
                  /* role="none" keeps this wrapper out of the a11y tree so the
                     option is a direct child of the listbox; a role="option"
                     here would wrap a nested button, which is invalid ARIA. */
                  role="none"
                  className={`ms-opt-row ${o === value ? "ms-opt-on" : ""} ${i === cb.active ? "ms-opt-active" : ""}`}
                  onMouseEnter={() => cb.setActive(i)}
                >
                  <button
                    id={cb.optionId(i)}
                    type="button"
                    role="option"
                    aria-selected={o === value}
                    className="ms-opt"
                    tabIndex={-1}
                    onClick={() => onChange(o)}
                  >
                    <span className="ms-check">{o === value && <Check size={11} />}</span>
                    <span className="ms-opt-label">{lab(o)}</span>
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
          </div>
          {/* Offered only when the typed text matches no stored value, and kept
              outside the scrolling list so it is reachable however long the
              filtered list is. */}
          {cb.canCreate && (
            <button
              type="button"
              className="ms-create-row"
              disabled={creating}
              onClick={() => void createValue(cb.typed)}
            >
              {creating ? <Loader2 size={13} className="imp-spin" /> : <Plus size={13} />}
              <span className="ms-create-text">
                {creating ? t("form.creatingValue") : t("form.addNewValue", { value: cb.typed })}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
