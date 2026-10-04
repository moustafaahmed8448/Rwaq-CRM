"use client";

/**
 * Shared column-layout state: resolve defaults, apply a user's saved layout, and
 * persist changes back to their own row.
 *
 * Extracted because two pages render the SAME clients table and each had its own
 * half of this. The clients page persisted through a debounced PATCH; the profile
 * page only called `setColumns`, so a drag there looked like it worked and then
 * reverted on reload — and silently overwrote whatever the clients page had saved.
 * One hook makes that split impossible.
 *
 * The marketing table uses it too, with its own registry and its own saved field,
 * so column widths survive a reload on every table rather than only one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveColumns, type ColumnPrefs, type GridColumn, type Resolved } from "@/lib/column-registry";

export interface ColumnLayout<C extends GridColumn<string> = GridColumn<string>> {
  columns: Resolved<C>[];
  /** Pass to a grid's `onColumnsChange`. Applies now, saves shortly after. */
  commit: (next: Resolved<C>[]) => void;
  /** Applies saved prefs without saving. Call once, when the session resolves. */
  hydrate: (prefs?: ColumnPrefs | null) => void;
  saving: boolean;
}

export function useColumnLayout<C extends GridColumn<string>>(
  registry: readonly C[],
  field: "clientColumns" | "marketingColumns" | "userColumns",
  initial?: ColumnPrefs | null,
): ColumnLayout<C> {
  const [columns, setColumns] = useState<Resolved<C>[]>(() => resolveColumns(registry, initial ?? null));
  const [saving, setSaving] = useState(false);

  /* Debounce timer held in a ref rather than state: the effect below already
     re-runs on every `columns` change, and a timer in state would add a second
     render per drag frame for no behavioural gain. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: Resolved<C>[]) => {
    setColumns(next);
    setSaving(true);
  }, []);

  const hydrate = useCallback((prefs?: ColumnPrefs | null) => {
    setColumns(resolveColumns(registry, prefs ?? null));
  }, [registry]);

  useEffect(() => {
    if (!saving) return;
    if (timer.current) clearTimeout(timer.current);
    // 400ms: long enough that a drag (which fires on every pointer move) produces
    // one request instead of one per pixel, short enough that switching pages
    // immediately afterwards still saves.
    timer.current = setTimeout(async () => {
      try {
        await fetch("/api/auth/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [field]: Object.fromEntries(
              columns
                .filter((c) => {
                  const def = registry.find((d) => d.key === c.key);
                  // An unknown key (a column dropped from the registry since the
                  // layout was saved) has no default, so it is left alone rather
                  // than crashing the filter.
                  if (!def) return false;
                  return c.w !== def.w || c.hidden;
                })
                .map((c) => [c.key, { w: c.w, hidden: c.hidden }]),
            ),
          }),
        });
      } catch {
        // A failed save is not worth interrupting the user over; the layout still
        // applies for this session.
      } finally {
        setSaving(false);
      }
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [columns, saving, field, registry]);

  return { columns, commit, hydrate, saving };
}