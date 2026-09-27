"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";
import {
  ArrowUpRight, ChevronDown, Download, Grid2X2,
  LayoutDashboard, Pencil, Plus, Search, Trash2, UsersRound, X as XIcon,
  Check, AlertCircle, MessageSquare, Filter, Archive,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { resolveLang, useLang } from "@/lib/i18n";
import { apiErrorMessage, readApiError } from "@/lib/api-errors";
import { channelLabel, statusLabel } from "@/lib/reporting";
import { downloadFile, exportQuery, EXPORT_FAILED } from "@/lib/download";
import { dateLocale, sar } from "@/lib/format";

type Client = {
  id: string; name: string; phoneNumber: string;
  status: "WAITING" | "WON" | "LOST" | string;
  project: string; location: string; acquisitionChannel: string;
  operationToTake: string; firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string;
};
type Metric = { channel: string; platform: string; spend: number; reach: number; totalClients: number; won: number; lost: number; waiting: number; cpa: number };
type User = { name: string; initials: string; role: string };
type Filters = { query: string; status: string[]; channel: string[]; location: string[]; salesperson: string[]; startDate: string; endDate: string };
type EditDraft = Partial<Client> & { id: string };
type ConfirmDelete = { ids: string[]; names: string[] };
type Toast = { id: number; type: "success" | "error" | "info"; message: string };
type DatePreset = { label: string; startDate?: string; endDate?: string };
type SpStat = { name: string; won: number; lost: number; waiting: number; total: number; winRate: string };

const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CH_COLORS: Record<string, string> = { FACEBOOK: "#4f46e5", INSTAGRAM: "#e11d48", X: "#111827", TIKTOK: "#7c3aed", GOOGLE_ADS: "#d97706", WHATSAPP: "#16a34a", CALLS: "#ea580c", SALES: "#0891b2" };
const CHANNEL_VALUES = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"] as const;
const PREDEFINED_STATUSES = ["WAITING", "WON", "LOST"];
const CUSTOM_LOCATIONS = ["Riyadh", "Jeddah", "Makkah", "Madinah", "Dammam", "Khobar", "Dhahran", "Taif", "Abha", "Tabuk"] as const;

// `label` holds a dictionary key so the preset keeps a stable identity while
// the rendered text follows the selected language (see FilterBar).
const DATE_PRESETS: DatePreset[] = [
  { label: "date.today", startDate: new Date().toISOString().slice(0, 10) },
  { label: "date.week", startDate: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); })() },
  { label: "date.last7", startDate: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })() },
  { label: "date.month", startDate: (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })() },
];

// Field key -> dictionary key, used by the "field updated" toast.
const FIELD_KEYS: Record<string, string> = {
  name: "form.name", phoneNumber: "form.phone", project: "form.project", location: "form.location",
  acquisitionChannel: "form.channel", status: "form.status", firstContactPerson: "form.firstContact",
  secondContactPerson: "form.secondContact", operationToTake: "form.operation", notes: "form.notes",
};

const initialFilters: Filters = { query: "", status: [], channel: [], location: [], salesperson: [], startDate: "", endDate: "" };

function matchesFilters(client: Client, filters: Filters) {
  const date = (client.createdAt || "").slice(0, 10);
  // Ignore spaces/dashes/parentheses so phone numbers match with or without
  // formatting, e.g. "1018240912" finds "+20 101 824 0912".
  const norm = (s: string) => s.replace(/[\s\-().]/g, "").toLowerCase();
  const haystack = norm(`${client.name} ${client.phoneNumber} ${client.project} ${client.notes ?? ""}`);
  return (filters.status.length === 0 || filters.status.includes(String(client.status))) &&
    (filters.channel.length === 0 || filters.channel.includes(client.acquisitionChannel)) &&
    (filters.location.length === 0 || filters.location.includes(client.location)) &&
    (filters.salesperson.length === 0 || filters.salesperson.includes(client.firstContactPerson) || filters.salesperson.includes(client.secondContactPerson)) &&
    (!filters.startDate || date >= filters.startDate) && (!filters.endDate || date <= filters.endDate) &&
    haystack.includes(norm(filters.query));
}

