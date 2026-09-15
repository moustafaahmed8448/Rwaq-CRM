import fs from "fs";
import path from "path";
import { ClientData } from "./types";

const STORAGE_PATH = path.join(process.cwd(), "data", "rwaq-clients.json");
const CUSTOMER_STATUS_PATH = path.join(process.cwd(), "data", "rwaq-custom-statuses.json");
const LOCATIONS_FILE = path.join(process.cwd(), "data", "rwaq-locations.json");

export function readClients(): ClientData[] {
  try {
    const raw = fs.readFileSync(STORAGE_PATH, "utf-8");
    return JSON.parse(raw) as ClientData[];
  } catch {
    return [];
  }
}

export function writeClients(clients: ClientData[]) {
  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
  fs.writeFileSync(STORAGE_PATH, JSON.stringify(clients, null, 2));
}

export function readCustomStatuses(): string[] {
  try {
    const raw = fs.readFileSync(CUSTOMER_STATUS_PATH, "utf-8");
    const data = JSON.parse(raw) as { statuses: string[] };
    return data.statuses ?? [];
  } catch {
    return [];
  }
}

export function writeCustomStatuses(statuses: string[]) {
  fs.mkdirSync(path.dirname(CUSTOMER_STATUS_PATH), { recursive: true });
  fs.writeFileSync(CUSTOMER_STATUS_PATH, JSON.stringify({ statuses }, null, 2));
}

/* ── Locations ─────────────────────────────────── */
export function readCustomLocations(): string[] {
  try {
    const raw = fs.readFileSync(LOCATIONS_FILE, "utf-8");
    const data = JSON.parse(raw) as { locations: string[] };
    return data.locations ?? [];
  } catch {
    return [];
  }
}

export function writeCustomLocations(locations: string[]) {
  fs.mkdirSync(path.dirname(LOCATIONS_FILE), { recursive: true });
  fs.writeFileSync(LOCATIONS_FILE, JSON.stringify({ locations }, null, 2));
}

/* ── Notifications ─────────────────────────────── */
export interface NotificationRecord {
  id: string;
  recipient: string;
  type: string;
  message: string;
  clientId?: string;
  clientName?: string;
  read: boolean;
  createdAt: string;
}

const NOTIFICATIONS_FILE = path.join(process.cwd(), "data", "rwaq-notifications.json");

export function readNotifications(): NotificationRecord[] {
  try {
    const raw = fs.readFileSync(NOTIFICATIONS_FILE, "utf-8");
    return JSON.parse(raw) as NotificationRecord[];
  } catch {
    return [];
  }
}

export function writeNotifications(items: NotificationRecord[]) {
  fs.mkdirSync(path.dirname(NOTIFICATIONS_FILE), { recursive: true });
  fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(items, null, 2));
}

export function createNotification(input: Omit<NotificationRecord, "id" | "read" | "createdAt">) {
  if (!input.recipient) return;
  const items = readNotifications();
  items.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    read: false,
    createdAt: new Date().toISOString(),
    ...input,
  });
  writeNotifications(items.slice(0, 300));
}
