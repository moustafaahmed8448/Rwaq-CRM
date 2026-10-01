/**
 * Reference options — the workspace-wide lists behind a client's status,
 * acquisition channel and location — and the one place their colour is decided.
 *
 * Before this module, each screen carried its own colour map. `src/app/page.tsx`
 * and `src/app/marketing/page.tsx` each held a byte-identical `CH_COLORS`
 * constant, and locations had no colour at all, so the same value could render
 * blue in the dashboard table and grey in the kanban card. An admin changing a
 * colour now writes it once (see /api/options) and every consumer resolves it
 * through `optionColor`, so the pickers, pills, tags, funnel bars and the admin
 * page can never disagree.
 *
 * Resolution order is: an admin-set colour, then the code-level built-in, then a
 * stable hash of the value. The last step is what keeps a value that nobody has
 * coloured yet from rendering as an invisible uncoloured dot.
 *
 * DELIBERATELY NOT marked "use client": this module holds pure data and pure
 * functions — no hooks, no browser APIs — and `src/app/api/options/route.ts`
 * imports it. A server module must never pull across a client boundary, or the
 * route gets client references it cannot call and the whole endpoint fails. This
 * is the same split `src/lib/logo-constants.ts` documents for the logo limits.
 */
import {
  BUILTIN_LOCATION_KEYS,
  channelValues,
  hashedColor,
  PREDEFINED_STATUSES,
  statusColor,
} from "@/lib/reporting";

/** The three reference lists, in the order the admin page renders them. */
export const REF_KINDS = ["statuses", "channels", "locations"] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** Setting key holding the admin-set colour for each kind. */
export const COLORS_SETTING_KEY = "optionColors";

/** Built-in channel palette, promoted out of the two duplicated page constants. */
export const CHANNEL_COLORS: Record<string, string> = {
  FACEBOOK: "#1877f2",
  INSTAGRAM: "#e11d48",
  X: "#111827",
  TIKTOK: "#7c3aed",
  GOOGLE_ADS: "#d97706",
  WHATSAPP: "#16a34a",
  CALLS: "#ea580c",
  SALES: "#0891b2",
};

/** Colour overrides, keyed by kind then by the raw stored value. */
export type OptionColors = Partial<Record<RefKind, Record<string, string>>>;

export const EMPTY_COLORS: OptionColors = {};

/** Only `#rgb` and `#rrggbb` are accepted. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalizes a colour from the API or a colour input, or returns null.
 *
 * Rejecting anything else matters: an empty or malformed string interpolated
 * into `style={{ background }}` is silently dropped by the browser, which would
 * render an uncoloured dot and read as "this option has no colour" rather than
 * as a bug. Null lets the caller fall back instead.
 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  return HEX.test(raw) ? raw : null;
}

/**
 * Coerces the stored JSON into a colour map.
 *
 * The row is user-editable through the API, so anything can end up in it. A bad
 * entry is dropped here rather than at every render site.
 */
export function coerceColors(raw: unknown): OptionColors {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_COLORS;
  const out: OptionColors = {};
  for (const kind of REF_KINDS) {
    const group = (raw as Record<string, unknown>)[kind];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const entries: Record<string, string> = {};
    for (const [value, color] of Object.entries(group as Record<string, unknown>)) {
      const normalized = normalizeColor(color);
      if (value && normalized) entries[value] = normalized;
    }
    out[kind] = entries;
  }
  return out;
}

/**
 * The colour for a reference value.
 *
 * Order matters: an admin override wins over the built-in, so a colour chosen on
 * the options page is what the whole app shows, including for the pipeline
 * stages whose colour used to be a code constant.
 */
export function optionColor(kind: RefKind, value: string, colors?: OptionColors): string {
  const key = String(value ?? "");
  const override = normalizeColor(colors?.[kind]?.[key]);
  if (override) return override;
  if (kind === "statuses") return statusColor(key);
  if (kind === "channels") return CHANNEL_COLORS[key] ?? hashedColor(key);
  // Locations had no colour of their own before; the stable hash gives every
  // city and custom location a distinct, repeatable chip.
  return hashedColor(key);
}

/** True when the value ships with the app and therefore cannot be deleted. */
export function isBuiltinOption(kind: RefKind, value: string): boolean {
  if (kind === "statuses") return PREDEFINED_STATUSES.includes(value);
  if (kind === "channels") return channelValues.includes(value);
  return BUILTIN_LOCATION_KEYS.includes(value);
}

/**
 * The stored form of a new label, mirroring what each endpoint already writes.
 *
 * Channels and statuses are upper-cased tokens throughout the app; locations are
 * free text typed by the user and keep their original casing.
 */
export function normalizeOptionLabel(kind: RefKind, label: string): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "";
  return kind === "locations" ? raw : raw.toUpperCase().replace(/\s+/g, "_");
}