let toastId = 0;

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
    fetch("/api/auth/me").then(async r => { if (!r.ok) { router.replace("/login"); return null; } return r.json(); }).then(d => d?.user && setUser(d.user));
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
    Promise.all([fetch("/api/analytics/weekly"), fetch("/api/crm/clients")])
      .then(async ([a, c]) => {
        if (!a.ok || !c.ok) throw new Error("Unable to load workspace");
        return Promise.all([a.json(), c.json()]);
      })
      .then(([analytics, crm]) => {
        setMetrics(analytics.rows || []);
        setClients(crm.clients || []);
      })
      .catch(() => undefined);
    fetch("/api/crm/clients").then(r => r.json()).then(d => setCustomStatuses(d.statuses ?? [])).catch(() => {});
    fetch("/api/channels").then(r => r.json()).then(d => setCustomChannels(d.channels ?? CHANNEL_VALUES)).catch(() => {});
    fetch("/api/locations").then(r => r.json()).then(d => setCustomLocations(d.locations ?? [])).catch(() => {});
    fetch("/api/users").then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => {});
    fetch("/api/notifications").then(r => r.json()).then(d => setNotifications(d.notifications ?? [])).catch(() => {});
  }, [user]);

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

  const filteredClients = useMemo(() => clients.filter(c => matchesFilters(c, filters)), [clients, filters]);
  const salespeople = useMemo(() => [...new Set(clients.flatMap(c => [c.firstContactPerson, c.secondContactPerson].filter(Boolean)))], [clients]);
  const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
  const totalReach = metrics.reduce((s, m) => s + m.reach, 0);
  const won = clients.filter(c => c.status === "WON").length;
  const lost = clients.filter(c => c.status === "LOST").length;
  const waiting = clients.filter(c => c.status !== "WON" && c.status !== "LOST").length;

  const updateFilter = (key: "query" | "startDate" | "endDate", value: string) => {
    setFilters(cur => ({ ...cur, [key]: value }));
    if (key !== "query") setActiveDatePreset(null);
  };

  const setMultiFilter = (key: "status" | "channel" | "location" | "salesperson", values: string[]) => {
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
    filters.status.length + filters.channel.length + filters.location.length + filters.salesperson.length +
    (filters.startDate ? 1 : 0) + (filters.endDate ? 1 : 0) + (filters.query ? 1 : 0);

  const allStatuses = [...PREDEFINED_STATUSES, ...customStatuses.filter(s => !PREDEFINED_STATUSES.includes(s))];
  const allChannels = [...CHANNEL_VALUES, ...customChannels.filter(ch => !CHANNEL_VALUES.includes(ch as typeof CHANNEL_VALUES[number]))];
  const allLocations = [...CUSTOM_LOCATIONS, ...customLocations.filter(l => !(CUSTOM_LOCATIONS as unknown as string[]).includes(l))];

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
    return clean;
  };

  const addStatus = async (label: string): Promise<string> => {
    const key = label.trim().toUpperCase();
    if (!key) return label;
    await fetch("/api/crm/clients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", label: key }) }).catch(() => {});
    const r = await fetch("/api/crm/clients").then(x => x.json()).catch(() => ({}));
    setCustomStatuses(r.statuses ?? []);
    return key;
  };

  const spStats = useMemo(() => {
    const m = new Map<string, { won: number; lost: number; waiting: number; total: number }>();
    for (const cl of clients) {
      // Attribute each client once per unique salesperson (avoid double counting
      // when the same person is both 1st and 2nd contact).
      const people = [...new Set([cl.firstContactPerson, cl.secondContactPerson].filter(Boolean))];
      for (const key of people) {
        const s = m.get(key) ?? { won: 0, lost: 0, waiting: 0, total: 0 };
        if (cl.status === "WON") s.won++;
        else if (cl.status === "LOST") s.lost++;
        else s.waiting++;
        s.total++;
        m.set(key, s);
      }
    }
    return [...m.entries()].sort((a,b) => b[1].won - a[1].won || b[1].total - a[1].total).slice(0, 8).map(([name, s]) => ({
      name, ...s, winRate: s.total > 0 ? Math.round(s.won / s.total * 100) + "%" : "—"
    }));
  }, [clients]);

    const visibleMetrics = useMemo(() => metrics.map(metric => {
    const scoped = filteredClients.filter(c => c.acquisitionChannel === metric.channel);
    const wonCount = scoped.filter(c => c.status === "WON").length;
    return { ...metric, totalClients: scoped.length, won: wonCount, lost: scoped.filter(c => c.status === "LOST").length, waiting: scoped.filter(c => c.status === "WAITING").length, cpa: wonCount ? metric.spend / wonCount : 0 };
  }), [metrics, filteredClients]);

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
        salespeople: filters.salesperson.join(","),
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
            won={won} lost={lost} waiting={waiting}
            clients={filteredClients}
            salespeople={salespeople}
            spStats={spStats}
            updateStatus={updateStatus} updateClientField={updateClientField}
            allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations}
            onAddStatus={addStatus} onAddChannel={addChannel} onAddLocation={addLocation}
            onExport={exportReport} exporting={exporting}
            t={t}
          />
        ) : (
          <ClientsView
            clients={filteredClients} allClients={clients} mode={mode} setMode={setMode}
            filters={filters} updateFilter={updateFilter}
            setMultiFilter={setMultiFilter} clearAllFilters={clearAllFilters}
            salespeople={salespeople} updateStatus={updateStatus} updateClientField={updateClientField}
            onAssigned={refreshNotifications}
            selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
            onOpenEdit={openEdit} onOpenCreate={openCreate} onOpenDelete={(ids: string[], names: string[]) => setConfirmDelete({ ids, names })}
            onOpenDetail={openDetail}
            exportExcel={exportExcel} exportSelected={exportSelected}
            bulkCount={selectedIds.size}
            isAdmin={user.role === "Admin"}
            onArchive={archiveClient}
            onArchiveSelected={archiveSelected}
            onBulkDelete={() => { if (selectedIds.size === 0) return; setConfirmDelete({ ids: [...selectedIds], names: filteredClients.filter(c => selectedIds.has(c.id)).map(c => c.name) }); }}
            allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations}
            customLocationInput={customLocationInput} setCustomLocationInput={setCustomLocationInput}
            customChannels={customChannels}
            users={users}
            onAddStatus={addStatus} onAddChannel={addChannel} onAddLocation={addLocation}
            activeDatePreset={activeDatePreset}
            applyDatePreset={applyDatePreset} clearDatePreset={clearDatePreset}
            datePresets={DATE_PRESETS}
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
                <Field label={t("form.phone")}><input value={editDraft.phoneNumber ?? ""} onChange={e => setEditDraft({ ...editDraft, phoneNumber: e.target.value })} /></Field>
                <Field label={t("form.project")} wide><textarea rows={3} value={editDraft.project ?? ""} onChange={e => setEditDraft({ ...editDraft, project: e.target.value })} placeholder={t("form.projectDetailsPh")} /></Field>
                <Field label={t("form.location")}>
                  <AddNewSelect value={editDraft.location ?? ""} options={allLocations} onAdd={addLocation} onChange={v => setEditDraft({ ...editDraft, location: v })} placeholder={t("form.locationPh")} t={t} />
                </Field>
                <Field label={t("form.channel")}>
                  <AddNewSelect value={editDraft.acquisitionChannel ?? ""} options={allChannels} onAdd={addChannel} onChange={v => setEditDraft({ ...editDraft, acquisitionChannel: v })} render={v => channelLabel(t, v)} placeholder={t("form.channelPh")} t={t} />
                </Field>
                <Field label={t("form.status")}>
                  <AddNewSelect value={editDraft.status ?? ""} options={allStatuses} onAdd={addStatus} onChange={v => setEditDraft({ ...editDraft, status: v })} placeholder={t("form.statusPh")} t={t} />
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
                <div className="meta-item"><span className="meta-label">{t("form.phone")}</span><span className="meta-value">{detailClient.phoneNumber}</span></div>
                <div className="meta-item"><span className="meta-label">{t("form.status")}</span>
                  <select className={`status-select status-${String(detailClient.status).toLowerCase()}`} value={detailClient.status} onChange={e => updateStatus(detailClient.id, e.target.value)}>
                    {allStatuses.map(s => <option key={s} value={s}>{statusLabel(t, s)}</option>)}
                  </select>
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

