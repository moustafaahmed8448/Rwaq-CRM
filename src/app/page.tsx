"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";
import {
  ArrowUpRight, ChevronDown, Download, Grid2X2,
  LayoutDashboard, Pencil, Plus, Search, Trash2, UsersRound, X as XIcon,
  Check, AlertCircle, MessageSquare, Filter, Hash, UserCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";

type Client = {
  id: string; name: string; phoneNumber: string;
  status: "WAITING" | "WON" | "LOST" | string;
  project: string; location: string; acquisitionChannel: string;
  operationToTake: string; firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string;
};
type Metric = { channel: string; platform: string; spend: number; reach: number; totalClients: number; won: number; lost: number; waiting: number; cpa: number };
type User = { name: string; initials: string; role: string };
type Filters = { query: string; status: string; channel: string; location: string; salesperson: string; startDate: string; endDate: string };
type EditDraft = Partial<Client> & { id: string };
type ConfirmDelete = { ids: string[]; names: string[] };
type Toast = { id: number; type: "success" | "error" | "info"; message: string };
type DatePreset = { label: string; startDate?: string; endDate?: string };
type SpStat = { name: string; won: number; lost: number; waiting: number; total: number; winRate: string };

const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CH_COLORS: Record<string, string> = { FACEBOOK: "#4f46e5", INSTAGRAM: "#e11d48", X: "#111827", TIKTOK: "#7c3aed", GOOGLE_ADS: "#d97706", WHATSAPP: "#16a34a", CALLS: "#ea580c", SALES: "#0891b2" };
const CH_LABELS: Record<string, string> = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", X: "X", TIKTOK: "TikTok", GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", CALLS: "Calls", SALES: "Sales" };
const CHANNEL_VALUES = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "GOOGLE_ADS", "WHATSAPP", "CALLS", "SALES"] as const;
const PREDEFINED_STATUSES = ["WAITING", "WON", "LOST"];
const STATUS_LABELS: Record<string, string> = { WAITING: "Waiting", WON: "Won", LOST: "Lost" };
const CUSTOM_LOCATIONS = ["New Cairo", "6th of October", "North Coast"] as const;

const DATE_PRESETS: DatePreset[] = [
  { label: "Today", startDate: new Date().toISOString().slice(0, 10) },
  { label: "This week", startDate: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); })() },
  { label: "Last 7 days", startDate: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })() },
  { label: "This month", startDate: (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })() },
];

const initialFilters: Filters = { query: "", status: "ALL", channel: "ALL", location: "ALL", salesperson: "ALL", startDate: "", endDate: "" };

function matchesFilters(client: Client, filters: Filters) {
  const date = (client.createdAt || "").slice(0, 10);
  return (filters.status === "ALL" || String(client.status) === filters.status) &&
    (filters.channel === "ALL" || client.acquisitionChannel === filters.channel) &&
    (filters.location === "ALL" || client.location === filters.location) &&
    (filters.salesperson === "ALL" || client.firstContactPerson === filters.salesperson || client.secondContactPerson === filters.salesperson) &&
    (!filters.startDate || date >= filters.startDate) && (!filters.endDate || date <= filters.endDate) &&
    `${client.name} ${client.phoneNumber} ${client.project} ${client.notes ?? ""}`.toLowerCase().includes(filters.query.toLowerCase());
}

let toastId = 0;

