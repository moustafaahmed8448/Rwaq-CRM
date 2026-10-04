"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download, Grid2X2,
  LayoutDashboard, Pencil, Plus, Search, Trash2, UsersRound, X as XIcon,
  Check, AlertCircle, MessageSquare, Filter, Archive, Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ClientDetailPanel from "@/components/ClientDetailPanel";
import { useLang } from "@/lib/i18n";
import { canWrite } from "@/lib/auth";
import { apiErrorMessage, readApiError } from "@/lib/api-errors";
import {
  PIPELINE_STAGES,
  PREDEFINED_STATUSES,
  PERIOD_KINDS,
  channelLabel,
  classifyStatusWith,
  BUILTIN_LOCATION_KEYS,
  locationLabel,
  redundantBuiltinChannels,
  statusLabel,
  type PeriodKind,
  type StatusBuckets,
} from "@/lib/reporting";
import { downloadFile, exportQuery, EXPORT_FAILED } from "@/lib/download";
import { dateInputValue, isOverdue, localDayKey, num, sar, dateLocale } from "@/lib/format";
import { useLogo } from "@/lib/logo";
import StatusPill, { StatusDot } from "@/components/StatusPill";
import RefPicker from "@/components/RefPicker";
import MultiSelect from "@/components/MultiSelect";
import Select from "@/components/Select";
import ImportClientsModal from "@/components/ImportClientsModal";
import DashboardCharts, { type ChartView, type TrendPoint } from "@/components/DashboardCharts";
import {
  initialFilters,
  SORT_LABELS,
  type Client,
  type DatePreset,
  type Filters,
  type SortField,
  type TFn,
} from "@/lib/client-types";
import ColumnPicker from "@/components/ColumnPicker";
import ClientFilterBar from "@/components/ClientFilterBar";
import ClientTable from "@/components/ClientTable";
import { useOptionColors } from "@/lib/option-colors";
import { optionColor } from "@/lib/ref-options";
import {
  CLIENT_COLUMNS,
  type ColumnKey, type ResolvedColumn,
} from "@/lib/client-columns";
import { useColumnLayout } from "@/lib/use-column-layout";

type Metric = { channel: string; platform: string; spend: number; reach: number; totalClients: number; won: number; lost: number; waiting: number; cpa: number };
type User = { name: string; initials: string; role: string };
type EditDraft = Partial<Client> & { id: string };
type ConfirmDelete = { ids: string[]; names: string[] };
type Toast = { id: number; type: "success" | "error" | "info"; message: string };
/** One salesperson's outcome breakdown for a single contact role. */
type SpRow = { name: string; won: number; lost: number; waiting: number; other: number; total: number; winRate: number | null };

const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
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
 * The first day of a window that INCLUDES today and spans `n` days.
 *
 * Returns `n-1` days back, not `n`. This is inclusive of today, so "last 30 days"
 * means today plus the 29 days before it — a 30-day span. Passing `n` here would
 * silently produce a 31-day window, and that is exactly the bug this replaced:
 * the clients page counted 208 for "Last 30 days" while the dashboard, using
 * `rollingWindow()` in reporting.ts, counted 201 for the same label. Both were
 * labelled identically and meant different spans.
 *
 * Kept as a named helper so the two pages cannot drift apart again.
 */
const rollingStart = (n: number): string => daysAgo(n - 1);

/**
 * Recent-date presets.
 *
 * A FACTORY, not a module constant: the old version computed these once at
 * import, so a tab left open overnight kept offering yesterday's dates.
 *
 * "This week" was removed from this list — "Last 7 days" covers the same ground
 * and the rolling set reads more consistently.
 */
