/**
 * Generic table-column machinery, shared by every resizable grid.
 *
 * The clients table was the first grid in the app and its registry, resolver and
 * grid-template builder all hard-coded `Client` and `CLIENT_COLUMNS`. The
 * marketing metrics table needs the identical behaviour — same resizing, same
 * clamping, same "unknown key is ignored" tolerance — over an unrelated row type
 * and an unrelated column set.
 *
 * Those pieces are therefore expressed here against a structural type, and
 * client-columns.ts keeps its client-specific vocabulary (`ColumnKey`,
 * `ClientColumn`) on top. Nothing here imports a row type, so it cannot drift
 * toward either table.
 */

/** A column as the registry declares it. `K` is the host's own key union. */
export interface GridColumn<K extends string = string> {
  key: K;
  /** Dictionary key for the header label; "" for columns with no heading. */
  labelKey: string;
  /** Default width in pixels. */
  w: number;
  min: number;
  max: number;
  /**
   * Locked columns cannot be hidden or resized. Used for columns that drive bulk
   * operations or identify the row.
   */
  locked: boolean;
  /** Hidden until the user opts in from the Columns picker. */
  hiddenByDefault?: boolean;
}

/** A user's saved layout: only the keys they actually changed. */
export interface ColumnPrefs {
  [key: string]: { w?: number; hidden?: boolean };
}

/** A registry: the ordered list of columns a grid renders. */
export type ColumnRegistry<K extends string = string> = readonly GridColumn<K>[];

/**
 * A registry entry with a concrete width and visibility.
 *
 * Derived from the ENTRY's own type rather than from `GridColumn`, so a registry
 * carrying extra fields — the clients one has `inKanban`, which the kanban board
 * reads — keeps them. Widening to `GridColumn` here would silently strip them and
 * force a cast at every call site.
 */
export type Resolved<C extends GridColumn<string>> = Omit<C, "w" | "hidden"> & { w: number; hidden: boolean };

/**
 * Merges a sparse saved layout over the registry defaults.
 *
 * Tolerates anything: an unknown key is ignored, a missing column falls back to
 * its default, and a stored width is clamped into that column's min/max. So a
 * layout saved before a column existed — or with a hand-edited value — degrades
 * to a sane table instead of throwing.
 */
export function resolveColumns<C extends GridColumn<string>>(
  registry: readonly C[],
  prefs: ColumnPrefs | null | undefined,
): Resolved<C>[] {
  return registry.map((col) => {
    const saved = prefs?.[col.key];
    const width = typeof saved?.w === "number" && Number.isFinite(saved.w) ? saved.w : col.w;
    return {
      ...col,
      w: col.locked ? col.w : Math.min(col.max, Math.max(col.min, Math.round(width))),
      // `saved.hidden` wins when present, so ticking the box in the Columns picker
      // beats `hiddenByDefault` permanently; with nothing saved, the column's own
      // default applies.
      hidden: col.locked ? false : (saved?.hidden ?? col.hiddenByDefault ?? false),
    };
  });
}

/** The `grid-template-columns` value for the visible columns. */
export function gridTemplate<C extends GridColumn<string>>(columns: Resolved<C>[]): string {
  return columns.filter((c) => !c.hidden).map((c) => `${c.w}px`).join(" ");
}

/**
 * Strips unknown keys and clamps values, so a tampered payload cannot persist junk.
 *
 * Takes the registry rather than assuming the clients one: a marketing key like
 * `spend` is unknown to the clients registry, and clamping it against clients
 * bounds would either drop it or store a width the marketing table rejects.
 */
export function sanitizePrefs<K extends string>(
  registry: ColumnRegistry<K>,
  input: unknown,
): ColumnPrefs {
  const out: ColumnPrefs = {};
  if (!input || typeof input !== "object") return out;
  const byKey = new Map(registry.map((c) => [c.key, c]));
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const col = byKey.get(key as K);
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