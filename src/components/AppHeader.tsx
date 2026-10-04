"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useLogo } from "@/lib/logo";
import { dateLocale } from "@/lib/format";
import { notificationMessage } from "@/lib/reporting";
import BrandMark from "@/components/BrandMark";
import {
  Bell, ChevronDown, LayoutDashboard, UsersRound, Layers, Settings, LogOut,
  Sun, Moon, Menu, X as XIcon, Archive, CheckCheck, Globe, Palette, Settings2,
  UserRound, UserCog, TableProperties,
} from "lucide-react";
import { useRouter } from "next/navigation";

export type HeaderUser = { name: string; initials: string; role?: string };
export type NavTab = "dashboard" | "clients" | "archived" | "marketing" | "metrics" | "users" | "options" | "profile" | "settings";

type Notif = { id: string; message: string; read: boolean; createdAt: string; type?: string; clientName?: string; clientId?: string | null };

const NAV: { key: NavTab; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { key: "dashboard", icon: <LayoutDashboard size={16} /> },
  { key: "clients", icon: <UsersRound size={16} /> },
  { key: "archived", icon: <Archive size={16} /> },
  { key: "marketing", icon: <Layers size={16} /> },
  // The metrics page is the same campaign data as /marketing but as a plain
  // searchable table rather than charts — /marketing answers "how are we doing",
  // this one answers "find me that one campaign". Visible to every role, like
  // /marketing: the figures are company-wide.
  { key: "metrics", icon: <TableProperties size={16} /> },
  // Team directory and user CRUD. Admin-only in the UI; /api/users rejects every
  // write from any other role, so hiding the tab is about clarity, not security.
  { key: "users", icon: <UserCog size={16} />, adminOnly: true },
  // Reference-option management (statuses / channels / locations + their
  // colours). Admin-only in the UI; /api/options rejects every write from any
  // other role, so hiding the tab is about clarity, not security.
  { key: "options", icon: <Settings2 size={16} />, adminOnly: true },
  // Your own profile: your book of clients, your follow-ups, your stats. Kept in
  // the sidebar as well as the user menu, since it is as reachable as any other
  // page here. `go()` routes it directly rather than through the parent's
  // `onNavigate`, so no page has to learn about it — see the note there.
  { key: "profile", icon: <UserRound size={16} /> },
  { key: "settings", icon: <Settings size={16} /> },
];
/** The legacy localStorage copy of the avatar, for photos saved before it was DB-backed. */
function readStoredAvatar(): string {
  try { return localStorage.getItem("rwaq-avatar") ?? ""; } catch { return ""; }
}

