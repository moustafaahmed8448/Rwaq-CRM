"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Trash2, Search, UsersRound, AlertCircle, Filter } from "lucide-react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ClientDetailPanel from "@/components/ClientDetailPanel";
import MultiSelect from "@/components/MultiSelect";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-errors";
import { channelLabel, locationLabel, statusLabel } from "@/lib/reporting";
import { optionColor } from "@/lib/ref-options";
import { useOptionColors } from "@/lib/option-colors";
import { useStatusLabels } from "@/lib/status-labels";
import StatusPill from "@/components/StatusPill";
import { dateLocale } from "@/lib/format";

/**
 * YYYY-MM-DD in the LOCAL calendar — the same rule as `localDay` in the clients
 * page and `dayKey` in reporting.ts. Written out rather than imported because
 * those two are module-private to their files.
 */
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Rolling windows offered as one-click presets, matching the clients page. */
const datePresets = (): Array<{ label: string; startDate: string }> => {
  // `n-1` days back, not `n`: the window INCLUDES today, so "last 7 days" spans
  // exactly 7 days. Using `n` here produced an 8-day window and put this page's
  // counts out of step with the same labels on the clients page and dashboard.
  const rollingStart = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); return localDay(d); };
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  const firstOfYear = new Date(); firstOfYear.setMonth(0, 1);
  return [
    { label: "date.today", startDate: localDay(new Date()) },
    { label: "date.last7", startDate: rollingStart(7) },
    { label: "date.last30", startDate: rollingStart(30) },
    { label: "date.last90", startDate: rollingStart(90) },
    { label: "date.thisMonth", startDate: localDay(firstOfMonth) },
    { label: "date.thisYear", startDate: localDay(firstOfYear) },
  ];
};

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
  /* The client whose detail panel is open. The panel itself is the SAME
     component the clients page uses (see components/ClientDetailPanel.tsx) —
     an archived client is inspected the same way a live one is. It used to be
     unreachable from here, so the only way to read an archived client's notes
     or history was to restore them into the live book first. */
  const [detailClient, setDetailClient] = useState<Client | null>(null);

  const isAdmin = user?.role === "Admin";
  // Shared colour map, so a recoloured channel or status matches everywhere.
  const colors = useOptionColors();
  // Archived rows keep their status value, so the archive filters must name a
  // renamed stage the same way the live screens do.
  const statusLabels = useStatusLabels();
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

  /* ── Filters ────────────────────────────────────────────────────────────
     Filtering happens in the browser over the `?archived=1` payload rather than
     on the server. That is a deliberate choice for this page, not an oversight:
     the archived book is small, and sending the filters to the API would need a
     paging path that no other caller uses. The semantics still match
     matchesFilters() in src/app/page.tsx — every group ANDs together, every
     value inside a group ORs — so the same status means the same thing here. */
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const shown = useMemo(() => {
    // Ignore spaces/dashes/parentheses so phone numbers match with or without
    // formatting, e.g. "1018240912" finds "+20 101 824 0912".
    const norm = (s: string) => s.replace(/[\s\-().]/g, "").toLowerCase();
    const q = norm(query);
    return clients.filter((c) => {
      // LOCAL calendar day, not createdAt.slice(0,10): that slices the UTC ISO
      // string, which reads the wrong day east of Greenwich and would disagree
      // with the server's own local-midnight comparison on the clients page.
      const day = c.createdAt ? localDay(new Date(c.createdAt)) : "";
      return (!q || norm(`${c.name} ${c.phoneNumber} ${c.project} ${c.location}`).includes(q)) &&
        (statusFilter.length === 0 || statusFilter.includes(c.status)) &&
        (channelFilter.length === 0 || channelFilter.includes(c.acquisitionChannel)) &&
        (locationFilter.length === 0 || locationFilter.includes(c.location)) &&
        (!startDate || day >= startDate) && (!endDate || day <= endDate);
    });
  }, [clients, query, statusFilter, channelFilter, locationFilter, startDate, endDate]);

  // Option lists come from the rows actually loaded, so a filter can only ever
  // offer a value that has archived clients behind it — no empty dropdowns.
  const archiveStatuses = useMemo(() => [...new Set(clients.map(c => c.status).filter(Boolean))].sort(), [clients]);
  const archiveChannels = useMemo(() => [...new Set(clients.map(c => c.acquisitionChannel).filter(Boolean))].sort(), [clients]);
  const archiveLocations = useMemo(() => [...new Set(clients.map(c => c.location).filter(Boolean))].sort(), [clients]);

  const hasFilters = Boolean(query) || statusFilter.length > 0 || channelFilter.length > 0 ||
    locationFilter.length > 0 || Boolean(startDate) || Boolean(endDate);

  const clearAllFilters = () => {
    setQuery(""); setStatusFilter([]); setChannelFilter([]); setLocationFilter([]);
    setStartDate(""); setEndDate("");
  };

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
        </div>

        {!isAdmin && (
          <div className="archive-note"><AlertCircle size={14} /> {t("archive.adminNote")}</div>
        )}

        {/* ── Filters: same shape as the clients page, scoped to archived rows only ── */}
        <div className="filter-row archive-filters">
          <div className="search-box">
            <Search size={15} />
            <input placeholder={t("archive.searchPh")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <MultiSelect label={t("filter.allStatuses")} options={archiveStatuses} selected={statusFilter} onChange={setStatusFilter} render={v => statusLabel(t, v, statusLabels)} t={t} />
          <MultiSelect label={t("filter.allChannels")} options={archiveChannels} selected={channelFilter} onChange={setChannelFilter} render={v => channelLabel(t, v)} t={t} />
          <MultiSelect label={t("filter.allLocations")} options={archiveLocations} selected={locationFilter} onChange={setLocationFilter} render={v => locationLabel(t, v)} t={t} />
        </div>
        <div className="date-bar archive-filters">
          <Filter size={13} />
          <span>{t("th.date")}</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span>–</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="date-presets archive-filters">
          {datePresets().map(p => (
            <button
              key={p.label}
              className={`date-preset-btn ${startDate === p.startDate && !endDate ? "active" : ""}`}
              onClick={() => { setStartDate(p.startDate); setEndDate(""); }}
            >
              {t(p.label)}
            </button>
          ))}
        </div>

        {/* One chip per active filter, each removable on its own. The MultiSelect
            trigger collapses a multi-pick to "first +N", so without this row there
            was no way to see what was actually selected here — the same gap this
            closed on the clients page and the dashboard. */}
        {hasFilters && (
          <div className="filter-chips">
            {query && <span className="filter-chip">&ldquo;{query.slice(0, 24)}&rdquo;<button title={t("common.clear")} onClick={() => setQuery("")}>×</button></span>}
            {statusFilter.map(s => (
              <span key={`a-st-${s}`} className="filter-chip">
                {statusLabel(t, s, statusLabels)}
                <button title={t("common.clear")} onClick={() => setStatusFilter(statusFilter.filter(x => x !== s))}>×</button>
              </span>
            ))}
            {channelFilter.map(c => (
              <span key={`a-ch-${c}`} className="filter-chip">
                {channelLabel(t, c)}
                <button title={t("common.clear")} onClick={() => setChannelFilter(channelFilter.filter(x => x !== c))}>×</button>
              </span>
            ))}
            {locationFilter.map(l => (
              <span key={`a-lo-${l}`} className="filter-chip">
                {locationLabel(t, l)}
                <button title={t("common.clear")} onClick={() => setLocationFilter(locationFilter.filter(x => x !== l))}>×</button>
              </span>
            ))}
            {startDate && <span className="filter-chip">{t("common.from")} {startDate}<button title={t("common.clear")} onClick={() => setStartDate("")}>×</button></span>}
            {endDate && <span className="filter-chip">{t("common.to")} {endDate}<button title={t("common.clear")} onClick={() => setEndDate("")}>×</button></span>}
            <button type="button" className="filter-chip clear-all-chip" onClick={clearAllFilters}>{t("filter.clear")} ×</button>
          </div>
        )}

        <section className="panel">
          <div className="panel-heading">
            <h3>{t("archive.heading")} <small>{t("archive.clientsCount", { n: shown.length })}</small></h3>
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
            /* Clickable, exactly like a row on the clients table: opens the same
               detail panel. `cursor:pointer` comes from `.archive-row` in the
               stylesheet so the affordance is visible before the click. */
            <div className="archive-row archive-row-clickable" key={c.id} onClick={() => setDetailClient(c)}>
              <span className="id-cell" title={t("th.id")}>#{c.id}</span>
              <span className="rc-avatar">{c.name.slice(0, 2).toUpperCase()}</span>
              <div className="archive-info">
                <strong>{c.name}</strong>
                <small><span className="ltr-num">{c.phoneNumber}</span> · {c.project} · {c.location}</small>
              </div>
              <span className="chan-tag"><i className="dot" style={{ background: optionColor("channels", c.acquisitionChannel, colors) }} />{channelLabel(t, c.acquisitionChannel)}</span>
              <span className="loc-tag"><i className="dot" style={{ background: optionColor("locations", c.location, colors) }} />{c.location}</span>
              {/* StatusPill rather than the class-based `status-${…}` span: that
                  naming only ever matched three hardcoded values, so an archived
                  client on any of the six pipeline stages rendered uncoloured. */}
              <StatusPill status={c.status} t={t} />
              <span className="muted archive-date">
                {c.archivedAt ? t("common.archivedOn", { date: new Date(c.archivedAt).toLocaleDateString(dateLocale(lang)) }) : t("archive.archivedLabel")}
              </span>
              <div className="archive-actions">
                {isAdmin && <button className="btn-outline btn-sm" disabled={busyId === c.id} onClick={e => { e.stopPropagation(); restore(c); }}>
                  <ArchiveRestore size={13} />{t("clients.restore")}
                </button>}
                {isAdmin && (
                  <button className="icon-btn danger" title={t("archive.deleteTitle")} disabled={busyId === c.id} onClick={e => { e.stopPropagation(); destroy(c); }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* Same panel as the clients page. No `onEdit` and no `statusControl`: an
          archived client is out of the book, so editing it here would be
          misleading, and the panel falls back to a read-only status pill.
          `onArchive` is omitted because the client is already archived — the
          only lifecycle action left is Restore, which lives on the row. */}
      {detailClient && (
        <ClientDetailPanel
          client={detailClient}
          onClose={() => setDetailClient(null)}
          onDelete={isAdmin ? () => { const target = detailClient; setDetailClient(null); destroy(target); } : undefined}
          t={t}
          lang={lang}
        />
      )}

      {toast && <div className="toast-single">{toast}</div>}
    </div>
  );
}
