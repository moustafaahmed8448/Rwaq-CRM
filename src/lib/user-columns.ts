/**
 * Users table column registry — the third member of the family, alongside
 * client-columns.ts and marketing-columns.ts.
 *
 * It is the first of the three with no checkbox gutter: the users grid has no
 * bulk action bar, so there is nothing for a `select` column to select. The
 * `actions` gutter (edit + delete) is locked for the same reason the others lock
 * theirs — its width is dictated by the icons, not the user.
 *
 * Deliberately SEPARATE from the other two: `role` and `username` are keys here
 * that neither registry knows, so a shared blob would have those widths stripped
 * by the wrong sanitizer on the way back out. It also persists to its own column
 * on AppUser — `userColumns`.
 *
 * The generic machinery lives in column-registry.ts; this file only binds it to
 * the users vocabulary.
 */
import {
  resolveColumns as resolveColumnsFor,
  sanitizePrefs as sanitizePrefsFor,
  type ColumnPrefs,
  type GridColumn,
  type Resolved,
} from "@/lib/column-registry";

export type UserColumnKey = "name" | "index" | "email" | "role" | "actions";

export type UserColumn = GridColumn<UserColumnKey>;

/** A users column with a concrete width and visibility. */
export type ResolvedUserColumn = Resolved<UserColumn>;

export type { ColumnPrefs };
export { gridTemplate } from "@/lib/column-registry";

/** Merges a sparse saved layout over the users column defaults. */
export const resolveUserColumns = (prefs?: ColumnPrefs | null): ResolvedUserColumn[] =>
  resolveColumnsFor(USER_COLUMNS, prefs ?? null);

/** Clamps a saved payload against the users column bounds. */
export const sanitizeUserPrefs = (input: unknown): ColumnPrefs =>
  sanitizePrefsFor(USER_COLUMNS, input);

/**
 * Default widths are the `minmax()` minimums the settings team list used before,
 * so an un-customised table looks the way it always has.
 */
export const USER_COLUMNS: readonly UserColumn[] = [
  { key: "index",    labelKey: "#",    w: 30,  min: 20,  max: 100, locked: true  },
  { key: "name",     labelKey: "users.name",     w: 180, min: 120, max: 360, locked: false },
  { key: "email",    labelKey: "users.email",    w: 200, min: 120, max: 420, locked: false },
  { key: "role",     labelKey: "users.role",     w: 90,  min: 70,  max: 180, locked: false },
  { key: "actions",  labelKey: "",               w: 62,  min: 62,  max: 62,  locked: true  },
];