function FilterBar({ filters, updateFilter, setMultiFilter, clearAllFilters, salespeople, datePresets, activeDatePreset, applyDatePreset, clearDatePreset, filterCount, allStatuses, allChannels, allLocations, t }: {
  filters: Filters;
  updateFilter: (k: "query" | "startDate" | "endDate", v: string) => void;
  setMultiFilter: (k: "status" | "channel" | "location" | "salesperson", values: string[]) => void;
  clearAllFilters: () => void;
  salespeople: string[];
  datePresets?: DatePreset[];
  activeDatePreset?: string | null;
  applyDatePreset?: (p: DatePreset) => void;
  clearDatePreset?: () => void;
  filterCount?: number;
  allStatuses?: string[];
  allChannels?: string[];
  allLocations?: string[];
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
        <MultiSelect label={t("filter.allStatuses")} options={allStatuses ?? []} selected={filters.status} onChange={v => setMultiFilter("status", v)} t={t} />
        <MultiSelect label={t("filter.allChannels")} options={allChannels ?? []} selected={filters.channel} onChange={v => setMultiFilter("channel", v)} render={v => channelLabel(t, v)} t={t} />
        <MultiSelect label={t("filter.allLocations")} options={allLocations ?? []} selected={filters.location} onChange={v => setMultiFilter("location", v)} t={t} />
        <MultiSelect label={t("filter.allSalespeople")} options={salespeople} selected={filters.salesperson} onChange={v => setMultiFilter("salesperson", v)} t={t} />
      </div>
      <div className="date-bar"><Filter size={13} /><span>{t("th.date")}</span><input type="date" value={filters.startDate} onChange={e => updateFilter("startDate", e.target.value)} /><span>–</span><input type="date" value={filters.endDate} onChange={e => updateFilter("endDate", e.target.value)} /></div>
      {(filterCount ?? 0) > 0 && (
        <div className="filter-chips">
          {filters.query && <span className="filter-chip">&ldquo;{filters.query.slice(0, 24)}&rdquo;<button title={t("common.clear")} onClick={() => updateFilter("query", "")}>×</button></span>}
          {filters.status.map(s => <span key={`st-${s}`} className="filter-chip">{statusLabel(t, s)}<button onClick={() => setMultiFilter("status", filters.status.filter(x => x !== s))}>×</button></span>)}
          {filters.channel.map(c => <span key={`ch-${c}`} className="filter-chip">{channelLabel(t, c)}<button onClick={() => setMultiFilter("channel", filters.channel.filter(x => x !== c))}>×</button></span>)}
          {filters.location.map(l => <span key={`lo-${l}`} className="filter-chip">{l}<button onClick={() => setMultiFilter("location", filters.location.filter(x => x !== l))}>×</button></span>)}
          {filters.salesperson.map(p => <span key={`sp-${p}`} className="filter-chip">{p}<button onClick={() => setMultiFilter("salesperson", filters.salesperson.filter(x => x !== p))}>×</button></span>)}
          {filters.startDate && <span className="filter-chip">{t("common.from")} {filters.startDate}<button onClick={() => updateFilter("startDate", "")}>×</button></span>}
          {filters.endDate && <span className="filter-chip">{t("common.to")} {filters.endDate}<button onClick={() => updateFilter("endDate", "")}>×</button></span>}
          <button type="button" className="filter-chip clear-all-chip" onClick={clearAllFilters}>{t("filter.clear")} ×</button>
        </div>
      )}
    </>
  );
}

