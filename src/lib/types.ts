export type ActivityAction =
  | "STATUS_CHANGE"
  | "FIELD_EDIT"
  | "NOTE_ADD"
  | "NOTE_EDIT"
  | "CREATED"
  | "DELETED"
  | "ARCHIVED"
  | "RESTORED"
  | "STATUS_CUSTOM_ADDED";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: ActivityAction;
  /** Raw Client column key (e.g. "acquisitionChannel") so the UI can localize it. */
  field?: string;
  oldValue?: string;
  newValue?: string;
  /** Client name, for entries that refer to a specific client (archived/restored). */
  clientName?: string;
  /**
   * Legacy English prose written before activity logs were localized.
   * Only used as a last-resort fallback for rows created before localization.
   */
  summary?: string;
}

export interface MarketingMetric {
  id: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  channel: string;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientData {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  notes?: string;
  createdAt: string;
  lastUpdateDate: string;
  activityLog: ActivityEntry[];
  customStatuses?: string[];
  archived?: boolean;
  archivedAt?: string;
}

export function makeActivityEntry(
  action: ActivityAction,
  actor: string,
  opts?: { field?: string; oldValue?: string; newValue?: string; clientName?: string },
  // No English prose is stored: the UI localizes the entry from `action` +
  // `field` at render time (see describeActivity in src/lib/reporting.ts), so
  // the same log reads correctly in Arabic and English.
): ActivityEntry {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    ...opts,
  };
}

