"use client";

/**
 * Loads the admin-set reference-option colours once and shares them with every
 * component that needs to render a status, channel or location.
 *
 * This is a tiny external store rather than React context on purpose. The
 * colours have to reach deeply nested leaves — a `StatusPill` inside a kanban
 * card, a channel dot inside a table cell in ClientTable — and context would mean
 * threading a provider through every page and wrapping components that render in
 * isolation. A module-level store plus `useSyncExternalStore` lets any component
 * subscribe with a single hook call and no provider at all, while still giving
 * every subscriber the SAME snapshot reference (so React's referential-equality
 * bail-out works and a colour change re-renders all of them consistently).
 *
 * Reads are safe during SSR and the first client render: the store starts empty
 * and `optionColor` falls back to the code-level built-ins, so the server HTML
 * and the first client paint agree and hydration never mismatches.
 */
import { useEffect, useSyncExternalStore } from "react";
import { coerceColors, EMPTY_COLORS, type OptionColors } from "@/lib/ref-options";

let snapshot: OptionColors = EMPTY_COLORS;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Fetches the colour map. Safe to call repeatedly: concurrent callers share the
 * one in-flight request, so three components mounting on the same page produce
 * a single network call rather than three.
 */
export function refreshOptionColors(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/options", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<{ colors?: unknown }>) : null))
    .then((data) => {
      if (data?.colors && typeof data.colors === "object") {
        // A fresh object every time, so subscribers relying on reference
        // equality re-render exactly once per real change.
        snapshot = coerceColors(data.colors);
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

/** The colour map, loaded once per page. */
export function useOptionColors(): OptionColors {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void refreshOptionColors();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}