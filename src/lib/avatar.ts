"use client";

/**
 * Profile photos: client-side downscaling before upload.
 *
 * Structurally the same as readLogoFile in logo.ts, with a much smaller cap. The
 * logo is one row read on every page load; an avatar is one per TEAM MEMBER, and
 * /api/users returns the whole team in a single response, so a 400px PNG per
 * person would make that response heavy for no visual gain — an avatar is drawn
 * at 40px in the table and 96px in the panel.
 *
 * Rejects are signalled by error MESSAGE rather than a code, matching the caller
 * in logo.ts: `NOT_AN_IMAGE`, `TOO_LARGE` or `BAD_IMAGE`.
 */
import { MAX_UPLOAD_BYTES } from "@/lib/logo-constants";

export { MAX_UPLOAD_BYTES };

/** Longest edge, in CSS pixels, of a stored avatar. */
const MAX_EDGE_PX = 160;

/** Reads an image file and returns a downscaled PNG data URL. */
export function readAvatarFile(file: File): Promise<string> {
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
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("BAD_IMAGE"));
    };
    img.src = objectUrl;
  });
}

/**
 * Initials for the fallback avatar tile.
 *
 * Takes the first letter of up to two words, which is what reads as a person's
 * initials in Arabic and Latin names alike. Falls back to "?" so the tile is
 * never a blank box.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}