/**
 * Shapes shared between the clients page and the profile page.
 *
 * These lived as private `type`s inside src/app/page.tsx, which meant the
 * profile page could not reuse the table or the filter bar without either
 * duplicating them or importing from a page module — the latter being a layering
 * violation, since a page is an entry point, not a library.
 *
 * Deliberately types plus a couple of pure helpers. Anything with state, effects
 * or fetching stays in the components that own it.
 */

/** A client row as the API returns it (ISO date strings, activity log stripped). */
export type Client = {
  id: string; name: string; phoneNumber: string;
  status: "WAITING" | "WON" | "LOST" | string;
  project: string; location: string; acquisitionChannel: string;
  operationToTake: string; firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string;
  /** ISO string, or null when no follow-up is set. */
  nextFollowUpAt?: string | null;
  archived?: boolean; archivedAt?: string;
  /** Row index/display order within the current sorted/filtered table. */
  index?: number;
};

export type Filters = {
  query: string;
  status: string[]; channel: string[]; location: string[];
  firstContact: string[]; secondContact: string[];
  /** "" for no filter, else one of the FollowUpFilter buckets. */
  followUp: string;
  startDate: string; endDate: string;
};

export const initialFilters: Filters = {
  query: "", status: [], channel: [], location: [],
  firstContact: [], secondContact: [], followUp: "",
  startDate: "", endDate: "",
};

/** Which client date the table is ordered by. */
export type SortField = "recent" | "oldest" | "registered" | "registeredOldest";

/** One of the rolling date presets offered above the filter bar. */
export type DatePreset = { label: string; startDate?: string; endDate?: string };

/** Sort options are a closed set, so the label key can be looked up by value. */
export const SORT_LABELS: Record<string, string> = {
  recent: "clients.sortRecent",
  oldest: "clients.sortOldest",
  registered: "clients.sortRegistered",
  registeredOldest: "clients.sortRegisteredOldest",
};

/** The four follow-up buckets, in the order the filter chips show them. */
export const FOLLOW_UP_BUCKETS = ["overdue", "today", "upcoming", "none"] as const;

/** The dictionary-lookup signature both filter bar and table receive. */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;