"use client";

/**
 * Shared dropdown behaviour — search, keyboard navigation, outside-click
 * dismissal — for every picker in the app.
 *
 * This exists because three components (RefPicker, MultiSelect, Select) all
 * need the same behaviour, and the duplication had already drifted: the client
 * detail page carried its own copy that hid "add new" behind a `__NEW__`
 * <option>, so the same field behaved differently on two screens.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Folds away the letter variants a user will not type identically to how they
 * happen to be stored, so either spelling finds the row. Also strips the bidi
 * marks the RTL layout can leave in a stored value.
 *
 * Exported so a caller can decide whether a typed value already exists, using
 * exactly the same comparison the filter uses.
 */
export function normalizeLabel(s: string): string {
  return s
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .trim();
}

export function useCombobox({
  options, labelOf, selected, onSelect, onRemoveLast, closeOnSelect = true,
  focusTarget = "input", onCreate,
}: {
  options: string[];
  /** Display text for a value — search matches this *and* the raw value. */
  labelOf: (v: string) => string;
  selected: string[];
  onSelect: (v: string) => void;
  /** Backspace on an empty search removes the last chip (multi-select only). */
  onRemoveLast?: () => void;
  /** Multi-select keeps the menu open so several values can be ticked. */
  closeOnSelect?: boolean;
  /**
   * "list" for a dropdown with no filter box: there is no input to focus, so
   * keyboard handling moves to the listbox itself.
   */
  focusTarget?: "input" | "list";
  /**
   * Enables the "add this value" row. The hook decides whether to show it,
   * because the decision depends on the query it owns.
   */
  onCreate?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeRaw, setActiveRaw] = useState(0);

  // DOM lookups instead of refs: a custom hook that hands refs back to its
  // caller cannot satisfy react-hooks/refs, and every caller would need
  // `useEffect`-synced ref plumbing just to satisfy the linter.
  const key = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rootId = `cbx${key}`;
  const menuId = `${rootId}-listbox`;
  const inputId = `${rootId}-input`;
  const triggerId = `${rootId}-trigger`;

  const filtered = useMemo(() => {
    const q = normalizeLabel(query);
    const hit = (v: string) =>
      !q || normalizeLabel(labelOf(v)).includes(q) || normalizeLabel(v).includes(q);
    // Selected values stay pinned at the top so they never vanish mid-search.
    return [
      ...options.filter((v) => selected.includes(v) && hit(v)),
      ...options.filter((v) => !selected.includes(v) && hit(v)),
    ];
    // `labelOf` is usually an inline arrow, so this recomputes each render.
    // That is fine: the list is tens of rows, and it keeps the filter correct
    // when the caller swaps in a different language or label map.
  }, [options, query, selected, labelOf]);

  // Derived rather than clamped in an effect, which would be a setState there.
  const active = filtered.length ? Math.min(activeRaw, filtered.length - 1) : 0;

  /** What the user typed, trimmed; empty means "no create offered". */
  const typed = query.trim();

  /**
   * True when the typed text is not already a stored value. Compared with the
   * same folding the filter uses, so "قاهره" is recognised as "القاهرة" and does
   * not offer to create a duplicate.
   */
  const canCreate = Boolean(onCreate) && typed !== "" && !options.some(
    (v) => normalizeLabel(labelOf(v)) === normalizeLabel(typed) || normalizeLabel(v) === normalizeLabel(typed),
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.(`[data-cbx-root="${rootId}"]`)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, rootId]);

  // Focus the search box once the menu has mounted, or the listbox itself when
  // this dropdown has no filter box. No setState here, so this is an effect the
  // react-hooks rules allow.
  useEffect(() => {
    if (!open) return;
    document.getElementById(focusTarget === "list" ? menuId : inputId)?.focus();
  }, [open, inputId, menuId, focusTarget]);

  // Keep the highlighted row visible while arrowing through a long list.
  //
  // Deliberately NOT `scrollIntoView`. That scrolls EVERY scrollable ancestor, so
  // once a dropdown lived inside a scrolling container — the modal body, since
  // `.modal-body` became `overflow-y:auto` — opening the menu dragged the whole
  // form down to the field. Adjusting `scrollTop` on the listbox itself moves the
  // same pixels and cannot touch an ancestor, because scrollTop is scoped to one
  // element.
  useEffect(() => {
    if (!open) return;
    const list = document.getElementById(menuId);
    const opt = document.getElementById(`${menuId}-opt-${active}`);
    if (!list || !opt) return;
    const lb = list.getBoundingClientRect();
    const ob = opt.getBoundingClientRect();
    if (ob.top < lb.top) list.scrollTop -= lb.top - ob.top;
    else if (ob.bottom > lb.bottom) list.scrollTop += ob.bottom - lb.bottom;
  }, [active, open, menuId, filtered]);

  const openMenu = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveRaw(0);
  }, []);

  /** Escape returns focus to the trigger; an outside click must not steal it. */
  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) document.getElementById(triggerId)?.focus();
  }, [triggerId]);

  const toggle = useCallback(() => {
    if (open) setOpen(false);
    else openMenu();
  }, [open, openMenu]);

  const onKeyDown = (e: KeyboardEvent) => {
    const n = filtered.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveRaw(n ? (active + 1) % n : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveRaw(n ? (active - 1 + n) % n : 0);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveRaw(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveRaw(Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[active];
      // Nothing highlighted to pick — the "type something new and press Enter"
      // path. Only offered when the text is not already a stored value.
      if (pick === undefined) { if (canCreate) onCreate?.(typed); return; }
      onSelect(pick);
      setQuery("");
      if (closeOnSelect) setOpen(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Backspace" && query === "" && onRemoveLast) {
      e.preventDefault();
      onRemoveLast();
    }
  };

  return {
    open, query, setQuery, active, setActive: setActiveRaw, filtered,
    rootId, menuId, inputId, triggerId, onKeyDown, toggle, openMenu, close,
    optionId: (i: number) => `${menuId}-opt-${i}`,
    typed, canCreate,
  };
}
