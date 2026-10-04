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
 *
 * The generic resolver/clamp/grid-template helpers live in column-registry.ts so
 * the marketing table can use the same machinery over its own column set; this
 * file keeps only what is specific to clients.
 */
import {
  resolveColumns as resolveColumnsFor,
  sanitizePrefs as sanitizePrefsFor,
  type ColumnPrefs,
  type GridColumn,
  type Resolved,
} from "@/lib/column-registry";

export type ColumnKey =
  | "select" | "id" | "client" | "status" | "channel" | "project"
  | "location" | "registeredAt" | "operation" | "firstContact"
  | "secondContact" | "lastUpdateDate" | "nextFollowUp" | "actions";

/**
 * The clients column set, described with the GENERIC machinery from
 * column-registry.ts. Only two fields are client-specific: `inKanban`, which the
 * kanban board reads, and the concrete `ColumnKey` union above.
 */
export interface ClientColumn extends GridColumn<ColumnKey> {
  /**
   * Whether this field appears on a kanban card. The date columns and the
   * select/actions columns have no card equivalent; the card's own action
   * buttons are always shown regardless.
   */
  inKanban: boolean;
}

/** A clients column with a concrete width and visibility. Keeps `inKanban`. */
export type ResolvedColumn = Resolved<ClientColumn>;

/* Re-exported so importers of `@/lib/client-columns` keep one place for "the
   clients table's layout". The generic implementations live in
   column-registry.ts and take the registry as an argument; the two wrappers
   below bind it to the clients one. */
export type { ColumnPrefs };
export { gridTemplate } from "@/lib/column-registry";

/** Merges a sparse saved layout over the clients column defaults. */
export const resolveColumns = (prefs?: ColumnPrefs | null): ResolvedColumn[] =>
  resolveColumnsFor(CLIENT_COLUMNS, prefs ?? null);

/** Clamps a saved payload against the clients column bounds. */
export const sanitizePrefs = (input: unknown): ColumnPrefs =>
  sanitizePrefsFor(CLIENT_COLUMNS, input);

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
  { key: "nextFollowUp",  labelKey: "th.followUp",        w: 90,  min: 70,  max: 180, locked: false, inKanban: true, hiddenByDefault: true },
  { key: "actions",        labelKey: "",                    w: 50,  min: 50,  max: 50,  locked: true,  inKanban: false },
];

/**
 * Merges a sparse saved layout over the registry defaults, and the `sanitizePrefs`
 * counterpart, both live in column-registry.ts and take the registry as an
 * argument. The client-bound wrappers are declared near the top of this file.
 */
