"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  Bell, ChevronDown, LayoutDashboard, UsersRound, Layers, Settings, LogOut,
  Sun, Moon, Menu, X as XIcon, Archive, CheckCheck, Globe, Palette,
} from "lucide-react";
import { useRouter } from "next/navigation";

export type HeaderUser = { name: string; initials: string; role?: string };
export type NavTab = "dashboard" | "clients" | "archived" | "marketing" | "settings";

type Notif = { id: string; message: string; read: boolean; createdAt: string };

const NAV: { key: NavTab; icon: React.ReactNode }[] = [
  { key: "dashboard", icon: <LayoutDashboard size={16} /> },
  { key: "clients", icon: <UsersRound size={16} /> },
  { key: "archived", icon: <Archive size={16} /> },
  { key: "marketing", icon: <Layers size={16} /> },
  { key: "settings", icon: <Settings size={16} /> },
];

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notif[]>([]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      const l = d?.user?.language;
      if (l === "ar" || l === "en") setLang(l);
    }).catch(() => {});
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

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const visibleNav = NAV.filter(item => item.key !== "marketing" || user.role === "Admin");
  const go = (tab: NavTab) => {
    if (tab === "marketing" && user.role !== "Admin") return;
    setMobileMenuOpen(false);
    if (onNavigate) { onNavigate(tab); return; }
    if (tab === "dashboard") router.push("/");
    else if (tab === "clients") router.push("/?view=clients");
    else if (tab === "archived") router.push("/archived");
    else if (tab === "marketing") router.push("/marketing");
    else router.push("/settings");
  };

  const logout = async () => {
    setMobileMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
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
          <span className="brand-letter">R</span>
          <span className="brand-name">rwaq</span>
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

          <div className="user-dropdown">
            <button
              type="button"
              className="icon-btn"
              title={t("header.notifications")}
              onClick={() => { setNotifOpen((o) => !o); if (!notifOpen) refreshNotifications(); }}
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
                <div key={n.id} className="notif-item unread">
                  <span className="notif-new-dot" />
                  <div><strong>{n.message}</strong><small>{new Date(n.createdAt).toLocaleString()}</small></div>
                </div>
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

          <div className="user-dropdown">
            <button
              type="button"
              className="user-pill"
              onClick={() => document.getElementById("app-user-menu")?.classList.toggle("open")}
            >
              <span className="user-avatar">{user.initials}</span>
              <span>{user.name}</span>
              <ChevronDown size={14} className="chevron" />
            </button>
            <div id="app-user-menu" className="dropdown-menu">
              {user.role && (
                <div className="menu-role"><span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span></div>
              )}
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
              <span className="brand-letter">R</span>
              <span className="brand-name">rwaq</span>
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
            <div className="mobile-user-avatar">{user.initials}</div>
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
