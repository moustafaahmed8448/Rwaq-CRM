"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight, ChevronDown, Download, Grid2X2,
  LayoutDashboard, Pencil, Plus, Search, Trash2, UsersRound, X as XIcon,
  Check, AlertCircle, MessageSquare, Filter, Archive, Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/lib/i18n";
import { canWrite } from "@/lib/auth";
import { apiErrorMessage, readApiError } from "@/lib/api-errors";
import {
  PIPELINE_STAGES,
  PREDEFINED_STATUSES,
  channelLabel,
  isInProgress,
  isLost,
  isWon,
  BUILTIN_LOCATION_KEYS,
  locationLabel,
  statusColor,
  statusLabel,
  type PeriodKind,
} from "@/lib/reporting";
import { downloadFile, exportQuery, EXPORT_FAILED } from "@/lib/download";
import { num, sar, dateLocale } from "@/lib/format";
import { useLogo } from "@/lib/logo";
import StatusPill, { StatusDot } from "@/components/StatusPill";
import RefPicker from "@/components/RefPicker";
import ImportClientsModal from "@/components/ImportClientsModal";
import DashboardCharts, { type ChartView, type TrendPoint } from "@/components/DashboardCharts";
import ColumnPicker from "@/components/ColumnPicker";
import {
  CLIENT_COLUMNS, resolveColumns, gridTemplate,
  type ColumnKey, type ResolvedColumn,
} from "@/lib/client-columns";

type Client = {
  id: string; name: string; phoneNumber: string;
  status: "WAITING" | "WON" | "LOST" | string;
  project: string; location: string; acquisitionChannel: string;
  operationToTake: string; firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string;
};
type Metric = { channel: string; platform: string; spend: number; reach: number; totalClients: number; won: number; lost: number; waiting: number; cpa: number };
type User = { name: string; initials: string; role: string };
type Filters = { query: string; status: string[]; channel: string[]; location: string[]; firstContact: string[]; secondContact: string[]; startDate: string; endDate: string };
type EditDraft = Partial<Client> & { id: string };
type ConfirmDelete = { ids: string[]; names: string[] };
type Toast = { id: number; type: "success" | "error" | "info"; message: string };
type DatePreset = { label: string; startDate?: string; endDate?: string };
/** One salesperson's outcome breakdown for a single contact role. */
type SpRow = { name: string; won: number; lost: number; waiting: number; other: number; total: number; winRate: number | null };
/** Which client date the table is ordered by. */
type SortField = "recent" | "oldest" | "registered" | "registeredOldest";

const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CH_COLORS: Record<string, string> = { FACEBOOK: "#1877f2", INSTAGRAM: "#e11d48", X: "#111827", TIKTOK: "#7c3aed", GOOGLE_ADS: "#d97706", WHATSAPP: "#16a34a", CALLS: "#ea580c", SALES: "#0891b2" };
const CHANNEL_VALUES = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"] as const;


/**
 * YYYY-MM-DD in the LOCAL calendar.
 *
 * Deliberately not `toISOString()`, which converts to UTC and is a day off
 * east of Greenwich — the same trap documented on `dayKey` in reporting.ts.
 */
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
};

/**
 * Recent-date presets.
 *
 * A FACTORY, not a module constant: the old version computed these once at
 * import, so a tab left open overnight kept offering yesterday's dates.
 *
 * "This week" starts Monday, matching `startOfWeek` in reporting.ts. It used to
 * use `getDay()` (Sunday), so the same label produced a different range on the
 * clients page than on the dashboard.
 */
const buildDatePresets = (): DatePreset[] => {
  // Monday of the current week, matching startOfWeek() in reporting.ts. The old
  // preset used getDay() (Sunday), so "This week" covered a different range on
  // the clients page than on the dashboard.
  const monday = (() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  })();
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const firstOfYear = new Date();
  firstOfYear.setMonth(0, 1);

  return [
    { label: "date.today", startDate: localDay(new Date()) },
    { label: "date.thisWeek", startDate: localDay(monday) },
    { label: "date.last3", startDate: daysAgo(3) },
    { label: "date.last7", startDate: daysAgo(7) },
    { label: "date.last14", startDate: daysAgo(14) },
    { label: "date.last30", startDate: daysAgo(30) },
    { label: "date.last90", startDate: daysAgo(90) },
    { label: "date.thisMonth", startDate: localDay(firstOfMonth) },
    { label: "date.thisYear", startDate: localDay(firstOfYear) },
  ];
};

// Field key -> dictionary key, used by the "field updated" toast.
const FIELD_KEYS: Record<string, string> = {
  name: "form.name", phoneNumber: "form.phone", project: "form.project", location: "form.location",
  acquisitionChannel: "form.channel", status: "form.status", firstContactPerson: "form.firstContact",
  secondContactPerson: "form.secondContact", operationToTake: "form.operation", notes: "form.notes",
};

const initialFilters: Filters = { query: "", status: [], channel: [], location: [], firstContact: [], secondContact: [], startDate: "", endDate: "" };

function matchesFilters(client: Client, filters: Filters) {
  const date = (client.createdAt || "").slice(0, 10);
  // Ignore spaces/dashes/parentheses so phone numbers match with or without
  // formatting, e.g. "1018240912" finds "+20 101 824 0912".
  const norm = (s: string) => s.replace(/[\s\-().]/g, "").toLowerCase();
  const haystack = norm(`${client.name} ${client.phoneNumber} ${client.project} ${client.notes ?? ""}`);
  // Every selected group must match (AND): Status=X + Channel=Y only lists
  // clients that are both status X and channel Y.
  // Keep in sync with src/app/api/export/clients/route.ts.
  return (filters.status.length === 0 || filters.status.includes(String(client.status))) &&
    (filters.channel.length === 0 || filters.channel.includes(client.acquisitionChannel)) &&
    (filters.location.length === 0 || filters.location.includes(client.location)) &&
    // 1st and 2nd contact are SEPARATE filters that AND together: picking a 1st
    // and a 2nd contact narrows to clients held by that exact pairing, rather
    // than the union of "is either contact".
    (filters.firstContact.length === 0 || filters.firstContact.includes(client.firstContactPerson)) &&
    (filters.secondContact.length === 0 || filters.secondContact.includes(client.secondContactPerson)) &&
    (!filters.startDate || date >= filters.startDate) && (!filters.endDate || date <= filters.endDate) &&
    haystack.includes(norm(filters.query));
}

let toastId = 0;

/**
 * Orders the client table.
 *
 * Two different dates are in play and they are not interchangeable: `createdAt`
 * is the sheet's تاريخ التسجيل (when the lead arrived), while `lastUpdateDate`
 * is touched by every edit. "Recent" is ambiguous between them, so both are
 * offered. The default matches the order the API already returns, leaving the
 * initial view unchanged.
 *
 * Numeric ids are compared as numbers so id 9 sorts before id 10.
 */
function sortClients(clients: Client[], sort: SortField): Client[] {
  const byDate = (key: "createdAt" | "lastUpdateDate") => (a: Client, b: Client) =>
    String(b[key] ?? "").localeCompare(String(a[key] ?? ""));
  const byId = (a: Client, b: Client) => Number(b.id) - Number(a.id);

  switch (sort) {
    case "oldest": return [...clients].sort((a, b) => -byDate("lastUpdateDate")(a, b));
    case "registered": return [...clients].sort(byDate("createdAt"));
    case "registeredOldest": return [...clients].sort((a, b) => -byDate("createdAt")(a, b));
    // "recent": last update, newest first, with the id as a tie-breaker so rows
    // saved in the same batch keep a stable, predictable order.
    case "recent":
    default: return [...clients].sort((a, b) => byDate("lastUpdateDate")(a, b) || byId(a, b));
  }
}

