"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Edit3, Plus, Tag, Trash2, UserRound, AlertCircle, Check, MessageSquare, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import type { ActivityEntry, ClientData } from "@/lib/types";

const PREDEFINED_STATUSES = ["WAITING", "WON", "LOST"];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  WAITING: { bg: "#fef3c7", fg: "#92400e", label: "Waiting" },
  WON: { bg: "#d1fae5", fg: "#065f46", label: "Won" },
  LOST: { bg: "#fee2e2", fg: "#991b1b", label: "Lost" },
};

function getStatusStyle(status: string) {
  if (PREDEFINED_STATUSES.includes(status)) return STATUS_STYLE[status];
  return { bg: "#ede9fe", fg: "#5b21b6", label: status };
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return d.toLocaleDateString();
}

export default function ClientDetailPage({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Partial<ClientData>>({});
  const [customStatuses, setCustomStatuses] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [user, setUser] = useState<{ name: string; initials: string; role?: string } | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    Promise.all([
      fetch(`/api/clients/${clientId}`).then((r) => r.json()),
      fetch("/api/crm/clients").then((r) => r.json()).then((d) => d.statuses ?? []),
      fetch("/api/locations").then((r) => r.json()).then((d) => d.locations ?? []).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).then((d) => d.channels ?? []).catch(() => []),
      fetch("/api/auth/me").then((r) => r.json()).then((d) => d.user ?? null).catch(() => null),
    ]).then(([data, statuses, locs, chans, me]) => {
      setClient(data.client);
      setCustomStatuses(statuses);
      setLocations(locs);
      setChannels(chans);
      setUser(me);
      setDraft(data.client);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("rwaq-dark") === "1") setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  const saveEdit = async () => {
    if (!draft.id) return;
    await fetch("/api/crm/clients", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setClient((prev) => prev ? { ...prev, ...draft } : null);
    setEditMode(false);
    showToast("Changes saved");
  };

  const deleteClient = async () => {
    if (!confirm("Delete this client? This cannot be undone.")) return;
    await fetch("/api/crm/clients", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: draft.id }),
    });
    router.replace("/");
  };

  const addLocation = async (v: string): Promise<string> => {
    const clean = v.trim();
    if (!clean) return v;
    await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: clean }) }).catch(() => {});
    const r = await fetch("/api/locations").then((x) => x.json()).catch(() => ({}));
    setLocations(r.locations ?? []);
    return clean;
  };

  const addChannel = async (v: string): Promise<string> => {
    const key = v.trim().toUpperCase().replace(/\s+/g, "_");
    if (!key) return v;
    await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: key }) }).catch(() => {});
    const r = await fetch("/api/channels").then((x) => x.json()).catch(() => ({}));
    setChannels(r.channels ?? []);
    return key;
  };

  const addStatus = async (v: string): Promise<string> => {
    const key = v.trim().toUpperCase();
    if (!key) return v;
    await fetch("/api/crm/clients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", label: key }) }).catch(() => {});
    const r = await fetch("/api/crm/clients").then((x) => x.json()).catch(() => ({}));
    setCustomStatuses(r.statuses ?? []);
    return key;
  };

  if (loading) return <div className="page-center"><div className="spinner" /><p>Loading client…</p></div>;
  if (!client) return <div className="page-center"><AlertCircle size={48} color="#ef4444" /><p>Client not found</p><button className="btn-primary" onClick={() => router.replace("/")}>Back</button></div>;

  const statuses = [...PREDEFINED_STATUSES, ...customStatuses.filter((s) => !PREDEFINED_STATUSES.includes(s))];
  const statusStyle = getStatusStyle(client.status);
  const daysSinceCreated = client.createdAt ? Math.floor((Date.now() - new Date(client.createdAt).getTime()) / 86400000) : 0;

  return (
    <div className="detail-page">
      {user && <AppHeader user={user} active="clients" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />}
      {/* Top bar */}
      <div className="detail-topbar">
        <button className="btn-ghost" onClick={() => router.back()}><ArrowLeft size={16} /> Back</button>
        <div className="detail-title">
          <span className={`status-badge status-${client.status.toLowerCase()}`}>{statusStyle.label}</span>
          <h1>{client.name}</h1>
        </div>
        <div className="detail-actions">
          <button className="btn-outline" onClick={() => setEditMode(!editMode)}>{editMode ? <Check size={15} /> : <Edit3 size={15} />}{editMode ? "Cancel" : "Edit"}</button>
          {user?.role === "Admin" && <button className="btn-danger" onClick={deleteClient}><Trash2 size={15} />Delete</button>}
        </div>
      </div>

      <div className="detail-grid">
        {/* Recent activity (first) */}
        <section className="detail-section timeline-panel">
          <h2>Activity log</h2>
          <div className="timeline">
            {(client.activityLog ?? []).length === 0 && (
              <div className="empty-timeline">No activity yet</div>
            )}
            {(client.activityLog ?? []).map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
          </div>
        </section>

        {/* Client info */}
        <section className="detail-section info-panel">
          <h2>Client info</h2>
          {editMode ? (
            <div className="edit-form">
              <div className="form-grid-2">
                <Field label="Name"><input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                <Field label="Phone"><input value={draft.phoneNumber ?? ""} onChange={(e) => setDraft({ ...draft, phoneNumber: e.target.value })} /></Field>
                <Field label="Project"><input value={draft.project ?? ""} onChange={(e) => setDraft({ ...draft, project: e.target.value })} /></Field>
                <Field label="Location">
                  <AddNewSelect value={draft.location ?? ""} options={locations} onAdd={addLocation} onChange={(v) => setDraft({ ...draft, location: v })} placeholder="Select location…" />
                </Field>
                <Field label="Channel">
                  <AddNewSelect value={draft.acquisitionChannel ?? ""} options={channels} onAdd={addChannel} onChange={(v) => setDraft({ ...draft, acquisitionChannel: v })} placeholder="Select channel…" />
                </Field>
                <Field label="Status">
                  <AddNewSelect value={draft.status ?? ""} options={statuses} onAdd={addStatus} onChange={(v) => setDraft({ ...draft, status: v })} placeholder="Select status…" />
                </Field>
                <Field label="1st Contact"><input value={draft.firstContactPerson ?? ""} onChange={(e) => setDraft({ ...draft, firstContactPerson: e.target.value })} /></Field>
                <Field label="2nd Contact"><input value={draft.secondContactPerson ?? ""} onChange={(e) => setDraft({ ...draft, secondContactPerson: e.target.value })} /></Field>
                <Field label="Next Operation" wide><input value={draft.operationToTake ?? ""} onChange={(e) => setDraft({ ...draft, operationToTake: e.target.value })} /></Field>
                <Field label="Notes" wide><textarea value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} placeholder="Add notes about this client…" /></Field>
              </div>
              <div className="edit-form-actions">
                <button className="btn-primary" onClick={saveEdit}><Check size={15} />Save changes</button>
              </div>
            </div>
          ) : (
            <dl className="info-list">
              <InfoItem icon={<Tag size={14} />} label="Status"><span className={`status-badge status-${client.status.toLowerCase()}`}>{statusStyle.label}</span></InfoItem>
              <InfoItem icon={<UserRound size={14} />} label="Phone"><span>{client.phoneNumber}</span></InfoItem>
              <InfoItem icon={<Tag size={14} />} label="Project"><span>{client.project}</span></InfoItem>
              <InfoItem icon={<TrendingUp size={14} />} label="Location"><span>{client.location}</span></InfoItem>
              <InfoItem icon={<Edit3 size={14} />} label="Next Operation"><span>{client.operationToTake}</span></InfoItem>
              <InfoItem icon={<UserRound size={14} />} label="1st Contact"><span>{client.firstContactPerson}</span></InfoItem>
              <InfoItem icon={<UserRound size={14} />} label="2nd Contact"><span>{client.secondContactPerson || "—"}</span></InfoItem>
              {client.notes && <InfoItem icon={<MessageSquare size={14} />} label="Notes"><p className="notes-display">{client.notes}</p></InfoItem>}
            </dl>
          )}
        </section>

      </div>

      {/* Stats */}
      <section className="detail-section stats-row">
        <StatCard label="Days since created" value={String(daysSinceCreated)} />
        <StatCard label="Total edits" value={String((client.activityLog ?? []).filter((a) => a.action === "FIELD_EDIT").length)} />
        <StatCard label="Status changes" value={String((client.activityLog ?? []).filter((a) => a.action === "STATUS_CHANGE").length)} />
      </section>

      {toast && <div className="toast-single">{toast}</div>}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const icons: Record<string, { icon: React.ReactNode; color: string }> = {
    CREATED: { icon: <Plus size={13} />, color: "#22c55e" },
    DELETED: { icon: <Trash2 size={13} />, color: "#ef4444" },
    STATUS_CHANGE: { icon: <TrendingUp size={13} />, color: "#f59e0b" },
    FIELD_EDIT: { icon: <Edit3 size={13} />, color: "#4f46e5" },
    NOTE_ADD: { icon: <MessageSquare size={13} />, color: "#0891b2" },
    NOTE_EDIT: { icon: <MessageSquare size={13} />, color: "#0891b2" },
  };
  const { icon, color } = icons[entry.action] ?? { icon: <Clock size={13} />, color: "#9ca3af" };

  return (
    <div className="timeline-item">
      <div className="timeline-dot" style={{ background: color }}>{icon}</div>
      <div className="timeline-content">
        <div className="timeline-header">
          <span className="timeline-action">{entry.summary ?? entry.action}</span>
          <span className="timeline-meta">
            <span className="actor">{entry.actor}</span>
            <span className="time">· {formatTime(entry.timestamp)}</span>
          </span>
        </div>
        {entry.field && (
          <div className="timeline-field-change">
            <span className="field-name">{entry.field}</span>
            {entry.oldValue !== undefined && <span className="old-value">{entry.oldValue}</span>}
            {entry.oldValue !== undefined && <span className="arrow">→</span>}
            {entry.newValue !== undefined && <span className="new-value">{entry.newValue}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="info-row">
      <div className="info-icon">{icon}</div>
      <div className="info-label">{label}</div>
      <div className="info-value">{children}</div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? "field field-wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); else if (e.key === "Escape") { setAdding(false); setText(""); } }}
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
      onChange={(e) => { if (e.target.value === "__NEW__") { setAdding(true); } else { onChange(e.target.value); } }}
    >
      <option value="" disabled>{placeholder ?? "Select…"}</option>
      {options.map((o) => <option key={o} value={o}>{render ? render(o) : o}</option>)}
      <option value="__NEW__">＋ Add new…</option>
    </select>
  );
}