function MultiSelect({ label, options, selected, onChange, render, t }: {
  label: string; options: string[]; selected: string[];
  onChange: (values: string[]) => void; render?: (v: string) => string;
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
          {options.map(o => (
            <button type="button" key={o} className={`ms-opt ${selected.includes(o) ? "ms-opt-on" : ""}`} onClick={() => toggleValue(o)}>
              <span className="ms-check">{selected.includes(o) && <Check size={11} />}</span>
              {lab(o)}
            </button>
          ))}
          {selected.length > 0 && <button type="button" className="ms-clear" onClick={() => { onChange([]); setOpen(false); }}>{t("clients.clearSelection")}</button>}
        </div>
      )}
    </div>
  );
}

function Dashboard({ metrics, totalSpend, totalReach, won, lost, waiting, clients, salespeople, spStats, updateStatus, updateClientField, allStatuses, allChannels, allLocations, onAddStatus, onAddChannel, onAddLocation, onExport, exporting, t }: { metrics: Metric[]; totalSpend: number; totalReach: number; won: number; lost: number; waiting: number; clients: Client[]; salespeople: string[]; spStats: SpStat[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; allStatuses: string[]; allChannels: string[]; allLocations: string[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; onExport: () => void; exporting: boolean; t: TFn }) {
  const recentClients = useMemo(() => [...clients].sort((a,b) => String(b.lastUpdateDate||"").localeCompare(String(a.lastUpdateDate||""))).slice(0,5), [clients]);
  const topLocations = useMemo(() => { const m = new Map<string,number>(); clients.forEach(c=>m.set(c.location,(m.get(c.location)||0)+1)); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5); }, [clients]);

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div>
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
      {/* KPI strip */}
      <section className="kpi-row kpi-row-6">
        <KpiCard label={t("kpi.totalSpend")} value={sar(totalSpend)} sub={t("kpi.weeklyInvestment")} accent="#4f46e5"/>
        <KpiCard label={t("kpi.totalReach")} value={MONEY.format(totalReach)} sub={t("kpi.acrossChannels")} accent="#0891b2"/>
        <KpiCard label={t("kpi.won")} value={String(won)} sub={`${won+lost?Math.round(won/(won+lost)*100):0}% ${t("kpi.winRate")}`} accent="#22c55e"/>
        <KpiCard label={t("kpi.lost")} value={String(lost)} sub={`${lost>0?Math.round(lost/(won+lost)*100):0}% ${t("kpi.ofTotal")}`} accent="#ef4444"/>
        <KpiCard label={t("kpi.pipeline")} value={String(waiting)} sub={t("kpi.awaiting")} accent="#f59e0b"/>
        <KpiCard label={t("kpi.avgCpa")} value={metrics.length ? sar(Math.round(totalSpend / (won || 1))) : "—"} sub={won>0?t("kpi.customersWon",{n:won}):t("kpi.noWins")} accent="#7c3aed"/>
      </section>

      {/* Funnel + ROI */}
      <section className="funnel-row">
        <div className="panel sp-perf-panel">
          <h3>{t("sp.title")}</h3>
          <div className="sp-perf-legend">
            <span className="sp-won">{t("status.wonLabel")}</span>
            <span className="sp-lost">{t("status.lostLabel")}</span>
            <span className="sp-wait">{t("status.waitingLabel")}</span>
          </div>
          {spStats.length === 0 && <div className="empty-state" style={{fontSize:12,padding:"16px 0"}}>{t("sp.noData")}</div>}
          {spStats.map(sp => (
            <div className="sp-perf-row" key={sp.name}>
              <div className="sp-perf-avatar">{sp.name.slice(0,2).toUpperCase()}</div>
              <div className="sp-perf-name">{sp.name}</div>
              <div className="sp-perf-stats">
                <span className="sp-won">{sp.won}</span>
                <span className="sp-lost">{sp.lost}</span>
                <span className="sp-wait">{sp.waiting}</span>
              </div>
              <div className="sp-perf-bar"><div className="sp-perf-fill" style={{width: String(Math.round(sp.total>0?sp.won/sp.total*100:0)) + "%"}}/></div>
              <span className="sp-winrate">{sp.winRate}</span>
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

      {/* Recent clients + Top locations */}
      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading"><h3>{t("recent.title")}</h3><button className="btn-ghost" onClick={()=>onExport()} disabled={exporting} style={{fontSize:11}}>{t("common.export")}</button></div>
          {recentClients.length === 0 && <div className="empty-state">{t("recent.empty")}</div>}
          {recentClients.map(c => (
            <div className="recent-client-row" key={c.id}>
              <span className="rc-avatar">{c.name.slice(0,2).toUpperCase()}</span>
              <div className="rc-info">
                <strong>{c.name}</strong>
                <small>
                  <span className="rc-kv"><span className="rc-k">{t("recent.project")}</span>{c.project || "—"}</span>
                  {c.location ? <span className="rc-kv"><span className="rc-k">{t("recent.location")}</span>{c.location}</span> : null}
                </small>
              </div>
              <span className="chan-tag-inline" style={{ flexShrink: 0 }}><i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>{channelLabel(t, c.acquisitionChannel)}</span>
              <span className={`status-pill status-${String(c.status).toLowerCase()}`} style={{ flexShrink: 0 }}>{statusLabel(t, c.status)}</span>
            </div>
          ))}
        </section>
        <div className="dash-stack">
        <section className="panel">
          <div className="panel-heading"><h3>{t("loc.title")}</h3><span className="muted" style={{fontSize:11}}>{t("loc.clients", { n: clients.length })}</span></div>
          {topLocations.length === 0 && <div className="empty-state">{t("loc.noData")}</div>}
          {topLocations.map(([loc, count], i) => (
            <div className="loc-bar-row" key={loc}>
              <span className="loc-rank">#{i+1}</span>
              <div className="loc-bar-track"><div className="loc-bar-fill" style={{width: `${Math.round(count/clients.length*100)}%`, background: ["#4f46e5","#0891b2","#f59e0b","#22c55e","#7c3aed"][i]}}/></div>
              <span className="loc-name">{loc}</span>
              <span className="loc-count">{count}</span>
            </div>
          ))}
          </section>
          <section className="panel funnel-panel">
            <h3>{t("funnel.title")}</h3>
            <div className="funnel-stages">
              <div className="funnel-stage stage-total"><span className="funnel-num">{clients.length}</span><span className="funnel-label">{t("funnel.total")}</span></div>
              <div className="funnel-arrow">↓</div>
              <div className="funnel-stage stage-waiting"><span className="funnel-num">{waiting}</span><span className="funnel-label">{t("funnel.waiting")}</span></div>
              <div className="funnel-arrow">↓</div>
              <div className="funnel-stage stage-won"><span className="funnel-num">{won}</span><span className="funnel-label">{t("funnel.won")}</span></div>
              <div className="funnel-stage stage-lost"><span className="funnel-num">{lost}</span><span className="funnel-label">{t("funnel.lost")}</span></div>
            </div>
          </section>
        </div>
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

function ClientsView({ clients, allClients, mode, setMode, filters, updateFilter, setMultiFilter, clearAllFilters, salespeople, updateStatus, updateClientField, onAssigned, isAdmin, onArchive, onArchiveSelected,
  selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenCreate, onOpenDelete, onOpenDetail,
  exportExcel, exportSelected, bulkCount, onBulkDelete, allStatuses, allChannels,
  customLocationInput, setCustomLocationInput, customChannels, activeDatePreset,
  applyDatePreset, clearDatePreset, datePresets, filterCount, allLocations, users, onAddStatus, onAddChannel, onAddLocation, t }: { clients: Client[]; allClients: Client[]; mode: "table"|"kanban"; setMode: (m: "table"|"kanban") => void; filters: Filters; updateFilter: (k: "query" | "startDate" | "endDate", v: string) => void; setMultiFilter: (k: "status" | "channel" | "location" | "salesperson", values: string[]) => void; clearAllFilters: () => void; isAdmin: boolean; onArchive: (id: string) => void | Promise<void>; onArchiveSelected: () => void | Promise<void>; salespeople: string[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; toggleSelect: (id: string) => void; toggleSelectAll: () => void; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; onOpenCreate: () => void; exportExcel: () => void; exportSelected: () => void; bulkCount: number; onBulkDelete: () => void; allStatuses: string[]; allChannels: string[]; customLocationInput: string; setCustomLocationInput: (v: string) => void; customChannels: string[]; activeDatePreset?: string | null; applyDatePreset?: (p: DatePreset) => void; clearDatePreset?: () => void; datePresets?: DatePreset[]; filterCount?: number; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; t: TFn }) {
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
          <button className="btn-primary" onClick={onOpenCreate}><Plus size={15}/>{t("clients.newClient")}</button>
          <button className="btn-outline" onClick={exportSelected} disabled={bulkCount===0}><Download size={15}/>{t("clients.exportSelected",{n:bulkCount})}</button>
          <button className="btn-outline" onClick={exportExcel}><Download size={15}/>{t("clients.exportAll")}</button>
        </div>
      </div>
      <FilterBar filters={filters} updateFilter={updateFilter} setMultiFilter={setMultiFilter} clearAllFilters={clearAllFilters} salespeople={salespeople} datePresets={datePresets} activeDatePreset={activeDatePreset} applyDatePreset={applyDatePreset} clearDatePreset={clearDatePreset} filterCount={filterCount ?? 0} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} t={t} />
      <div className="result-note">{t("clients.showing",{n:clients.length,total:allClients.length})} · {t("clients.selected",{n:selectedIds.size})}</div>
      {mode==="table"? <ClientTable clients={clients} updateStatus={updateStatus} updateClientField={updateClientField} onAssigned={onAssigned} selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} isAdmin={isAdmin} onArchive={onArchive} tableRef={null} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} users={users} onAddStatus={onAddStatus} onAddChannel={onAddChannel} onAddLocation={onAddLocation} t={t}/>:<Kanban clients={clients} updateStatus={updateStatus} updateClientField={updateClientField} onAssigned={onAssigned} selectedIds={selectedIds} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} isAdmin={isAdmin} onArchive={onArchive} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} users={users} onAddStatus={onAddStatus} onAddChannel={onAddChannel} onAddLocation={onAddLocation} t={t}/>}
    </div>
  );
}

