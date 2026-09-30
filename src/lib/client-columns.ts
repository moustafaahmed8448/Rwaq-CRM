/**
 * Clients-table column registry — the single source of truth for column order,
 * default widths, and what may be hidden or resized.
 *
 * Both the table and the kanban board read from this list, which is what makes
 * "the layout applies to both views" a property of the design rather than two
 * parallel implementations that drift apart.
 *
 * The default widths are the `fr` units the stylesheet used before, resolved to
 * pixels at its 1,210px minimum (1fr ≈ 100px after the fixed columns and gaps),
 * so an un-customised table looks exactly as it did.
 */

export type ColumnKey =
  | "select" | "id" | "client" | "status" | "channel" | "project"
  | "location" | "registeredAt" | "operation" | "firstContact"
  | "secondContact" | "lastUpdateDate" | "actions";

export interface ClientColumn {
  key: ColumnKey;
  /** Dictionary key for the header label; "" for columns with no heading. */
  labelKey: string;
  /** Default width in pixels. */
  w: number;
  min: number;
  max: number;
  /**
   * Locked columns cannot be hidden or resized: the select checkbox and actions
   * drive bulk operations, the id is the row's identity, and status is the axis
   * the kanban board is grouped by.
   */
  locked: boolean;
  /**
   * Whether this field appears on a kanban card. The date columns and the
   * select/actions columns have no card equivalent; the card's own action
   * buttons are always shown regardless.
   */
  inKanban: boolean;
}

export const CLIENT_COLUMNS: readonly ClientColumn[] = [
  { key: "select",         labelKey: "",                    w: 30,  min: 30,  max: 30,  locked: true,  inKanban: false },
  { key: "id",             labelKey: "th.id",               w: 42,  min: 36,  max: 90,  locked: true,  inKanban: false },
  { key: "client",         labelKey: "th.client",           w: 140, min: 110, max: 420, locked: false, inKanban: true },
  { key: "status",         labelKey: "th.status",           w: 85,  min: 70,  max: 200, locked: true,  inKanban: true },
  { key: "channel",        labelKey: "th.source",           w: 90,  min: 70,  max: 220, locked: false, inKanban: true },
  { key: "project",        labelKey: "th.project",          w: 100, min: 80,  max: 460, locked: false, inKanban: true },
  { key: "location",       labelKey: "th.location",         w: 100, min: 80,  max: 320, locked: false, inKanban: true },
  { key: "registeredAt",   labelKey: "th.date",             w: 80,  min: 70,  max: 180, locked: false, inKanban: false },
  { key: "operation",      labelKey: "form.operation",      w: 120, min: 90,  max: 460, locked: false, inKanban: true },
  { key: "firstContact",   labelKey: "th.first",            w: 85,  min: 70,  max: 220, locked: false, inKanban: true },
  { key: "secondContact",  labelKey: "th.second",           w: 85,  min: 70,  max: 220, locked: false, inKanban: true },
  { key: "lastUpdateDate", labelKey: "detail.lastUpdate",   w: 80,  min: 70,  max: 180, locked: false, inKanban: false },
  { key: "actions",        labelKey: "",                    w: 50,  min: 50,  max: 50,  locked: true,  inKanban: false },
];

/** A user's saved layout: only the keys they actually changed. */
export interface ColumnPrefs {
  [key: string]: { w?: number; hidden?: boolean };
}

/** Resolved layout — every column, always present, with a concrete width. */
export interface ResolvedColumn extends ClientColumn {
  w: number;
  hidden: boolean;
}

/**
 * Merges a sparse saved layout over the registry defaults.
 *
 * Tolerates anything: an unknown key is ignored, a missing column falls back to
 * its default, and a stored width is clamped into that column's min/max. So a
 * layout saved before a column existed — or with a hand-edited value — degrades
 * to a sane table instead of throwing.
 */
export function resolveColumns(prefs: ColumnPrefs | null | undefined): ResolvedColumn[] {
  return CLIENT_COLUMNS.map((col) => {
    const saved = prefs?.[col.key];
    const width = typeof saved?.w === "number" && Number.isFinite(saved.w) ? saved.w : col.w;
    return {
      ...col,
      w: col.locked ? col.w : Math.min(col.max, Math.max(col.min, Math.round(width))),
      hidden: col.locked ? false : saved?.hidden === true,
    };
  });
}

/** The `grid-template-columns` value for the visible columns. */
export function gridTemplate(columns: ResolvedColumn[]): string {
  return columns.filter((c) => !c.hidden).map((c) => `${c.w}px`).join(" ");
}

/**
 * Strips unknown keys and clamps values, so a tampered payload cannot persist junk.
 */
export function sanitizePrefs(input: unknown): ColumnPrefs {
  const out: ColumnPrefs = {};
  if (!input || typeof input !== "object") return out;
  const byKey = new Map(CLIENT_COLUMNS.map((c) => [c.key, c]));
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const col = byKey.get(key as ColumnKey);
    if (!col || !value || typeof value !== "object") continue;
    const v = value as { w?: unknown; hidden?: unknown };
    const entry: { w?: number; hidden?: boolean } = {};
    if (!col.locked && typeof v.w === "number" && Number.isFinite(v.w)) {
      entry.w = Math.min(col.max, Math.max(col.min, Math.round(v.w)));
    }
    if (!col.locked && typeof v.hidden === "boolean") entry.hidden = v.hidden;
    if (Object.keys(entry).length > 0) out[col.key] = entry;
  }
  return out;
}
