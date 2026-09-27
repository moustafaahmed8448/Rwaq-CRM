"use client";

/**
 * Dashboard logo: client-side downscaling + a shared fetch hook.
 *
 * The logo is a data URL stored in the `Setting` table so every user and every
 * device sees the same one. Raw uploads are rejected past MAX_UPLOAD_BYTES, and
 * anything that gets through is redrawn onto a canvas capped at MAX_EDGE_PX.
 * That keeps the stored payload in the tens-of KB rather than the multi-MB a
 * 2MB base64 upload would otherwise produce — this row is downloaded by every
 * user on every page load, so its size is a real cost, not a detail.
 */
import { useCallback, useEffect, useState } from "react";
import { MAX_UPLOAD_BYTES } from "@/lib/logo-constants";

export { MAX_UPLOAD_BYTES };

/** Longest edge, in CSS pixels, of the stored logo. */
const MAX_EDGE_PX = 400;

/** Mirrors the Setting row; used as a fast local cache so the header can paint immediately. */
const LOGO_CACHE_KEY = "rwaq-logo";

export const LOGO_CHANGED_EVENT = "rwaq-logo-changed";

/** Reads a logo file and returns a downscaled, transparent PNG data URL. */
export function readLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("NOT_AN_IMAGE"));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error("TOO_LARGE"));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      // Guard against a zero-dimension image, which would throw in drawImage.
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("BAD_IMAGE"));
        return;
      }
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("BAD_IMAGE"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // PNG keeps the alpha channel, so logos on transparent backgrounds survive.
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("BAD_IMAGE"));
    };
    img.src = objectUrl;
  });
}

function readCache(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LOGO_CACHE_KEY) ?? "";
}

function writeCache(logo: string): void {
  try {
    if (logo) window.localStorage.setItem(LOGO_CACHE_KEY, logo);
    else window.localStorage.removeItem(LOGO_CACHE_KEY);
  } catch {
    // A full or blocked storage quota must not break the logo.
  }
}

/** Notifies every mounted consumer (header, login card) that the logo changed. */
export function notifyLogoChanged(): void {
  window.dispatchEvent(new Event(LOGO_CHANGED_EVENT));
}

/**
 * The current logo, or "" when none is set.
 *
 * The cache is read in an effect rather than during render so the server and
 * client agree on the first paint and React never reports a hydration mismatch.
 */
export function useLogo(): { logo: string; setLogo: (logo: string) => void } {
  const [logo, setLogoState] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogoState(readCache());
    let active = true;
    fetch("/api/settings/logo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { logo: "" }))
      .then((d) => {
        const next = typeof d?.logo === "string" ? d.logo : "";
        if (!active) return;
        writeCache(next);
        setLogoState(next);
      })
      .catch(() => {
        // Keep whatever the cache gave us if the request fails.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onChange = () => setLogoState(readCache());
    window.addEventListener(LOGO_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(LOGO_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setLogo = useCallback((next: string) => {
    writeCache(next);
    setLogoState(next);
    notifyLogoChanged();
  }, []);

  return { logo, setLogo };
}
