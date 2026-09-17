"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Trash2, Search, UsersRound, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";

type Client = {
  id: string; name: string; phoneNumber: string; status: string;
  project: string; location: string; acquisitionChannel: string;
  operationToTake: string; firstContactPerson: string; secondContactPerson: string;
  notes?: string; createdAt?: string; lastUpdateDate?: string; archived?: boolean; archivedAt?: string;
};

const CH_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", X: "X", TIKTOK: "TikTok",
  GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", CALLS: "Calls", SALES: "Sales",
};

export default function ArchivedPage() {
  const router = useRouter();
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
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => `${c.name} ${c.phoneNumber} ${c.project} ${c.location}`.toLowerCase().includes(q));
  }, [clients, query]);

  const restore = async (c: Client) => {
    setBusyId(c.id);
    const r = await fetch("/api/crm/clients", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, archived: false }),
    });
    if (r.ok) {
      setClients((prev) => prev.filter((x) => x.id !== c.id));
      showToast(`“${c.name}” restored`);
    } else {
      const d = await r.json().catch(() => ({}));
      showToast(d.error || "Could not restore client");
    }
    setBusyId(null);
  };

  const destroy = async (c: Client) => {
    if (!confirm(`Permanently delete “${c.name}”? This cannot be undone.`)) return;
    setBusyId(c.id);
    const r = await fetch("/api/crm/clients", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id }),
    });
    if (r.ok) {
      setClients((prev) => prev.filter((x) => x.id !== c.id));
      showToast(`“${c.name}” deleted`);
    } else {
      const d = await r.json().catch(() => ({}));
      showToast(d.error || "Could not delete client");
    }
    setBusyId(null);
  };

  if (!user) return <div className="shell-loading"><div className="spinner" /><p>Loading…</p></div>;

  return (
    <div className="shell">
      <AppHeader user={user} active="archived" darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />

      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><Archive size={14} />Archive</div>
            <h1>Archived clients</h1>
            <p>Archived clients stay here safely. Restore them any time, or delete permanently if you&apos;re an admin.</p>
          </div>
          <div className="header-actions">
            <div className="search-box">
              <Search size={15} />
              <input placeholder="Search archived clients…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        </div>

        {!isAdmin && (
          <div className="archive-note"><AlertCircle size={14} /> Only admins can archive, restore, or permanently delete clients. Your access here is read-only.</div>
        )}

        <section className="panel">
          <div className="panel-heading">
            <h3>Archive <small>{clients.length} client{clients.length === 1 ? "" : "s"}</small></h3>
            <span className="muted" style={{ fontSize: 11 }}>{isAdmin ? "Admin — full control" : `${user.role} — read only`}</span>
          </div>

          {loading && <div className="empty-state">Loading archived clients…</div>}
          {!loading && shown.length === 0 && (
            <div className="archive-empty">
              <UsersRound size={26} />
              <strong>{clients.length === 0 ? "Nothing archived yet" : "No matches"}</strong>
              <span>{clients.length === 0 ? "Clients you archive will appear here." : "Try a different search."}</span>
            </div>
          )}

          {shown.map((c) => (
            <div className="archive-row" key={c.id}>
              <span className="rc-avatar">{c.name.slice(0, 2).toUpperCase()}</span>
              <div className="archive-info">
                <strong>{c.name}</strong>
                <small>{c.phoneNumber} · {c.project} · {c.location}</small>
              </div>
              <span className="chan-tag"><i className="dot" />{CH_LABELS[c.acquisitionChannel] ?? c.acquisitionChannel}</span>
              <span className={`status-pill status-${String(c.status).toLowerCase()}`}>{c.status}</span>
              <span className="muted archive-date">
                {c.archivedAt ? `Archived ${new Date(c.archivedAt).toLocaleDateString()}` : "Archived"}
              </span>
              <div className="archive-actions">
                {isAdmin && <button className="btn-outline btn-sm" disabled={busyId === c.id} onClick={() => restore(c)}>
                  <ArchiveRestore size={13} />Restore
                </button>}
                {isAdmin && (
                  <button className="icon-btn danger" title="Delete permanently" disabled={busyId === c.id} onClick={() => destroy(c)}>
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
