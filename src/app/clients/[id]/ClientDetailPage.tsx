"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Edit3, Plus, Tag, Trash2, UserRound, AlertCircle, Check, MessageSquare, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import RefPicker from "@/components/RefPicker";
import { useLang } from "@/lib/i18n";
import { dateLocale } from "@/lib/format";
import { canWrite } from "@/lib/auth";
import StatusPill from "@/components/StatusPill";
import { activityFieldLabel, activityValueLabel, channelLabel, describeActivity, PIPELINE_STAGES, pipelineStage, statusLabel as localizeStatus } from "@/lib/reporting";
import type { ActivityEntry, ClientData } from "@/lib/types";

const PREDEFINED_STATUSES = PIPELINE_STAGES.map((s) => s.value);

/**
 * Badge colours derive from the registry's accent so a stage can never show one
 * colour in the dashboard panel and another on the detail page. User-defined
 * custom statuses keep the violet fallback.
 */
function getStatusStyle(status: string) {
  const stage = pipelineStage(status);
  if (stage) return { bg: stage.color + "22", fg: stage.color, label: stage.fallback };
  return { bg: "#ede9fe", fg: "#5b21b6", label: status };
}

function formatTimeAgo(iso: string, t: (key: string, vars?: Record<string, string | number>) => string, lang: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("common.justNow");
  if (diffMin < 60) return t("common.minAgo", { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t("common.hourAgo", { n: diffH });
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return t("common.dayAgo", { n: diffD });
  return d.toLocaleDateString(dateLocale(lang));
}

export default function ClientDetailPage({ clientId }: { clientId: string }) {
  const router = useRouter();
  const { t, lang } = useLang();
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
  const [daysSinceCreated, setDaysSinceCreated] = useState(0);

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
    if (client?.createdAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDaysSinceCreated(Math.floor((Date.now() - new Date(client.createdAt).getTime()) / 86400000));
    }
  }, [client?.createdAt]);

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
    showToast(t("detail.saved"));
  };

  const deleteClient = async () => {
    if (!confirm(t("detail.deleteBody", { name: client?.name ?? "" }))) return;
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

  if (loading) return <div className="page-center"><div className="spinner" /><p>{t("common.loading")}</p></div>;
  if (!client) return <div className="page-center"><AlertCircle size={48} color="#ef4444" /><p>{t("detail.notFound")}</p><button className="btn-primary" onClick={() => router.replace("/")}>{t("detail.back")}</button></div>;

  const statuses = [...PREDEFINED_STATUSES, ...customStatuses.filter((s) => !PREDEFINED_STATUSES.includes(s))];
  const statusStyle = { ...getStatusStyle(client.status), label: localizeStatus(t, client.status) };

  return (
    <div className="detail-page">
      {user && <AppHeader user={user} active="clients" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />}
      {/* Top bar */}
      <div className="detail-topbar">
        <button className="btn-ghost" onClick={() => router.back()}><ArrowLeft size={16} /> {t("detail.back")}</button>
        <div className="detail-title">
          <StatusPill status={client.status} t={t} variant="badge" />
          <span className="id-cell" title={t("th.id")}>#{client.id}</span>
          <h1>{client.name}</h1>
        </div>
        <div className="detail-actions">
          {canWrite(user?.role) && <button className="btn-outline" onClick={() => setEditMode(!editMode)}>{editMode ? <Check size={15} /> : <Edit3 size={15} />}{editMode ? t("common.cancel") : t("detail.edit")}</button>}
          {user?.role === "Admin" && <button className="btn-danger" onClick={deleteClient}><Trash2 size={15} />{t("detail.delete")}</button>}
        </div>
      </div>

      <div className="detail-grid">
        {/* Recent activity (first) */}
        <section className="detail-section timeline-panel">
          <h2>{t("detail.timeline")}</h2>
          <div className="timeline">
            {(client.activityLog ?? []).length === 0 && (
              <div className="empty-timeline">{t("client.noActivity")}</div>
            )}
            {[...(client.activityLog ?? [])].reverse().map((entry) => (
              <ActivityItem key={entry.id} entry={entry} t={t} lang={lang} />
            ))}
          </div>
        </section>

        {/* Client info */}
        <section className="detail-section info-panel">
          <h2>{t("detail.details")}</h2>
          {editMode ? (
            <div className="edit-form">
              <div className="form-grid-2">
                <Field label={t("form.name")}><input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                <Field label={t("form.phone")}><input dir="ltr" className="ltr-num" value={draft.phoneNumber ?? ""} onChange={(e) => setDraft({ ...draft, phoneNumber: e.target.value })} /></Field>
                <Field label={t("form.project")} wide><textarea rows={3} value={draft.project ?? ""} onChange={(e) => setDraft({ ...draft, project: e.target.value })} placeholder={t("form.projectDetailsPh")} /></Field>
                <Field label={t("form.location")}>
                  <RefPicker value={draft.location ?? ""} options={locations} onAdd={addLocation} onChange={(v) => setDraft({ ...draft, location: v })} placeholder={t("form.locationPh")} t={t} />
                </Field>
                <Field label={t("form.channel")}>
                  <RefPicker value={draft.acquisitionChannel ?? ""} options={channels} onAdd={addChannel} onChange={(v) => setDraft({ ...draft, acquisitionChannel: v })} render={(v) => channelLabel(t, v)} placeholder={t("form.channelPh")} t={t} />
                </Field>
                <Field label={t("form.status")}>
                  <RefPicker value={draft.status ?? ""} options={statuses} onAdd={addStatus} onChange={(v) => setDraft({ ...draft, status: v })} render={(v) => localizeStatus(t, v)} placeholder={t("form.statusPh")} t={t} />
                </Field>
                <Field label={t("form.firstContact")}><input value={draft.firstContactPerson ?? ""} onChange={(e) => setDraft({ ...draft, firstContactPerson: e.target.value })} /></Field>
                <Field label={t("form.secondContact")}><input value={draft.secondContactPerson ?? ""} onChange={(e) => setDraft({ ...draft, secondContactPerson: e.target.value })} /></Field>
                <Field label={t("form.operation")} wide><input value={draft.operationToTake ?? ""} onChange={(e) => setDraft({ ...draft, operationToTake: e.target.value })} /></Field>
                <Field label={t("form.notes")} wide><textarea value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} placeholder={t("form.notesPh")} /></Field>
              </div>
              <div className="edit-form-actions">
                <button className="btn-primary" onClick={saveEdit}><Check size={15} />{t("detail.saveChanges")}</button>
              </div>
            </div>
          ) : (
            <dl className="info-list">
              <InfoItem icon={<Tag size={14} />} label={t("form.status")}><StatusPill status={client.status} t={t} variant="badge" /></InfoItem>
              <InfoItem icon={<UserRound size={14} />} label={t("form.phone")}><span><span className="ltr-num">{client.phoneNumber}</span></span></InfoItem>
              <InfoItem icon={<Tag size={14} />} label={t("form.project")}><span>{client.project}</span></InfoItem>
              <InfoItem icon={<Tag size={14} />} label={t("form.channel")}><span>{channelLabel(t, client.acquisitionChannel)}</span></InfoItem>
              <InfoItem icon={<TrendingUp size={14} />} label={t("form.location")}><span>{client.location}</span></InfoItem>
              <InfoItem icon={<Edit3 size={14} />} label={t("form.operation")}><span>{client.operationToTake}</span></InfoItem>
              <InfoItem icon={<UserRound size={14} />} label={t("form.firstContact")}><span>{client.firstContactPerson}</span></InfoItem>
              <InfoItem icon={<UserRound size={14} />} label={t("form.secondContact")}><span>{client.secondContactPerson || "—"}</span></InfoItem>
              {client.notes && <InfoItem icon={<MessageSquare size={14} />} label={t("form.notes")}><p className="notes-display">{client.notes}</p></InfoItem>}
            </dl>
          )}
        </section>

      </div>

      {/* Stats */}
      <section className="detail-section stats-row">
        <StatCard label={t("detail.sinceCreation")} value={daysSinceCreated === 0 ? t("common.today") : t("detail.createdAgo", { n: daysSinceCreated })} />
        <StatCard label={t("detail.activities")} value={String((client.activityLog ?? []).length)} />
        <StatCard label={t("detail.lastUpdate")} value={client.lastUpdateDate ? formatTimeAgo(client.lastUpdateDate, t, lang) : "—"} />
      </section>

      {toast && <div className="toast-single">{toast}</div>}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function ActivityItem({ entry, t, lang }: { entry: ActivityEntry; t: (key: string, vars?: Record<string, string | number>) => string; lang: string }) {
  const icons: Record<string, { icon: React.ReactNode; color: string }> = {
    CREATED: { icon: <Plus size={13} />, color: "#22c55e" },
    DELETED: { icon: <Trash2 size={13} />, color: "#ef4444" },
    STATUS_CHANGE: { icon: <TrendingUp size={13} />, color: "#f59e0b" },
    FIELD_EDIT: { icon: <Edit3 size={13} />, color: "#069de3" },
    NOTE_ADD: { icon: <MessageSquare size={13} />, color: "#0891b2" },
    NOTE_EDIT: { icon: <MessageSquare size={13} />, color: "#0891b2" },
  };
  const { icon, color } = icons[entry.action] ?? { icon: <Clock size={13} />, color: "#9ca3af" };

  return (
    <div className="timeline-item">
      <div className="timeline-dot" style={{ background: color }}>{icon}</div>
      <div className="timeline-content">
        <div className="timeline-header">
          <span className="timeline-action">{describeActivity(t, entry)}</span>
          <span className="timeline-meta">
            <span className="actor">{entry.actor}</span>
            <span className="time">· {formatTimeAgo(entry.timestamp, t, lang)}</span>
          </span>
        </div>
        {entry.field && (
          <div className="timeline-field-change">
            <span className="field-name">{activityFieldLabel(t, entry.field)}</span>
            {entry.oldValue !== undefined && <span className="old-value">{activityValueLabel(t, entry.field, entry.oldValue)}</span>}
            {entry.oldValue !== undefined && <span className="arrow">{t("common.arrow")}</span>}
            {entry.newValue !== undefined && <span className="new-value">{activityValueLabel(t, entry.field, entry.newValue)}</span>}
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