export default function Home() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [view, setView] = useState<"dashboard" | "clients">("dashboard");
  const [mode, setMode] = useState<"table" | "kanban">("table");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [exporting, setExporting] = useState(false);
  const [customStatuses, setCustomStatuses] = useState<string[]>([]);
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  const [customLocations, setCustomLocations] = useState<string[]>([]);
  // Only saved (custom) values can be deleted; built-ins are code constants.
  // The usage maps let the UI warn before removing a value still in use.
  const [removableStatuses, setRemovableStatuses] = useState<string[]>([]);
  const [removableChannels, setRemovableChannels] = useState<string[]>([]);
  const [removableLocations, setRemovableLocations] = useState<string[]>([]);
  const [statusUsage, setStatusUsage] = useState<Record<string, number>>({});
  const [channelUsage, setChannelUsage] = useState<Record<string, number>>({});
  const [locationUsage, setLocationUsage] = useState<Record<string, number>>({});
  // Reporting window for the KPI figures. Defaults to the current week, as
  // requested; month, all-time and a custom range are also supported.
  const [periodKind, setPeriodKind] = useState<PeriodKind>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [periodLoading, setPeriodLoading] = useState(false);
  // `other` counts clients whose status sits outside the built-in pipeline
  // (a user-defined status). Without it the three outcome cards silently
  // summed to less than the client count.
  const [periodInfo, setPeriodInfo] = useState({ from: "", to: "", campaignCount: 0, campaignNames: [] as string[], totals: { total: 0, won: 0, lost: 0, waiting: 0, other: 0 } });
  // Per-salesperson outcome report, split by contact role. Server-computed and
  // period-scoped, so it agrees with the KPI cards above it.
  const [spReports, setSpReports] = useState<{ first: SpRow[]; second: SpRow[] }>({ first: [], second: [] });
  // Outcome-split time series for the dashboard chart, from the same response.
  const [timeline, setTimeline] = useState<TrendPoint[]>([]);
  // Which chart the dashboard shows. Lifted here so the choice survives the
  // dashboard remounting when the period changes.
  const [chartView, setChartView] = useState<ChartView>("trend");
  const [users, setUsers] = useState<{ username: string; name: string; role: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [customLocationInput, setCustomLocationInput] = useState("");
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDatePreset, setActiveDatePreset] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Table order. Defaults to most-recently-updated, which is the order the API
  // already returns, so the initial view is unchanged.
  const [sortBy, setSortBy] = useState<SortField>("recent");
  // Clients-table layout: column widths + visibility, saved to the user's own
  // row (see PATCH /api/auth/me). Defaults come from the registry until the
  // signed-in user's layout arrives.
  const [columns, setColumns] = useState<ResolvedColumn[]>(() => resolveColumns(null));
  const [savingLayout, setSavingLayout] = useState(false);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  /**
   * Persists the layout. Debounced through the caller's `savingLayout` flag so a
   * drag (which fires on every pointer move) results in one request at the end,
   * not one per pixel.
   */
  const commitColumns = useCallback((next: ResolvedColumn[]) => {
    setColumns(next);
    setSavingLayout(true);
  }, []);

  useEffect(() => {
    if (!savingLayout) return;
    const id = setTimeout(async () => {
      try {
        await fetch("/api/auth/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Sparse: only the columns that differ from the defaults, so a column
            // added later still picks up its own default.
            clientColumns: Object.fromEntries(
              columns
                .filter((c) => {
                  const def = CLIENT_COLUMNS.find((d) => d.key === c.key)!;
                  return c.w !== def.w || c.hidden;
                })
                .map((c) => [c.key, { w: c.w, hidden: c.hidden }]),
            ),
          }),
        });
      } catch {
        // A failed save is not worth interrupting the user over; the layout still
        // applies for this session.
      } finally {
        setSavingLayout(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [columns, savingLayout]);

  /**
   * Re-reads the client list and the reference data after an import.
   *
   * The import creates clients AND appends to the shared status/channel/location
   * lists, so all four endpoints are refreshed; leaving the pickers stale would
   * hide values that are now in use.
   */
  const refreshAfterImport = (imported: number) => {
    addToast(imported > 0 ? "success" : "info", t(imported > 0 ? "importer.done" : "importer.doneNone", { n: imported }));
    fetch("/api/crm/clients").then(r => r.json()).then(d => {
      setClients(d.clients ?? []);
      setCustomStatuses(d.statuses ?? []);
      setRemovableStatuses(d.removable ?? []);
      setStatusUsage(d.usage ?? {});
    }).catch(() => undefined);
    fetch("/api/channels").then(r => r.json()).then(d => { setCustomChannels(d.channels ?? []); setRemovableChannels(d.removable ?? []); setChannelUsage(d.usage ?? {}); }).catch(() => undefined);
    fetch("/api/locations").then(r => r.json()).then(d => { setCustomLocations(d.locations ?? []); setRemovableLocations(d.removable ?? []); setLocationUsage(d.usage ?? {}); }).catch(() => undefined);
    refreshNotifications();
  };
  const [notifications, setNotifications] = useState<{ id: string; message: string; read: boolean; clientName?: string; createdAt: string; type: string }[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [newClient] = useState<Partial<Client>>({
    name: "", phoneNumber: "", project: "", location: "",
    acquisitionChannel: "FACEBOOK", operationToTake: "",
    firstContactPerson: "", secondContactPerson: "", status: "WAITING", notes: "",
  });
  const tableRef = useRef<HTMLDivElement>(null);

  const addToast = (type: Toast["type"], message: string) => {
    const id = ++toastId;
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };

  useEffect(() => {
    fetch("/api/auth/me").then(async r => { if (!r.ok) { router.replace("/login"); return null; } return r.json(); }).then(d => {
      if (!d?.user) return;
      setUser(d.user);
      // Adopt the signed-in user's saved column layout. The demo session has no
      // row, so it keeps the registry defaults.
      if (d.user.clientColumns) setColumns(resolveColumns(d.user.clientColumns));
    });
  }, [router]);

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v === "clients") setView("clients");
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("rwaq-dark");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "1") setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  useEffect(() => {
    if (!user) return;
    Promise.all([fetch("/api/crm/clients"), fetch("/api/users")])
      .then(async ([c, u]) => {
        if (!c.ok) throw new Error("Unable to load workspace");
        return Promise.all([c.json(), u.json()]);
      })
      .then(([crm, usersData]) => {
        setClients(crm.clients || []);
        setUsers(usersData.users ?? []);
      })
      .catch(() => undefined);
    fetch("/api/crm/clients").then(r => r.json()).then(d => { setCustomStatuses(d.statuses ?? []); setRemovableStatuses(d.removable ?? []); setStatusUsage(d.usage ?? {}); }).catch(() => {});
    fetch("/api/channels").then(r => r.json()).then(d => { setCustomChannels(d.channels ?? CHANNEL_VALUES); setRemovableChannels(d.removable ?? []); setChannelUsage(d.usage ?? {}); }).catch(() => {});
    fetch("/api/locations").then(r => r.json()).then(d => { setCustomLocations(d.locations ?? []); setRemovableLocations(d.removable ?? []); setLocationUsage(d.usage ?? {}); }).catch(() => {});
    fetch("/api/notifications").then(r => r.json()).then(d => setNotifications(d.notifications ?? [])).catch(() => {});
  }, [user]);

  // Reporting figures are period-scoped, so they refetch whenever the window
  // changes. Separate from the client list above, which is not period-scoped.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams({ period: periodKind });
    if (periodKind === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    // Flagging the pending fetch so the period summary can show a loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriodLoading(true);
    fetch(`/api/analytics/weekly?${params.toString()}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setMetrics(d.rows || []);
        setPeriodInfo({
          from: d.period?.from ?? "",
          to: d.period?.to ?? "",
          campaignCount: d.campaignCount ?? 0,
          campaignNames: d.campaignNames ?? [],
          totals: d.totals ?? { total: 0, won: 0, lost: 0, waiting: 0, other: 0 },
        });
        // Same response carries the per-salesperson breakdown, so the sales
        // performance panel is always the selected period rather than all time.
        setSpReports({
          first: d.firstSalespersonReport ?? [],
          second: d.secondSalespersonReport ?? [],
        });
        setTimeline(d.timeline ?? []);
      })
      .catch(() => undefined)
      .finally(() => setPeriodLoading(false));
  }, [user, periodKind, customFrom, customTo]);

  // Table scroll detection
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const check = () => {
      const left = el.scrollLeft > 0;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      // just update DOM refs directly for perf
    };
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, []);

  const filteredClients = useMemo(() => sortClients(clients.filter(c => matchesFilters(c, filters)), sortBy), [clients, filters, sortBy]);
  // The two contact roles are listed separately, because they are separate
  // filters: a merged list could not tell you who is the 1st and who the 2nd.
  const firstContacts = useMemo(
    () => [...new Set(clients.map(c => c.firstContactPerson).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")),
    [clients],
  );
  const secondContacts = useMemo(
    () => [...new Set(clients.map(c => c.secondContactPerson).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")),
    [clients],
  );
  /** Everyone in either role — used by the dashboard's salesperson panels. */
  const salespeople = useMemo(
    () => [...new Set(clients.flatMap(c => [c.firstContactPerson, c.secondContactPerson].filter(Boolean)))],
    [clients],
  );
  const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
  const totalReach = metrics.reduce((s, m) => s + m.reach, 0);
  // Registry-driven so a new pipeline stage is counted correctly without
  // editing this file (the old version hardcoded "WON"/"LOST"/"WAITING").
  // Period totals, straight from the API. These used to be counted from the
  // full client list, which silently reverted them to all-time numbers while the
  // spend beside them stayed week-scoped — so Avg CPA divided one period's spend
  // by another period's wins.
  const won = periodInfo.totals.won;
  const lost = periodInfo.totals.lost;
  const waiting = periodInfo.totals.waiting;
  const unclassified = periodInfo.totals.other;

  // Non-admins see only their own book; the server already scopes the query, so
  // this just tells the UI which message to show.
  const isScoped = user?.role !== "Admin";

  // Visitor is read-only. The API rejects writes for this role (see
  // canWrite in src/lib/auth.ts); these flags only hide the controls so the UI
  // matches what the server will actually allow.
  const canEdit = canWrite(user?.role);

  // Clicking a stage row in the status panel filters the clients view to it.
  const toggleStageFilter = (status: string) => {
    setView("clients");
    setMultiFilter("status", [status]);
  };

  const updateFilter = (key: "query" | "startDate" | "endDate", value: string) => {
    setFilters(cur => ({ ...cur, [key]: value }));
    if (key !== "query") setActiveDatePreset(null);
  };

  const setMultiFilter = (key: "status" | "channel" | "location" | "firstContact" | "secondContact", values: string[]) => {
    setFilters(cur => ({ ...cur, [key]: values }));
  };

  const clearAllFilters = () => {
    setFilters(initialFilters);
    setActiveDatePreset(null);
  };

  const applyDatePreset = (preset: DatePreset) => {
    updateFilter("startDate", preset.startDate ?? "");
    updateFilter("endDate", preset.endDate ?? "");
    setActiveDatePreset(preset.label);
  };

  const clearDatePreset = () => {
    updateFilter("startDate", "");
    updateFilter("endDate", "");
    setActiveDatePreset(null);
  };

  const activeFilterCount =
    filters.status.length + filters.channel.length + filters.location.length +
    filters.firstContact.length + filters.secondContact.length +
    (filters.startDate ? 1 : 0) + (filters.endDate ? 1 : 0) + (filters.query ? 1 : 0);

  const allStatuses = [...PREDEFINED_STATUSES, ...customStatuses.filter(s => !PREDEFINED_STATUSES.includes(s))];
  const allChannels = [...CHANNEL_VALUES, ...customChannels.filter(ch => !CHANNEL_VALUES.includes(ch as typeof CHANNEL_VALUES[number]))];
  const allLocations = [...BUILTIN_LOCATION_KEYS, ...customLocations.filter(l => !BUILTIN_LOCATION_KEYS.includes(l))];

  const addChannel = async (label: string): Promise<string> => {
    const key = label.trim().toUpperCase().replace(/\s+/g, "_");
    if (!key) return label;
    await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: key }) }).catch(() => {});
    const r = await fetch("/api/channels").then(x => x.json()).catch(() => ({}));
    setCustomChannels(r.channels ?? []);
    return key;
  };

  const addLocation = async (label: string): Promise<string> => {
    const clean = label.trim();
    if (!clean) return label;
    await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: clean }) }).catch(() => {});
    const r = await fetch("/api/locations").then(x => x.json()).catch(() => ({}));
    setCustomLocations(r.locations ?? []);
    setRemovableLocations(r.removable ?? []);
    setLocationUsage(r.usage ?? {});
    return clean;
  };

  /**
   * Deletes a saved location/channel from the reference list.
   *
   * Only removes the value from the saved list — clients already set to it keep
   * it, which is why the caller confirms with the usage count first. The server
   * rejects this for non-admins regardless of what the UI shows.
   */
  const removeLocation = async (label: string) => {
    const res = await fetch("/api/locations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }).catch(() => null);
    if (!res || !res.ok) {
      const err = res ? await res.json().catch(() => ({})) : null;
      addToast("error", apiErrorMessage(t, err?.error));
      return;
    }
    const r = await res.json().catch(() => ({}));
    setCustomLocations(r.locations ?? []);
    setRemovableLocations([]);
    setLocationUsage({});
    addToast("success", t("refData.removedLocation", { value: label }));
  };

  const removeChannel = async (label: string) => {
    const res = await fetch("/api/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }).catch(() => null);
    if (!res || !res.ok) {
      const err = res ? await res.json().catch(() => ({})) : null;
      addToast("error", apiErrorMessage(t, err?.error));
      return;
    }
    const r = await res.json().catch(() => ({}));
    setCustomChannels(r.channels ?? []);
    setRemovableChannels([]);
    setChannelUsage({});
    addToast("success", t("refData.removedChannel", { value: label }));
  };

  /**
   * Deletes a saved status from the reference list, mirroring removeChannel.
   * Admin-only, custom-only, and rejected while any client still uses it — the
   * server answers 403/400/409 for those, so this only surfaces the message.
   */
  const removeStatus = async (label: string) => {
    const res = await fetch("/api/crm/clients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", label }) }).catch(() => null);
    if (!res || !res.ok) {
      const err = res ? await res.json().catch(() => ({})) : null;
      addToast("error", apiErrorMessage(t, err?.error));
      return;
    }
    // Re-read the reference data instead of clearing it, so the usage counts
    // shown beside the remaining statuses stay accurate.
    const r = await fetch("/api/crm/clients").then(x => x.json()).catch(() => ({}));
    setCustomStatuses(r.statuses ?? []);
    setRemovableStatuses(r.removable ?? []);
    setStatusUsage(r.usage ?? {});
    addToast("success", t("refData.removedStatus", { value: label }));
  };

  const addStatus = async (label: string): Promise<string> => {
    const key = label.trim().toUpperCase();
    if (!key) return label;
    await fetch("/api/crm/clients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", label: key }) }).catch(() => {});
    const r = await fetch("/api/crm/clients").then(x => x.json()).catch(() => ({}));
    setCustomStatuses(r.statuses ?? []);
    setRemovableStatuses(r.removable ?? []);
    setStatusUsage(r.usage ?? {});
    return key;
  };

  // Sales performance rows come from the API, not from the client list.
  //
  // It used to be computed here from `clients`, which (a) merged the 1st and 2nd
  // contact into one list, so a rep's own book could not be separated from
  // clients they were 2nd contact on, and (b) ignored the reporting period, so
  // the panel showed every client while the KPI cards above it showed one week.
  // It was also capped at 8 rows, hiding 5 of the 13 users.

    const visibleMetrics = useMemo(() => metrics.map(metric => ({
    // Keep the API's period-scoped won/lost/waiting/cpa. This used to recompute
    // them from `filteredClients` (the unfiltered, all-time client list), which
    // threw away the period and made the ROI table disagree with the KPI cards.
    ...metric,
    // The local client list is still used to decide which channels to show.
    inUse: filteredClients.some(c => c.acquisitionChannel === metric.channel),
  })), [metrics, filteredClients]);

  const openEdit = (client: Client) => setEditDraft({ ...client });
  const openCreate = () => setEditDraft({
    id: "", createdAt: "", lastUpdateDate: "", name: "", phoneNumber: "",
    status: allStatuses[0] ?? "WAITING", project: "", location: "",
    acquisitionChannel: allChannels[0] ?? "FACEBOOK", operationToTake: "",
    firstContactPerson: users[0]?.name ?? "", secondContactPerson: "",
    notes: "",
  });
  const closeEdit = () => setEditDraft(null);
  const openDetail = (client: Client) => setDetailClient(client);
  const closeDetail = () => setDetailClient(null);

  const saveEdit = async () => {
    if (!editDraft) return;
    if (!editDraft.name || editDraft.name.trim().length < 2) { addToast("error", t("form.errNameMin")); return; }
    if (!editDraft.phoneNumber || editDraft.phoneNumber.trim().length < 5) { addToast("error", t("form.errPhoneMin")); return; }

    if (editDraft.id) {
      await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editDraft) });
      setClients(prev => prev.map(c => c.id === editDraft.id ? { ...c, ...editDraft, lastUpdateDate: new Date().toISOString() } : c));
      if (detailClient?.id === editDraft.id) setDetailClient(prev => prev ? { ...prev, ...editDraft } : null);
      closeEdit();
      addToast("success", t("clients.savedToast", { name: editDraft.name ?? "" }));
      return;
    }

    const res = await fetch("/api/crm/clients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editDraft.name, phoneNumber: editDraft.phoneNumber, status: editDraft.status,
        project: editDraft.project, location: editDraft.location, acquisitionChannel: editDraft.acquisitionChannel,
        operationToTake: editDraft.operationToTake, firstContactPerson: editDraft.firstContactPerson,
        secondContactPerson: editDraft.secondContactPerson, notes: editDraft.notes,
      }),
    });
    if (!res.ok) {
      addToast("error", apiErrorMessage(t, await readApiError(res)));
      return;
    }
    const d = await res.json() as { client?: Client };
    if (d.client) setClients(prev => [d.client as Client, ...prev]);
    closeEdit();
    addToast("success", t("clients.createdToast", { name: editDraft.name ?? "" }));
  };

  const deleteSelected = async () => {
    if (!confirmDelete || confirmDelete.ids.length === 0) return;
    if (user?.role !== "Admin") { addToast("error", t("archive.adminNote")); return; }
    for (const id of confirmDelete.ids) await fetch("/api/crm/clients", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setClients(prev => prev.filter(c => !confirmDelete.ids.includes(c.id)));
    setSelectedIds(new Set());
    closeDelete();
    addToast("success", t("clients.bulkDeleted", { n: confirmDelete.ids.length }));
  };
  const closeDelete = () => setConfirmDelete(null);

  const archiveClient = async (id: string) => {
    const r = await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, archived: true }) });
    if (!r.ok) { addToast("error", apiErrorMessage(t, await readApiError(r))); return; }
    setClients(prev => prev.filter(c => c.id !== id));
    addToast("info", t("clients.archivedToast"));
  };

  const archiveSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    for (const id of ids) await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, archived: true }) });
    setClients(prev => prev.filter(c => !selectedIds.has(c.id)));
    setSelectedIds(new Set());
    addToast("info", t("clients.bulkArchived", { n: ids.length }));
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(prev => prev.size === filteredClients.length ? new Set() : new Set(filteredClients.map(c => c.id)));

  const updateStatus = async (id: string, status: string) => {
    await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    setClients(prev => prev.map(c => c.id === id ? { ...c, status, lastUpdateDate: new Date().toISOString() } : c));
    if (detailClient?.id === id) setDetailClient(prev => prev ? { ...prev, status } : null);
    addToast("info", t("clients.statusToast", { status: statusLabel(t, status) }));
  };

  const updateClientField = async (id: string, patch: Partial<Client>) => {
    await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) }).catch(() => {});
    setClients(prev => prev.map(c => c.id === id ? { ...c, ...patch, lastUpdateDate: new Date().toISOString() } : c));
    if (detailClient?.id === id) setDetailClient(prev => prev ? { ...prev, ...patch } : null);
    const [k, v] = Object.entries(patch)[0] ?? [];
    if (k) {
      const field = FIELD_KEYS[k];
      const value = k === "status" ? statusLabel(t, String(v))
        : k === "acquisitionChannel" ? channelLabel(t, String(v))
        : String(v ?? "");
      addToast("info", t("clients.fieldToast", { field: field ? t(field) : k, value }));
    }
  };

  const refreshNotifications = () => {
    fetch("/api/notifications").then(r => r.json()).then(d => setNotifications(d.notifications ?? [])).catch(() => {});
  };

  const markNotificationsRead = async () => {
    if (notifications.every(n => n.read)) return;
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const exportClientsFile = async (
    params: Record<string, string | number | undefined | null>,
    fallbackName: string,
    successMessage: string,
  ) => {
    setExporting(true);
    try {
      await downloadFile(`/api/export/clients${exportQuery(params)}`, fallbackName);
      addToast("success", successMessage);
    } catch (e) {
      addToast("error", e instanceof Error && e.message !== EXPORT_FAILED
        ? apiErrorMessage(t, e.message)
        : t("clients.exportFail"));
    } finally {
      setExporting(false);
    }
  };

  // "Export all" downloads the currently filtered view as a real .xlsx file,
  // filtered server-side with the exact same semantics as matchesFilters().
  const exportExcel = () => {
    void exportClientsFile(
      {
        statuses: filters.status.join(","),
        channels: filters.channel.join(","),
        locations: filters.location.join(","),
        firstContacts: filters.firstContact.join(","),
        secondContacts: filters.secondContact.join(","),
        q: filters.query,
        from: filters.startDate,
        to: filters.endDate,
      },
      `rwaq-clients-${new Date().toISOString().slice(0, 10)}.xlsx`,
      t("clients.exportedToast", { n: filteredClients.length }),
    );
  };

  const exportSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) { addToast("info", t("clients.noSelection")); return; }
    void exportClientsFile(
      { ids: ids.join(",") },
      `rwaq-clients-selected-${new Date().toISOString().slice(0, 10)}.xlsx`,
      t("clients.exportedToast", { n: ids.length }),
    );
  };

  const exportReport = () => exportExcel();

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); };

  if (!user) return <main className="shell-loading"><div className="spinner" /><p>{t("common.loadingWorkspace")}</p></main>;

  return (
    <main className="shell">
      <AppHeader
        user={user}
        active={view}
        badge={filteredClients.length !== clients.length
          ? <span className="badge-count">{filteredClients.length}/{clients.length}</span>
          : (waiting > 0 ? <span className="badge">{t("dash.clientsInView", { n: waiting })}</span> : null)}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        onNavigate={(tab) => {
          if (tab === "dashboard") setView("dashboard");
          else if (tab === "clients") setView("clients");
          else if (tab === "archived") router.push("/archived");
          else if (tab === "marketing") router.push("/marketing");
          else router.push("/settings");
        }}
      />

      <div className="content">
        {view === "dashboard" ? (
          <Dashboard
            metrics={visibleMetrics} totalSpend={totalSpend} totalReach={totalReach}
            won={won} lost={lost} waiting={waiting} unclassified={unclassified}
            clients={filteredClients}
            salespeople={salespeople}
            spReports={spReports}
            timeline={timeline}
            chartView={chartView}
            onChartViewChange={setChartView}
            updateStatus={updateStatus} updateClientField={updateClientField}
            allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations}
            onAddStatus={addStatus} onAddChannel={addChannel} onAddLocation={addLocation}
            onExport={exportReport} exporting={exporting}
            scoped={isScoped}
            onToggleStageFilter={toggleStageFilter}
            periodKind={periodKind}
            periodInfo={periodInfo}
            onPeriodChange={setPeriodKind}
            onCustomRange={(f, to) => { setCustomFrom(f); setCustomTo(to); }}
            customFrom={customFrom}
            customTo={customTo}
            periodLoading={periodLoading}
            t={t}
          />
        ) : (
          <ClientsView
            clients={filteredClients} allClients={clients} mode={mode} setMode={setMode}
            filters={filters} updateFilter={updateFilter}
            setMultiFilter={setMultiFilter} clearAllFilters={clearAllFilters}
            updateStatus={updateStatus} updateClientField={updateClientField}
            firstContacts={firstContacts} secondContacts={secondContacts}
            sortBy={sortBy} setSortBy={setSortBy}
            columns={columns} onColumnsChange={commitColumns} rtl={rtl}
            onAssigned={refreshNotifications}
            selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
            onOpenEdit={openEdit} onOpenCreate={openCreate} onOpenImport={() => setImporting(true)} onOpenDelete={(ids: string[], names: string[]) => setConfirmDelete({ ids, names })}
            onOpenDetail={openDetail}
            exportExcel={exportExcel} exportSelected={exportSelected}
            bulkCount={selectedIds.size}
            isAdmin={user.role === "Admin"}
            canEdit={canEdit}
            onArchive={archiveClient}
            onArchiveSelected={archiveSelected}
            onBulkDelete={() => { if (selectedIds.size === 0) return; setConfirmDelete({ ids: [...selectedIds], names: filteredClients.filter(c => selectedIds.has(c.id)).map(c => c.name) }); }}
            allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations}
            refData={{
              onRemoveStatus: user.role === "Admin" ? removeStatus : undefined,
              onRemoveChannel: user.role === "Admin" ? removeChannel : undefined,
              onRemoveLocation: user.role === "Admin" ? removeLocation : undefined,
              removableStatuses, removableChannels, removableLocations,
              statusUsage, channelUsage, locationUsage,
            }}
            customLocationInput={customLocationInput} setCustomLocationInput={setCustomLocationInput}
            customChannels={customChannels}
            users={users}
            onAddStatus={addStatus} onAddChannel={addChannel} onAddLocation={addLocation}
            activeDatePreset={activeDatePreset}
            applyDatePreset={applyDatePreset} clearDatePreset={clearDatePreset}
            datePresets={buildDatePresets()}
            filterCount={activeFilterCount}
            t={t}
          />
        )}
      </div>

      {/* Edit Modal */}
      {editDraft && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>{editDraft.id ? t("clients.editTitle") : t("clients.addTitle")}</h2><button className="modal-close" onClick={closeEdit}><XIcon size={18} /></button></div>
            <div className="modal-body">
              <div className="form-grid">
                <Field label={t("form.name")}><input value={editDraft.name ?? ""} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} /></Field>
                <Field label={t("form.phone")}><input dir="ltr" className="ltr-num" value={editDraft.phoneNumber ?? ""} onChange={e => setEditDraft({ ...editDraft, phoneNumber: e.target.value })} /></Field>
                <Field label={t("form.project")} wide><textarea rows={3} value={editDraft.project ?? ""} onChange={e => setEditDraft({ ...editDraft, project: e.target.value })} placeholder={t("form.projectDetailsPh")} /></Field>
                <Field label={t("form.location")}>
                  <RefPicker value={editDraft.location ?? ""} options={allLocations} onAdd={addLocation} onChange={v => setEditDraft({ ...editDraft, location: v })} render={v => locationLabel(t, v)} onRemove={user.role === "Admin" ? removeLocation : undefined} removable={removableLocations} removeUsage={locationUsage} placeholder={t("form.locationPh")} t={t} />
                </Field>
                <Field label={t("form.channel")}>
                  <RefPicker value={editDraft.acquisitionChannel ?? ""} options={allChannels} onAdd={addChannel} onChange={v => setEditDraft({ ...editDraft, acquisitionChannel: v })} render={v => channelLabel(t, v)} onRemove={user.role === "Admin" ? removeChannel : undefined} removable={removableChannels} removeUsage={channelUsage} placeholder={t("form.channelPh")} t={t} />
                </Field>
                <Field label={t("form.status")}>
                  <RefPicker value={editDraft.status ?? ""} options={allStatuses} onAdd={addStatus} onChange={v => setEditDraft({ ...editDraft, status: v })} render={v => statusLabel(t, v)} placeholder={t("form.statusPh")} t={t} />
                </Field>
                <Field label={t("form.firstContact")}>
                  <select value={editDraft.firstContactPerson ?? ""} onChange={e => setEditDraft({ ...editDraft, firstContactPerson: e.target.value })}>
                    <option value="">{t("form.unassigned")}</option>
                    {users.map(u => <option key={u.username} value={u.name}>{u.name}</option>)}
                  </select>
                </Field>
                <Field label={t("form.secondContact")}>
                  <select value={editDraft.secondContactPerson ?? ""} onChange={e => setEditDraft({ ...editDraft, secondContactPerson: e.target.value })}>
                    <option value="">{t("form.noneOption")}</option>
                    {users.map(u => <option key={u.username} value={u.name}>{u.name}</option>)}
                  </select>
                </Field>
                <Field label={t("form.operation")} wide><input value={editDraft.operationToTake ?? ""} onChange={e => setEditDraft({ ...editDraft, operationToTake: e.target.value })} placeholder={t("form.operationPh")} /></Field>
                <Field label={t("form.notes")} wide><textarea value={editDraft.notes ?? ""} onChange={e => setEditDraft({ ...editDraft, notes: e.target.value })} rows={3} placeholder={t("form.notesPh")} /></Field>
              </div>
            </div>
            <div className="modal-footer"><button className="btn-ghost" onClick={closeEdit}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveEdit}><Check size={15} />{editDraft.id ? t("clients.saveBtn") : t("clients.createBtn")}</button></div>
          </div>
        </div>
      )}

      {/* Google Sheet import — admin only, preview gated inside the modal. */}
      {importing && (
        <ImportClientsModal
          onClose={() => setImporting(false)}
          onImported={refreshAfterImport}
          t={t}
        />
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={closeDelete}>
          <div className="modal delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>{t("clients.deleteTitle", { n: confirmDelete.ids.length })}</h2><button className="modal-close" onClick={closeDelete}><XIcon size={18} /></button></div>
            <div className="modal-body">
              <div className="delete-warning"><AlertCircle size={28} /><div><strong>{t("common.confirm")}</strong><p>{t("clients.deleteBody")}</p>{confirmDelete.names.length > 0 && <p className="delete-names">{confirmDelete.names.join(", ")}</p>}</div></div>
            </div>
            <div className="modal-footer"><button className="btn-ghost" onClick={closeDelete}>{t("common.cancel")}</button><button className="btn-danger" onClick={deleteSelected}><Trash2 size={15} />{t("common.delete")}</button></div>
          </div>
        </div>
      )}

      {/* Client Detail Side Panel */}
      {detailClient && (
        <div className="detail-overlay" onClick={closeDetail}>
          <div className="detail-panel" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <div><div className="breadcrumb"><UsersRound size={14} />{t("detail.info")}</div><h2>{detailClient.name}</h2></div>
              <button className="modal-close" onClick={closeDetail}><XIcon size={18} /></button>
            </div>
            <div className="detail-body">
              <div className="detail-meta">
                <div className="meta-item"><span className="meta-label">{t("form.phone")}</span><span className="meta-value"><span className="ltr-num">{detailClient.phoneNumber}</span></span></div>
                <div className="meta-item"><span className="meta-label">{t("form.status")}</span>
                  {canEdit ? (
                    // Coloured from the registry, not a per-status CSS class:
                    // .status-select.waiting never matched `status-no_response`,
                    // so every new stage rendered as a bare unstyled select.
                    <select
                      className="status-select"
                      value={detailClient.status}
                      onChange={e => updateStatus(detailClient.id, e.target.value)}
                      style={{ background: statusColor(detailClient.status) + "1f", color: statusColor(detailClient.status) }}
                    >
                      {allStatuses.map(s => <option key={s} value={s}>{statusLabel(t, s)}</option>)}
                    </select>
                  ) : (
                    <StatusPill status={detailClient.status} t={t} />
                  )}
                </div>
                <div className="meta-item"><span className="meta-label">{t("form.channel")}</span><span className="chan-tag-inline"><i className="dot" style={{ background: CH_COLORS[detailClient.acquisitionChannel] }} />{channelLabel(t, detailClient.acquisitionChannel)}</span></div>
                <div className="meta-item"><span className="meta-label">{t("form.project")}</span><span className="meta-value">{detailClient.project}</span></div>
                <div className="meta-item"><span className="meta-label">{t("form.location")}</span><span className="meta-value">{detailClient.location}</span></div>
                <div className="meta-item"><span className="meta-label">{t("form.firstContact")}</span><span className="meta-value">{detailClient.firstContactPerson}</span></div>
                <div className="meta-item"><span className="meta-label">{t("form.secondContact")}</span><span className="meta-value">{detailClient.secondContactPerson || "—"}</span></div>
                <div className="meta-item full"><span className="meta-label">{t("form.operation")}</span><span className="meta-value op-value">{detailClient.operationToTake}</span></div>
                {detailClient.notes && <div className="meta-item full"><span className="meta-label">{t("form.notes")}</span><p className="notes-text">{detailClient.notes}</p></div>}
                <div className="meta-item full"><span className="meta-label">{t("client.field.created")}</span><span className="meta-value muted">{detailClient.createdAt ? new Date(detailClient.createdAt).toLocaleDateString(dateLocale(lang)) : "—"}</span></div>
                <div className="meta-item full"><span className="meta-label">{t("detail.lastUpdate")}</span><span className="meta-value muted">{detailClient.lastUpdateDate ? new Date(detailClient.lastUpdateDate).toLocaleString(dateLocale(lang)) : "—"}</span></div>
              </div>
              <div className="detail-actions">
                <button className="btn-outline" onClick={() => { openEdit(detailClient); closeDetail(); }}><Pencil size={14} />{t("detail.edit")}</button>
                <button className="btn-outline" onClick={() => { closeDetail(); setTimeout(() => router.push(`/clients/${detailClient.id}`), 200); }}><ArrowUpRight size={14} />{t("detail.timeline")}</button>
                {user.role === "Admin" && (<>
                  <button className="btn-danger-outline" onClick={() => { closeDetail(); setTimeout(() => setConfirmDelete({ ids: [detailClient.id], names: [detailClient.name] }), 200); }}><Trash2 size={14} />{t("detail.delete")}</button>
                  <button className="btn-outline" onClick={() => { closeDetail(); archiveClient(detailClient.id); }}><Archive size={14} />{t("nav.archived")}</button>
                </>)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}><span>{t.message}</span></div>)}
      </div>
    </main>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

type TFn = (key: string, vars?: Record<string, string | number>) => string;

function FilterBar({ filters, updateFilter, setMultiFilter, clearAllFilters, firstContacts, secondContacts, datePresets, activeDatePreset, applyDatePreset, clearDatePreset, sortBy, setSortBy, filterCount, allStatuses, allChannels, allLocations, onRemoveStatus, onRemoveChannel, onRemoveLocation, removableStatuses, removableChannels, removableLocations, statusUsage, channelUsage, locationUsage, t }: {
  filters: Filters;
  updateFilter: (k: "query" | "startDate" | "endDate", v: string) => void;
  setMultiFilter: (k: "status" | "channel" | "location" | "firstContact" | "secondContact", values: string[]) => void;
  clearAllFilters: () => void;
  /** Distinct names per contact role, filtered independently. */
  firstContacts: string[];
  secondContacts: string[];
  datePresets?: DatePreset[];
  activeDatePreset?: string | null;
  applyDatePreset?: (p: DatePreset) => void;
  clearDatePreset?: () => void;
  sortBy?: SortField;
  setSortBy?: (s: SortField) => void;
  filterCount?: number;
  allStatuses?: string[];
  allChannels?: string[];
  allLocations?: string[];
  onRemoveStatus?: (value: string) => void;
  onRemoveChannel?: (value: string) => void;
  onRemoveLocation?: (value: string) => void;
  removableStatuses?: string[];
  removableChannels?: string[];
  removableLocations?: string[];
  statusUsage?: Record<string, number>;
  channelUsage?: Record<string, number>;
  locationUsage?: Record<string, number>;
  t: TFn;
}) {
  const hasPreset = activeDatePreset || filters.startDate || filters.endDate;
  return (
    <>
      {datePresets && datePresets.length > 0 && (
        <div className="date-presets">
          {datePresets.map(p => (
            <button key={p.label} className={`date-preset-btn ${activeDatePreset === p.label ? 'active' : ''}`}
              onClick={() => applyDatePreset!(p)}>{t(p.label)}</button>
          ))}
          {hasPreset && <button className="date-preset-btn" onClick={clearDatePreset}>{t("filter.clear")}</button>}
        </div>
      )}
      <div className="filter-row">
        <div className="search-box"><Search size={15} /><input placeholder={t("filter.queryPh")} value={filters.query} onChange={e => updateFilter("query", e.target.value)} /></div>
        <MultiSelect label={t("filter.allStatuses")} options={allStatuses ?? []} selected={filters.status} onChange={v => setMultiFilter("status", v)} render={v => statusLabel(t, v)} onRemove={onRemoveStatus} removable={removableStatuses} removeUsage={statusUsage} t={t} />
        <MultiSelect label={t("filter.allChannels")} options={allChannels ?? []} selected={filters.channel} onChange={v => setMultiFilter("channel", v)} render={v => channelLabel(t, v)} onRemove={onRemoveChannel} removable={removableChannels} removeUsage={channelUsage} t={t} />
        <MultiSelect label={t("filter.allLocations")} options={allLocations ?? []} selected={filters.location} onChange={v => setMultiFilter("location", v)} render={v => locationLabel(t, v)} onRemove={onRemoveLocation} removable={removableLocations} removeUsage={locationUsage} t={t} />
        {/* 1st and 2nd contact are separate dropdowns, and they AND together:
            picking one of each narrows to that exact pairing. */}
        <MultiSelect label={t("filter.firstContact")} options={firstContacts} selected={filters.firstContact} onChange={v => setMultiFilter("firstContact", v)} t={t} />
        <MultiSelect label={t("filter.secondContact")} options={secondContacts} selected={filters.secondContact} onChange={v => setMultiFilter("secondContact", v)} t={t} />
      </div>
      <div className="date-bar">
        <Filter size={13} /><span>{t("th.date")}</span><input type="date" value={filters.startDate} onChange={e => updateFilter("startDate", e.target.value)} /><span>–</span><input type="date" value={filters.endDate} onChange={e => updateFilter("endDate", e.target.value)} />
        {setSortBy && (
          <label className="sort-picker">
            <span>{t("clients.sortBy")}</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortField)}>
              <option value="recent">{t("clients.sortRecent")}</option>
              <option value="oldest">{t("clients.sortOldest")}</option>
              <option value="registered">{t("clients.sortRegistered")}</option>
              <option value="registeredOldest">{t("clients.sortRegisteredOldest")}</option>
            </select>
          </label>
        )}
      </div>
      {(filterCount ?? 0) > 0 && (
        <div className="filter-chips">
          {filters.query && <span className="filter-chip">&ldquo;{filters.query.slice(0, 24)}&rdquo;<button title={t("common.clear")} onClick={() => updateFilter("query", "")}>×</button></span>}
          {filters.status.map(s => <span key={`st-${s}`} className="filter-chip">{statusLabel(t, s)}<button onClick={() => setMultiFilter("status", filters.status.filter(x => x !== s))}>×</button></span>)}
          {filters.channel.map(c => <span key={`ch-${c}`} className="filter-chip">{channelLabel(t, c)}<button onClick={() => setMultiFilter("channel", filters.channel.filter(x => x !== c))}>×</button></span>)}
          {filters.location.map(l => <span key={`lo-${l}`} className="filter-chip">{l}<button onClick={() => setMultiFilter("location", filters.location.filter(x => x !== l))}>×</button></span>)}
          {filters.firstContact.map(p => <span key={`fc-${p}`} className="filter-chip">{t("filter.firstContact")}: {p}<button onClick={() => setMultiFilter("firstContact", filters.firstContact.filter(x => x !== p))}>×</button></span>)}
          {filters.secondContact.map(p => <span key={`sc-${p}`} className="filter-chip">{t("filter.secondContact")}: {p}<button onClick={() => setMultiFilter("secondContact", filters.secondContact.filter(x => x !== p))}>×</button></span>)}
          {filters.startDate && <span className="filter-chip">{t("common.from")} {filters.startDate}<button onClick={() => updateFilter("startDate", "")}>×</button></span>}
          {filters.endDate && <span className="filter-chip">{t("common.to")} {filters.endDate}<button onClick={() => updateFilter("endDate", "")}>×</button></span>}
          <button type="button" className="filter-chip clear-all-chip" onClick={clearAllFilters}>{t("filter.clear")} ×</button>
        </div>
      )}
    </>
  );
}

function MultiSelect({ label, options, selected, onChange, render, onRemove, removable, removeUsage, t }: {
  label: string; options: string[]; selected: string[];
  onChange: (values: string[]) => void; render?: (v: string) => string;
  /** Deletes the value from the saved reference list (admin only, server-gated). */
  onRemove?: (value: string) => void;
  /** Only values in this list may be removed; built-ins are code constants. */
  removable?: string[];
  /** Client count per value, used to warn before removing something in use. */
  removeUsage?: Record<string, number>;
  t: TFn;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const lab = (v: string) => (render ? render(v) : v);
  const toggleValue = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <button type="button" className={`ms-trigger ${selected.length > 0 ? "ms-active" : ""}`} onClick={() => setOpen(o => !o)}>
        <span className="ms-value">
          {selected.length === 0 ? label
            : selected.length === 1 ? lab(selected[0])
            : `${lab(selected[0])} +${selected.length - 1}`}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ms-menu">
          {options.length === 0 && <div className="ms-empty">{t("common.noData")}</div>}
          {options.map(o => {
            // Only saved (custom) values, and only while nothing references them.
            // A value still attached to clients cannot be removed: deleting it from
            // the list would leave those clients pointing at a value that no longer
            // exists anywhere in the UI. The count on the row explains why.
            const used = removeUsage?.[o] ?? 0;
            const canRemove = Boolean(onRemove && removable?.includes(o) && used === 0);
            return (
              <div key={o} className={`ms-opt-row ${selected.includes(o) ? "ms-opt-on" : ""}`}>
                <button type="button" className="ms-opt" onClick={() => toggleValue(o)}>
                  <span className="ms-check">{selected.includes(o) && <Check size={11} />}</span>
                  {lab(o)}
                  {used > 0 && <span className="ms-opt-count">{num(used)}</span>}
                </button>
                {canRemove && (
                  <button
                    type="button"
                    className="ms-opt-del"
                    title={t("refData.removeTitle")}
                    aria-label={t("refData.removeAria", { value: lab(o) })}
                    onClick={() => {
                      // Removing the value from the saved list does NOT touch
                      // clients already using it, so say so before doing it.
                      const msg = used > 0
                        ? t("refData.removeUsedConfirm", { value: lab(o), n: used })
                        : t("refData.removeConfirm", { value: lab(o) });
                      if (!confirm(msg)) return;
                      onChange(selected.filter(x => x !== o));
                      onRemove?.(o);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {selected.length > 0 && <button type="button" className="ms-clear" onClick={() => { onChange([]); setOpen(false); }}>{t("clients.clearSelection")}</button>}
        </div>
      )}
    </div>
  );
}

function Dashboard({ metrics, totalSpend, totalReach, won, lost, waiting, unclassified, clients, salespeople, spReports, timeline, chartView, onChartViewChange, updateStatus, updateClientField, allStatuses, allChannels, allLocations, onAddStatus, onAddChannel, onAddLocation, onExport, exporting, scoped, onToggleStageFilter, periodKind, periodInfo, onPeriodChange, onCustomRange, customFrom, customTo, periodLoading, t }: { metrics: Metric[]; totalSpend: number; totalReach: number; won: number; lost: number; waiting: number; unclassified: number; clients: Client[]; salespeople: string[]; spReports: { first: SpRow[]; second: SpRow[] }; timeline: TrendPoint[]; chartView: ChartView; onChartViewChange: (v: ChartView) => void; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; allStatuses: string[]; allChannels: string[]; allLocations: string[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; onExport: () => void; exporting: boolean; scoped: boolean; onToggleStageFilter: (status: string) => void; periodKind: PeriodKind; periodInfo: { from: string; to: string; campaignCount: number; campaignNames: string[]; totals: { total: number; won: number; lost: number; waiting: number; other: number } }; onPeriodChange: (k: PeriodKind) => void; onCustomRange: (from: string, to: string) => void; customFrom: string; customTo: string; periodLoading: boolean; t: TFn }) {
  const recentClients = useMemo(() => [...clients].sort((a,b) => String(b.lastUpdateDate||"").localeCompare(String(a.lastUpdateDate||""))).slice(0,5), [clients]);
  const topLocations = useMemo(() => { const m = new Map<string,number>(); clients.forEach(c=>m.set(c.location,(m.get(c.location)||0)+1)); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5); }, [clients]);

  // Which contact role the sales performance panel is reporting on. Defaults to
  // the 2nd contact: that is the number most reps could not previously see at
  // all, since the panel used to merge both roles into one list.
  const [spRole, setSpRole] = useState<"first" | "second">("second");
  const spRows = spReports[spRole];
  const { logo: heroLogo } = useLogo();

  // Status panel: every pipeline stage in registry order, followed by the
  // user-defined statuses created on the clients page. Without the second half,
  // a status added there never appeared on the dashboard at all.
  const stageCounts = useMemo(() => {
    const stages = PIPELINE_STAGES.map((stage) => ({
      value: stage.value,
      color: stage.color,
      count: clients.filter((c) => c.status === stage.value).length,
    }));
    const custom = (allStatuses ?? [])
      .filter((value) => !PREDEFINED_STATUSES.includes(value))
      .map((value) => ({
        value,
        color: statusColor(value),
        count: clients.filter((c) => c.status === value).length,
      }));
    return [...stages, ...custom];
  }, [clients, allStatuses]);

  const inProgress = useMemo(
    () => clients.filter((c) => isInProgress(c.status)).length,
    [clients],
  );

  // Funnel: the active pipeline (everything up to "Contracted"), each step
  // showing its pass rate from the previous one. "Final loss" is terminal and
  // sits outside the funnel, so it is reported separately below.
  //
  // Written as a two-pass reduce rather than a loop with a reassigned variable:
  // mutating a `let` while building a memo trips the compiler's
  // "cannot reassign variable after render completes" rule.
  const funnelStages = useMemo(() => {
    const active = PIPELINE_STAGES.filter((s) => s.outcome !== "lost");
    const counts = active.map((stage) => clients.filter((c) => c.status === stage.value).length);
    return active.map((stage, i) => ({
      stage,
      count: counts[i],
      // Pass rate is measured against the step above; the first step is measured
      // against the total, so it has no rate of its own.
      rate: i === 0 || counts[i - 1] === 0 ? null : Math.round((counts[i] / counts[i - 1]) * 100),
      entering: i === 0,
    }));
  }, [clients]);

  const finalConversionRate = clients.length > 0
    ? Math.round((clients.filter((c) => isWon(c.status)).length / clients.length) * 100)
    : 0;

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div>
          {heroLogo && <img src={heroLogo} alt={t("brand.logoAlt")} className="hero-logo" />}
          <span className="dashboard-eyebrow">{t("dash.heroEyebrow")}</span>
          <h1>{t("dash.heroTitle")}</h1>
          <p>{t("dash.heroSubtitle")}</p>
        </div>
        <div className="dashboard-hero-summary">
          <span>{t("dash.clientOverview")}</span>
          <strong>{MONEY.format(clients.length)}</strong>
          <small>{t("dash.clientsInThisView")}</small>
          <button type="button" onClick={onExport} disabled={exporting}><Download size={14} />{exporting ? t("dash.exporting") : t("dash.exportReport")}</button>
        </div>
      </header>
      {/* Reporting period — scopes the six cards below. Defaults to this week. */}
      <div className="period-bar">
        <div className="period-tabs" role="group" aria-label={t("period.label")}>
          {(["week", "month", "all", "custom"] as PeriodKind[]).map(k => (
            <button
              key={k}
              type="button"
              className={periodKind === k ? "active" : ""}
              aria-pressed={periodKind === k}
              onClick={() => onPeriodChange(k)}
            >
              {t(`period.${k}`)}
            </button>
          ))}
        </div>
        {periodKind === "custom" && (
          <div className="period-custom">
            <input type="date" value={customFrom} onChange={e => onCustomRange(e.target.value, customTo)} aria-label={t("common.from")} />
            <span>–</span>
            <input type="date" value={customTo} onChange={e => onCustomRange(customFrom, e.target.value)} aria-label={t("common.to")} />
          </div>
        )}
        <span className="period-summary">
          {periodLoading
            ? t("common.loading")
            : periodInfo.from && periodInfo.to
              ? `${periodInfo.from} — ${periodInfo.to} · ${t("period.campaigns", { n: periodInfo.campaignCount })}`
              : t(`period.${periodKind}`)}
        </span>
      </div>

      {/* KPI strip — the four outcome cards (won / lost / in progress / other)
          plus spend, reach and CPA. `other` is what makes the outcome cards sum
          to the period total instead of quietly under-reporting. */}
      <section className="kpi-row kpi-row-7">
        <KpiCard label={t("kpi.totalSpend")} value={sar(totalSpend)} sub={t("kpi.weeklyInvestment")} accent="#069de3"/>
        <KpiCard label={t("kpi.totalReach")} value={MONEY.format(totalReach)} sub={t("kpi.acrossChannels")} accent="#0891b2"/>
        <KpiCard label={t("kpi.won")} value={String(won)} sub={`${won+lost?Math.round(won/(won+lost)*100):0}% ${t("kpi.winRate")}`} accent="#22c55e"/>
        <KpiCard label={t("stage.lost")} value={String(lost)} sub={`${lost>0?Math.round(lost/(won+lost)*100):0}% ${t("kpi.ofTotal")}`} accent="#ef4444"/>
        <KpiCard label={t("funnel.inProgress")} value={String(waiting)} sub={t("kpi.awaiting")} accent="#f59e0b"/>
        <KpiCard label={t("kpi.otherStatus")} value={String(unclassified)} sub={t("kpi.otherStatusSub")} accent="#94a3b8"/>
        <KpiCard label={t("kpi.avgCpa")} value={metrics.length ? sar(Math.round(totalSpend / (won || 1))) : "—"} sub={won>0?t("kpi.customersWon",{n:won}):t("kpi.noWins")} accent="#7c3aed"/>
      </section>

      {/* Charts. Full width directly under the cards, so the trend has room to
          breathe and the y-axis is not squeezed into a half-column. */}
      <DashboardCharts
        view={chartView}
        onViewChange={onChartViewChange}
        timeline={timeline}
        channels={metrics.map((m) => ({
          channel: m.channel,
          platform: m.platform,
          totalClients: m.totalClients,
          won: m.won,
          lost: m.lost,
          spend: m.spend,
        }))}
        sales={spRows}
        t={t}
      />

      {/* Client status — above Sales performance and Channel ROI */}
      <section className="panel stage-panel">
        <div className="panel-heading">
          <h3>{t("stage.title")} <small>{scoped ? t("dash.scopeMine") : t("dash.scopeAll")}</small></h3>
        </div>
        <div className="stage-total-row">
          <span className="stage-total-label">{t("stage.total")}</span>
          <strong className="stage-total-value">{num(clients.length)}</strong>
        </div>
        <div className="stage-rows">
          {stageCounts.map(({ value, color, count }) => {
            const pct = clients.length > 0 ? Math.round((count / clients.length) * 100) : 0;
            return (
              <button
                type="button"
                className="stage-row"
                key={value}
                title={t("stage.clickFilter")}
                onClick={() => onToggleStageFilter(value)}
              >
                <span className="stage-row-dot" style={{ background: color }} />
                <span className="stage-row-name">{statusLabel(t, value)}</span>
                <span className="stage-row-track">
                  <span className="stage-row-fill" style={{ width: `${pct}%`, background: color }} />
                </span>
                <span className="stage-row-count">{num(count)}</span>
                <span className="stage-row-pct">{pct}%</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Funnel + ROI */}
      <section className="funnel-row">
        <div className="panel sp-perf-panel">
          <div className="sp-perf-head">
            <h3>{t("sp.title")}</h3>
            <div className="sp-role-toggle" role="group" aria-label={t("sp.roleLabel")}>
              <button
                type="button"
                className={spRole === "first" ? "active" : ""}
                aria-pressed={spRole === "first"}
                onClick={() => setSpRole("first")}
              >{t("sp.roleFirst")}</button>
              <button
                type="button"
                className={spRole === "second" ? "active" : ""}
                aria-pressed={spRole === "second"}
                onClick={() => setSpRole("second")}
              >{t("sp.roleSecond")}</button>
            </div>
          </div>
          <p className="sp-role-hint">
            {t(spRole === "first" ? "sp.roleFirstHint" : "sp.roleSecondHint")}
          </p>
          <div className="sp-perf-legend">
            <span className="sp-won">{statusLabel(t, "WON")}</span>
            <span className="sp-lost">{statusLabel(t, "LOST")}</span>
            <span className="sp-wait">{t("funnel.inProgress")}</span>
            <span className="sp-other">{t("kpi.otherStatus")}</span>
            <span className="sp-total">{t("sp.total")}</span>
          </div>
          {spRows.length === 0 && <div className="empty-state" style={{fontSize:12,padding:"16px 0"}}>{t("sp.noData")}</div>}
          {spRows.map(sp => (
            <div className="sp-perf-row" key={sp.name}>
              <div className="sp-perf-avatar">{sp.name.slice(0,2).toUpperCase()}</div>
              <div className="sp-perf-name">{sp.name}</div>
              <div className="sp-perf-stats">
                <span className="sp-won">{sp.won}</span>
                <span className="sp-lost">{sp.lost}</span>
                <span className="sp-wait">{sp.waiting}</span>
                <span className="sp-other">{sp.other}</span>
                <span className="sp-total">{sp.total}</span>
              </div>
              <div className="sp-perf-bar"><div className="sp-perf-fill" style={{width: String(sp.winRate ?? 0) + "%"}}/></div>
              <span className="sp-winrate">{sp.winRate === null ? "—" : sp.winRate + "%"}</span>
            </div>
          ))}
        </div>
        <div className="panel channel-roi-panel">
          <h3>{t("roi.title")}</h3>
          <div className="roi-table">
            <div className="roi-head"><span>{t("roi.channel")}</span><span>{t("roi.spend")}</span><span>{t("roi.won")}</span><span>{t("roi.cpa")}</span></div>
            {metrics.filter((m: Metric)=>m.totalClients>0).map((m: Metric)=>(
              <div className="roi-row" key={m.channel}>
                <span className="chan-cell"><i className="dot" style={{background:CH_COLORS[m.channel]}}/>{m.platform}</span>
                <span>{sar(m.spend)}</span><span>{m.won}</span>
                <span className={m.cpa<100?"good":m.cpa<500?"":"bad"}>{m.cpa > 0 ? sar(m.cpa) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recent clients (full width) */}
      <section className="panel recent-clients-panel">
        <div className="panel-heading"><h3>{t("recent.title")}</h3><button className="btn-ghost" onClick={()=>onExport()} disabled={exporting} style={{fontSize:11}}>{t("common.export")}</button></div>
        {recentClients.length === 0 && <div className="empty-state">{t("recent.empty")}</div>}
        {recentClients.map(c => (
          <div className="recent-client-row" key={c.id}>
            <span className="rc-avatar">{c.name.slice(0,2).toUpperCase()}</span>
            <div className="rc-info">
              <strong>{c.name}</strong>
              <small>
                <span className="rc-kv"><span className="rc-k">{t("recent.project")}</span><span className="rc-v">{c.project || "—"}</span></span>
                {c.location ? <span className="rc-kv"><span className="rc-k">{t("recent.location")}</span><span className="rc-v">{c.location}</span></span> : null}
              </small>
            </div>
            <span className="chan-tag-inline" style={{ flexShrink: 0 }}><i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>{channelLabel(t, c.acquisitionChannel)}</span>
            <StatusPill status={c.status} t={t} style={{ flexShrink: 0 }} />
          </div>
        ))}
      </section>

      {/* Top locations + Conversion funnel underneath */}
      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading"><h3>{t("loc.title")}</h3><span className="muted" style={{fontSize:11}}>{t("loc.clients", { n: clients.length })}</span></div>
          {topLocations.length === 0 && <div className="empty-state">{t("loc.noData")}</div>}
          {topLocations.map(([loc, count], i) => (
            <div className="loc-bar-row" key={loc}>
              <span className="loc-rank">#{i+1}</span>
              <div className="loc-bar-track"><div className="loc-bar-fill" style={{width: `${Math.round(count/clients.length*100)}%`, background: ["#069de3","#0891b2","#f59e0b","#22c55e","#7c3aed"][i]}}/></div>
              <span className="loc-name">{loc}</span>
              <span className="loc-count">{count}</span>
            </div>
          ))}
        </section>
        <section className="panel funnel-panel">
          <div className="panel-heading">
            <h3>{t("funnel.newTitle")}</h3>
            <span className="muted" style={{ fontSize: 11 }}>{t("funnel.inProgress")}: {num(inProgress)}</span>
          </div>
          <div className="funnel2">
            {funnelStages.map(({ stage, count, rate, entering }, i) => {
              const width = clients.length > 0 ? Math.max(2, Math.round((count / clients.length) * 100)) : 0;
              return (
                <div className="funnel2-step" key={stage.value}>
                  <div className="funnel2-head">
                    <span className="funnel2-dot" style={{ background: stage.color }} />
                    <span className="funnel2-name">{statusLabel(t, stage.value)}</span>
                    <span className="funnel2-count">{num(count)}</span>
                  </div>
                  <div className="funnel2-track">
                    <div
                      className="funnel2-fill"
                      style={{ width: `${width}%`, background: stage.color, opacity: entering ? 1 : 0.82 }}
                    />
                  </div>
                  {i > 0 && (
                    <span className="funnel2-rate">
                      {rate === null ? "—" : `${rate}%`} · {t("funnel.dropoff")}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="funnel2-final">
              <span>{t("funnel.finalRate")}</span>
              <strong>{finalConversionRate}%</strong>
            </div>
          </div>
        </section>
      </div>

      {/* Channel breakdown */}
      <section className="panel channel-breakdown-panel">
        <h3>{t("brk.title")} <small>{t("loc.clients", { n: clients.length })}</small></h3>
        <div className="table-head-row"><span>{t("brk.platform")}</span><span>{t("roi.spend")}</span><span>{t("brk.reach")}</span><span>{t("brk.clients")}</span><span>{t("roi.cpa")}</span></div>
        {metrics.map((item: Metric)=><div className="table-row" key={item.channel}>
          <span className="chan-cell"><i className="dot" style={{background:CH_COLORS[item.channel]}}/>{item.platform}</span>
          <span>{sar(item.spend)}</span><span>{MONEY.format(item.reach)}</span><span>{item.totalClients}</span><span>{item.cpa.toFixed(2)}</span>
        </div>)}
      </section>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (<div className="kpi-card" style={{borderTopColor:accent}}><div className="kpi-label"><span>{label}</span><span className="kpi-dot" style={{background:accent}}/></div><div className="kpi-value">{value}</div><div className="kpi-sub">{sub}</div></div>);}

function ClientsView({ clients, allClients, mode, setMode, filters, updateFilter, setMultiFilter, clearAllFilters, firstContacts, secondContacts, sortBy, setSortBy, columns, onColumnsChange, rtl, updateStatus, updateClientField, onAssigned, isAdmin, canEdit, refData, onArchive, onArchiveSelected,
  selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenCreate, onOpenImport, onOpenDelete, onOpenDetail,
  exportExcel, exportSelected, bulkCount, onBulkDelete, allStatuses, allChannels,
  customLocationInput, setCustomLocationInput, customChannels, activeDatePreset,
  applyDatePreset, clearDatePreset, datePresets, filterCount, allLocations, users, onAddStatus, onAddChannel, onAddLocation, t }: { clients: Client[]; allClients: Client[]; mode: "table"|"kanban"; setMode: (m: "table"|"kanban") => void; filters: Filters; updateFilter: (k: "query" | "startDate" | "endDate", v: string) => void; setMultiFilter: (k: "status" | "channel" | "location" | "firstContact" | "secondContact", values: string[]) => void; clearAllFilters: () => void; isAdmin: boolean; canEdit: boolean; refData: { onRemoveStatus?: (v: string) => void; onRemoveChannel?: (v: string) => void; onRemoveLocation?: (v: string) => void; removableStatuses?: string[]; removableChannels?: string[]; removableLocations?: string[]; statusUsage?: Record<string, number>; channelUsage?: Record<string, number>; locationUsage?: Record<string, number> }; onArchive: (id: string) => void | Promise<void>; onArchiveSelected: () => void | Promise<void>; firstContacts: string[]; secondContacts: string[]; sortBy: SortField; setSortBy: (s: SortField) => void; columns: ResolvedColumn[]; onColumnsChange: (c: ResolvedColumn[]) => void; rtl: boolean; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; toggleSelect: (id: string) => void; toggleSelectAll: () => void; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; onOpenCreate: () => void; onOpenImport: () => void; exportExcel: () => void; exportSelected: () => void; bulkCount: number; onBulkDelete: () => void; allStatuses: string[]; allChannels: string[]; customLocationInput: string; setCustomLocationInput: (v: string) => void; customChannels: string[]; activeDatePreset?: string | null; applyDatePreset?: (p: DatePreset) => void; clearDatePreset?: () => void; datePresets?: DatePreset[]; filterCount?: number; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; t: TFn }) {
  return (
    <div className="page">
      <div className="page-header">
        <div><div className="breadcrumb"><UsersRound size={14}/>{t("clients.crm")}</div><h1>{t("clients.title")}</h1><p>{t("clients.subtitle")}</p></div>
        <div className="header-actions">
          {bulkCount>0&&<span className="selection-info">{t("clients.selectedCount",{n:bulkCount})}
            {isAdmin && <><button className="btn-danger-sm" onClick={onBulkDelete}>{t("clients.deleteSelected")}</button>
              <button className="btn-archive-sm" onClick={onArchiveSelected}>{t("clients.archiveSelected")}</button></>}
          </span>}
          <div className="segmented">
            <button className={mode==="table"?"seg-active":""} onClick={()=>setMode("table")}><LayoutDashboard size={14}/>{t("clients.table")}</button>
            <button className={mode==="kanban"?"seg-active":""} onClick={()=>setMode("kanban")}><Grid2X2 size={14}/>{t("clients.kanban")}</button>
          </div>
          {canEdit && <button className="btn-primary" onClick={onOpenCreate}><Plus size={15}/>{t("clients.newClient")}</button>}
          {isAdmin && <button className="btn-outline" onClick={onOpenImport}><Upload size={15}/>{t("importer.btn")}</button>}
          <ColumnPicker columns={columns} onChange={onColumnsChange} t={t} />
          <button className="btn-outline" onClick={exportSelected} disabled={bulkCount===0}><Download size={15}/>{t("clients.exportSelected",{n:bulkCount})}</button>
          <button className="btn-outline" onClick={exportExcel}><Download size={15}/>{t("clients.exportAll")}</button>
        </div>
      </div>
      <FilterBar filters={filters} updateFilter={updateFilter} setMultiFilter={setMultiFilter} clearAllFilters={clearAllFilters} firstContacts={firstContacts} secondContacts={secondContacts} sortBy={sortBy} setSortBy={setSortBy} datePresets={datePresets} activeDatePreset={activeDatePreset} applyDatePreset={applyDatePreset} clearDatePreset={clearDatePreset} filterCount={filterCount ?? 0} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} onRemoveStatus={refData.onRemoveStatus} removableStatuses={refData.removableStatuses} statusUsage={refData.statusUsage} onRemoveChannel={refData.onRemoveChannel} onRemoveLocation={refData.onRemoveLocation} removableChannels={refData.removableChannels} removableLocations={refData.removableLocations} channelUsage={refData.channelUsage} locationUsage={refData.locationUsage} t={t} />
      <div className="result-note">{t("clients.showing",{n:clients.length,total:allClients.length})} · {t("clients.selected",{n:selectedIds.size})}</div>
      {mode==="table"? <ClientTable clients={clients} selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} isAdmin={isAdmin} canEdit={canEdit} onArchive={onArchive} tableRef={null} columns={columns} onColumnsChange={onColumnsChange} rtl={rtl} t={t}/>:<Kanban clients={clients} updateStatus={updateStatus} updateClientField={updateClientField} onAssigned={onAssigned} selectedIds={selectedIds} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} isAdmin={isAdmin} canEdit={canEdit} onArchive={onArchive} columns={columns} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} users={users} onAddStatus={onAddStatus} onAddChannel={onAddChannel} onAddLocation={onAddLocation} t={t}/>}
    </div>
  );
}

/**
 * Renders one table cell for a column key.
 *
 * A lookup rather than a switch inside the row so the header and body can never
 * drift out of column order — the grid assigns cells positionally, so one extra
 * or missing cell shifts every cell after it.
 */
function ClientCell({ col, c, t, lang, onOpenDetail, canEdit, isAdmin, onOpenEdit, onOpenDelete, onArchive }: {
  col: ResolvedColumn;
  c: Client;
  t: TFn;
  lang: string;
  onOpenDetail: (c: Client) => void;
  canEdit?: boolean;
  isAdmin?: boolean;
  onOpenEdit: (c: Client) => void;
  onOpenDelete: (ids: string[], names: string[]) => void;
  onArchive?: (id: string) => void | Promise<void>;
}) {
  switch (col.key) {
    case "id":
      return <span className="id-cell" title={t("th.id")}>#{c.id}</span>;
    case "client":
      return (
        <span className="person-cell" onClick={() => onOpenDetail(c)}>
          <b>{c.name}</b>
          <small><span className="ltr-num">{c.phoneNumber}</span></small>
          {c.notes && <span className="notes-indicator"><MessageSquare size={10} /></span>}
        </span>
      );
    case "status":
      return <StatusPill status={c.status} t={t} />;
    case "channel":
      return <span className="chan-tag"><i className="dot" style={{ background: CH_COLORS[c.acquisitionChannel] }} />{channelLabel(t, c.acquisitionChannel)}</span>;
    case "project":
      return <span>{c.project}</span>;
    case "location":
      return <span>{c.location}</span>;
    case "registeredAt":
      return <span className="muted">{c.createdAt ? new Date(c.createdAt).toLocaleDateString(dateLocale(lang)) : "—"}</span>;
    case "operation":
      return <span className="op-text">{c.operationToTake}</span>;
    case "firstContact":
      return <span className="muted">{c.firstContactPerson || "—"}</span>;
    case "secondContact":
      return <span className="muted">{c.secondContactPerson || "—"}</span>;
    case "lastUpdateDate":
      return <span className="muted">{c.lastUpdateDate ? new Date(c.lastUpdateDate).toLocaleDateString(dateLocale(lang)) : "—"}</span>;
    case "actions":
      return (
        <span className="actions-cell no-detail">
          {canEdit && <button className="icon-btn" title={t("common.edit")} onClick={e => { e.stopPropagation(); onOpenEdit(c); }}><Pencil size={14} /></button>}
          {isAdmin && <><button className="icon-btn danger" title={t("common.delete")} onClick={e => { e.stopPropagation(); onOpenDelete([c.id], [c.name]); }}><Trash2 size={14} /></button>
            <button className="icon-btn" title={t("nav.archived")} onClick={e => { e.stopPropagation(); onArchive && onArchive(c.id); }}><Archive size={14} /></button></>}
        </span>
      );
    default:
      return null;
  }
}

function ClientTable({ clients, selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenDelete, onOpenDetail, isAdmin, canEdit, onArchive, tableRef, columns, onColumnsChange, rtl, t }: {
  clients: Client[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  onOpenEdit: (c: Client) => void;
  onOpenDelete: (ids: string[], names: string[]) => void;
  onOpenDetail: (c: Client) => void;
  isAdmin?: boolean;
  canEdit?: boolean;
  onArchive?: (id: string) => void | Promise<void>;
  tableRef?: React.RefObject<HTMLDivElement> | null;
  columns: ResolvedColumn[];
  onColumnsChange: (c: ResolvedColumn[]) => void;
  rtl: boolean;
  t: TFn;
}) {
  const { lang } = useLang();
  const allSelected = clients.length > 0 && clients.every(c => selectedIds.has(c.id));

  // Width changes preview live during the drag and commit once on release —
  // otherwise a drag would fire a save per pixel.
  const [draft, setDraft] = useState<{ key: ColumnKey; w: number } | null>(null);
  const drag = useRef<{ key: ColumnKey; startX: number; startW: number } | null>(null);
  // Suppress text selection while dragging, or the drag selects the row text.
  useEffect(() => {
    if (!draft) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => { document.body.style.userSelect = prev; };
  }, [draft]);

  const startResize = (e: React.PointerEvent, col: ResolvedColumn) => {
    if (col.locked) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key: col.key, startX: e.clientX, startW: col.w };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft({ key: col.key, w: col.w });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // In RTL the grid flows right-to-left, so moving the pointer RIGHT NARROWS
    // the column. Without this inversion every drag runs backwards for Arabic
    // users — the app's default language.
    const delta = rtl ? d.startX - e.clientX : e.clientX - d.startX;
    const col = columns.find(c => c.key === d.key);
    if (!col) return;
    setDraft({ key: d.key, w: Math.min(col.max, Math.max(col.min, d.startW + delta)) });
  };

  const endResize = () => {
    const done = draft;
    drag.current = null;
    setDraft(null);
    if (!done) return;
    onColumnsChange(columns.map(c => (c.key === done.key ? { ...c, w: done.w } : c)));
  };

  /** Double-click a divider to restore that column's default width. */
  const resetColumn = (col: ResolvedColumn) => {
    const def = CLIENT_COLUMNS.find(d => d.key === col.key);
    if (!def || col.locked) return;
    onColumnsChange(columns.map(c => (c.key === col.key ? { ...c, w: def.w } : c)));
  };

  const onResizeKey = (e: React.KeyboardEvent, col: ResolvedColumn) => {
    if (col.locked) return;
    const step = e.shiftKey ? 24 : 8;
    let w: number | null = null;
    // Arrow keys are mirrored in RTL, same as the drag.
    if (e.key === "ArrowRight") w = col.w + (rtl ? -step : step);
    else if (e.key === "ArrowLeft") w = col.w + (rtl ? step : -step);
    if (w === null) return;
    e.preventDefault();
    e.stopPropagation();
    onColumnsChange(columns.map(c => (c.key === col.key ? { ...c, w: Math.min(col.max, Math.max(col.min, w)) } : c)));
  };

  // The live drag width, so the header and every body row move together.
  const layout = draft ? columns.map(c => (c.key === draft.key ? { ...c, w: draft.w } : c)) : columns;
  const shown = layout.filter(col => !col.hidden);

  return (
    <div className="table-scroll-wrapper">
      <div className="scroll-indicator-left hidden" ref={(el) => { if (el) { const t2 = tableRef?.current; if (t2) { const check = () => { el.classList.toggle("hidden", t2.scrollLeft <= 0); }; check(); t2.addEventListener("scroll", check, { passive: true }); } } }} />
      <div className="scroll-indicator-right hidden" />
      <div
        className="client-table"
        ref={tableRef}
        style={{ ["--ct-cols" as string]: gridTemplate(layout) }}
      >
        <div className="client-row client-head">
          {shown.map(col => (
            <span key={col.key} className="col-head-cell">
              {col.key === "select"
                ? <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="cb" />
                : col.labelKey ? t(col.labelKey) : null}
              {!col.locked && (
                <span
                  className="col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("cols.resize", { name: col.labelKey ? t(col.labelKey) : col.key })}
                  aria-valuenow={col.w}
                  aria-valuemin={col.min}
                  aria-valuemax={col.max}
                  tabIndex={0}
                  title={t("cols.resizeHint")}
                  onPointerDown={e => startResize(e, col)}
                  onPointerMove={onMove}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={e => { e.stopPropagation(); resetColumn(col); }}
                  onKeyDown={e => onResizeKey(e, col)}
                />
              )}
            </span>
          ))}
        </div>
        {clients.map(c => (
          <div className={`client-row client-row-clickable ${selectedIds.has(c.id) ? "selected" : ""}`} key={c.id} onClick={e => { (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "SELECT" && !(e.target as HTMLElement).closest(".no-detail") && onOpenDetail(c) }}>
            {shown.map(col => (
              col.key === "select"
                ? <input key={col.key} type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="cb" onClick={e => e.stopPropagation()} />
                : <ClientCell key={col.key} col={col} c={c} t={t} lang={lang} onOpenDetail={onOpenDetail} canEdit={canEdit} isAdmin={isAdmin} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onArchive={onArchive} />
            ))}
          </div>
        ))}
        {clients.length === 0 && <div className="empty-state">{t("clients.noResults")}</div>}
      </div>
    </div>
  );
}

function Kanban({ clients, updateStatus, updateClientField, onAssigned, selectedIds, onOpenEdit, onOpenDelete, onOpenDetail, isAdmin, canEdit, onArchive, columns, allStatuses, allChannels, allLocations, users, onAddStatus, onAddChannel, onAddLocation, t }: { clients: Client[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; isAdmin?: boolean; canEdit?: boolean; onArchive?: (id: string) => void | Promise<void>; columns: ResolvedColumn[]; allStatuses?: string[]; allChannels?: string[]; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; t: TFn }) {
  const [draggedId, setDraggedId] = useState<string|null>(null);
  const [dropTarget, setDropTarget] = useState<string|null>(null);
  // The same saved layout drives the cards, so hiding a field in the table hides
  // it on every card too. Widths are ignored here: cards are fixed-width in a
  // 3-column board, so there is nothing for a width to act on.
  const show = (key: ColumnKey) => columns.find(c => c.key === key)?.hidden === false;
  const statusColumns: string[] = [...new Set([...(allStatuses ?? ["WAITING","WON","LOST"]), ...clients.map(c => c.status)])];
  return (
    <div className="kanban-board">
      {statusColumns.map(col=>(
        <section key={col} className={`kanban-col ${dropTarget===col?"drop-target":""}`}
          onDragEnter={canEdit?()=>setDropTarget(col):undefined} onDragOver={canEdit?(e=>{e.preventDefault();setDropTarget(col);}):undefined}
          onDragLeave={canEdit?()=>setDropTarget(null):undefined} onDrop={canEdit?()=>{if(draggedId){updateStatus(draggedId,col);setDraggedId(null);setDropTarget(null);}}:undefined}>
          <div className="kanban-head">
            <StatusDot status={col} /><span>{statusLabel(t, col)}</span><small>{clients.filter(c=>c.status===col).length}</small>
          </div>
          {clients.filter(c=>c.status===col).map(c=>(
            <article className={`client-card ${draggedId===c.id?"dragging":""} ${selectedIds.has(c.id)?"card-selected":""}`} key={c.id} draggable={canEdit} onDragStart={canEdit?()=>setDraggedId(c.id):undefined} onDragEnd={canEdit?()=>{setDraggedId(null);setDropTarget(null);}:undefined} onDoubleClick={()=>onOpenDetail(c)}>
              <div className="card-top"><b className="card-name"><span className="id-cell" title={t("th.id")}>#{c.id}</span>{c.name}</b><span className="card-actions no-detail">
                {canEdit && <button className="icon-btn-sm" title={t("common.edit")} onClick={e=>{e.stopPropagation();onOpenEdit(c);}}><Pencil size={12}/></button>}
                {isAdmin && <><button className="icon-btn-sm danger" title={t("common.delete")} onClick={e=>{e.stopPropagation();onOpenDelete([c.id],[c.name]);}}><Trash2 size={12}/></button>
                  <button className="icon-btn-sm" title={t("nav.archived")} onClick={e=>{e.stopPropagation();onArchive&&onArchive(c.id);}}><Archive size={12}/></button></>}
              </span></div>
              {show("channel") && <div className="card-ch">
                <i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>
                <span>{channelLabel(t, c.acquisitionChannel)}</span>
              </div>}
              {show("project") && <p className="card-project">{c.project}</p>}
              {show("location") && <p className="card-location">{c.location}</p>}
              {c.notes&&<p className="card-notes"><MessageSquare size={10}/>{c.notes.slice(0,40)}{c.notes.length>40?"...":""}</p>}
              {show("operation") && <strong className="card-op">{c.operationToTake}</strong>}
              {(show("firstContact") || show("secondContact")) && (
                <footer className="card-contacts">
                  {show("firstContact") && <span className="muted">{t("card.first")}: {c.firstContactPerson || "—"}</span>}
                  {show("secondContact") && <span className="muted">{t("card.second")}: {c.secondContactPerson || "—"}</span>}
                </footer>
              )}
              <div className="card-status-wrap">
                <StatusPill status={c.status} t={t} />
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (<label className={wide?"field field-wide":"field"}><span>{label}</span>{children}</label>);}

