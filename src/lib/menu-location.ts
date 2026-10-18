"use client";

/**
 * Workspace-wide navigation placement: "header" (topbar tabs) or "sidebar".
 *
 * Mirrors `useLogo()` and `useBrand()`: a localStorage cache drives the first
 * paint so the header switches to the sidebar instantly on navigation, and a
 * fetch of the `Setting` row refreshes it (with a change event so every mounted
 * header updates the moment an admin saves a new value). Reading only from the
 * cache during render keeps SSR and the first client paint in step (no hydration
 * mismatch); the cache is applied in an effect.
 */
import { useCallback, useEffect, useState } from "react";

export type MenuLocation = "header" | "sidebar";

/** Mirrors the Setting row; a fast local cache so the header paints immediately. */
const CACHE_KEY = "rwaq-menu-location";

export const MENU_LOCATION_CHANGED_EVENT = "rwaq-menu-location-changed";

function readCache(): MenuLocation {
  if (typeof window === "undefined") return "header";
  return window.localStorage.getItem(CACHE_KEY) === "sidebar" ? "sidebar" : "header";
}

function writeCache(value: MenuLocation): void {
  try {
    window.localStorage.setItem(CACHE_KEY, value);
  } catch {
    // A full or blocked storage quota must not break the layout toggle.
  }
}

/** Notifies every mounted header that the menu location changed. */
export function notifyMenuLocationChanged(): void {
  window.dispatchEvent(new Event(MENU_LOCATION_CHANGED_EVENT));
}

export function useMenuLocation(): {
  menuLocation: MenuLocation;
  setMenuLocation: (value: MenuLocation) => void;
} {
  const [menuLocation, setMenuLocationState] = useState<MenuLocation>("header");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuLocationState(readCache());
    let active = true;
    fetch("/api/settings/menu-location", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { menuLocation?: string } | null) => {
        if (!active || !d) return;
        const resolved = d.menuLocation === "sidebar" ? "sidebar" : "header";
        writeCache(resolved);
        setMenuLocationState(resolved);
      })
      .catch(() => {
        // Keep whatever the cache gave us if the request fails.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onChange = () => setMenuLocationState(readCache());
    window.addEventListener(MENU_LOCATION_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(MENU_LOCATION_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setMenuLocation = useCallback((next: MenuLocation) => {
    writeCache(next);
    setMenuLocationState(next);
    notifyMenuLocationChanged();
  }, []);

  return { menuLocation, setMenuLocation };
}
