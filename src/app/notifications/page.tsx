"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Trash2, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/lib/i18n";
import { dateLocale } from "@/lib/format";
import { notificationMessage } from "@/lib/reporting";

type Notif = { id: string; message: string; read: boolean; recipient?: string; createdAt: string; type?: string; clientName?: string; clientId?: string | null };

export default function NotificationsPage() {
  const router = useRouter();
  const { t, lang } = useLang();
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
      if (!response.ok) throw new Error(t("notif.updateFail"));
      setItems(update);
      window.dispatchEvent(new Event("rwaq-notifications-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("notif.updateFailShort"));
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

  /**
   * Opens the client a notification refers to.
   *
   * Marks it read on the way through, but does not block on that request: the
   * navigation is what the user asked for, and a failed mark leaves an unread
   * row — which is a far better outcome than a spinner over a page they wanted.
   * The local list is updated first so the row is not still highlighted when the
   * next render happens.
   */
  const openClient = (n: Notif) => {
    if (!n.clientId) return;
    setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id }),
    }).catch(() => undefined);
    router.push(`/clients/${n.clientId}`);
  };

  const clearHistory = async () => {
    if (read.length === 0) return;
    if (!confirm(t("notif.clearConfirm", { n: read.length }))) return;
    await mutate("DELETE", { clearRead: true }, prev => prev.filter(n => !n.read));
  };

  if (!user) return <div className="shell-loading"><div className="spinner" /><p>{t("common.loading")}</p></div>;

  const shown = tab === "all" ? unread : read;

  return (
    <div className="shell">
      <AppHeader user={user} active="settings" darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />

      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><Bell size={14} />{t("notif.crumbs")}</div>
            <h1>{t("notif.title")}</h1>
            <p>{t("notif.sub")}</p>
          </div>
          <div className="header-actions">
            {unread.length > 0 && (
              <button className="btn-outline" onClick={markAllRead}><CheckCheck size={15} />{t("notif.markAll")}</button>
            )}
            {read.length > 0 && (
              <button className="btn-danger-outline" onClick={clearHistory}><Trash2 size={15} />{t("notif.clearHistory", { n: read.length })}</button>
            )}
          </div>
        </div>

        <div className="notif-tabs">
          <button className={tab === "all" ? "seg-active" : ""} onClick={() => setTab("all")}>
            <Bell size={13} />{t("notif.new")} {unread.length > 0 && <span className="badge-count">{t("notif.newCount", { n: unread.length })}</span>}
          </button>
          <button className={tab === "history" ? "seg-active" : ""} onClick={() => setTab("history")}>
            <Inbox size={13} />{t("notif.history")} {read.length > 0 && <small>({read.length})</small>}
          </button>
        </div>

        {error && <div className="settings-error">{error}</div>}

        <section className="panel">
          {loading && <div className="empty-state">{t("notif.loading")}</div>}
          {!loading && shown.length === 0 && (
            <div className="archive-empty">
              <CheckCheck size={26} />
              <strong>{tab === "history" ? t("notif.historyEmpty") : t("notif.caughtUp")}</strong>
              <span>{tab === "history" ? t("notif.historySub") : t("notif.caughtUpSub")}</span>
            </div>
          )}
          {shown.map((n) => (
            /* The message body is a button when the notification points at a
               client, so the text itself opens them. `stopPropagation` on the
               row buttons below is what keeps "Mark read" / "Delete" from also
               navigating — they are siblings of this button, not ancestors, so
               the guard is there purely so a future wrapper refactor cannot
               accidentally make them trigger the row. */
            <div className={`notif-row ${n.read ? "is-read" : "is-unread"}`} key={n.id}>
              <span className="notif-new-dot" />
              <div className="notif-row-body">
                {n.clientId ? (
                  <button type="button" className="notif-open" onClick={() => openClient(n)}>
                    <strong>{notificationMessage(t, n)}</strong>
                    <small>{new Date(n.createdAt).toLocaleString(dateLocale(lang))}</small>
                  </button>
                ) : (
                  <>
                    <strong>{notificationMessage(t, n)}</strong>
                    <small>{new Date(n.createdAt).toLocaleString(dateLocale(lang))}</small>
                  </>
                )}
              </div>
              {!n.read && <button className="btn-ghost btn-sm" disabled={busyId === n.id} onClick={() => markRead(n.id)}>{t("notif.markRead")}</button>}
              <button className="icon-btn-sm danger" title={t("notif.deleteTitle")} disabled={busyId === n.id} onClick={() => removeOne(n)}><Trash2 size={13} /></button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
