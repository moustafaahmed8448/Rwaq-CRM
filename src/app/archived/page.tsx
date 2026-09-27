"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Trash2, Search, UsersRound, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-errors";
import { channelLabel, statusLabel } from "@/lib/reporting";
import { dateLocale } from "@/lib/format";

type Client = {
  id: string; name: string; phoneNumber: string; status: string;
  project: string; location: string; acquisitionChannel: string;
  operationToTake: string; firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string; archived?: boolean; archivedAt?: string;
};

export default function ArchivedPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<{ name: string; initials: string; role: string } | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isAdmin = user?.role === "Admin";
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/clients?archived=1");
    if (!r.ok) { router.replace("/login"); return; }
    const d = await r.json() as { clients?: Client[] };
    setClients(d.clients ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) { router.replace("/login"); return; }
      const d = await r.json();
      if (!d.authenticated) { router.replace("/login"); return; }
      setUser(d.user);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("rwaq-dark") === "1") setDarkMode(true);
  }, [router, load]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  const shown = useMemo(() => {
    // Ignore spaces/dashes/parentheses so phone numbers match with or without
    // formatting, e.g. "1018240912" finds "+20 101 824 0912".
    const norm = (s: string) => s.replace(/[\s\-().]/g, "").toLowerCase();
    const q = norm(query);
    if (!q) return clients;
    return clients.filter((c) => norm(`${c.name} ${c.phoneNumber} ${c.project} ${c.location}`).includes(q));
  }, [clients, query]);

  const restore = async (c: Client) => {
    setBusyId(c.id);
    const r = await fetch("/api/crm/clients", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, archived: false }),
    });
    if (r.ok) {
      setClients((prev) => prev.filter((x) => x.id !== c.id));
      showToast(t("archive.restored", { name: c.name }));
    } else {
      const d = await r.json().catch(() => ({}));
      showToast(d.error ? apiErrorMessage(t, d.error) : t("archive.restoreFail"));
    }
    setBusyId(null);
  };

  const destroy = async (c: Client) => {
    if (!confirm(t("archive.deleteConfirm", { name: c.name }))) return;
    setBusyId(c.id);
    const r = await fetch("/api/crm/clients", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id }),
    });
    if (r.ok) {
      setClients((prev) => prev.filter((x) => x.id !== c.id));
      showToast(t("archive.deleted", { name: c.name }));
    } else {
      const d = await r.json().catch(() => ({}));
      showToast(d.error ? apiErrorMessage(t, d.error) : t("archive.deleteFail"));
    }
    setBusyId(null);
  };

  if (!user) return <div className="shell-loading"><div className="spinner" /><p>{t("common.loading")}</p></div>;

  return (
    <div className="shell">
      <AppHeader user={user} active="archived" darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />

      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><Archive size={14} />{t("archive.crumbs")}</div>
            <h1>{t("archive.title")}</h1>
            <p>{t("archive.sub")}</p>
          </div>
          <div className="header-actions">
            <div className="search-box">
              <Search size={15} />
              <input placeholder={t("archive.searchPh")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        </div>

        {!isAdmin && (
          <div className="archive-note"><AlertCircle size={14} /> {t("archive.adminNote")}</div>
        )}

        <section className="panel">
          <div className="panel-heading">
            <h3>{t("archive.heading")} <small>{t("archive.clientsCount", { n: clients.length })}</small></h3>
            <span className="muted" style={{ fontSize: 11 }}>{isAdmin ? t("archive.adminFull") : t("archive.readOnly", { role: user.role })}</span>
          </div>

          {loading && <div className="empty-state">{t("archive.loading")}</div>}
          {!loading && shown.length === 0 && (
            <div className="archive-empty">
              <UsersRound size={26} />
              <strong>{clients.length === 0 ? t("archive.nothing") : t("archive.noMatch")}</strong>
              <span>{clients.length === 0 ? t("archive.nothingSub") : t("archive.noMatchSub")}</span>
            </div>
          )}

          {shown.map((c) => (
            <div className="archive-row" key={c.id}>
              <span className="rc-avatar">{c.name.slice(0, 2).toUpperCase()}</span>
              <div className="archive-info">
                <strong>{c.name}</strong>
                <small>{c.phoneNumber} · {c.project} · {c.location}</small>
              </div>
              <span className="chan-tag"><i className="dot" />{channelLabel(t, c.acquisitionChannel)}</span>
              <span className={`status-pill status-${String(c.status).toLowerCase()}`}>{statusLabel(t, c.status)}</span>
              <span className="muted archive-date">
                {c.archivedAt ? t("common.archivedOn", { date: new Date(c.archivedAt).toLocaleDateString(dateLocale(lang)) }) : t("archive.archivedLabel")}
              </span>
              <div className="archive-actions">
                {isAdmin && <button className="btn-outline btn-sm" disabled={busyId === c.id} onClick={() => restore(c)}>
                  <ArchiveRestore size={13} />{t("clients.restore")}
                </button>}
                {isAdmin && (
                  <button className="icon-btn danger" title={t("archive.deleteTitle")} disabled={busyId === c.id} onClick={() => destroy(c)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>

      {toast && <div className="toast-single">{toast}</div>}
    </div>
  );
}