export default function AppHeader({
  user, active, onNavigate, badge, darkMode, onToggleDark,
}: {
  user: HeaderUser;
  active?: NavTab;
  onNavigate?: (tab: NavTab) => void;
  badge?: React.ReactNode;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
  const router = useRouter();
  const { t, lang, setLang } = useLang();
  const { logo } = useLogo();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notif[]>([]);
  // The uploaded profile photo. Read from the session (the DB is the source of
  // truth — it used to come only out of this browser's localStorage, so the
  // header showed initials on any other machine and the /users row for the same
  // person showed their photo). The localStorage key is still consulted as a
  // fallback so a photo uploaded before this change keeps showing.
  const [avatar, setAvatar] = useState("");
  const notifWrapRef = useRef<HTMLDivElement>(null);
  const userWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      const l = d?.user?.language;
      if (l === "ar" || l === "en") setLang(l);
      const fromDb = typeof d?.user?.avatar === "string" ? d.user.avatar : "";
      setAvatar(fromDb || readStoredAvatar());
    }).catch(() => setAvatar(readStoredAvatar()));
  }, []);

  const refreshNotifications = () => {
    fetch("/api/notifications").then((r) => r.json()).then((d) => setNotifications(d.notifications ?? [])).catch(() => {});
  };

  useEffect(() => { refreshNotifications(); }, []);

  useEffect(() => {
    const onChange = () => refreshNotifications();
    window.addEventListener("rwaq-notifications-changed", onChange);
    return () => window.removeEventListener("rwaq-notifications-changed", onChange);
  }, []);

  // Re-read the avatar when the settings page uploads or removes one. It
  // re-reads the session rather than the storage key, so a photo set on another
  // device lands here on the next load; the event keeps the current tab instant.
  useEffect(() => {
    const readAvatar = () => {
      fetch("/api/auth/me").then((r) => r.json()).then((d) => {
        const fromDb = typeof d?.user?.avatar === "string" ? d.user.avatar : "";
        setAvatar(fromDb || readStoredAvatar());
      }).catch(() => setAvatar(readStoredAvatar()));
    };
    window.addEventListener("rwaq-avatar-changed", readAvatar);
    return () => window.removeEventListener("rwaq-avatar-changed", readAvatar);
  }, []);

  // Both header popovers close on a click anywhere outside them — the same
  // contract the filter menus keep. Without this they only ever closed on their
  // own toggle button, so the window stayed open over the page beneath it.
  useEffect(() => {
    if (!notifOpen && !userMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifWrapRef.current?.contains(target) || userWrapRef.current?.contains(target)) return;
      setNotifOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [notifOpen, userMenuOpen]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  // Marketing is viewable by every role (campaign figures are company-wide);
  // only its write actions are admin-gated, inside the page itself. The options
  // tab is admin-only in the UI too — /api/options enforces the same rule on
  // every write, so this mirrors the server rather than replacing it.
  const visibleNav = NAV.filter((item) => !item.adminOnly || user.role === "Admin");
  const go = (tab: NavTab) => {
    setMobileMenuOpen(false);
    setNotifOpen(false);
    setUserMenuOpen(false);
    /* Two tabs are routed here rather than delegated. Every page passes its own
       `onNavigate` to rewrite the legacy tab names into URLs, and each one's
       switch ends in an `else` — so a tab they do not know about lands on
       /settings, silently. Handling these before the delegation makes it
       impossible to wire up half-way across ten pages.

       `users` was the second one, and it is the same trap: the dashboard's
       `onNavigate` has no `users` branch, so pressing Users from there — the
       page most people sit on — landed on Settings' Team Members list, which
       looks similar enough to read as a bug report rather than a routing one. */
    if (tab === "profile") { router.push("/profile"); return; }
    if (tab === "users") { router.push("/users"); return; }
    if (onNavigate) { onNavigate(tab); return; }
    if (tab === "dashboard") router.push("/");
    else if (tab === "clients") router.push("/?view=clients");
    else if (tab === "archived") router.push("/archived");
    else if (tab === "marketing") router.push("/marketing");
    else if (tab === "metrics") router.push("/metrics");
    else if (tab === "options") router.push("/options");
    // Deliberately a catch-all for `settings` only: a new tab added to NAV
    // without a branch here would silently land on /settings instead of erroring.
    else router.push("/settings");
  };

  /* /profile is a personal surface rather than a workspace tab, so it is reached
     from the user menu — and, since it was asked for, from the sidebar too. Both
     navigate directly rather than through `go()`'s `onNavigate` delegation, so
     neither depends on a page's switch knowing about it. */
  const openProfile = () => {
    setMobileMenuOpen(false);
    setNotifOpen(false);
    setUserMenuOpen(false);
    router.push("/profile");
  };

  const logout = async () => {
    setMobileMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  /**
   * Opens the client a notification refers to, and marks it read.
   *
   * The read-mark is fired but NOT awaited: navigating is the point, and the
   * header re-reads its list on every mount anyway, so a failed mark cannot
   * strand the user on the page they asked for. Local state is updated straight
   * away so the row leaves the unread list behind them instead of lingering.
   */
  const openNotification = (n: Notif) => {
    if (!n.clientId) return;
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setNotifOpen(false);
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id }),
    }).catch(() => undefined);
    router.push(`/clients/${n.clientId}`);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(true)}
            aria-label={t("header.menu")}
            title={t("header.menu")}
          >
            <Menu size={20} />
          </button>
          {/* The brand is a link home. It calls `go("dashboard")` rather than
              `router.push("/")` on purpose: the dashboard and the clients list
              are two VIEWS OF THIS ROUTE, selected by `view` state in page.tsx,
              not two URLs. Pushing "/" therefore re-fetched the same component
              with the same `view` and looked like a dead button when you were
              on the clients view. `go` prefers the `onNavigate` callback when the
              host page supplied one (this page, which resets `view`), and falls
              back to a real navigation from the standalone routes. */}
          <button
            type="button"
            className="brand-home"
            onClick={() => go("dashboard")}
            title={t("nav.dashboard")}
            aria-label={t("nav.dashboard")}
          >
            <BrandMark logo={logo} alt={t("brand.logoAlt")} />
            <span className="brand-name">rwaq</span>
          </button>
          {badge}
        </div>

        <nav className="topbar-nav">
          {visibleNav.map((item) => (
            <button key={item.key} onClick={() => go(item.key)} className={active === item.key ? "nav-active" : ""} aria-current={active === item.key ? "page" : undefined}>
              {item.icon}{t("nav." + item.key)}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <div className="lang-switch" dir="ltr">
            <button
              type="button"
              className={lang === "ar" ? "active" : ""}
              onClick={() => setLang("ar")}
            >
              AR
            </button>
            <button
              type="button"
              className={lang === "en" ? "active" : ""}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleDark}
            title={darkMode ? t("header.switchLight") : t("header.switchDark")}
            aria-label={darkMode ? t("header.switchLight") : t("header.switchDark")}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="user-dropdown" ref={notifWrapRef}>
            <button
              type="button"
              className="icon-btn"
              title={t("header.notifications")}
              onClick={() => { setNotifOpen((o) => !o); setUserMenuOpen(false); if (!notifOpen) refreshNotifications(); }}
            >
              <Bell size={16} />{unreadCount > 0 && <i />}
            </button>
            <div className={`dropdown-menu notif-menu ${notifOpen ? "open" : ""}`}>
              <div className="notif-head">
                <strong>{t("header.notifications")}</strong>
                {unreadCount > 0 && <button type="button" onClick={markAllRead}>{t("header.markAllRead")}</button>}
              </div>
              {unreadCount === 0 && (
                <div className="notif-allread"><CheckCheck size={13} /> {t("header.allCaughtUp")}</div>
              )}
              {notifications.filter((n) => !n.read).slice(0, 30).map((n) => (
                /* A <button>, because a notification is a pointer at a specific
                   client: the row was a <div>, so clicking "Sarah was assigned to
                   you" did absolutely nothing and the only working control was
                   the "View all" link at the bottom. `clientId` was already on the
                   Notification row in the schema and already coming back from
                   /api/notifications — only the header's local type dropped it, so
                   this needed no backend change.

                   A notification with no clientId (a workspace-wide message) stays
                   a plain, non-interactive row rather than a button that navigates
                   nowhere. */
                n.clientId ? (
                  <button
                    type="button"
                    key={n.id}
                    className="notif-item notif-item-btn unread"
                    onClick={() => openNotification(n)}
                  >
                    <span className="notif-new-dot" />
                    <div><strong>{notificationMessage(t, n)}</strong><small>{new Date(n.createdAt).toLocaleString(dateLocale(lang))}</small></div>
                  </button>
                ) : (
                  <div key={n.id} className="notif-item unread">
                    <span className="notif-new-dot" />
                    <div><strong>{notificationMessage(t, n)}</strong><small>{new Date(n.createdAt).toLocaleString(dateLocale(lang))}</small></div>
                  </div>
                )
              ))}
              <button
                type="button"
                className="notif-footer"
                onClick={() => { setNotifOpen(false); router.push("/notifications"); }}
              >
                {t("header.viewAll")}
              </button>
            </div>
          </div>

          <div className="user-dropdown" ref={userWrapRef}>
            <button
              type="button"
              className="user-pill"
              onClick={() => { setUserMenuOpen((o) => !o); setNotifOpen(false); }}
            >
              {avatar
                ? <span className="user-avatar user-avatar-photo"><img src={avatar} alt="" /></span>
                : <span className="user-avatar">{user.initials}</span>}
              <span>{user.name}</span>
              <ChevronDown size={14} className="chevron" />
            </button>
            <div id="app-user-menu" className={`dropdown-menu ${userMenuOpen ? "open" : ""}`}>
              {user.role && (
                <div className="menu-role"><span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span></div>
              )}
              <button type="button" onClick={openProfile}><UserRound size={14} />{t("profile.title")}</button>
              <button type="button" onClick={() => go("settings")}><Settings size={14} />{t("nav.settings")}</button>
              <button type="button" className="dropdown-danger" onClick={logout}><LogOut size={14} />{t("header.signOut")}</button>
            </div>
          </div>
        </div>
      </header>

      {/* Responsive mobile menu drawer */}
      <div
        className={`mobile-nav-overlay ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden={!mobileMenuOpen}
      >
        <div className="mobile-nav-panel" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-nav-header">
            <div className="mobile-brand-wrap">
              {/* Same home link as the desktop bar, routed through `go` so it
                  resets the in-page view rather than re-pushing the URL the
                  dashboard and clients list already share. `go` also closes the
                  drawer, so tapping the logo does not navigate while the panel
                  stays open over the page it just navigated to. */}
              <button
                type="button"
                className="brand-home"
                onClick={() => go("dashboard")}
                title={t("nav.dashboard")}
                aria-label={t("nav.dashboard")}
              >
                <BrandMark logo={logo} alt={t("brand.logoAlt")} />
                <span className="brand-name">rwaq</span>
              </button>
              {badge}
            </div>
            <button
              type="button"
              className="mobile-nav-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label={t("common.close")}
            >
              <XIcon size={18} />
            </button>
          </div>

          <div className="mobile-user-card">
            <div className="mobile-user-avatar">{avatar ? <img src={avatar} alt="" /> : user.initials}</div>
            <div className="mobile-user-info">
              <strong>{user.name}</strong>
              {user.role && <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>}
            </div>
          </div>

          <div className="mobile-nav-links">
            <div className="mobile-nav-section-title">{t("header.menu")}</div>
            {visibleNav.map((item) => (
              <button
                type="button"
                key={item.key}
                className={active === item.key ? "active" : ""}
                onClick={() => go(item.key)}
              >
                <span className="mobile-nav-icon">{item.icon}</span>
                <span className="mobile-nav-text">{t("nav." + item.key)}</span>
              </button>
            ))}
          </div>

          <div className="mobile-nav-prefs">
            <div className="mobile-nav-section-title">{t("settings.preferences")}</div>

            <div className="mobile-pref-row">
              <div className="mobile-pref-label">
                <Globe size={15} />
                <span>{t("settings.language")}</span>
              </div>
              <div className="lang-switch" dir="ltr">
                <button
                  type="button"
                  className={lang === "ar" ? "active" : ""}
                  onClick={() => setLang("ar")}
                >
                  العربية
                </button>
                <button
                  type="button"
                  className={lang === "en" ? "active" : ""}
                  onClick={() => setLang("en")}
                >
                  English
                </button>
              </div>
            </div>

            <div className="mobile-pref-row">
              <div className="mobile-pref-label">
                <Palette size={15} />
                <span>{darkMode ? t("settings.darkMode") : t("settings.lightMode")}</span>
              </div>
              <button
                type="button"
                className="mobile-theme-pill-btn"
                onClick={onToggleDark}
                title={darkMode ? t("header.switchLight") : t("header.switchDark")}
              >
                {darkMode ? <Sun size={15} /> : <Moon size={15} />}
                <span>{darkMode ? t("header.switchLight") : t("header.switchDark")}</span>
              </button>
            </div>
          </div>

          <div className="mobile-nav-footer">
            <button type="button" className="mobile-logout" onClick={logout}>
              <LogOut size={16} />
              <span>{t("header.signOut")}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
