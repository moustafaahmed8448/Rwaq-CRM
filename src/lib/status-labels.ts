"use client";

/**
 * Admin-set display names for statuses, shared with every component that shows
 * one.
 *
 * Structurally identical to option-colors.ts, and for the same reason: a status
 * label is needed by deeply nested leaves — a `StatusPill` in a kanban card, the
 * column header, a filter chip, a funnel row — and React context would mean
 * threading a provider through every page. A module-level store plus
 * `useSyncExternalStore` lets any component subscribe with one hook call and no
 * provider, while still handing every subscriber the SAME snapshot reference so
 * referential-equality bail-out keeps working.
 *
 * Reads are safe during SSR and the first client render: the store starts empty
 * and `statusLabel` falls back to the built-in name, so server HTML and first
 * paint agree and hydration never mismatches.
 *
 * ONLY the display name lives here. The stored status value is untouched, which
 * is what keeps `classifyStatus` — and therefore every KPI, the funnel and the win
 * rate — correct after a rename.
 */
import { useEffect, useSyncExternalStore } from "react";
import { coerceStatusLabels } from "@/lib/reporting";

export type StatusLabels = Record<string, string>;

const EMPTY: StatusLabels = {};

let snapshot: StatusLabels = EMPTY;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Fetches the label map. Safe to call repeatedly: concurrent callers share the
 * one in-flight request, so three components mounting on the same page produce a
 * single network call rather than three.
 */
export function refreshStatusLabels(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/options", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<{ statusLabels?: unknown }>) : null))
    .then((data) => {
      if (data && data.statusLabels !== undefined) {
        // A fresh object every time, so subscribers relying on reference equality
        // re-render exactly once per real change.
        snapshot = coerceStatusLabels(data.statusLabels);
        emit();
      }
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

/** The admin label map, loaded once per page. */
export function useStatusLabels(): StatusLabels {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void refreshStatusLabels();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}