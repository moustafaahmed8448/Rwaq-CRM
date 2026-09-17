"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Trash2, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";

type Notif = { id: string; message: string; read: boolean; recipient?: string; createdAt: string; type?: string; clientName?: string };

export default function NotificationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; initials: string; role: string } | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "history">("all");

  const load = useCallback(async () => {
    const r = await fetch("/api/notifications");
    if (!r.ok) { window.location.href = "/login"; return; }
    const d = await r.json();
    setItems(d.notifications ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) { window.location.href = "/login"; return; }
      const d = await r.json();
      if (!d.authenticated) { window.location.href = "/login"; return; }
      setUser(d.user);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("rwaq-dark") === "1") setDarkMode(true);
  }, [load]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  const unread = items.filter((n) => !n.read);
  const read = items.filter((n) => n.read);

  const [error, setError] = useState("");
  const mutate = async (method: "POST" | "DELETE", body: object, update: (items: Notif[]) => Notif[]) => {
    setError("");
    try {
      const response = await fetch("/api/notifications", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Unable to update notifications. Please try again.");
      setItems(update);
      window.dispatchEvent(new Event("rwaq-notifications-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update notifications.");
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    if (unread.length === 0) return;
    await mutate("POST", {}, prev => prev.map(n => ({ ...n, read: true })));
  };

  const markRead = async (id: string) => {
    setBusyId(id);
    await mutate("POST", { id }, prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const removeOne = async (n: Notif) => {
    setBusyId(n.id);
    await mutate("DELETE", { id: n.id }, prev => prev.filter(x => x.id !== n.id));
  };

  const clearHistory = async () => {
    if (read.length === 0) return;
    if (!confirm(`Clear ${read.length} notification${read.length === 1 ? "" : "s"} from history?`)) return;
    await mutate("DELETE", { clearRead: true }, prev => prev.filter(n => !n.read));
  };

  if (!user) return <div className="shell-loading"><div className="spinner" /><p>Loading…</p></div>;

  const shown = tab === "all" ? unread : read;

  return (
    <div className="shell">
      <AppHeader user={user} active="settings" darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />

      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><Bell size={14} />Notifications</div>
            <h1>Notifications</h1>
            <p>New alerts stay here until you read them. Read ones move to history.</p>
          </div>
          <div className="header-actions">
            {unread.length > 0 && (
              <button className="btn-outline" onClick={markAllRead}><CheckCheck size={15} />Mark all read</button>
            )}
            {read.length > 0 && (
              <button className="btn-danger-outline" onClick={clearHistory}><Trash2 size={15} />Clear history ({read.length})</button>
            )}
          </div>
        </div>

        <div className="notif-tabs">
          <button className={tab === "all" ? "seg-active" : ""} onClick={() => setTab("all")}>
            <Bell size={13} />New {unread.length > 0 && <span className="badge-count">{unread.length} new</span>}
          </button>
          <button className={tab === "history" ? "seg-active" : ""} onClick={() => setTab("history")}>
            <Inbox size={13} />History {read.length > 0 && <small>({read.length})</small>}
          </button>
        </div>

        <section className="panel">
          {loading && <div className="empty-state">Loading notifications…</div>}
          {!loading && shown.length === 0 && (
            <div className="archive-empty">
              <CheckCheck size={26} />
              <strong>{tab === "history" ? "History is empty" : "You're all caught up"}</strong>
              <span>{tab === "history" ? "Read notifications are saved here until you delete them." : "No new notifications right now."}</span>
            </div>
          )}
          {shown.map((n) => (
            <div className={`notif-row ${n.read ? "is-read" : "is-unread"}`} key={n.id}>
              <span className="notif-new-dot" />
              <div className="notif-row-body">
                <strong>{n.message}</strong>
                <small>{new Date(n.createdAt).toLocaleString()}</small>
              </div>
              {!n.read && <button className="btn-ghost btn-sm" disabled={busyId === n.id} onClick={() => markRead(n.id)}>Mark read</button>}
              <button className="icon-btn-sm danger" title="Delete" disabled={busyId === n.id} onClick={() => removeOne(n)}><Trash2 size={13} /></button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