export default function Home() {
  const router = useRouter();
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
    if (v === "clients") setView("clients");
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const stored = localStorage.getItem("rwaq-dark");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(cur => ({ ...cur, [key]: value }));
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

  const activeFilterCount = [filters.status, filters.channel, filters.location, filters.salesperson, filters.startDate, filters.endDate, filters.query]
    .filter(v => v !== "ALL" && v !== "").length;

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
  const closeEdit = () => setEditDraft(null);
  const openDetail = (client: Client) => setDetailClient(client);
  const closeDetail = () => setDetailClient(null);

  const saveEdit = async () => {
    if (!editDraft) return;
    await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editDraft) });
    setClients(prev => prev.map(c => c.id === editDraft.id ? { ...c, ...editDraft, lastUpdateDate: new Date().toISOString() } : c));
    if (detailClient?.id === editDraft.id) setDetailClient(prev => prev ? { ...prev, ...editDraft } : null);
    closeEdit();
    addToast("success", `Saved changes for ${editDraft.name ?? editDraft.id}`);
  };

  const deleteSelected = async () => {
    if (!confirmDelete || confirmDelete.ids.length === 0) return;
    for (const id of confirmDelete.ids) await fetch("/api/crm/clients", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setClients(prev => prev.filter(c => !confirmDelete.ids.includes(c.id)));
    setSelectedIds(new Set());
    closeDelete();
    addToast("success", `Deleted ${confirmDelete.ids.length} client(s)`);
  };
  const closeDelete = () => setConfirmDelete(null);

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(prev => prev.size === filteredClients.length ? new Set() : new Set(filteredClients.map(c => c.id)));

  const updateStatus = async (id: string, status: string) => {
    await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    setClients(prev => prev.map(c => c.id === id ? { ...c, status, lastUpdateDate: new Date().toISOString() } : c));
    if (detailClient?.id === id) setDetailClient(prev => prev ? { ...prev, status } : null);
    addToast("info", `Status changed to ${STATUS_LABELS[status] ?? status}`);
  };

  const updateClientField = async (id: string, patch: Partial<Client>) => {
    await fetch("/api/crm/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) }).catch(() => {});
    setClients(prev => prev.map(c => c.id === id ? { ...c, ...patch, lastUpdateDate: new Date().toISOString() } : c));
    if (detailClient?.id === id) setDetailClient(prev => prev ? { ...prev, ...patch } : null);
    const [k, v] = Object.entries(patch)[0] ?? [];
    if (k) addToast("info", `Updated ${k} to ${v}`);
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

  const exportSelected = () => {
    const sel = filteredClients.filter(c => selectedIds.has(c.id));
    if (sel.length === 0) { addToast("info", "No clients selected"); return; }
    const headers = ["Client ID", "Created Date", "Name", "Phone", "Status", "Project", "Location", "Channel", "Operation", "1st Contact", "2nd Contact", "Notes", "Last Updated"];
    const rows = sel.map(c => [c.id, c.createdAt || "", c.name, c.phoneNumber, c.status, c.project, c.location, CH_LABELS[c.acquisitionChannel] ?? c.acquisitionChannel, c.operationToTake, c.firstContactPerson, c.secondContactPerson, c.notes ?? "", c.lastUpdateDate ? new Date(c.lastUpdateDate).toLocaleDateString() : ""]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = `rwaq-clients-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  const exportExcel = () => {
    const headers = ["Client ID", "Created Date", "Name", "Phone", "Status", "Project", "Location", "Channel", "Operation", "1st Contact", "2nd Contact", "Notes", "Last Updated"];
    const rows = filteredClients.map(c => [c.id, c.createdAt || "", c.name, c.phoneNumber, c.status, c.project, c.location, CH_LABELS[c.acquisitionChannel] ?? c.acquisitionChannel, c.operationToTake, c.firstContactPerson, c.secondContactPerson, c.notes ?? "", c.lastUpdateDate ? new Date(c.lastUpdateDate).toLocaleDateString() : ""]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = `rwaq-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const response = await fetch("/api/sync/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "report", ...filters }) });
      if (!response.ok) { const d = await response.json(); throw new Error(d.error || "Export failed"); }
      exportExcel(); addToast("success", "Report exported");
    } catch (e) { addToast("error", e instanceof Error ? e.message : "Export failed"); }
    finally { setExporting(false); }
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); };

  if (!user) return <main className="shell-loading"><div className="spinner" /><p>Loading workspace...</p></main>;

  return (
    <main className="shell">
      <AppHeader
        user={user}
        active={view}
        badge={filteredClients.length !== clients.length
          ? <span className="badge-count">{filteredClients.length}/{clients.length}</span>
          : (waiting > 0 ? <span className="badge">{waiting} pending</span> : null)}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        onNavigate={(tab) => {
          if (tab === "dashboard") setView("dashboard");
          else if (tab === "clients") setView("clients");
          else router.push(tab === "marketing" ? "/marketing" : "/settings");
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
          />
        ) : (
          <ClientsView
            clients={filteredClients} allClients={clients} mode={mode} setMode={setMode}
            filters={filters} updateFilter={updateFilter}
            salespeople={salespeople} updateStatus={updateStatus} updateClientField={updateClientField}
            onAssigned={refreshNotifications}
            selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll}
            onOpenEdit={openEdit} onOpenDelete={(ids: string[], names: string[]) => setConfirmDelete({ ids, names })}
            onOpenDetail={openDetail}
            exportExcel={exportExcel} exportSelected={exportSelected}
            bulkCount={selectedIds.size}
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
          />
        )}
      </div>

      {/* Edit Modal */}
      {editDraft && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Edit client</h2><button className="modal-close" onClick={closeEdit}><XIcon size={18} /></button></div>
            <div className="modal-body">
              <div className="form-grid">
                <Field label="Name"><input value={editDraft.name ?? ""} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} /></Field>
                <Field label="Phone"><input value={editDraft.phoneNumber ?? ""} onChange={e => setEditDraft({ ...editDraft, phoneNumber: e.target.value })} /></Field>
                <Field label="Project"><input value={editDraft.project ?? ""} onChange={e => setEditDraft({ ...editDraft, project: e.target.value })} /></Field>
                <Field label="Location">
                  <AddNewSelect value={editDraft.location ?? ""} options={allLocations} onAdd={addLocation} onChange={v => setEditDraft({ ...editDraft, location: v })} placeholder="Select location…" />
                </Field>
                <Field label="Channel">
                  <AddNewSelect value={editDraft.acquisitionChannel ?? ""} options={allChannels} onAdd={addChannel} onChange={v => setEditDraft({ ...editDraft, acquisitionChannel: v })} render={v => CH_LABELS[v] ?? v} placeholder="Select channel…" />
                </Field>
                <Field label="Status">
                  <AddNewSelect value={editDraft.status ?? ""} options={allStatuses} onAdd={addStatus} onChange={v => setEditDraft({ ...editDraft, status: v })} placeholder="Select status…" />
                </Field>
                <Field label="1st contact">
                  <select value={editDraft.firstContactPerson ?? ""} onChange={e => setEditDraft({ ...editDraft, firstContactPerson: e.target.value })}>
                    <option value="">Select salesperson...</option>
                    {users.map(u => <option key={u.username} value={u.name}>{u.name}</option>)}
                  </select>
                </Field>
                <Field label="2nd contact">
                  <select value={editDraft.secondContactPerson ?? ""} onChange={e => setEditDraft({ ...editDraft, secondContactPerson: e.target.value })}>
                    <option value="">-- None --</option>
                    {users.map(u => <option key={u.username} value={u.name}>{u.name}</option>)}
                  </select>
                </Field>
                <Field label="Next operation" wide><input value={editDraft.operationToTake ?? ""} onChange={e => setEditDraft({ ...editDraft, operationToTake: e.target.value })} /></Field>
                <Field label="Notes" wide><textarea value={editDraft.notes ?? ""} onChange={e => setEditDraft({ ...editDraft, notes: e.target.value })} rows={3} placeholder="Internal notes about this client..." /></Field>
              </div>
            </div>
            <div className="modal-footer"><button className="btn-ghost" onClick={closeEdit}>Cancel</button><button className="btn-primary" onClick={saveEdit}><Check size={15} />Save changes</button></div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={closeDelete}>
          <div className="modal delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>{confirmDelete.ids.length > 1 ? "Delete clients" : "Delete client"}</h2><button className="modal-close" onClick={closeDelete}><XIcon size={18} /></button></div>
            <div className="modal-body">
              <div className="delete-warning"><AlertCircle size={28} /><div><strong>Are you sure?</strong><p>You&apos;re about to delete <em>{confirmDelete.ids.length} client(s)</em>. This action cannot be undone.</p>{confirmDelete.names.length > 0 && <p className="delete-names">{confirmDelete.names.join(", ")}</p>}</div></div>
            </div>
            <div className="modal-footer"><button className="btn-ghost" onClick={closeDelete}>Cancel</button><button className="btn-danger" onClick={deleteSelected}><Trash2 size={15} />Delete</button></div>
          </div>
        </div>
      )}

      {/* Client Detail Side Panel */}
      {detailClient && (
        <div className="detail-overlay" onClick={closeDetail}>
          <div className="detail-panel" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <div><div className="breadcrumb"><UsersRound size={14} />Client details</div><h2>{detailClient.name}</h2></div>
              <button className="modal-close" onClick={closeDetail}><XIcon size={18} /></button>
            </div>
            <div className="detail-body">
              <div className="detail-meta">
                <div className="meta-item"><span className="meta-label">Phone</span><span className="meta-value">{detailClient.phoneNumber}</span></div>
                <div className="meta-item"><span className="meta-label">Status</span>
                  <select className={`status-select status-${String(detailClient.status).toLowerCase()}`} value={detailClient.status} onChange={e => updateStatus(detailClient.id, e.target.value)}>
                    {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="meta-item"><span className="meta-label">Source</span><span className="chan-tag-inline"><i className="dot" style={{ background: CH_COLORS[detailClient.acquisitionChannel] }} />{CH_LABELS[detailClient.acquisitionChannel]}</span></div>
                <div className="meta-item"><span className="meta-label">Project</span><span className="meta-value">{detailClient.project}</span></div>
                <div className="meta-item"><span className="meta-label">Location</span><span className="meta-value">{detailClient.location}</span></div>
                <div className="meta-item"><span className="meta-label">1st Contact</span><span className="meta-value">{detailClient.firstContactPerson}</span></div>
                <div className="meta-item"><span className="meta-label">2nd Contact</span><span className="meta-value">{detailClient.secondContactPerson || "—"}</span></div>
                <div className="meta-item full"><span className="meta-label">Next Operation</span><span className="meta-value op-value">{detailClient.operationToTake}</span></div>
                {detailClient.notes && <div className="meta-item full"><span className="meta-label">Notes</span><p className="notes-text">{detailClient.notes}</p></div>}
                <div className="meta-item full"><span className="meta-label">Created</span><span className="meta-value muted">{detailClient.createdAt ? new Date(detailClient.createdAt).toLocaleDateString() : "—"}</span></div>
                <div className="meta-item full"><span className="meta-label">Last updated</span><span className="meta-value muted">{detailClient.lastUpdateDate ? new Date(detailClient.lastUpdateDate).toLocaleString() : "—"}</span></div>
              </div>
              <div className="detail-actions">
                <button className="btn-outline" onClick={() => { openEdit(detailClient); closeDetail(); }}><Pencil size={14} />Edit</button>
                <button className="btn-outline" onClick={() => { closeDetail(); setTimeout(() => router.push(`/clients/${detailClient.id}`), 200); }}><ArrowUpRight size={14} />Full history</button>
                <button className="btn-danger-outline" onClick={() => { closeDetail(); setTimeout(() => setConfirmDelete({ ids: [detailClient.id], names: [detailClient.name] }), 200); }}><Trash2 size={14} />Delete</button>
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

function FilterBar({ filters, updateFilter, salespeople, datePresets, activeDatePreset, applyDatePreset, clearDatePreset, filterCount, allStatuses, allChannels, allLocations }: {
  filters: Filters;
  updateFilter: (k: keyof Filters, v: string) => void;
  salespeople: string[];
  datePresets?: DatePreset[];
  activeDatePreset?: string | null;
  applyDatePreset?: (p: DatePreset) => void;
  clearDatePreset?: () => void;
  filterCount?: number;
  allStatuses?: string[];
  allChannels?: string[];
  allLocations?: string[];
}) {
  const hasPreset = activeDatePreset || filters.startDate || filters.endDate;
  return (
    <>
      {datePresets && datePresets.length > 0 && (
        <div className="date-presets">
          {datePresets.map(p => (
            <button key={p.label} className={`date-preset-btn ${activeDatePreset === p.label ? 'active' : ''}`}
              onClick={() => applyDatePreset!(p)}>{p.label}</button>
          ))}
          {hasPreset && <button className="date-preset-btn" onClick={clearDatePreset}>Clear dates</button>}
        </div>
      )}
      <div className="filter-row">
        <div className="search-box"><Search size={15}/><input placeholder="Search name, phone, notes..." value={filters.query} onChange={e=>updateFilter("query",e.target.value)}/></div>
        <select value={filters.status} onChange={e=>updateFilter("status",e.target.value)} style={{height:36,border:"1px solid #dfe2e6",borderRadius:6,padding:"0 8px",fontSize:12,color:"#6b7280",background:"#fff",cursor:"pointer"}}><option value="ALL">All statuses</option>{(allStatuses??[]).map(s=><option key={s} value={s}>{s}</option>)}</select>
        <select value={filters.channel} onChange={e=>updateFilter("channel",e.target.value)} style={{height:36,border:"1px solid #dfe2e6",borderRadius:6,padding:"0 8px",fontSize:12,color:"#6b7280",background:"#fff",cursor:"pointer"}}><option value="ALL">All channels</option>{(allChannels??[]).map(ch=><option key={ch} value={ch}>{CH_LABELS[ch]??ch}</option>)}</select>
        <select value={filters.location} onChange={e=>updateFilter("location",e.target.value)} style={{height:36,border:"1px solid #dfe2e6",borderRadius:6,padding:"0 8px",fontSize:12,color:"#6b7280",background:"#fff",cursor:"pointer"}}><option value="ALL">All locations</option>{(allLocations??[]).map(l=><option key={l} value={l}>{l}</option>)}</select>
        <select value={filters.salesperson} onChange={e=>updateFilter("salesperson",e.target.value)} style={{height:36,border:"1px solid #dfe2e6",borderRadius:6,padding:"0 8px",fontSize:12,color:"#6b7280",cursor:"pointer",background:"#fff"}}>
          <option value="ALL">All salespeople</option>{salespeople.map(p=><option key={p}>{p}</option>)}</select>
      </div>
      <div className="date-bar"><Filter size={13}/><span>Date</span><input type="date" value={filters.startDate} onChange={e=>updateFilter("startDate",e.target.value)}/><span>–</span><input type="date" value={filters.endDate} onChange={e=>updateFilter("endDate",e.target.value)}/></div>
      {(filterCount ?? 0) > 0 && <div className="filter-chips"><span className="filter-chip"><Hash size={10}/> {filterCount ?? 0} active filter{filterCount??0>1?'s':''} <button onClick={()=>{clearDatePreset&&clearDatePreset();}}>×</button></span></div>}
    </>
  );
}

function Dashboard({ metrics, totalSpend, totalReach, won, lost, waiting, clients, salespeople, spStats, updateStatus, updateClientField, allStatuses, allChannels, allLocations, onAddStatus, onAddChannel, onAddLocation, onExport, exporting }: { metrics: Metric[]; totalSpend: number; totalReach: number; won: number; lost: number; waiting: number; clients: Client[]; salespeople: string[]; spStats: SpStat[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; allStatuses: string[]; allChannels: string[]; allLocations: string[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void>; onExport: () => void; exporting: boolean }) {
  const recentClients = useMemo(() => [...clients].sort((a,b) => String(b.lastUpdateDate||"").localeCompare(String(a.lastUpdateDate||""))).slice(0,5), [clients]);
  const topLocations = useMemo(() => { const m = new Map<string,number>(); clients.forEach(c=>m.set(c.location,(m.get(c.location)||0)+1)); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5); }, [clients]);

  return (
    <div className="page">
      {/* KPI strip */}
      <section className="kpi-row kpi-row-6">
        <KpiCard label="Total spend" value={`$${MONEY.format(totalSpend)}`} sub="Weekly investment" accent="#4f46e5"/>
        <KpiCard label="Total reach" value={MONEY.format(totalReach)} sub="Across all channels" accent="#0891b2"/>
        <KpiCard label="Won" value={String(won)} sub={`${won+lost?Math.round(won/(won+lost)*100):0}% win rate`} accent="#22c55e"/>
        <KpiCard label="Lost" value={String(lost)} sub={`${lost>0?Math.round(lost/(won+lost)*100):0}% of total`} accent="#ef4444"/>
        <KpiCard label="In pipeline" value={String(waiting)} sub="Awaiting action" accent="#f59e0b"/>
        <KpiCard label="Avg CPA" value={metrics.length?`$${Math.round(totalSpend/(won||1))}`:"—"} sub={won>0?`${won} customers won`:"No wins yet"} accent="#7c3aed"/>
      </section>

      {/* Funnel + ROI */}
      <section className="funnel-row">
        <div className="panel funnel-panel">
          <h3>Conversion funnel</h3>
          <div className="funnel-stages">
            <div className="funnel-stage stage-total"><span className="funnel-num">{clients.length}</span><span className="funnel-label">Total</span></div>
            <div className="funnel-arrow">↓</div>
            <div className="funnel-stage stage-waiting"><span className="funnel-num">{waiting}</span><span className="funnel-label">Waiting</span></div>
            <div className="funnel-arrow">↓</div>
            <div className="funnel-stage stage-won"><span className="funnel-num">{won}</span><span className="funnel-label">Won</span></div>
            <div className="funnel-stage stage-lost"><span className="funnel-num">{lost}</span><span className="funnel-label">Lost</span></div>
          </div>
        </div>
        <div className="panel channel-roi-panel">
          <h3>Channel ROI</h3>
          <div className="roi-table">
            <div className="roi-head"><span>Channel</span><span>Spend</span><span>Won</span><span>CPA</span></div>
            {metrics.filter((m: Metric)=>m.totalClients>0).map((m: Metric)=>(
              <div className="roi-row" key={m.channel}>
                <span className="chan-cell"><i className="dot" style={{background:CH_COLORS[m.channel]}}/>{m.platform}</span>
                <span>${MONEY.format(m.spend)}</span><span>{m.won}</span>
                <span className={m.cpa<100?"good":m.cpa<500?"":"bad"}>{m.cpa>0?`$${m.cpa.toFixed(0)}`:"—"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recent clients + Top locations */}
      <div className="dashboard-grid-2">
        <section className="panel">
          <div className="panel-heading"><h3>Recent clients</h3><button className="btn-ghost" onClick={()=>onExport()} disabled={exporting} style={{fontSize:11}}>Export</button></div>
          {recentClients.length === 0 && <div className="empty-state">No clients yet.</div>}
          {recentClients.map(c => (
            <div className="recent-client-row" key={c.id}>
              <span className="rc-avatar">{c.name.slice(0,2).toUpperCase()}</span>
              <div className="rc-info"><strong>{c.name}</strong><small>{c.project}{c.location ? ` · ${c.location}` : ""}</small></div>
              <span className="chan-tag-inline" style={{ flexShrink: 0 }}><i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>{CH_LABELS[c.acquisitionChannel]??c.acquisitionChannel}</span>
              <span className={`status-pill status-${String(c.status).toLowerCase()}`} style={{ flexShrink: 0 }}>{STATUS_LABELS[c.status] ?? c.status}</span>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading"><h3>Top locations</h3><span className="muted" style={{fontSize:11}}>{clients.length} clients</span></div>
          {topLocations.length === 0 && <div className="empty-state">No location data.</div>}
          {topLocations.map(([loc, count], i) => (
            <div className="loc-bar-row" key={loc}>
              <span className="loc-rank">#{i+1}</span>
              <div className="loc-bar-track"><div className="loc-bar-fill" style={{width: `${Math.round(count/clients.length*100)}%`, background: ["#4f46e5","#0891b2","#f59e0b","#22c55e","#7c3aed"][i]}}/></div>
              <span className="loc-name">{loc}</span>
              <span className="loc-count">{count}</span>
            </div>
          ))}
          <div style={{marginTop:20,borderTop:"1px solid var(--line)",paddingTop:14}}>
            <h3 style={{margin:"0 0 10px",fontSize:13}}>Sales Performance</h3>
            {spStats.length === 0 && <div className="empty-state" style={{fontSize:11,padding:"8px 0"}}>No data yet</div>}
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
        </section>
      </div>

      {/* Channel breakdown */}
      <section className="panel channel-breakdown-panel">
        <h3>Channel breakdown <small>{clients.length} clients</small></h3>
        <div className="table-head-row"><span>Platform</span><span>Spend</span><span>Reach</span><span>Clients</span><span>CPA</span></div>
        {metrics.map((item: Metric)=><div className="table-row" key={item.channel}>
          <span className="chan-cell"><i className="dot" style={{background:CH_COLORS[item.channel]}}/>{item.platform}</span>
          <span>${MONEY.format(item.spend)}</span><span>{MONEY.format(item.reach)}</span><span>{item.totalClients}</span><span>{item.cpa.toFixed(2)}</span>
        </div>)}
      </section>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (<div className="kpi-card" style={{borderTopColor:accent}}><div className="kpi-label"><span>{label}</span><span className="kpi-dot" style={{background:accent}}/></div><div className="kpi-value">{value}</div><div className="kpi-sub">{sub}</div></div>);}

function ClientsView({ clients, allClients, mode, setMode, filters, updateFilter, salespeople, updateStatus, updateClientField, onAssigned,
  selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenDelete, onOpenDetail,
  exportExcel, exportSelected, bulkCount, onBulkDelete, allStatuses, allChannels,
  customLocationInput, setCustomLocationInput, customChannels, activeDatePreset,
  applyDatePreset, clearDatePreset, datePresets, filterCount, allLocations, users, onAddStatus, onAddChannel, onAddLocation }: { clients: Client[]; allClients: Client[]; mode: "table"|"kanban"; setMode: (m: "table"|"kanban") => void; filters: Filters; updateFilter: (k: keyof Filters, v: string) => void; salespeople: string[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; toggleSelect: (id: string) => void; toggleSelectAll: () => void; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; exportExcel: () => void; exportSelected: () => void; bulkCount: number; onBulkDelete: () => void; allStatuses: string[]; allChannels: string[]; customLocationInput: string; setCustomLocationInput: (v: string) => void; customChannels: string[]; activeDatePreset?: string | null; applyDatePreset?: (p: DatePreset) => void; clearDatePreset?: () => void; datePresets?: DatePreset[]; filterCount?: number; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void> }) {
  return (
    <div className="page">
      <div className="page-header">
        <div><div className="breadcrumb"><UsersRound size={14}/>CRM</div><h1>Clients</h1><p>Manage your pipeline. Click a client to view details.</p></div>
        <div className="header-actions">
          {bulkCount>0&&<span className="selection-info">{bulkCount} selected<button className="btn-danger-sm" onClick={onBulkDelete}>Delete selected</button></span>}
          <div className="segmented">
            <button className={mode==="table"?"seg-active":""} onClick={()=>setMode("table")}><LayoutDashboard size={14}/>Table</button>
            <button className={mode==="kanban"?"seg-active":""} onClick={()=>setMode("kanban")}><Grid2X2 size={14}/>Kanban</button>
          </div>
          <button className="btn-outline" onClick={exportSelected} disabled={bulkCount===0}><Download size={15}/>Export selected ({bulkCount})</button>
          <button className="btn-outline" onClick={exportExcel}><Download size={15}/>Export all</button>
        </div>
      </div>
      <FilterBar filters={filters} updateFilter={updateFilter} salespeople={salespeople} datePresets={datePresets} activeDatePreset={activeDatePreset} applyDatePreset={applyDatePreset} clearDatePreset={clearDatePreset} filterCount={filterCount ?? 0} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} />
      <div className="result-note">Showing {clients.length} of {allClients.length} clients</div>
      {mode==="table"? <ClientTable clients={clients} updateStatus={updateStatus} updateClientField={updateClientField} onAssigned={onAssigned} selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} tableRef={null} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} users={users} onAddStatus={onAddStatus} onAddChannel={onAddChannel} onAddLocation={onAddLocation}/>:<Kanban clients={clients} updateStatus={updateStatus} updateClientField={updateClientField} onAssigned={onAssigned} selectedIds={selectedIds} onOpenEdit={onOpenEdit} onOpenDelete={onOpenDelete} onOpenDetail={onOpenDetail} allStatuses={allStatuses} allChannels={allChannels} allLocations={allLocations ?? []} users={users} onAddStatus={onAddStatus} onAddChannel={onAddChannel} onAddLocation={onAddLocation}/>}
    </div>
  );
}


function Picker({ label, value, options, onChange, onAddNew }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
  onAddNew?: (v: string) => Promise<void>;
}) {
  const [input, setInput] = useState(value);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const filtered = options.filter(o => o.toLowerCase().includes(input.toLowerCase()) && o.toLowerCase() !== input.toLowerCase());
  const isCustom = input.length > 0 && !options.some(o => o.toLowerCase() === input.toLowerCase());

  const commit = async (val: string) => {
    setInput(val);
    onChange(val);
    setOpen(false);
    if (onAddNew && val.length > 0 && !options.some(o => o.toLowerCase() === val.toLowerCase())) {
      setAdding(true);
      try { await onAddNew(val); } catch {} finally { setAdding(false); }
    }
  };

  return (
    <div className="picker-wrapper">
      <span className="picker-label">{label}</span>
      <div className={`picker-box ${open ? "open" : ""}`}>
        <button type="button" className="picker-selected" onClick={() => setOpen(!open)}>
          <span className="picker-selected-text">{value || `Select ${label}...`}</span>
          <ChevronDown size={12} className="picker-chevron" />
        </button>
        {open && <><div className="picker-overlay" onClick={() => setOpen(false)} /><div className="picker-dropdown">
          {filtered.slice(0, 8).map(opt => (
            <button key={opt} type="button" className="picker-option" onClick={() => commit(opt)}>{opt}</button>
          ))}
          {isCustom && (
            <button type="button" className="picker-option picker-add" onClick={() => commit(input)} disabled={adding}>
              {adding ? "Saving…" : `+ Save “${input}”`}
            </button>
          )}
        </div></>}
      </div>
    </div>
  );
}

function ClientTable({ clients, updateStatus, updateClientField, onAssigned, selectedIds, toggleSelect, toggleSelectAll, onOpenEdit, onOpenDelete, onOpenDetail, tableRef, allStatuses, allChannels, allLocations, users, onAddStatus, onAddChannel, onAddLocation }: { clients: Client[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; toggleSelect: (id: string) => void; toggleSelectAll: () => void; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; tableRef?: React.RefObject<HTMLDivElement> | null; allStatuses?: string[]; allChannels?: string[]; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void> }) {
  const allSelected = clients.length>0&&clients.every(c=>selectedIds.has(c.id));
  return (
    <div className="table-scroll-wrapper">
      <div className="scroll-indicator-left hidden" ref={(el) => { if(el) { const t = tableRef?.current; if(t){ const check = ()=>{ el.classList.toggle("hidden", t.scrollLeft <= 0); }; check(); t.addEventListener("scroll",check,{passive:true}); } } }} />
      <div className="scroll-indicator-right hidden" />
      <div className="client-table" ref={tableRef}>
        <div className="client-row client-head">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="cb"/>
          <span>Client</span><span>Status</span><span>Source</span><span>Project</span><span>Location</span><span>Date</span><span>Operation</span><span>1st</span><span>2nd</span><span>Updated</span><span/></div>
        {clients.map(c=>(
          <div className={`client-row client-row-clickable ${selectedIds.has(c.id)?"selected":""}`} key={c.id} onClick={e=>{(e.target as HTMLElement).tagName!=="INPUT"&&(e.target as HTMLElement).tagName!=="SELECT"&&! (e.target as HTMLElement).closest(".no-detail")&&onOpenDetail(c)}}>
            <input type="checkbox" checked={selectedIds.has(c.id)} onChange={()=>toggleSelect(c.id)} className="cb" onClick={e=>e.stopPropagation()}/>  
            <span className="person-cell" onClick={()=>onOpenDetail(c)}><b>{c.name}</b><small>{c.phoneNumber}</small>{c.notes&&<span className="notes-indicator"><MessageSquare size={10}/></span>}</span>
            <span className={`status-pill status-${String(c.status).toLowerCase()}`}>{STATUS_LABELS[c.status] ?? c.status}</span>
            <span className="chan-tag"><i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>{CH_LABELS[c.acquisitionChannel]??c.acquisitionChannel}</span>
            <span>{c.project}</span><span>{c.location}</span><span className="muted">{c.createdAt?new Date(c.createdAt).toLocaleDateString():"—"}</span>
            <span className="op-text">{c.operationToTake}</span>
            <span className="muted">{c.firstContactPerson || "—"}</span>
            <span className="muted">{c.secondContactPerson || "—"}</span>
            <span className="muted">{c.lastUpdateDate?new Date(c.lastUpdateDate).toLocaleDateString():"—"}</span>
            <span className="actions-cell no-detail">
              <button className="icon-btn" title="Edit" onClick={e=>{e.stopPropagation();onOpenEdit(c);}}><Pencil size={14}/></button>
              <button className="icon-btn danger" title="Delete" onClick={e=>{e.stopPropagation();onOpenDelete([c.id],[c.name]);}}><Trash2 size={14}/></button>
            </span>
          </div>
        ))}
        {clients.length===0&&<div className="empty-state">No clients match your filters.</div>}
      </div>
    </div>
  );
}

function Kanban({ clients, updateStatus, updateClientField, onAssigned, selectedIds, onOpenEdit, onOpenDelete, onOpenDetail, allStatuses, allChannels, allLocations, users, onAddStatus, onAddChannel, onAddLocation }: { clients: Client[]; updateStatus: (id: string, s: string) => void; updateClientField: (id: string, patch: Partial<Client>) => void; onAssigned?: () => void; selectedIds: Set<string>; onOpenEdit: (c: Client) => void; onOpenDelete: (ids: string[], names: string[]) => void; onOpenDetail: (c: Client) => void; allStatuses?: string[]; allChannels?: string[]; allLocations?: string[]; users?: { username: string; name: string; role: string }[]; onAddStatus?: (s: string) => Promise<string | void>; onAddChannel?: (s: string) => Promise<string | void>; onAddLocation?: (s: string) => Promise<string | void> }) {
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
            <span className={`kanban-dot dot-${col.toLowerCase()}`}/><span>{STATUS_LABELS[col]??col}</span><small>{clients.filter(c=>c.status===col).length}</small>
          </div>
          {clients.filter(c=>c.status===col).map(c=>(
            <article className={`client-card ${draggedId===c.id?"dragging":""} ${selectedIds.has(c.id)?"card-selected":""}`} key={c.id} draggable onDragStart={()=>setDraggedId(c.id)} onDragEnd={()=>{setDraggedId(null);setDropTarget(null);}} onDoubleClick={()=>onOpenDetail(c)}>  
              <div className="card-top"><b className="card-name">{c.name}</b><span className="card-actions no-detail">
                <button className="icon-btn-sm" title="Edit" onClick={e=>{e.stopPropagation();onOpenEdit(c);}}><Pencil size={12}/></button>
                <button className="icon-btn-sm danger" title="Delete" onClick={e=>{e.stopPropagation();onOpenDelete([c.id],[c.name]);}}><Trash2 size={12}/></button>
              </span></div>
              <div className="card-ch">
                <i className="dot" style={{background:CH_COLORS[c.acquisitionChannel]}}/>
                <span>{CH_LABELS[c.acquisitionChannel]??c.acquisitionChannel}</span>
              </div>
              <p className="card-project">{c.project}</p>
              <p className="card-location">{c.location}</p>
              {c.notes&&<p className="card-notes"><MessageSquare size={10}/>{c.notes.slice(0,40)}{c.notes.length>40?"...":""}</p>}
              <strong className="card-op">{c.operationToTake}</strong>
              <footer className="card-contacts">
                <span className="muted">1st: {c.firstContactPerson || "—"}</span>
                <span className="muted">2nd: {c.secondContactPerson || "—"}</span>
              </footer>
              <div className="card-status-wrap">
                <span className={`status-pill status-${String(c.status).toLowerCase()}`}>{STATUS_LABELS[c.status] ?? c.status}</span>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
function AddNewSelect({ value, options, onChange, onAdd, render, placeholder }: {
  value: string; options: string[];
  onChange: (v: string) => void;
  onAdd?: (v: string) => Promise<string | void>;
  render?: (v: string) => string;
  placeholder?: string;
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
          placeholder={placeholder ?? "New value…"}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") confirmAdd(); else if (e.key === "Escape") { setAdding(false); setText(""); } }}
          style={{ flex: 1, height: 36, border: "1px solid #dfe2e6", borderRadius: 6, padding: "0 10px", fontSize: 12, outline: "none" }}
        />
        <button type="button" className="btn-sm" onClick={confirmAdd}><Check size={14} />Add</button>
        <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setText(""); }}>Cancel</button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => { if (e.target.value === "__NEW__") { setAdding(true); } else { onChange(e.target.value); } }}
    >
      <option value="" disabled>{placeholder ?? "Select…"}</option>
      {options.map(o => <option key={o} value={o}>{render ? render(o) : o}</option>)}
      <option value="__NEW__">＋ Add new…</option>
    </select>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (<label className={wide?"field field-wide":"field"}><span>{label}</span>{children}</label>);}