function ClientTable({ clients, updateStatus, updateClientField, onAssigned, selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenDelete, onOpenDetail, isAdmin, onArchive, tableRef, allStatuses, allChannels, allLocations, users, onAddStatus, onAddChannel, onAddLocation, t }: { clients: Client[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; toggleSelect: (id: string) => void; toggleSelectAll: () => void; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; isAdmin?: boolean; onArchive?: (id: string) => void | Promise<void>; tableRef?: React.RefObject<HTMLDivElement> | null; allStatuses?: string[]; allChannels?: string[]; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; t: TFn }) {
  const allSelected = clients.length>0&&clients.every(c=>selectedIds.has(c.id));
  return (
    <div className="table-scroll-wrapper">
      <div className="scroll-indicator-left hidden" ref={(el) => { if(el) { const t2 = tableRef?.current; if(t2){ const check = ()=>{ el.classList.toggle("hidden", t2.scrollLeft <= 0); }; check(); t2.addEventListener("scroll",check,{passive:true}); } } }} />
      <div className="scroll-indicator-right hidden" />
      <div className="client-table" ref={tableRef}>
        <div className="client-row client-head">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="cb"/>
          <span>{t("th.client")}</span><span>{t("th.status")}</span><span>{t("th.source")}</span><span>{t("th.project")}</span><span>{t("th.location")}</span><span>{t("th.date")}</span><span>{t("form.operation")}</span><span>{t("th.first")}</span><span>{t("th.second")}</span><span>{t("detail.lastUpdate")}</span><span/></div>
        {clients.map(c=>(
          <div className={`client-row client-row-clickable ${selectedIds.has(c.id)?"selected":""}`} key={c.id} onClick={e=>{(e.target as HTMLElement).tagName!=="INPUT"&&(e.target as HTMLElement).tagName!=="SELECT"&&! (e.target as HTMLElement).closest(".no-detail")&&onOpenDetail(c)}}>
            <input type="checkbox" checked={selectedIds.has(c.id)} onChange={()=>toggleSelect(c.id)} className="cb" onClick={e=>e.stopPropagation()}/>
            <span className="person-cell" onClick={()=>onOpenDetail(c)}><b>{c.name}</b><small>{c.phoneNumber}</small>{c.notes&&<span className="notes-indicator"><MessageSquare size={10}/></span>}</span>
            <span className={`status-pill status-${String(c.status).toLowerCase()}`}>{statusLabel(t, c.status)}</span>
            <span className="chan-tag"><i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>{channelLabel(t, c.acquisitionChannel)}</span>
            <span>{c.project}</span><span>{c.location}</span><span className="muted">{c.createdAt?new Date(c.createdAt).toLocaleDateString(dateLocale(resolveLang())):"—"}</span>
            <span className="op-text">{c.operationToTake}</span>
            <span className="muted">{c.firstContactPerson || "—"}</span>
            <span className="muted">{c.secondContactPerson || "—"}</span>
            <span className="muted">{c.lastUpdateDate?new Date(c.lastUpdateDate).toLocaleDateString(dateLocale(resolveLang())):"—"}</span>
            <span className="actions-cell no-detail">
              <button className="icon-btn" title={t("common.edit")} onClick={e=>{e.stopPropagation();onOpenEdit(c);}}><Pencil size={14}/></button>
              {isAdmin && <><button className="icon-btn danger" title={t("common.delete")} onClick={e=>{e.stopPropagation();onOpenDelete([c.id],[c.name]);}}><Trash2 size={14}/></button>
                <button className="icon-btn" title={t("nav.archived")} onClick={e=>{e.stopPropagation();onArchive&&onArchive(c.id);}}><Archive size={14}/></button></>}
            </span>
          </div>
        ))}
        {clients.length===0&&<div className="empty-state">{t("clients.noResults")}</div>}
      </div>
    </div>
  );
}

function Kanban({ clients, updateStatus, updateClientField, onAssigned, selectedIds, onOpenEdit, onOpenDelete, onOpenDetail, isAdmin, onArchive, allStatuses, allChannels, allLocations, users, onAddStatus, onAddChannel, onAddLocation, t }: { clients: Client[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; isAdmin?: boolean; onArchive?: (id: string) => void | Promise<void>; allStatuses?: string[]; allChannels?: string[]; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; t: TFn }) {
  const [draggedId, setDraggedId] = useState<string|null>(null);
  const [dropTarget, setDropTarget] = useState<string|null>(null);
  const columns: string[] = [...new Set([...(allStatuses ?? ["WAITING","WON","LOST"]), ...clients.map(c => c.status)])];
  return (
    <div className="kanban-board">
      {columns.map(col=>(
        <section key={col} className={`kanban-col ${dropTarget===col?"drop-target":""}`}
          onDragEnter={()=>setDropTarget(col)} onDragOver={e=>{e.preventDefault();setDropTarget(col);}}
          onDragLeave={()=>setDropTarget(null)} onDrop={()=>{if(draggedId){updateStatus(draggedId,col);setDraggedId(null);setDropTarget(null);}}}>
          <div className="kanban-head">
            <span className={`kanban-dot dot-${col.toLowerCase()}`}/><span>{statusLabel(t, col)}</span><small>{clients.filter(c=>c.status===col).length}</small>
          </div>
          {clients.filter(c=>c.status===col).map(c=>(
            <article className={`client-card ${draggedId===c.id?"dragging":""} ${selectedIds.has(c.id)?"card-selected":""}`} key={c.id} draggable onDragStart={()=>setDraggedId(c.id)} onDragEnd={()=>{setDraggedId(null);setDropTarget(null);}} onDoubleClick={()=>onOpenDetail(c)}>
              <div className="card-top"><b className="card-name">{c.name}</b><span className="card-actions no-detail">
                <button className="icon-btn-sm" title={t("common.edit")} onClick={e=>{e.stopPropagation();onOpenEdit(c);}}><Pencil size={12}/></button>
                {isAdmin && <><button className="icon-btn-sm danger" title={t("common.delete")} onClick={e=>{e.stopPropagation();onOpenDelete([c.id],[c.name]);}}><Trash2 size={12}/></button>
                  <button className="icon-btn-sm" title={t("nav.archived")} onClick={e=>{e.stopPropagation();onArchive&&onArchive(c.id);}}><Archive size={12}/></button></>}
              </span></div>
              <div className="card-ch">
                <i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>
                <span>{channelLabel(t, c.acquisitionChannel)}</span>
              </div>
              <p className="card-project">{c.project}</p>
              <p className="card-location">{c.location}</p>
              {c.notes&&<p className="card-notes"><MessageSquare size={10}/>{c.notes.slice(0,40)}{c.notes.length>40?"...":""}</p>}
              <strong className="card-op">{c.operationToTake}</strong>
              <footer className="card-contacts">
                <span className="muted">{t("card.first")}: {c.firstContactPerson || "—"}</span>
                <span className="muted">{t("card.second")}: {c.secondContactPerson || "—"}</span>
              </footer>
              <div className="card-status-wrap">
                <span className={`status-pill status-${String(c.status).toLowerCase()}`}>{statusLabel(t, c.status)}</span>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
function AddNewSelect({ value, options, onChange, onAdd, render, placeholder, t }: {
  value: string; options: string[];
  onChange: (v: string) => void;
  onAdd?: (v: string) => Promise<string | void>;
  render?: (v: string) => string;
  placeholder?: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const confirmAdd = async () => {
    const val = text.trim();
    if (!val) { setAdding(false); return; }
    const res = onAdd ? await onAdd(val) : val;
    const final = typeof res === "string" && res ? res : val;
    onChange(final);
    setAdding(false); setText("");
  };

  if (adding) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input
          autoFocus
          value={text}
          placeholder={placeholder ?? t("form.newValuePh")}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") confirmAdd(); else if (e.key === "Escape") { setAdding(false); setText(""); } }}
          style={{ flex: 1, height: 36, border: "1px solid #dfe2e6", borderRadius: 6, padding: "0 10px", fontSize: 12, outline: "none" }}
        />
        <button type="button" className="btn-sm" onClick={confirmAdd}><Check size={14} />{t("form.addBtn")}</button>
        <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setText(""); }}>{t("common.cancel")}</button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => { if (e.target.value === "__NEW__") { setAdding(true); } else { onChange(e.target.value); } }}
    >
      <option value="" disabled>{placeholder ?? t("form.statusPh")}</option>
      {options.map(o => <option key={o} value={o}>{render ? render(o) : o}</option>)}
      <option value="__NEW__">{t("form.addNewOpt")}</option>
    </select>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (<label className={wide?"field field-wide":"field"}><span>{label}</span>{children}</label>);}