const buildDatePresets = (): DatePreset[] => {
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const firstOfYear = new Date();
  firstOfYear.setMonth(0, 1);

  // No "This week": "Last 7 days" covers the same ground and the rolling set
  // reads more consistently. The Monday computation that backed it is gone, so
  // there is no longer a way for this page and the dashboard to disagree about
  // where a week starts — they no longer offer one.
  //
  // Rolling windows go through rollingStart() so their span matches the
  // dashboard's `rollingWindow()` for the same label. The calendar ones
  // (This month, This year) are unaffected: they are bounded by the month or
  // year, not by a day count.
  return [
    { label: "date.today", startDate: localDay(new Date()) },
    { label: "date.last3", startDate: rollingStart(3) },
    { label: "date.last7", startDate: rollingStart(7) },
    { label: "date.last14", startDate: rollingStart(14) },
    { label: "date.last30", startDate: rollingStart(30) },
    { label: "date.last90", startDate: rollingStart(90) },
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



/**
 * Renders a stored follow-up timestamp as the `YYYY-MM-DD` a date input wants.
 *
 * Thin alias over `dateInputValue` in lib/format, kept as a named local so the
 * form reads in domain terms rather than in formatting-library terms.
 */
function followUpInput(value?: string | null): string {
  return dateInputValue(value);
}

/** Shortcuts offered beside the date input. Days are offsets from today. */
const followUpPresets = [
  { days: 1, key: "followUp.in1Day" },
  { days: 3, key: "followUp.in3Days" },
  { days: 7, key: "followUp.in7Days" },
  { days: 30, key: "followUp.in30Days" },
] as const;

function matchesFilters(client: Client, filters: Filters) {
  /**
   * The client's registration day in the LOCAL calendar.
   *
   * This used to be `client.createdAt.slice(0, 10)`, which slices the UTC ISO
   * string — so it read the UTC day, while the server filtered on local midnight
   * (`startOfLocalDay`). East of Greenwich those disagree for anything created
   * between 00:00 and the local offset: at UTC+3 the header showed 195 clients for
   * "last 30 days" while the paged table counted 202, from the same filter on the
   * same screen. The server's reading is the correct one (a timestamp's day
   * should be the user's day), so the browser is corrected to match it.
   */
  const date = client.createdAt ? localDay(new Date(client.createdAt)) : "";
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
    matchesFollowUp(client.nextFollowUpAt, filters.followUp) &&
    haystack.includes(norm(filters.query));
}

/**
 * The browser-side twin of the `followUp` clause in `clientWhere`.
 *
 * Present so the KANBAN board — which filters `clients` in memory rather than
 * paging from the API — shows the same set as the table. Both sides compare
 * whole DAYS, via the shared `isOverdue` / `dateInputValue` helpers, so "overdue"
 * means the same thing in each.
 */
function matchesFollowUp(value: string | null | undefined, bucket: string): boolean {
  if (!bucket) return true;
  const key = dateInputValue(value);
  const today = localDayKey(new Date());
  const tomorrow = localDayKey(new Date(Date.now() + 86400000));
  switch (bucket) {
    case "overdue": return key !== "" && key < today;
    case "today": return key === today;
    case "upcoming": return key !== "" && key >= tomorrow;
    case "none": return key === "";
    default: return true;
  }
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
  /**
   * How many clients each follow-up bucket holds in this book.
   *
   * Deliberately SCOPE-level, not filter-level: these describe the clients on
   * screen before any other chip is applied, and they do not move as the other
   * filters change. That is what makes them useful — a badge that recounted
   * itself every time you touched a status filter would be noise. Counted by the
   * API from the same `clientWhere` the table filters with, so they cannot
   * disagree with the rows.
   */
  const [followUpCounts, setFollowUpCounts] = useState<Record<string, number>>({});
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
  // "all" by default: the dashboard should open on the whole history rather
  // than silently showing one week.
  const [periodKind, setPeriodKind] = useState<PeriodKind>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [periodLoading, setPeriodLoading] = useState(false);
  /**
   * Dashboard narrowing by status / channel / location — the same three groups
   * the clients page offers, and deliberately a SEPARATE state from `filters`
   * above. The clients table has its own filter set; sharing one would mean
   * filtering a dashboard panel also silently refiltered the clients table and
   * changed the table's page count out from under the user.
   *
   * These intersect with the period rather than replacing it.
   */
  const [dashFilters, setDashFilters] = useState<{ status: string[]; channel: string[]; location: string[] }>({
    status: [], channel: [], location: [],
  });
  const setDashFilter = (key: "status" | "channel" | "location", values: string[]) =>
    setDashFilters((cur) => ({ ...cur, [key]: values }));
  const clearDashFilters = () => setDashFilters({ status: [], channel: [], location: [] });
  const dashFilterCount = dashFilters.status.length + dashFilters.channel.length + dashFilters.location.length;
  // `other` counts clients whose status sits outside the built-in pipeline
  // (a user-defined status). Without it the three outcome cards silently
  // summed to less than the client count.
  const [periodInfo, setPeriodInfo] = useState({ from: "", to: "", campaignCount: 0, campaignNames: [] as string[], totals: { total: 0, won: 0, lost: 0, waiting: 0, other: 0 } });
  // Period-scoped per-status / location / channel counts. Without these the stage
  // panel, funnel and location bars were recomputed in the browser from every
  // client, so "this week" moved the KPI cards and left the rest on all time.
  const [periodBreakdowns, setPeriodBreakdowns] = useState<
    | {
        statusCounts?: Record<string, number>;
        locationCounts?: Record<string, number>;
        channelCounts?: Record<string, number>;
        totals?: { total: number; won: number; lost: number; waiting: number; other: number };
      }
    // undefined until the first analytics response lands; the Dashboard falls
    // back to all-time counts so the panels are never blank on first paint.
    | undefined
  >(undefined);
  // Per-salesperson outcome report, split by contact role. Server-computed and
  // period-scoped, so it agrees with the KPI cards above it.
  const [spReports, setSpReports] = useState<{ first: SpRow[]; second: SpRow[] }>({ first: [], second: [] });
  /* The admin's status -> bucket assignments, as resolved by the analytics route.
     Held in state rather than re-fetched so the funnel and stage panel describe
     exactly the same window and the same buckets as the KPI cards above them. */
  const [statusBuckets, setStatusBuckets] = useState<StatusBuckets>({});
  /* The comparison window's figures, for the KPI deltas. Null under "all time",
     which is what makes every card show a dash instead of a fake 0%. */
  const [previous, setPrevious] = useState<{
    from: string; to: string;
    totals: { total: number; won: number; lost: number; waiting: number; other: number };
    spend: number; reach: number;
  } | null>(null);
  // Outcome-split time series for the dashboard chart, from the same response.
  const [timeline, setTimeline] = useState<TrendPoint[]>([]);
  // Which chart the dashboard shows. Lifted here so the choice survives the
  // dashboard remounting when the period changes.
  const [chartView, setChartView] = useState<ChartView>("trend");
  /* `avatar` is in the type because /api/users has always returned it and the
     dashboard already fetches that response for the client table's contact
     options — the panel below was just discarding the field and drawing
     initials for reps whose photo the rest of the app was showing. */
  const [users, setUsers] = useState<{ username: string; name: string; role: string; avatar?: string | null }[]>([]);
  /* Rep name -> photo, for the Sales Performance rows. Those rows are keyed by
     the assignee name on each client (see the analytics route), so the display
     name is the only thing they share with a user record — which is also how the
     lookup is done. Names without a stored photo are simply absent, and the panel
     falls back to initials exactly as before. */
  const userAvatars = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of users) if (u.avatar) map[u.name] = u.avatar;
    return map;
  }, [users]);
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
  // signed-in user's layout arrives. The debounced save chain lives in
  // use-column-layout so /profile and /marketing cannot drift from it.
  const { columns, commit: commitColumns, hydrate } = useColumnLayout(CLIENT_COLUMNS, "clientColumns");
  // Admin-set option colours, shared module-wide so every pill, dot and tag in
  // this file resolves the same value without prop-drilling them down.
  const colors = useOptionColors();
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  /**
   * Re-reads the client list and the reference data after an import.
   *
   * The import creates clients AND appends to the shared status/channel/location
   * lists, so all four endpoints are refreshed; leaving the pickers stale would
   * hide values that are now in use.
   */
  const refreshAfterImport = (result: { imported: number; updated: number }) => {
    const { imported, updated } = result;
    const total = imported + updated;
    addToast(
      total > 0 ? "success" : "info",
      t(total > 0 ? "importer.doneMixed" : "importer.doneNone", { a: imported, b: updated }),
    );
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
  const [bulkBusy, setBulkBusy] = useState(false);
  const [newClient] = useState<Partial<Client>>({
    name: "", phoneNumber: "", project: "", location: "",
    acquisitionChannel: "FACEBOOK", operationToTake: "",
    firstContactPerson: "", secondContactPerson: "", status: "WAITING", notes: "",
  });
  const tableRef = useRef<HTMLDivElement>(null);

  // Stable via useCallback: `addToast` was a plain function, so it got a new
  // identity every render. Anything memoised against it (selectAllMatching) then
  // re-created every render too, which the compiler rejects as unpreservable
  // memoization — and it would have re-fetched the id list on every keystroke.
  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId;
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then(async r => { if (!r.ok) { router.replace("/login"); return null; } return r.json(); }).then(d => {
      if (!d?.user) return;
      setUser(d.user);
      // Adopt the signed-in user's saved column layout. The demo session has no
      // row, so it keeps the registry defaults.
      if (d.user.clientColumns) hydrate(d.user.clientColumns);
    });
    // `hydrate` is a stable useCallback (its only dep is the module-level
    // registry), so listing it costs nothing and keeps the lint honest.
  }, [router, hydrate]);

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
    Promise.all([fetch("/api/crm/clients?followUpCounts=1"), fetch("/api/users")])
      .then(async ([c, u]) => {
        if (!c.ok) throw new Error("Unable to load workspace");
        return Promise.all([c.json(), u.json()]);
      })
      .then(([crm, usersData]) => {
        setClients(crm.clients || []);
        setUsers(usersData.users ?? []);
        setFollowUpCounts(crm.followUpCounts ?? {});
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
    // Dashboard narrowing, sent only when non-empty so an unfiltered group adds
    // no query key at all. These INTERSECT with the period above rather than
    // replacing it, so "Last 30 days + LOST" is LOST clients from that window.
    if (dashFilters.status.length > 0) params.set("statuses", dashFilters.status.join(","));
    if (dashFilters.channel.length > 0) params.set("channels", dashFilters.channel.join(","));
    if (dashFilters.location.length > 0) params.set("locations", dashFilters.location.join(","));
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
        // Same response carries the breakdowns that scope the stage panel, funnel
        // and location bars to the selected window.
        setPeriodBreakdowns({
          statusCounts: d.statusCounts,
          locationCounts: d.locationCounts,
          channelCounts: d.channelCounts,
          totals: d.totals,
        });
        // Same response carries the per-salesperson breakdown, so the sales
        // performance panel is always the selected period rather than all time.
        setSpReports({
          first: d.firstSalespersonReport ?? [],
          second: d.secondSalespersonReport ?? [],
        });
        // Coerced server-side, so anything invalid was already dropped. Guarded
        // here too because `statusBuckets` drives which clients land in which KPI
        // card: an unexpected shape must degrade to the built-in pipeline, never
        // to a thrown render.
        setStatusBuckets(d.statusBuckets && typeof d.statusBuckets === "object" ? d.statusBuckets : {});
        // Null under "all time" — the API omits the comparison window there.
        setPrevious(d.previous ?? null);
        setTimeline(d.timeline ?? []);
      })
      .catch(() => undefined)
      .finally(() => setPeriodLoading(false));
  }, [user, periodKind, customFrom, customTo, dashFilters.status, dashFilters.channel, dashFilters.location]);

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

  /* ── Paged table rows ────────────────────────────────────────────────────
     `clients` stays the FULL list: the dashboard KPIs, funnel, stage panel and
     the salesperson reports are all derived from it, so paging that state would
     make every card describe one screen. The table therefore gets its own slice
     from ?paged=1, which is the only place that ever shows a subset.

     The two lists are deliberately separate rather than one list with an offset
     applied in JS — that is the whole point of the change. */
  const [tableRows, setTableRows] = useState<Client[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageCount, setTablePageCount] = useState(1);
  const [tableLoading, setTableLoading] = useState(false);
  const PAGE_SIZE = 25;

  /**
   * Builds the table query from the same filter state the client-side matcher
   * uses, so the two can never disagree about what is being shown. Debounced by
   * the caller for the search box only; the dropdowns fire immediately.
   */
  const tableQuery = useMemo(() => {
    // Stringified rather than returning the params object: the effect below
    // depends on this value, and a fresh URLSearchParams every render would
    // defeat the memo and refetch the table on every keystroke elsewhere.
    const params = new URLSearchParams({ paged: "1", pageSize: String(PAGE_SIZE) });
    if (filters.query) params.set("q", filters.query);
    if (filters.status.length) params.set("status", filters.status.join(","));
    if (filters.channel.length) params.set("channel", filters.channel.join(","));
    if (filters.location.length) params.set("location", filters.location.join(","));
    if (filters.firstContact.length) params.set("firstContact", filters.firstContact.join(","));
    if (filters.secondContact.length) params.set("secondContact", filters.secondContact.join(","));
    if (filters.followUp) params.set("followUp", filters.followUp);
    if (filters.startDate) params.set("from", filters.startDate);
    if (filters.endDate) params.set("to", filters.endDate);
    params.set("sort", sortBy);
    return params.toString();
  }, [filters, sortBy]);

  /**
   Fetches one page of the table. Takes the page number as an argument rather
   than reading `tablePage` from a closure, so the fetch effect below can depend
   on it without re-creating itself (which is what broke memoization before).
   */
  const loadTable = useCallback(async (page: number, query: string) => {
    setTableLoading(true);
    try {
      const res = await fetch(`/api/crm/clients?${query}&page=${page}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json() as {
        clients?: Client[];
        total?: number;
        page?: number;
        pageCount?: number;
      };
      setTableRows(d.clients ?? []);
      setTableTotal(d.total ?? 0);
      setTablePage(d.page ?? page);
      setTablePageCount(d.pageCount ?? 1);
    } catch {
      // Leave the previous page on screen rather than blanking the table: a
      // failed refresh should not look like "no clients match".
    } finally {
      setTableLoading(false);
    }
  }, [setTablePage]);

  /**
   * Single fetch for the table: page + filters + sort in one dependency list.
   *
   * These used to be two effects — one for "filters changed, go to page 1" and
   * one for "page changed, fetch" — which meant a setState inside an effect to
   * reset the page, and a window where neither matched. Filtering straight to
   * page 1 here means there is exactly one transition to reason about.
   *
   * Every state write happens after `await`, inside the promise, so none of them
   * runs synchronously during the effect body and none can cascade a render.
   * Flagged for the same reason as the period-summary effect further down.
   */
  useEffect(() => {
    if (!user || view !== "clients") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTable(tablePage, tableQuery);
  }, [user, view, tablePage, tableQuery, loadTable]);

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

  /**
   * Opens the clients view narrowed to one follow-up bucket.
   *
   * Clears the OTHER follow-up filter rather than just setting the new one, and
   * leaves every other filter alone: "show me what is overdue" should not quietly
   * discard the status or channel the user had narrowed to, but two contradictory
   * follow-up buckets would be a view with no rows and no obvious cause.
   */
  const showFollowUp = (bucket: string) => {
    setView("clients");
    setTablePage(1);
    setFilters(cur => ({ ...cur, followUp: bucket }));
  };

  const updateFilter = (key: "query" | "startDate" | "endDate", value: string) => {
    // Any filter change restarts at page 1: staying on page 7 of a now much
    // smaller result set shows an empty table and reads as a bug.
    setTablePage(1);
    setFilters(cur => ({ ...cur, [key]: value }));
    if (key !== "query") setActiveDatePreset(null);
  };

  // Re-ordering while on page 7 of 14 would keep the offset, which is rarely
  // what you want after a sort change — page 1 of the new order is.
  const handleSortBy = (s: SortField) => {
    setTablePage(1);
    setSortBy(s);
  };

  const setMultiFilter = (key: "status" | "channel" | "location" | "firstContact" | "secondContact", values: string[]) => {
    setTablePage(1);
    setFilters(cur => ({ ...cur, [key]: values }));
  };

  // The follow-up bucket is a single value, not a list, so it gets its own setter
  // rather than being forced through setMultiFilter.
  const setFollowUpFilter = (value: string) => {
    setTablePage(1);
    setFilters(cur => ({ ...cur, followUp: cur.followUp === value ? "" : value }));
  };

  const clearAllFilters = () => {
    setTablePage(1);
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
    (filters.followUp ? 1 : 0) +
    (filters.startDate ? 1 : 0) + (filters.endDate ? 1 : 0) + (filters.query ? 1 : 0);

  const allStatuses = [...PREDEFINED_STATUSES, ...customStatuses.filter(s => !PREDEFINED_STATUSES.includes(s))];
  /**
   * Channel options for the filter bar.
   *
   * Built-in channels are only offered while no custom channel already stands in
   * for them under the same label. Without this the list showed two "Sales"
   * rows — the built-in `SALES` and the workspace's custom `المبيعات` — and
   * choosing the built-in one silently matched nothing, because no client stores
   * that value. Only genuinely-unused duplicates are dropped; a built-in that
   * clients actually use is always kept.
   */
  const allChannels = [
    ...CHANNEL_VALUES.filter(ch => !redundantBuiltinChannels(CHANNEL_VALUES, clients.map(c => c.acquisitionChannel), v => channelLabel(t, v)).includes(ch)),
    ...customChannels.filter(ch => !CHANNEL_VALUES.includes(ch as typeof CHANNEL_VALUES[number])),
  ];
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
    // Re-read the reference data rather than clearing it. These used to
    // `setRemovableLocations([])` / `setLocationUsage({})`, which made the
    // trash icon vanish for EVERY remaining option after the first delete (the
    // picker only offers delete for values in `removable`) and blanked the usage
    // counts. The endpoint now returns all three fields on DELETE, so one
    // response restores the whole state.
    setCustomLocations(r.locations ?? []);
    setRemovableLocations(r.removable ?? []);
    setLocationUsage(r.usage ?? {});
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
    // Same fix as removeLocation: keep the removable list and usage map so the
    // remaining options stay deletable and keep their counts.
    setCustomChannels(r.channels ?? []);
    setRemovableChannels(r.removable ?? []);
    setChannelUsage(r.usage ?? {});
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
    // The local client list decides which channels to show. Reads the FULL list
    // for the same reason <Dashboard clients={...}> does: a clients-page filter
    // must not change which channels the dashboard considers active.
    inUse: clients.some(c => c.acquisitionChannel === metric.channel),
  })), [metrics, clients]);

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
      /* The response is checked, which it was not: a failed PATCH used to close
         the dialog and toast "Saved" anyway, so a rejected field (a bad date, a
         read-only role, a 500) looked identical to a successful save and the edit
         vanished with no way to tell what went wrong. */
      const res = await fetch("/api/crm/clients", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editDraft),
      });
      if (!res.ok) {
        addToast("error", apiErrorMessage(t, await readApiError(res)));
        return;
      }
      setClients(prev => prev.map(c => c.id === editDraft.id ? { ...c, ...editDraft, lastUpdateDate: new Date().toISOString() } : c));
      if (detailClient?.id === editDraft.id) setDetailClient(prev => prev ? { ...prev, ...editDraft } : null);
      closeEdit();
      addToast("success", t("clients.savedToast", { name: editDraft.name ?? "" }));
      return;
    }

    const res = await fetch("/api/crm/clients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      /* `nextFollowUpAt` was missing from this list, so the follow-up date a user
         picked when ADDING a client was silently dropped on the floor — the server
         accepted it all along, the browser just never sent it. With 0 of 343 clients
         carrying a date, the four follow-up filter chips had nothing to match and
         "Overdue / Due today / Upcoming" all read as broken filters. */
      body: JSON.stringify({
        name: editDraft.name, phoneNumber: editDraft.phoneNumber, status: editDraft.status,
        project: editDraft.project, location: editDraft.location, acquisitionChannel: editDraft.acquisitionChannel,
        operationToTake: editDraft.operationToTake, firstContactPerson: editDraft.firstContactPerson,
        secondContactPerson: editDraft.secondContactPerson, notes: editDraft.notes,
        nextFollowUpAt: editDraft.nextFollowUpAt ?? null,
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

  /**
   * Moves every selected client to one status, in a single request.
   *
   * One call with an `ids` array, not a loop of single-client PATCHes: the
   * server runs the batch inside one transaction, so a partial failure cannot
   * leave half the selection moved. The client list is patched locally from the
   * status the user chose rather than re-fetching, because the response reports
   * counts and not rows — re-fetching a 25-row page to redraw 25 pills is a
   * visible flash for no information.
   */
  const bulkSetStatus = async (status: string) => {
    // Guards a double-click firing two batches. The trigger's value resets to ""
    // after a pick, so without this the same status could be submitted twice.
    if (bulkBusy) return;
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const res = await fetch("/api/crm/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status }),
    }).catch(() => null);
    setBulkBusy(false);
    if (!res || !res.ok) {
      addToast("error", apiErrorMessage(t, res ? await readApiError(res) : undefined));
      return;
    }
    const d = (await res.json().catch(() => ({}))) as { updated?: number; skipped?: number };
    const stamp = new Date().toISOString();
    setClients(prev => prev.map(c => (selectedIds.has(c.id) ? { ...c, status, lastUpdateDate: stamp } : c)));
    setTableRows(prev => prev.map(c => (selectedIds.has(c.id) ? { ...c, status, lastUpdateDate: stamp } : c)));
    setSelectedIds(new Set());
    refreshNotifications();
    // "skipped" carries two different causes (gone vs already on that status),
    // so the message reports the moved count and says plainly that the rest did
    // not change rather than inventing a reason.
    addToast("success", (d.skipped ?? 0) > 0
      ? t("clients.bulkStatusMixed", { n: d.updated ?? 0, skipped: d.skipped ?? 0 })
      : t("clients.bulkStatusDone", { n: d.updated ?? 0 }));
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

  /**
   * Selects (or clears) every row ON THE CURRENT PAGE.
   *
   * This used to select from `filteredClients` — the whole filtered book — while
   * the table renders `tableRows`, one page of 25. So ticking the header box
   * appeared to leave rows unticked, and the "N selected" count jumped to numbers
   * that were not on screen. Selection now means "what you can see".
   */
  const toggleSelectAll = () => {
    const visible = tableRows.map((c) => c.id);
    const allVisibleSelected = visible.length > 0 && visible.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((id) => next.delete(id));
      else visible.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  /**
   * Selects EVERY client the current filter matches, across all pages.
   *
   * The header checkbox covers the visible page only. This is the escape hatch for
   * "archive everything from the last 30 days", which otherwise means paging
   * through 9 screens by hand.
   *
   * Ids are fetched with `idsOnly=1` — the point is to tick boxes, not to
   * download 200 client records with their activity logs.
   */
  const selectAllMatching = async () => {
    const res = await fetch(`/api/crm/clients?${tableQuery}&idsOnly=1`, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      addToast("error", t("clients.selectAllFailed"));
      return;
    }
    const d = await res.json() as { ids?: string[] };
    setSelectedIds(new Set(d.ids ?? []));
  };

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

  /**
 * Dashboard "Export report" — its own query, NOT the clients table's.
 *
 * This used to alias `exportExcel()`, which builds its query from `filters.*`
 * — the clients TABLE's filter state. So the button exported whatever the table
 * happened to be filtered to and ignored the dashboard's own status/channel/
 * location selections entirely. The two filter sets are deliberately separate
 * (so filtering a dashboard panel never refilters the table), which made that
 * alias wrong by construction.
 *
 * Dates come from `periodInfo`, which the analytics response already resolved
 * from the selected preset, so the export cannot describe a different window
 * than the panels above it.
 */
const exportDashboard = () => {
  void exportClientsFile(
    {
      statuses: dashFilters.status.join(","),
      channels: dashFilters.channel.join(","),
      locations: dashFilters.location.join(","),
      from: periodInfo.from,
      to: periodInfo.to,
    },
    `rwaq-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`,
    t("clients.exportedToast", { n: periodInfo.totals.total }),
  );
};

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
          // The options page is a separate route, not a view of this one — the
          // final `else` used to swallow it and land on Settings instead.
          else if (tab === "options") router.push("/options");
          else router.push("/settings");
        }}
      />

      <div className="content">
        {view === "dashboard" ? (
          <Dashboard
            metrics={visibleMetrics} totalSpend={totalSpend} totalReach={totalReach}
            won={won} lost={lost} waiting={waiting} unclassified={unclassified}
            // The UNFILTERED list, deliberately: this used to be `filteredClients`,
            // which meant a search or status filter set on the clients page silently
            // re-sculpted the dashboard's cards, funnel and charts. The clients
            // filter bar belongs to the clients table; the dashboard has its own
            // reporting-period control, and the two must not bleed into each other.
            clients={clients}
            salespeople={salespeople}
            spReports={spReports}
userAvatars={userAvatars}
            timeline={timeline}
            chartView={chartView}
            onChartViewChange={setChartView}
            updateStatus={updateStatus} updateClientField={updateClientField}
            allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations}
            onAddStatus={addStatus} onAddChannel={addChannel} onAddLocation={addLocation}
            onExport={exportDashboard} exporting={exporting}
            scoped={isScoped}
            onToggleStageFilter={toggleStageFilter}
            periodKind={periodKind}
            periodInfo={periodInfo}
            statusBuckets={statusBuckets}
            previous={previous}
            onShowFollowUp={showFollowUp}
            /* Rep names in Sales Performance open that person's profile. Encoded
               because the names are Arabic — an unencoded space or any reserved
               character would truncate or reshape the query. */
            onOpenProfile={(name) => router.push(`/profile?user=${encodeURIComponent(name)}`)}
            periodBreakdowns={periodBreakdowns}
            onPeriodChange={setPeriodKind}
            onCustomRange={(f, to) => { setCustomFrom(f); setCustomTo(to); }}
            customFrom={customFrom}
            customTo={customTo}
            periodLoading={periodLoading}
            dashFilters={dashFilters}
            setDashFilter={setDashFilter}
            clearDashFilters={clearDashFilters}
            dashFilterCount={dashFilterCount}
            /* Clicking a name in "Recent clients" opens the SAME slide-in panel
               the clients table opens. The panel is rendered by Home outside the
               `view === "dashboard"` branch, so no extra state or markup is
               needed — only this wiring. */
            onOpenDetail={openDetail}
            t={t}
          />
        ) : (
          <ClientsView
            clients={mode === "table" ? tableRows : filteredClients} allClients={clients} mode={mode} setMode={setMode}
            filters={filters} updateFilter={updateFilter}
            setMultiFilter={setMultiFilter}
            clearAllFilters={clearAllFilters}
            updateStatus={updateStatus} updateClientField={updateClientField}
            firstContacts={firstContacts} secondContacts={secondContacts}
            sortBy={sortBy} setSortBy={handleSortBy}
            columns={columns} onColumnsChange={commitColumns} rtl={rtl}
            onAssigned={refreshNotifications}
            selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
            onClearSelection={clearSelection} onSelectAllMatching={() => void selectAllMatching()}
            onOpenEdit={openEdit} onOpenCreate={openCreate} onOpenImport={() => setImporting(true)} onOpenDelete={(ids: string[], names: string[]) => setConfirmDelete({ ids, names })}
            onOpenDetail={openDetail}
            exportExcel={exportExcel} exportSelected={exportSelected}
            bulkCount={selectedIds.size}
            isAdmin={user.role === "Admin"}
            canEdit={canEdit}
            onArchive={archiveClient}
            onArchiveSelected={archiveSelected}
            onBulkStatus={bulkSetStatus}
            onSetFollowUp={setFollowUpFilter}
      followUpCounts={followUpCounts}
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
            pager={{ page: tablePage, pageCount: tablePageCount, total: tableTotal, loading: tableLoading, onPage: setTablePage, t }}
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
                  <RefPicker kind="locations" value={editDraft.location ?? ""} options={allLocations} onAdd={addLocation} onChange={v => setEditDraft({ ...editDraft, location: v })} render={v => locationLabel(t, v)} onRemove={user.role === "Admin" ? removeLocation : undefined} removable={removableLocations} removeUsage={locationUsage} placeholder={t("form.locationPh")} t={t} />
                </Field>
                <Field label={t("form.channel")}>
                  <RefPicker kind="channels" value={editDraft.acquisitionChannel ?? ""} options={allChannels} onAdd={addChannel} onChange={v => setEditDraft({ ...editDraft, acquisitionChannel: v })} render={v => channelLabel(t, v)} onRemove={user.role === "Admin" ? removeChannel : undefined} removable={removableChannels} removeUsage={channelUsage} placeholder={t("form.channelPh")} t={t} />
                </Field>
                <Field label={t("form.status")}>
                  {/* Delete was never wired here, so no trash icon ever rendered
                      for a custom status. Now matches the location and channel
                      pickers above: admin only, saved values only, unused only. */}
                  <RefPicker kind="statuses" value={editDraft.status ?? ""} options={allStatuses} onAdd={addStatus} onChange={v => setEditDraft({ ...editDraft, status: v })} render={v => statusLabel(t, v)} onRemove={user.role === "Admin" ? removeStatus : undefined} removable={removableStatuses} removeUsage={statusUsage} placeholder={t("form.statusPh")} t={t} />
                </Field>
                <Field label={t("form.firstContact")}>
                  <Select
                    value={editDraft.firstContactPerson ?? ""}
                    /* "" stays in the list so an assigned contact can be
                       un-assigned again — a trigger-only placeholder would
                       offer no way back once a name was picked. */
                    options={["", ...users.map(u => u.name)]}
                    onChange={v => setEditDraft({ ...editDraft, firstContactPerson: v })}
                    render={v => (v === "" ? t("form.unassigned") : v)}
                    t={t}
                  />
                </Field>
                <Field label={t("form.secondContact")}>
                  <Select
                    value={editDraft.secondContactPerson ?? ""}
                    options={["", ...users.map(u => u.name)]}
                    onChange={v => setEditDraft({ ...editDraft, secondContactPerson: v })}
                    render={v => (v === "" ? t("form.noneOption") : v)}
                    t={t}
                  />
                </Field>
                <Field label={t("form.operation")} wide><input value={editDraft.operationToTake ?? ""} onChange={e => setEditDraft({ ...editDraft, operationToTake: e.target.value })} placeholder={t("form.operationPh")} /></Field>
                <Field label={t("form.notes")} wide><textarea value={editDraft.notes ?? ""} onChange={e => setEditDraft({ ...editDraft, notes: e.target.value })} rows={3} placeholder={t("form.notesPh")} /></Field>
                {/* WHEN to chase, as opposed to `operationToTake` above which is WHAT to
                    do. Kept as two separate fields on purpose: overwriting free text with a
                    date picker would destroy the instruction it carries. Empty input writes
                    null, which is how a follow-up gets cleared. */}
                <Field label={t("form.nextFollowUp")} wide>
                  <div className="followup-field">
                    <input
                      type="date"
                      value={followUpInput(editDraft.nextFollowUpAt)}
                      onChange={e => setEditDraft({ ...editDraft, nextFollowUpAt: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })}
                    />
                    {/* Quick presets, because typing a date three days out is the most common
                        case by far and a date input is the slowest way to express it. */}
                    <div className="followup-presets">
                      {followUpPresets.map(p => (
                        <button key={p.days} type="button" className="btn-ghost btn-sm" onClick={() => setEditDraft({ ...editDraft, nextFollowUpAt: new Date(Date.now() + p.days * 86400000).toISOString() })}>
                          {t(p.key)}
                        </button>
                      ))}
                      {editDraft.nextFollowUpAt && (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditDraft({ ...editDraft, nextFollowUpAt: null })}>
                          {t("common.clear")}
                        </button>
                      )}
                    </div>
                  </div>
                </Field>
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

      {/* Client Detail Side Panel. Shared with the archived page so both routes
          show exactly the same panel; the handlers it is given are what decide
          which action buttons appear. */}
      {detailClient && (
        <ClientDetailPanel
          client={detailClient}
          onClose={closeDetail}
          onEdit={canEdit ? () => { openEdit(detailClient); closeDetail(); } : undefined}
          onDelete={user.role === "Admin" ? () => { closeDetail(); setTimeout(() => setConfirmDelete({ ids: [detailClient.id], names: [detailClient.name] }), 200); } : undefined}
          onArchive={user.role === "Admin" ? () => { closeDetail(); archiveClient(detailClient.id); } : undefined}
          /* Coloured from the registry, not a per-status CSS class:
             .status-select.waiting never matched `status-no_response`, so every
             new stage rendered as a bare unstyled select. */
          statusControl={canEdit ? (
            <Select
              value={detailClient.status}
              options={allStatuses}
              onChange={v => updateStatus(detailClient.id, v)}
              render={v => statusLabel(t, v)}
              className="status-select"
              style={{
                background: optionColor("statuses", detailClient.status, colors) + "1f",
                color: optionColor("statuses", detailClient.status, colors),
              }}
              t={t}
              ariaLabel={t("form.status")}
            />
          ) : undefined}
          t={t}
          lang={lang}
        />
      )}

      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}><span>{t.message}</span></div>)}
      </div>
    </main>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function Dashboard({ metrics, totalSpend, totalReach, won, lost, waiting, unclassified, clients, salespeople, spReports, userAvatars, timeline, chartView, onChartViewChange, updateStatus, updateClientField, allStatuses, allChannels, allLocations, onAddStatus, onAddChannel, onAddLocation, onExport, exporting, scoped, onToggleStageFilter, periodKind, periodInfo, periodBreakdowns, onPeriodChange, onCustomRange, customFrom, customTo, periodLoading, dashFilters, setDashFilter, clearDashFilters, dashFilterCount, statusBuckets, previous, onShowFollowUp, onOpenDetail, onOpenProfile, t }: { metrics: Metric[]; totalSpend: number; totalReach: number; won: number; lost: number; waiting: number; unclassified: number; clients: Client[]; salespeople: string[]; spReports: { first: SpRow[]; second: SpRow[] };
  /** Rep display name -> stored photo, for the Sales Performance rows. */
  userAvatars: Record<string, string>; timeline: TrendPoint[]; chartView: ChartView; onChartViewChange: (v: ChartView) => void; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; allStatuses: string[]; allChannels: string[]; allLocations: string[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; onExport: () => void; exporting: boolean; scoped: boolean; onToggleStageFilter: (status: string) => void; periodKind: PeriodKind; periodInfo: { from: string; to: string; campaignCount: number; campaignNames: string[]; totals: { total: number; won: number; lost: number; waiting: number; other: number } };
  /**
   * Period-scoped per-status / per-location / per-channel counts, so the stage
   * panel, funnel, conversion rate and location bars describe the same window as
   * the KPI cards rather than all time.
   */
  periodBreakdowns?: { statusCounts?: Record<string, number>; locationCounts?: Record<string, number>; channelCounts?: Record<string, number>; totals?: { total: number; won: number; lost: number; waiting: number; other: number } };
  onPeriodChange: (k: PeriodKind) => void; onCustomRange: (from: string, to: string) => void; customFrom: string; customTo: string; periodLoading: boolean;
  /** Status/channel/location narrowing, applied on top of the period. */
  dashFilters: { status: string[]; channel: string[]; location: string[] };
  setDashFilter: (key: "status" | "channel" | "location", values: string[]) => void;
  clearDashFilters: () => void;
  dashFilterCount: number;
  /**
   * The admin's status -> bucket assignments from the Options page.
   *
   * The funnel and the fallbacks below must read these rather than the built-in
   * `stage.outcome`, otherwise reassigning a status on the Options page would
   * move the KPI cards but leave the funnel beside them unchanged — the two
   * panels describing the same window with different rules.
   */
  statusBuckets: StatusBuckets;
  /**
   * The comparison window's figures, or null under "all time".
   *
   * Null is meaningful, not missing: it tells the KPI cards there is nothing to
   * compare against, so they show a dash instead of a misleading 0%.
   */
  previous: {
    from: string; to: string;
    totals: { total: number; won: number; lost: number; waiting: number; other: number };
    spend: number; reach: number;
  } | null;
  /** Opens the same slide-in detail panel the clients table uses. */
  onOpenDetail: (c: Client) => void;
  /**
   * Opens `/profile?user=<name>` for one rep. Wired from `Home` so the dashboard
   * still owns no navigation state of its own, matching `onShowFollowUp`.
   */
  onOpenProfile: (name: string) => void;
  /**
   * Switches to the clients view with one follow-up bucket pre-selected. Wired
   * from `Home` so the dashboard owns no navigation state of its own.
   */
  onShowFollowUp: (bucket: string) => void;
  t: TFn }) {
  const recentClients = useMemo(() => [...clients].sort((a,b) => String(b.lastUpdateDate||"").localeCompare(String(a.lastUpdateDate||""))).slice(0,5), [clients]);
  // Same shared colour map the rest of the app resolves through.
  const colors = useOptionColors();

  /**
   * Counts for the panels that must agree with the KPI cards.
   *
   * The API returns these scoped to the selected period; the client-derived
   * versions describe all time. Picking "this week" used to move the seven cards
   * and leave the funnel, stage panel and location bars on the whole history, so
   * one screen showed two different periods side by side. These are the period's
   * numbers, falling back to the all-time computation only when the API has not
   * answered yet (first paint) so the panel is never blank.
   */
  const periodCounts = periodBreakdowns;
  const statusCountFor = (status: string): number =>
    periodCounts?.statusCounts?.[status] ?? 0;
  const locationEntries: Array<[string, number]> = useMemo(() => {
    const source: Array<[string, number]> = periodCounts?.locationCounts
      ? Object.entries(periodCounts.locationCounts)
      : (() => {
          const m = new Map<string, number>();
          clients.forEach((c) => m.set(c.location, (m.get(c.location) ?? 0) + 1));
          return [...m.entries()] as Array<[string, number]>;
        })();
    return source.sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [periodCounts, clients]);
  const periodTotal = periodCounts?.totals?.total ?? clients.length;

  // Which contact role the sales performance panel is reporting on. Defaults to
  // the 2nd contact: that is the number most reps could not previously see at
  // all, since the panel used to merge both roles into one list.
  const [spRole, setSpRole] = useState<"first" | "second">("second");
  const spRows = spReports[spRole];
  const { logo: heroLogo } = useLogo();

  // Status panel: every pipeline stage in registry order, followed by the
  // user-defined statuses created on the clients page. Without the second half,
  // a status added there never appeared on the dashboard at all.
  //
  // Counts come from the period-scoped map so the stage bars describe the same
  // window as the KPI cards; the all-time client list is only the fallback for
  // the first paint, before the analytics response has landed.
  const stageCounts = useMemo(() => {
    const stages = PIPELINE_STAGES.map((stage) => ({
      value: stage.value,
      // Through optionColor, not stage.color directly: an admin-set override has
      // to win here too, or the stage panel would ignore the options page while
      // the pill beside every client honoured it.
      color: optionColor("statuses", stage.value, colors),
      count: statusCountFor(stage.value),
    }));
    const custom = (allStatuses ?? [])
      .filter((value) => !PREDEFINED_STATUSES.includes(value))
      .map((value) => ({
        value,
        color: optionColor("statuses", value, colors),
        count: statusCountFor(value),
      }));
    return [...stages, ...custom];
  }, [allStatuses, colors, periodCounts]);

  // "Waiting" is the period total, so the funnel header and the KPI card it sits
  // beside cannot disagree.
  const inProgress = periodCounts?.totals?.waiting
    ?? clients.filter((c) => classifyStatusWith(c.status, statusBuckets) === "progress").length;

  // Funnel: the active pipeline (everything up to "Contracted"), each step
  // showing its pass rate from the previous one. "Final loss" is terminal and
  // sits outside the funnel, so it is reported separately below.
  const funnelStages = useMemo(() => {
    /* Which stages are terminal is itself admin-configurable: a status the
       Options page has filed as "lost" drops out of the funnel and into the
       final-loss figure, and one filed as "won" stays in as the last step. This
       used to read `s.outcome`, so the funnel was pinned to the built-in pipeline
       while the cards beside it followed the admin's choice. */
    const active = PIPELINE_STAGES.filter(
      (s) => classifyStatusWith(s.value, statusBuckets) !== "lost",
    );
    const counts = active.map((stage) => statusCountFor(stage.value));
    return active.map((stage, i) => ({
      stage,
      count: counts[i],
      // Pass rate is measured against the step above; the first step is measured
      // against the total, so it has no rate of its own.
      rate: i === 0 || counts[i - 1] === 0 ? null : Math.round((counts[i] / counts[i - 1]) * 100),
      entering: i === 0,
    }));
  }, [periodCounts, statusBuckets]);

  // Same window as the cards above it, so the headline rate is not an all-time
  // figure sitting under a weekly funnel.
  const wonInPeriod = periodCounts?.totals?.won
    ?? clients.filter((c) => classifyStatusWith(c.status, statusBuckets) === "won").length;
  const finalConversionRate = periodTotal > 0
    ? Math.round((wonInPeriod / periodTotal) * 100)
    : 0;

  /* Follow-up counts over the whole book, not the reporting period — see the
     strip's own comment. `isOverdue` and the "today" test are the same
     definitions `matchesFollowUp` uses, so the tile and the filter it opens can
     never disagree. */
  const overdueCount = useMemo(() => clients.filter(c => isOverdue(c.nextFollowUpAt)).length, [clients]);
  const dueTodayCount = useMemo(() => {
    const today = localDayKey(new Date());
    return clients.filter(c => dateInputValue(c.nextFollowUpAt) === today).length;
  }, [clients]);

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div>
          {heroLogo && <img src={heroLogo} alt={t("brand.logoAlt")} className="hero-logo" />}
          {/* The h1 headline and its subtitle were removed at the user's request;
              the logo and this small eyebrow label are what remain. The i18n keys
              `dash.heroTitle` / `dash.heroSubtitle` are left in place deliberately:
              the dictionary is checked for key parity against work/keys.txt, and
              two unused strings cost nothing. */}
          <span className="dashboard-eyebrow">{t("dash.heroEyebrow")}</span>
        </div>
        <div className="dashboard-hero-summary">
          <span>{t("dash.clientOverview")}</span>
          {/* The PERIOD's client count, not the all-time list. This used to read
              `clients.length`, so "This week" showed a weekly spend beside a
              lifetime client total. */}
          <strong>{MONEY.format(periodTotal)}</strong>
          <small>{t("dash.clientsInThisView", { period: t(`period.${periodKind}`) })}</small>
          <button type="button" onClick={onExport} disabled={exporting}><Download size={14} />{exporting ? t("dash.exporting") : t("dash.exportReport")}</button>
        </div>
      </header>
      {/* Reporting period — scopes every panel below. The tab list is driven by
          PERIOD_KINDS rather than hardcoded here, so adding a window is a
          one-line change in reporting.ts and it cannot drift out of sync. */}
      <div className="period-bar">
        <div className="period-tabs" role="group" aria-label={t("period.label")}>
          {PERIOD_KINDS.map(k => (
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
              {/* Visible From / To labels. These existed only as aria-labels, so the
                  two pickers rendered as unlabelled boxes and the active range was
                  invisible. */}
              <label className="period-custom-field">
                <span>{t("common.from")}</span>
                <input type="date" value={customFrom} onChange={e => onCustomRange(e.target.value, customTo)} aria-label={t("common.from")} />
              </label>
              <span className="period-custom-sep">–</span>
              <label className="period-custom-field">
                <span>{t("common.to")}</span>
                <input type="date" value={customTo} onChange={e => onCustomRange(customFrom, e.target.value)} aria-label={t("common.to")} />
              </label>
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

      {/* Dashboard narrowing. Sits directly under the period tabs because it
          composes with them rather than replacing them: the tabs choose the
          window, these three groups cut it down further. The same MultiSelect
          the clients page uses, and the same render functions, so "LOST" here
          and "LOST" there resolve to the same label and the same colour. */}
      <div className="period-filters">
        <MultiSelect
          label={t("filter.allStatuses")}
          options={allStatuses ?? []}
          selected={dashFilters.status}
          onChange={v => setDashFilter("status", v)}
          render={v => statusLabel(t, v)}
          t={t}
        />
        <MultiSelect
          label={t("filter.allChannels")}
          options={allChannels ?? []}
          selected={dashFilters.channel}
          onChange={v => setDashFilter("channel", v)}
          render={v => channelLabel(t, v)}
          t={t}
        />
        <MultiSelect
          label={t("filter.allLocations")}
          options={allLocations ?? []}
          selected={dashFilters.location}
          onChange={v => setDashFilter("location", v)}
          render={v => locationLabel(t, v)}
          t={t}
        />
      </div>

      {/* One chip per selected value, each removable on its own — the same
          affordance the clients page has. The dropdown trigger only ever shows
          the FIRST value plus a "+N" count, so without this row a selection of
          LOST + WON + QUALIFIED was indistinguishable from LOST alone: there
          was no way to see what was picked, nor to drop one pick without
          reopening the menu and unticking it. */}
      {dashFilterCount > 0 && (
        <div className="filter-chips">
          {dashFilters.status.map(s => (
            <span key={`d-st-${s}`} className="filter-chip">
              {statusLabel(t, s)}
              <button title={t("common.clear")} onClick={() => setDashFilter("status", dashFilters.status.filter(x => x !== s))}>×</button>
            </span>
          ))}
          {dashFilters.channel.map(c => (
            <span key={`d-ch-${c}`} className="filter-chip">
              {channelLabel(t, c)}
              <button title={t("common.clear")} onClick={() => setDashFilter("channel", dashFilters.channel.filter(x => x !== c))}>×</button>
            </span>
          ))}
          {dashFilters.location.map(l => (
            <span key={`d-lo-${l}`} className="filter-chip">
              {locationLabel(t, l)}
              <button title={t("common.clear")} onClick={() => setDashFilter("location", dashFilters.location.filter(x => x !== l))}>×</button>
            </span>
          ))}
          <button type="button" className="filter-chip clear-all-chip" onClick={clearDashFilters}>{t("filter.clear")} ×</button>
        </div>
      )}

      {/* KPI strip — the four outcome cards (won / lost / in progress / other)
          plus spend, reach and CPA. `other` is what makes the outcome cards sum
          to the period total instead of quietly under-reporting. */}
      <section className="kpi-row kpi-row-7">
        {/* `previous` is null under "all time" (nothing to compare with), so every
            card renders a dash instead of a fake 0% — see KpiCard. Spend and reach
            compare against the previous window's spend/reach; the outcome cards
            against its bucket totals, which come from the SAME status-classification
            map as the cards themselves. */}
        <KpiCard label={t("kpi.totalSpend")} value={sar(totalSpend)} sub={t("kpi.weeklyInvestment")} accent="#069de3"
          delta={previous && { current: totalSpend, previous: previous.spend }} t={t}/>
        <KpiCard label={t("kpi.totalReach")} value={MONEY.format(totalReach)} sub={t("kpi.acrossChannels")} accent="#0891b2"
          delta={previous && { current: totalReach, previous: previous.reach }} t={t}/>
        <KpiCard label={t("kpi.won")} value={String(won)} sub={`${won+lost?Math.round(won/(won+lost)*100):0}% ${t("kpi.winRate")}`} accent="#22c55e"
          delta={previous && { current: won, previous: previous.totals.won }} t={t}/>
        <KpiCard label={t("stage.lost")} value={String(lost)} sub={`${lost>0?Math.round(lost/(won+lost)*100):0}% ${t("kpi.ofTotal")}`} accent="#ef4444"
          delta={previous && { current: lost, previous: previous.totals.lost }} t={t}/>
        <KpiCard label={t("funnel.inProgress")} value={String(waiting)} sub={t("kpi.awaiting")} accent="#f59e0b"
          delta={previous && { current: waiting, previous: previous.totals.waiting }} t={t}/>
        <KpiCard label={t("kpi.otherStatus")} value={String(unclassified)} sub={t("kpi.otherStatusSub")} accent="#94a3b8"
          delta={previous && { current: unclassified, previous: previous.totals.other }} t={t}/>
        {/* Avg CPA is a RATIO, so it gets no delta: the change in a ratio is not
            the change in either of its parts, and a -50% arrow beside a CPA that
            only moved from 40 to 35 would be actively misleading. */}
        <KpiCard label={t("kpi.avgCpa")} value={metrics.length ? sar(Math.round(totalSpend / (won || 1))) : "—"}
          sub={won>0?t("kpi.customersWon",{n:won}):t("kpi.noWins")} accent="#7c3aed" t={t}/>
      </section>

      {/* Follow-up strip.
          Counted from the FULL client list, not `periodClients`, on purpose: a
          follow-up is a promise about a future date, so "which of these are due
          today" is not a question about last week's registrations. Scoping it to
          the reporting period would show zero for any window that has ended.
          The tile switches to the clients view with the matching filter applied. */}
      {(overdueCount > 0 || dueTodayCount > 0) && (
        <section className="followup-strip">
          {([
            { key: "overdue" as const, n: overdueCount, tone: "danger" },
            { key: "today" as const, n: dueTodayCount, tone: "warn" },
          ]).map(({ key, n, tone }) => (
            <button
              key={key}
              type="button"
              className={`followup-tile is-${tone}`}
              title={t("followUp.showTitle", { value: t(`followUp.${key}`) })}
              onClick={() => onShowFollowUp(key)}
            >
              <strong>{num(n)}</strong>
              <span>{t(`followUp.${key}`)}</span>
            </button>
          ))}
        </section>
      )}

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
        <div className="stage-rows">
          {stageCounts.map(({ value, color, count }) => {
            // Denominator is the PERIOD total, not `clients.length` (the whole
            // all-time book). With the two mixed, a weekly view showed every bar
            // as a sliver of 337 while the header claimed a total the bars did
            // not add up to.
            const pct = periodTotal > 0 ? Math.round((count / periodTotal) * 100) : 0;
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
        {/* Total moved BELOW the stages, and now reports the selected period, so
            it reads as the sum of the bars directly above it rather than as an
            unrelated headline. */}
        <div className="stage-total-row stage-total-row-footer">
          <span className="stage-total-label">{t("stage.total")}</span>
          <strong className="stage-total-value">{num(periodTotal)}</strong>
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
              <div className="sp-perf-avatar">
                      {userAvatars[sp.name] ? <img src={userAvatars[sp.name]} alt="" /> : sp.name.slice(0, 2).toUpperCase()}
                    </div>
              {/* The name is the row's affordance: it opens that rep's profile, so a
                  manager can go from "who is carrying what" to the actual book
                  without filtering the clients page by hand. A <button>, not a
                  <div>, so it is reachable by keyboard and announced as an
                  action rather than as static text. */}
              <button
                type="button"
                className="sp-perf-name sp-perf-link"
                onClick={() => onOpenProfile(sp.name)}
                title={t("sp.viewProfile", { name: sp.name })}
              >
                {sp.name}
              </button>
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
                <span className="chan-cell"><i className="dot" style={{background:optionColor("channels", m.channel, colors)}}/>{m.platform}</span>
                <span>{sar(m.spend)}</span><span>{m.won}</span>
                <span className={m.cpa<100?"good":m.cpa<500?"":"bad"}>{m.cpa > 0 ? sar(m.cpa) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recent clients (full width).
          A real table rather than a stack of rows. Each row used to be a flex box
          whose most prominent text was the tiny uppercase "PROJECT" / "LOCATION"
          label above the value, so the eye landed on a label that repeated the
          column header instead of on the data. Here the headers sit once, above,
          and the project and location carry the weight on the value itself. */}
      <section className="panel recent-clients-panel">
        <div className="panel-heading"><h3>{t("recent.title")}</h3><button className="btn-ghost" onClick={()=>onExport()} disabled={exporting} style={{fontSize:11}}>{t("common.export")}</button></div>
        {recentClients.length === 0 && <div className="empty-state">{t("recent.empty")}</div>}
        {recentClients.length > 0 && (
          <div className="recent-table">
            <div className="recent-head-row">
              <span>{t("th.client")}</span>
              <span>{t("recent.project")}</span>
              <span>{t("recent.location")}</span>
              <span>{t("th.source")}</span>
              <span>{t("th.status")}</span>
            </div>
            {recentClients.map(c => (
              <div className="recent-row" key={c.id}>
                <span className="recent-client">
                  <span className="rc-avatar">{c.name.slice(0,2).toUpperCase()}</span>
                  {/* A <button>, not a <span>: it opens the same slide-in detail
                      panel the clients table opens, so the name behaves like a
                      link instead of being decorative text. `.recent-client-name`
                      keeps its own styling, and the shared `.recent-client-btn`
                      rule below supplies the focus ring and hit area. */}
                  <button type="button" className="recent-client-name recent-client-btn" onClick={() => onOpenDetail(c)}>
                    {c.name}
                  </button>
                </span>
                {/* The project is the point of this panel, so it is the value that
                    is emphasised — not the column header above it. */}
                <span className="recent-project">{c.project || "—"}</span>
                <span className="recent-location">
                  <i className="dot" style={{ background: optionColor("locations", c.location, colors) }} />
                  {c.location || "—"}
                </span>
                <span className="chan-tag-inline"><i className="dot" style={{background:optionColor("channels", c.acquisitionChannel, colors)}}/>{channelLabel(t, c.acquisitionChannel)}</span>
                <StatusPill status={c.status} t={t} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Top locations + Conversion funnel underneath */}
      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading"><h3>{t("loc.title")}</h3><span className="muted" style={{fontSize:11}}>{t("loc.clients", { n: periodTotal })}</span></div>
          {locationEntries.length === 0 && <div className="empty-state">{t("loc.noData")}</div>}
          {locationEntries.map(([loc, count], i) => (
            <div className="loc-bar-row" key={loc}>
              <span className="loc-rank">#{i+1}</span>
              {/* Coloured by the location itself, not by rank. A rank palette made
                  the bar colour change whenever a client moved between cities, so
                  the same location wore a different colour from one render to the
                  next — and could not match an admin-set colour at all. */}
              <div className="loc-bar-track"><div className="loc-bar-fill" style={{width: `${periodTotal > 0 ? Math.round((count/periodTotal)*100) : 0}%`, background: optionColor("locations", loc, colors)}}/></div>
              <span className="loc-name">
                <i className="dot" style={{ background: optionColor("locations", loc, colors) }} />
                {loc}
              </span>
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
              // Resolved here so the funnel honours an admin-set colour, matching
              // the stage panel and the pills rather than the code constant.
              const stageColor = optionColor("statuses", stage.value, colors);
              return (
                <div className="funnel2-step" key={stage.value}>
                  <div className="funnel2-head">
                    <span className="funnel2-dot" style={{ background: stageColor }} />
                    <span className="funnel2-name">{statusLabel(t, stage.value)}</span>
                    <span className="funnel2-count">{num(count)}</span>
                  </div>
                  <div className="funnel2-track">
                    <div
                      className="funnel2-fill"
                      style={{ width: `${width}%`, background: stageColor, opacity: entering ? 1 : 0.82 }}
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
          <span className="chan-cell"><i className="dot" style={{background:optionColor("channels", item.channel, colors)}}/>{item.platform}</span>
          <span>{sar(item.spend)}</span><span>{MONEY.format(item.reach)}</span><span>{item.totalClients}</span><span>{item.cpa.toFixed(2)}</span>
        </div>)}
      </section>
    </div>
  );
}

/**
 * One KPI card, optionally carrying a change against the previous period.
 *
 * `delta` is deliberately nullable rather than defaulting to 0 — "unchanged" and
 * "nothing to compare with" are different statements, and a flat 0% under "all
 * time" would read as "nothing changed", which is a claim the data cannot
 * support.
 *
 * A delta against a previous value of 0 also renders as a dash rather than a
 * percentage: the ratio is undefined (or infinitely large), and inventing a
 * number there is worse than admitting the comparison does not apply.
 */
function KpiCard({ label, value, sub, accent, delta, t }: {
  label: string; value: string; sub: string; accent: string;
  delta?: { current: number; previous: number | null } | null;
  t: TFn;
}) {
  const pct = delta && delta.previous !== null && delta.previous !== 0
    ? Math.round(((delta.current - delta.previous) / Math.abs(delta.previous)) * 100)
    : null;
  const dir = pct === null ? "none" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return (
    <div className="kpi-card" style={{ borderTopColor: accent }}>
      <div className="kpi-label"><span>{label}</span><span className="kpi-dot" style={{ background: accent }} /></div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
      {delta && (
        <div className={`kpi-delta is-${dir}`} title={t("kpi.deltaTitle", { pct: pct ?? 0 })}>
          {dir === "none"
            ? <span>—</span>
            : <><span className="kpi-delta-arrow">{dir === "up" ? "▲" : dir === "down" ? "▼" : "="}</span><span>{Math.abs(pct ?? 0)}%</span></>}
        </div>
      )}
    </div>
  );
}

function ClientsView({ clients, allClients, mode, setMode, filters, updateFilter, setMultiFilter, onSetFollowUp, followUpCounts, clearAllFilters, firstContacts, secondContacts, sortBy, setSortBy, columns, onColumnsChange, rtl, updateStatus, updateClientField, onAssigned, isAdmin, canEdit, refData, onArchive, onArchiveSelected,
  selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenCreate, onOpenImport, onOpenDelete, onOpenDetail,
  exportExcel, exportSelected, bulkCount, onBulkDelete, allStatuses, allChannels,
  customLocationInput, setCustomLocationInput, customChannels, activeDatePreset,
  applyDatePreset, clearDatePreset, datePresets, filterCount, allLocations, users, onAddStatus, onAddChannel, onAddLocation,
  onClearSelection,
  onSelectAllMatching,
  onBulkStatus,
  pager, t }: { clients: Client[]; allClients: Client[]; mode: "table"|"kanban"; setMode: (m: "table"|"kanban") => void; filters: Filters; updateFilter: (k: "query" | "startDate" | "endDate", v: string) => void; setMultiFilter: (k: "status" | "channel" | "location" | "firstContact" | "secondContact", values: string[]) => void; clearAllFilters: () => void; isAdmin: boolean; canEdit: boolean; refData: { onRemoveStatus?: (v: string) => void; onRemoveChannel?: (v: string) => void; onRemoveLocation?: (v: string) => void; removableStatuses?: string[]; removableChannels?: string[]; removableLocations?: string[]; statusUsage?: Record<string, number>; channelUsage?: Record<string, number>; locationUsage?: Record<string, number> }; onArchive: (id: string) => void | Promise<void>; onArchiveSelected: () => void | Promise<void>; firstContacts: string[]; secondContacts: string[]; sortBy: SortField; setSortBy: (s: SortField) => void; columns: ResolvedColumn[]; onColumnsChange: (c: ResolvedColumn[]) => void; rtl: boolean; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; toggleSelect: (id: string) => void; toggleSelectAll: () => void; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; onOpenCreate: () => void; onOpenImport: () => void; exportExcel: () => void; exportSelected: () => void; bulkCount: number; onBulkDelete: () => void; allStatuses: string[]; allChannels: string[]; customLocationInput: string; setCustomLocationInput: (v: string) => void; customChannels: string[]; activeDatePreset?: string | null; applyDatePreset?: (p: DatePreset) => void; clearDatePreset?: () => void; datePresets?: DatePreset[]; filterCount?: number; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>;
  /** Clears the bulk selection. Always offered while anything is selected. */
  onClearSelection?: () => void;
  /** Ticks every client the current filter matches, across all pages. */
  onSelectAllMatching?: () => void;
  /**
   * Moves every selected client to one status. Supplied only when the viewer can
   * edit, which is what the bulk bar gates the control on.
   */
  onBulkStatus?: (status: string) => void;
  /** Toggles one follow-up bucket. Wired straight to the page-level setter. */
  onSetFollowUp: (value: string) => void;
  /** Per-bucket client counts for the follow-up chip badges. */
  followUpCounts?: Record<string, number>;
  pager?: { page: number; pageCount: number; total: number; loading: boolean; onPage: (p: number) => void; t: TFn }; t: TFn }) {
  // Page controls for the paged table. Supplied only in table mode — kanban
  // renders the whole book at once, so a pager there would be meaningless.
  const showPager = Boolean(pager && mode === "table");
  const hasPrev = showPager && pager!.page > 1;
  const hasNext = showPager && pager!.page < pager!.pageCount;
  const rowFrom = showPager ? (pager!.page - 1) * 25 + 1 : 0;
  const rowTo = showPager ? Math.min(pager!.page * 25, pager!.total) : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="breadcrumb"><UsersRound size={14}/>{t("clients.crm")}</div><h1>{t("clients.title")}</h1><p>{t("clients.subtitle")}</p></div>
        <div className="header-actions">
          {bulkCount>0&&<span className="selection-info">{t("clients.selectedCount",{n:bulkCount})}
            {/* Bulk status change. Gated on `canEdit`, NOT `isAdmin`: a Sales or
                CRM user can already move one client's status from the table or
                the detail panel, so refusing them the same edit in bulk while
                offering them Archive would be incoherent. Delete/Archive below
                stay admin-only because those endpoints are. */}
            {canEdit && onBulkStatus && (
              <span className="bulk-status">
                <span className="bulk-status-label">{t("clients.bulkStatus")}</span>
                <Select
                  value=""
                  options={allStatuses}
                  onChange={onBulkStatus}
                  render={v => statusLabel(t, v)}
                  searchable={false}
                  className="status-select"
                  t={t}
                  ariaLabel={t("clients.bulkStatus")}
                />
              </span>
            )}
            {isAdmin && <><button className="btn-danger-sm" onClick={onBulkDelete}>{t("clients.deleteSelected")}</button>
              <button className="btn-archive-sm" onClick={onArchiveSelected}>{t("clients.archiveSelected")}</button></>}
            {/* Always offered while anything is ticked. Selecting every visible row
                then wanting to change your mind had no way back except re-clicking
                them one at a time. */}
            <button className="btn-ghost" onClick={onClearSelection}>{t("clients.clearSelection")}</button>
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
      <ClientFilterBar filters={filters} updateFilter={updateFilter} setMultiFilter={setMultiFilter}
        followUp={filters.followUp} setFollowUp={onSetFollowUp}
        followUpCounts={followUpCounts}
        clearAllFilters={clearAllFilters} firstContacts={firstContacts} secondContacts={secondContacts} sortBy={sortBy} setSortBy={setSortBy} datePresets={datePresets} activeDatePreset={activeDatePreset} applyDatePreset={applyDatePreset} clearDatePreset={clearDatePreset} filterCount={filterCount ?? 0} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} onRemoveStatus={refData.onRemoveStatus} removableStatuses={refData.removableStatuses} statusUsage={refData.statusUsage} onRemoveChannel={refData.onRemoveChannel} onRemoveLocation={refData.onRemoveLocation} removableChannels={refData.removableChannels} removableLocations={refData.removableLocations} channelUsage={refData.channelUsage} locationUsage={refData.locationUsage} t={t} />
      {/* One count for the whole page. This used to read `clients.length` and
          `allClients.length`, which in table mode are the PAGE and the WHOLE BOOK —
          so "last 30 days" rendered "25 of 337" while the pager underneath correctly
          said "of 202". Both now come from the server's filtered total. */}
      <div className="result-note">{mode === "table"
        ? t("clients.showingRange", { from: rowFrom, to: rowTo, total: pager?.total ?? clients.length })
        : t("clients.showing", { n: clients.length, total: allClients.length })}
        {" · "}{t("clients.selected", { n: selectedIds.size })}
        {/* Cross-page bulk select. Page-level select-all (the header checkbox)
            covers what is on screen; this covers every row the current filter
            matches, so a "delete all 202 in the last 30 days" is still possible
            without paging through by hand. */}
        {mode === "table" && selectedIds.size > 0 && pager && pager.total > clients.length && (
          <button className="result-note-action" onClick={onSelectAllMatching}>
            {t("clients.selectAllMatching", { n: pager.total })}
          </button>
        )}
      </div>
      {mode==="table"? <ClientTable clients={clients} selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} isAdmin={isAdmin} canEdit={canEdit} onArchive={onArchive} tableRef={null} columns={columns} onColumnsChange={onColumnsChange} rtl={rtl} t={t}/>:<Kanban clients={clients} updateStatus={updateStatus} updateClientField={updateClientField} onAssigned={onAssigned} selectedIds={selectedIds} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} isAdmin={isAdmin} canEdit={canEdit} onArchive={onArchive} columns={columns} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} users={users} onAddStatus={onAddStatus} onAddChannel={onAddChannel} onAddLocation={onAddLocation} t={t}/>}
      {/* Pager. Only in table mode — kanban shows the whole book. */}
      {showPager && pager && (
        <div className="table-pager">
          <span className="table-pager-count">
            {pager.loading
              ? t("common.loading")
              : pager.total === 0
                ? t("clients.noResults")
                : t("clients.showingRange", { from: rowFrom, to: rowTo, total: pager.total })}
          </span>
          <div className="table-pager-controls">
            <button
              className="btn-outline"
              disabled={!hasPrev || pager.loading}
              onClick={() => pager.onPage(pager.page - 1)}
            >
              {t("pager.prev")}
            </button>
            <span className="table-pager-page">{t("pager.pageOf", { page: pager.page, count: pager.pageCount })}</span>
            <button
              className="btn-outline"
              disabled={!hasNext || pager.loading}
              onClick={() => pager.onPage(pager.page + 1)}
            >
              {t("pager.next")}
            </button>
          </div>
        </div>
      )}
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

function Kanban({ clients, updateStatus, updateClientField, onAssigned, selectedIds, onOpenEdit, onOpenDelete, onOpenDetail, isAdmin, canEdit, onArchive, columns, allStatuses, allChannels, allLocations, users, onAddStatus, onAddChannel, onAddLocation, t }: { clients: Client[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; isAdmin?: boolean; canEdit?: boolean; onArchive?: (id: string) => void | Promise<void>; columns: ResolvedColumn[]; allStatuses?: string[]; allChannels?: string[]; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; t: TFn }) {
  const [draggedId, setDraggedId] = useState<string|null>(null);
  const [dropTarget, setDropTarget] = useState<string|null>(null);
  // The same saved layout drives the cards, so hiding a field in the table hides
  // it on every card too. Widths are ignored here: cards are fixed-width in a
  // 3-column board, so there is nothing for a width to act on.
  const show = (key: ColumnKey) => columns.find(c => c.key === key)?.hidden === false;
  const colors = useOptionColors();
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
                <i className="dot" style={{background:optionColor("channels", c.acquisitionChannel, colors)}}/>
                <span>{channelLabel(t, c.acquisitionChannel)}</span>
              </div>}
              {show("project") && <p className="card-project">{c.project}</p>}
              {show("location") && <p className="card-location"><i className="dot" style={{background:optionColor("locations", c.location, colors)}}/>{c.location}</p>}
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

