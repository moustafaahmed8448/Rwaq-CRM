"use client";

/**
 * Workspace name: the text beside the brand mark, admin-settable from Settings.
 *
 * Mirrors `useLogo()` in src/lib/logo.ts exactly — localStorage cache for the
 * first paint, then a fetch of the `Setting` row, with a change event so the
 * header, the login card and every other mounted consumer update the moment an
 * admin saves a new name.
 *
 * `DEFAULT_BRAND_NAME` is the original brand: a workspace that has never set a
 * name looks exactly as it did before this feature existed.
 */
import { useCallback, useEffect, useState } from "react";

export const DEFAULT_BRAND_NAME = "rwaq";

/** Mirrors the Setting row; used as a fast local cache so the header can paint immediately. */
const BRAND_CACHE_KEY = "rwaq-brand";

export const BRAND_CHANGED_EVENT = "rwaq-brand-changed";

function readCache(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(BRAND_CACHE_KEY) ?? "";
}

function writeCache(name: string): void {
  try {
    if (name) window.localStorage.setItem(BRAND_CACHE_KEY, name);
    else window.localStorage.removeItem(BRAND_CACHE_KEY);
  } catch {
    // A full or blocked storage quota must not break the branding.
  }
}

/** Notifies every mounted consumer (header, login card, settings) that the name changed. */
export function notifyBrandChanged(): void {
  window.dispatchEvent(new Event(BRAND_CHANGED_EVENT));
}

/**
 * The current workspace name, or the default when none is set.
 *
 * The cache is read in an effect rather than during render so the server and
 * client agree on the first paint (same hydration rule as useLogo). The browser
 * tab title is set here too, so every page that mounts the header (i.e. all of
 * them) shows the tenant's name without a per-page document.title call — the
 * static layout metadata is only the pre-hydration fallback.
 */
export function useBrand(): { brand: string; setBrand: (name: string) => void } {
  const [brand, setBrandState] = useState(DEFAULT_BRAND_NAME);

  useEffect(() => {
    const cached = readCache();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached) setBrandState(cached);
    let active = true;
    fetch("/api/settings/brand", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { name: "" }))
      .then((d) => {
        const next = typeof d?.name === "string" && d.name.trim() ? d.name.trim() : "";
        if (!active) return;
        writeCache(next);
        const resolved = next || DEFAULT_BRAND_NAME;
        setBrandState(resolved);
        document.title = resolved;
      })
      .catch(() => {
        // Keep whatever the cache gave us if the request fails.
        if (cached) document.title = cached;
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onChange = () => {
      const next = readCache() || DEFAULT_BRAND_NAME;
      setBrandState(next);
      document.title = next;
    };
    window.addEventListener(BRAND_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(BRAND_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setBrand = useCallback((next: string) => {
    writeCache(next);
    const resolved = next.trim() || DEFAULT_BRAND_NAME;
    setBrandState(resolved);
    document.title = resolved;
    notifyBrandChanged();
  }, []);

  return { brand, setBrand };
}