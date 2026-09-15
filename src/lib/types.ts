export type ActivityAction =
  | "STATUS_CHANGE"
  | "FIELD_EDIT"
  | "NOTE_ADD"
  | "NOTE_EDIT"
  | "CREATED"
  | "DELETED"
  | "STATUS_CUSTOM_ADDED";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: ActivityAction;
  field?: string;
  oldValue?: string;
  newValue?: string;
  summary?: string;
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
}

export function makeActivityEntry(
  action: ActivityAction,
  actor: string,
  opts?: { field?: string; oldValue?: string; newValue?: string; summary?: string }
): ActivityEntry {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    ...opts,
  };
}

export function summarizeAction(action: ActivityAction, field?: string, oldValue?: string, newValue?: string): string {
  if (action === "STATUS_CHANGE") return `Status changed: ${oldValue} → ${newValue}`;
  if (action === "FIELD_EDIT" && field) return `${field} updated`;
  if (action === "CREATED") return "Client created";
  if (action === "NOTE_ADD" || action === "NOTE_EDIT") return "Notes updated";
  if (action === "DELETED") return "Client deleted";
  return action;
}
