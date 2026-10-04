"use client";

/**
 * A person's profile: who they are, and the clients they are responsible for.
 *
 * The 1st / 2nd contact split is the point of this page. Your data shows it is a
 * real boundary in the workspace, not a formality — eight reps carry their book
 * as the 1st contact (هشام 179, ابو شيخة 146, محمد حسام 20) and a separate group
 * only ever appears as the 2nd (العجمي 91, عاطف 77, حلمى 33). The two roles are
 * therefore counted and filtered SEPARATELY rather than summed into one "my
 * clients" figure, which would hide which side of the relationship you are on.
 *
 * Renders the SAME `ClientFilterBar` and `ClientTable` the clients page uses, so
 * the filters, column picker, resizable columns, sorting and paging are the same
 * components rather than a copy that drifts.
 *
 * `?user=<name>` opens SOMEONE ELSE's profile. The dashboard's Sales Performance
 * panel links every rep's name here, so a manager can go from "who is carrying
 * what" straight to one person's book without touching the clients page.
 *
 * Viewing others is allowed for every signed-in user, not just Admin — see the
 * matching note on the `assignee` resolution in /api/crm/clients, which is where
 * the permission boundary actually lives. `self` is the person whose book is on
 * screen: you by default, or the `?user=` target when there is one.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, UsersRound, AlertCircle } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import ClientFilterBar from "@/components/ClientFilterBar";
import ClientTable from "@/components/ClientTable";
import ClientDetailPanel from "@/components/ClientDetailPanel";
import { useLang } from "@/lib/i18n";
import { canWrite } from "@/lib/auth";
import { isOverdue, num } from "@/lib/format";
import { CLIENT_COLUMNS } from "@/lib/client-columns";
import { useColumnLayout } from "@/lib/use-column-layout";
import {
  initialFilters,
  type Client,
  type DatePreset,
  type Filters,
  type SortField,
  type TFn,
} from "@/lib/client-types";

type User = { name: string; initials: string; role: string; email?: string; username?: string; avatar?: string };

const PAGE_SIZE = 25;

/** Rolling windows offered above the table. Local-day keys, as on the clients page. */
function datePresets(): DatePreset[] {
  const day = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  return [
    { label: "date.today", startDate: day(0) },
    { label: "date.last7", startDate: day(6) },
    { label: "date.last30", startDate: day(29) },
    { label: "date.last90", startDate: day(89) },
    { label: "date.thisMonth", startDate: day(firstOfMonth.getDate() - 1) },
  ];
}

/** No selection state lives here — the profile table is read-and-follow-up only. */
const NO_SELECTION: Set<string> = new Set();

/**
 * `useSearchParams` needs a <Suspense> boundary on a prerendered-static route, or
 * the build fails with `missing-suspense-with-csr-bailout`. This wrapper is that
 * boundary.
 *
 * It also has to exist for correctness, not just for the build: reading the query
 * off `window.location` inside a mount-time effect would NOT re-run when
 * `router.push("/profile?user=someone-else")` swaps one target for another in
 * place, because `useRouter()` is a stable reference. `useSearchParams` re-renders
 * on the query change, so the effect below re-resolves and the book actually
 * changes.
 */
export default function ProfilePage() {
  return (
    <Suspense fallback={<main className="shell-loading"><div className="spinner" /></main>}>
      <ProfileView />
    </Suspense>
  );
}

function ProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang } = useLang();
  const [user, setUser] = useState<User | null>(null);
  /* The `?user=` target, once resolved. Null means "this is your own profile". */
  const [target, setTarget] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [rows, setRows] = useState<Client[]>([]);
  /**
   * How many clients each follow-up bucket holds in this rep's book. Scope-level,
   * not filter-level, for the same reason as the clients page: a stable number
   * beside each chip is what proves the filter is live, and one that recounted
   * itself on every status click would be noise.
   */
  const [followUpCounts, setFollowUpCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sortBy, setSortBy] = useState<SortField>("recent");
  const [role, setRole] = useState<"first" | "second" | "all">("all");
  const [allStatuses, setAllStatuses] = useState<string[]>([]);
  const [allChannels, setAllChannels] = useState<string[]>([]);
  const [allLocations, setAllLocations] = useState<string[]>([]);
  /* Column widths + visibility, persisted like the clients page's.
     This used to be a bare `useState`, which is why the resizer here was broken:
     a drag updated local state, looked correct, and reverted on reload — and never
     reached `PATCH /api/auth/me`, so it could not affect the clients page either.
     `commit` (aliased to `setColumns` so the table's prop is unchanged) applies the
     drag now and saves it a moment later. */
  const { columns, commit: setColumns, hydrate } = useColumnLayout(CLIENT_COLUMNS, "clientColumns");
  const [detail, setDetail] = useState<Client | null>(null);
  const [firstCount, setFirstCount] = useState(0);
  const [secondCount, setSecondCount] = useState(0);
