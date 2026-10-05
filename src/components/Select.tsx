"use client";

/**
 * Single-select searchable dropdown, replacing every native <select>.
 *
 * A native <select> cannot host a search box, cannot be styled to match the
 * glass theme, and on the client-detail page it forced "add new" to be faked as
 * a `__NEW__` option. This renders a real listbox with a filter box, full
 * keyboard navigation, and the same look as RefPicker.
 */
import type { CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useCombobox, type TFn } from "@/lib/use-combobox";

export default function Select({
  value, options, onChange, render, placeholder, className, style, t, ariaLabel, searchable = true,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  render?: (v: string) => string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  t: TFn;
  ariaLabel?: string;
  /**
   * Set false for a short, fixed list (sort order, role) where a filter box is
   * noise. Keyboard navigation and the shared styling are unaffected; only the
   * input is dropped and the listbox itself takes the key handler.
   */
  searchable?: boolean;
}) {
  const labelOf = (v: string) => (render ? render(v) : v);
  const cb = useCombobox({
    options, labelOf, selected: value ? [value] : [], onSelect: onChange,
    focusTarget: searchable ? "input" : "list",
  });

  return (
    <div className="ms-wrap cbx" data-cbx-root={cb.rootId}>
      <button
        id={cb.triggerId}
        type="button"
        className={`ms-trigger ${value ? "ms-active" : ""} ${className ?? ""}`}
        style={style}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={cb.open}
        onClick={cb.toggle}
      >
        <span className="ms-value">{value ? labelOf(value) : (placeholder ?? t("common.select"))}</span>
        <ChevronDown size={12} />
      </button>
      {cb.open && (
        <div className="ms-menu">
          {searchable && (
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
                onChange={(e) => cb.setQuery(e.target.value)}
                onKeyDown={cb.onKeyDown}
              />
            </div>
          )}
          {/* The listbox role sits here, not on .ms-menu: the options are direct
              children of this element, which is what the role requires. Without
              a search box it is also the focused element, so it needs the keys. */}
          <div
            className="ms-list"
            id={cb.menuId}
            role="listbox"
            tabIndex={searchable ? -1 : 0}
            onKeyDown={searchable ? undefined : cb.onKeyDown}
          >
            {cb.filtered.length === 0 && <div className="ms-empty">{t("common.noMatches")}</div>}
            {cb.filtered.map((o, i) => (
              <button
                key={o}
                id={cb.optionId(i)}
                type="button"
                role="option"
                aria-selected={o === value}
                className={`ms-opt${o === value ? " ms-opt-on" : ""}${i === cb.active ? " ms-opt-active" : ""}`}
                onMouseEnter={() => cb.setActive(i)}
                onClick={() => { onChange(o); cb.close(true); }}
              >
                {o === value ? <Check size={12} className="ms-tick" /> : <span className="ms-tick" />}
                <span className="ms-opt-label">{labelOf(o)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