/* Which preset is highlighted, so a chosen window stays visibly chosen after
     the bar re-renders. Mirrors the clients page. */
  const [activeDatePreset, setActiveDatePreset] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const rtl = lang === "ar";

  useEffect(() => {
// Same pattern as the clients/archived pages: the stored theme can only be read
    // after hydration, so it is adopted here rather than in a useState initialiser
    // (which would desync the server HTML from the first client render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("rwaq-dark") === "1") setDarkMode(true);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  /* The `?user=` target. Empty means "your own profile". Derived from the hook on
     every render, so it is always in step with the URL. */
  const wanted = (searchParams.get("user") ?? "").trim();

  useEffect(() => {
    /* `stale` guards both the redirect and the target update below.
       Navigating between two reps re-runs this effect while the first run's
       /api/users is still in flight; without the guard that late response would
       land last and overwrite the new person's header with the old one's. */
    let stale = false;
    (async () => {
      /* Only /api/auth/me is on the critical path. This used to be a Promise.all
         with /api/users, which meant the table below could not start until a
         response carrying every teammate's avatar data URL had downloaded — to
         display a name the URL had already given us. */
      const meRes = await fetch("/api/auth/me");
      if (stale) return;
      if (!meRes.ok) { router.replace("/login"); return; }
      const d = await meRes.json() as { authenticated: boolean; user?: User & { clientColumns?: Record<string, { w?: number; hidden?: boolean }> } };
      if (!d.authenticated || !d.user) { router.replace("/login"); return; }

      setUser(d.user);
      // Adopt the saved layout. Calling `hydrate` rather than `setColumns` keeps
      // this on the same state as a drag, so a later resize saves correctly.
      hydrate(d.user.clientColumns);

      /* Fresh view per person. Without this, following a link from one rep's
         profile to another's lands on page 4 of their book — or on an empty
         page, if their book is shorter than the page you were on. The counts are
         cleared too so the tiles never show one person's totals under another
         person's name while the new fetch is in flight.

         Done here rather than in its own effect because this is the one moment we
         know the person changed; an effect keyed on the name would fire an extra
         render pass after the data had already been requested. */
      setPage(1);
      setRole("all");
      setFirstCount(0);
      setSecondCount(0);

      if (!wanted) { setTarget(null); return; }

      /* Release the table straight away, using the name from the URL.

         `self = target ?? user` is what gates the clients fetch, so until this
         runs there is nothing to fetch with. The clients query already sends
         `assignee=<name>` and the API resolves the person itself, so the table
         needs only the name — not the role or the photo.

         This optimistic shape is not new: it is exactly the fallback used below
         when the lookup finds nobody, so an unknown name and a not-yet-loaded one
         render identically. It deliberately never falls back to the viewer's own
         identity, which would relabel the page as "me" while the table still
         showed the other person's clients. */
      setTarget({ name: wanted, initials: wanted.slice(0, 2).toUpperCase(), role: "" });

      /* Now upgrade the header with the real role and photo, off the critical
         path. Left as the optimistic target when there is no match: showing the
         requested name with no role is the same honest thing the failed lookup
         showed before. */
      void fetch("/api/users")
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => {
          if (stale || !u) return;
          const hit = (u as { users?: { name: string; role: string; email?: string; username?: string; avatar?: string }[] }).users?.find(x => x.name === wanted);
          if (!hit) return;
          setTarget({ name: hit.name, role: hit.role, email: hit.email, username: hit.username, avatar: hit.avatar, initials: hit.name.slice(0, 2).toUpperCase() });
        })
        .catch(() => { /* the optimistic target is already on screen */ });
    })().catch(() => { if (!stale) router.replace("/login"); });
    return () => { stale = true; };
    // `hydrate` is a stable useCallback (its only dep is the module-level
    // registry), so listing it costs nothing and keeps the lint honest.
  }, [router, wanted, hydrate]);

  /* Whose book is on screen: the `?user=` target when there is one, otherwise the
     signed-in user. Everything below reads this rather than `user`, so switching
     targets moves the header, the counts, the contact dropdowns and the query in
     one step and none of them can be left describing the previous person. */
  const self = target ?? user;
  const viewingOther = Boolean(target) && target?.name !== user?.name;

  /**
   * Query string shared by the table fetch and the two role counts, so a count
   * can never describe a different filter than the table beside it.
   */
  const query = useMemo(() => {
    const p = new URLSearchParams({ paged: "1", pageSize: String(PAGE_SIZE) });
    /* Always sent, for two different reasons. For an Admin it is the ONLY thing
       narrowing the view (they are unscoped everywhere else, so without it the
       page would list the whole company). For everyone else it names whose book
       to read when `?user=` is present. */
    if (self?.name) p.set("assignee", self.name);
    if (role !== "all") p.set("contact", role);
    if (filters.query) p.set("q", filters.query);
    if (filters.status.length) p.set("status", filters.status.join(","));
    if (filters.channel.length) p.set("channel", filters.channel.join(","));
    if (filters.location.length) p.set("location", filters.location.join(","));
    /* The 1st/2nd contact dropdowns are offered here as well, so their values have
       to reach the API or the chips would claim a filter that filters nothing. */
    if (filters.firstContact.length) p.set("firstContact", filters.firstContact.join(","));
    if (filters.secondContact.length) p.set("secondContact", filters.secondContact.join(","));
    if (filters.followUp) p.set("followUp", filters.followUp);
    if (filters.startDate) p.set("from", filters.startDate);
    if (filters.endDate) p.set("to", filters.endDate);
    p.set("sort", sortBy);
    return p.toString();
  }, [self, role, filters, sortBy]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/clients?${query}&page=${page}&followUpCounts=1`, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) return;
    const d = await res.json() as {
      clients?: Client[]; total?: number; pageCount?: number;
      statuses?: string[]; channels?: string[]; locations?: string[];
      followUpCounts?: Record<string, number>;
    };
    setRows(d.clients ?? []);
    setFollowUpCounts(d.followUpCounts ?? {});
    setTotal(d.total ?? 0);
    setPageCount(Math.max(1, d.pageCount ?? 1));
    if (d.statuses) setAllStatuses(d.statuses);
    if (d.channels) setAllChannels(d.channels);
    if (d.locations) setAllLocations(d.locations);
  }, [query, page]);

  // `load` resolves async and owns its own setState, so this is a subscription to an
  // external system rather than a synchronous state write.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (self) void load(); }, [load, self]);

  /**
   * The two role totals, requested with `idsOnly` so they cost one id column
   * rather than a full page of rows.
   *
   * `contact` is passed explicitly rather than derived from `role`, because the
   * tiles must show BOTH numbers at once regardless of which one is currently
   * filtering the table.
   */
  useEffect(() => {
    if (!self) return;
    const base = new URLSearchParams(query);
    base.delete("paged"); base.delete("pageSize"); base.delete("sort"); base.delete("contact");
    const count = async (contact: "first" | "second") => {
      const p = new URLSearchParams(base);
      p.set("contact", contact);
      p.set("idsOnly", "1");
      const res = await fetch(`/api/crm/clients?${p.toString()}`, { cache: "no-store" }).catch(() => null);
      return res && res.ok ? ((await res.json() as { total?: number }).total ?? 0) : 0;
    };
    void Promise.all([count("first"), count("second")]).then(([f, s]) => {
      setFirstCount(f); setSecondCount(s);
    });
  }, [query, self]);

  // Scoped to the page on screen, not the whole book — the tiles sit above a
  // pager and a number from another page would be a lie.
  const overdue = useMemo(() => rows.filter(r => isOverdue(r.nextFollowUpAt)).length, [rows]);
  const canEdit = canWrite(user?.role);
  const filterCount =
    filters.status.length + filters.channel.length + filters.location.length +
    filters.firstContact.length + filters.secondContact.length +
    (filters.followUp ? 1 : 0) + (filters.startDate ? 1 : 0) +
    (filters.endDate ? 1 : 0) + (filters.query ? 1 : 0);

  /* Accepts all five keys the filter bar can send. Narrowing this to the three it
     happens to use today would make the contact chips silently do nothing the
     moment they were wired up. */
  const setMulti = (
    key: "status" | "channel" | "location" | "firstContact" | "secondContact",
    values: string[],
  ) => {
    setPage(1); setFilters(f => ({ ...f, [key]: values }));
  };
  const updateFilter = (k: "query" | "startDate" | "endDate", v: string) => {
    setPage(1); setFilters(f => ({ ...f, [k]: v }));
    /* Typing a date by hand supersedes whichever preset was active, so the
       highlight is dropped rather than left describing a different range. */
    if (k !== "query") setActiveDatePreset(null);
  };

  /* The filter bar renders the preset buttons unconditionally whenever
     `datePresets` is passed, and calls these with a non-null assertion. Omitting
     them would make every preset throw on click. */
  const applyDatePreset = (preset: DatePreset) => {
    setPage(1);
    setFilters(f => ({ ...f, startDate: preset.startDate ?? "", endDate: preset.endDate ?? "" }));
    setActiveDatePreset(preset.label);
  };
  const clearDatePreset = () => {
    setPage(1);
    setFilters(f => ({ ...f, startDate: "", endDate: "" }));
    setActiveDatePreset(null);
  };

  if (!user) return <main className="shell-loading"><div className="spinner" /><p>{t("common.loading")}</p></main>;

  return (
    <main className="shell">
      <AppHeader
        user={user}
        active="profile"
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        onNavigate={(tab) => {
          if (tab === "dashboard") router.push("/");
          else if (tab === "clients") router.push("/?view=clients");
          else if (tab === "archived") router.push("/archived");
          else if (tab === "marketing") router.push("/marketing");
          else if (tab === "options") router.push("/options");
          else router.push("/settings");
        }}
      />

      <div className="content">
        <div className="page">
          {/* Banner only when looking at somebody else. Without it, a manager who arrived
              here from Sales Performance has no on-screen cue that the book below
              is not their own — the page would otherwise look identical to their
              own profile. */}
          {viewingOther && self && (
            <div className="selection-info profile-viewing" style={{ marginBottom: 12 }}>
              <UsersRound size={14} />
              {t("profile.viewingOf", { name: self.name })}
              <button className="btn-outline btn-sm" onClick={() => router.push("/profile")}>
                {t("profile.backToMine")}
              </button>
            </div>
          )}

          <div className="page-header">
            <div>
              <div className="breadcrumb"><UsersRound size={14} />{t("profile.title")}</div>
              <h1>{self?.name}</h1>
              <p>{t(viewingOther ? "profile.theirSubtitle" : "profile.subtitle")}</p>
            </div>
            {/* The role badge follows the person on screen, but "edit in settings"
                is only shown on your OWN profile — it opens YOUR settings, so
                offering it here would send you to your own account while looking
                at someone else's book. */}
            <div className="header-actions">
              {self?.role && <span className={`role-badge ${self.role.toLowerCase()}`}>{self.role}</span>}
              {!viewingOther && (
                <button className="btn-outline" onClick={() => router.push("/settings")}>
                  <ArrowUpRight size={14} />{t("profile.editInSettings")}
                </button>
              )}
            </div>
          </div>

          {/* Identity, then the three numbers that describe a rep's day. Each tile
              is also the filter for what it counts — clicking "as 1st contact"
              shows only those, clicking again clears it. */}
          <section className="profile-summary">
            <div className="profile-card">
              {/* Initials before, and never an image: this rendered the initials
                  and nothing else, so a user who HAD a photo uploaded still saw
                  no picture here even though /users and the header both showed
                  one. Same fallback the table uses. */}
              <div className="profile-avatar">
                {self?.avatar ? <img src={self.avatar} alt="" /> : self?.initials}
              </div>
              <div className="profile-id">
                <strong>{self?.name}</strong>
                <small>{self?.email || "—"}</small>
                {self?.username && <small className="muted">@{self.username}</small>}
              </div>
            </div>
            <div className="profile-stats">
              <button
                type="button"
                className={`profile-stat ${role === "first" ? "active" : ""}`}
                title={t("profile.filterByRole")}
                onClick={() => { setPage(1); setRole(r => (r === "first" ? "all" : "first")); }}
              >
                <strong>{num(firstCount)}</strong><span>{t("profile.asFirst")}</span>
              </button>
              <button
                type="button"
                className={`profile-stat ${role === "second" ? "active" : ""}`}
                title={t("profile.filterByRole")}
                onClick={() => { setPage(1); setRole(r => (r === "second" ? "all" : "second")); }}
              >
                <strong>{num(secondCount)}</strong><span>{t("profile.asSecond")}</span>
              </button>
              <button
                type="button"
                className={`profile-stat ${filters.followUp === "overdue" ? "active is-danger" : ""}`}
                title={t("profile.overdueHint")}
                onClick={() => { setPage(1); setFilters(f => ({ ...f, followUp: f.followUp === "overdue" ? "" : "overdue" })); }}
              >
                <strong>{num(overdue)}</strong><span>{t("profile.overdueOnPage")}</span>
              </button>
            </div>
          </section>

          {role !== "all" && (
            <div className="selection-info" style={{ marginBottom: 12 }}>
              <AlertCircle size={14} />
              {role === "first" ? t("profile.showingFirst") : t("profile.showingSecond")}
            </div>
          )}
{/* The identical bar the clients page uses. `firstContacts`/`secondContacts` are
              the person whose book is on screen and nobody else: a book scoped to
              one person cannot contain anyone else, so offering colleagues' names
              would only filter to nothing. */}
          <ClientFilterBar
            filters={filters}
            updateFilter={updateFilter}
            setMultiFilter={setMulti}
            followUp={filters.followUp}
            followUpCounts={followUpCounts}
            setFollowUp={v => { setPage(1); setFilters(f => ({ ...f, followUp: f.followUp === v ? "" : v })); }}
            clearAllFilters={() => { setPage(1); setFilters(initialFilters); setActiveDatePreset(null); setRole("all"); }}
            firstContacts={self?.name ? [self.name] : []}
            secondContacts={self?.name ? [self.name] : []}
            datePresets={datePresets()}
            activeDatePreset={activeDatePreset}
            applyDatePreset={applyDatePreset}
            clearDatePreset={clearDatePreset}
            sortBy={sortBy}
            setSortBy={s => { setPage(1); setSortBy(s); }}
            filterCount={filterCount}
            allStatuses={allStatuses}
            allChannels={allChannels}
            allLocations={allLocations}
            t={t as TFn}
          />

          <section className="panel">
            <div className="panel-heading">
              <h3>{t(viewingOther ? "profile.theirClients" : "profile.myClients")} <small>{t("profile.clientCount", { n: total })}</small></h3>
            </div>
            {/* Bulk selection is suppressed rather than left inert: this page is a
                read-and-follow-up surface, and a checkbox that does nothing is worse
                than no checkbox. `NO_SELECTION` is hoisted so the table does not see a brand-new
                 Set on every render.

                 `isAdmin` is forced off: admin-only delete/archive have no handler
                 wired on this page, and rendering buttons that silently do nothing
                 is the same fault as the checkbox column. Edit instead routes to the
                 full client page, which really can edit. */}
            <ClientTable
              clients={rows}
              selectedIds={NO_SELECTION}
              toggleSelect={() => undefined}
              toggleSelectAll={() => undefined}
              onOpenEdit={c => router.push(`/clients/${c.id}`)}
              onOpenDelete={() => undefined}
              onOpenDetail={setDetail}
              isAdmin={false}
              canEdit={canEdit}
              tableRef={tableRef}
              columns={columns}
              onColumnsChange={setColumns}
              rtl={rtl}
              t={t as TFn}
              hideSelect
            />
            {pageCount > 1 && (
              <div className="pager">
                <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("pager.prev")}</button>
                <span className="muted">{t("pager.pageOf", { page, count: pageCount })}</span>
                <button className="btn-outline btn-sm" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>{t("pager.next")}</button>
              </div>
            )}
          </section>
        </div>
      </div>

      {detail && (
        <ClientDetailPanel client={detail} onClose={() => setDetail(null)} t={t as TFn} lang={lang} />
      )}
    </main>
  );
}