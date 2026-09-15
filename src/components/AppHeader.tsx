"use client";

import { useEffect, useState } from "react";
import {
  Bell, ChevronDown, LayoutDashboard, UsersRound, Layers, Settings, LogOut,
  Sun, Moon, Menu, X as XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

export type HeaderUser = { name: string; initials: string; role?: string };
export type NavTab = "dashboard" | "clients" | "marketing" | "settings";

type Notif = { id: string; message: string; read: boolean; createdAt: string };

const NAV: { key: NavTab; label: string; icon: React.ReactNode }[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={15} /> },
  { key: "clients", label: "Clients", icon: <UsersRound size={15} /> },
  { key: "marketing", label: "Marketing", icon: <Layers size={15} /> },
  { key: "settings", label: "Settings", icon: <Settings size={15} /> },
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
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notif[]>([]);

  const refreshNotifications = () => {
    fetch("/api/notifications").then((r) => r.json()).then((d) => setNotifications(d.notifications ?? [])).catch(() => {});
  };

  useEffect(() => { refreshNotifications(); }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const go = (tab: NavTab) => {
    setMobileMenuOpen(false);
    if (onNavigate) { onNavigate(tab); return; }
    if (tab === "dashboard") router.push("/");
    else if (tab === "clients") router.push("/?view=clients");
    else if (tab === "marketing") router.push("/marketing");
    else router.push("/settings");
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); };

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)} aria-label="Menu"><Menu size={18} /></button>
          <span className="brand-letter">R</span>
          <span className="brand-name">rwaq</span>
          {badge}
        </div>
        <nav className="topbar-nav">
          {NAV.map((item) => (
            <button key={item.key} onClick={() => go(item.key)} className={active === item.key ? "nav-active" : ""}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button className="theme-toggle" onClick={onToggleDark} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="user-dropdown">
            <button className="icon-btn" title="Notifications" onClick={() => { setNotifOpen((o) => !o); if (!notifOpen) refreshNotifications(); }}>
              <Bell size={16} />{unreadCount > 0 && <i />}
            </button>
            <div className={`dropdown-menu notif-menu ${notifOpen ? "open" : ""}`}>
              <div className="notif-head"><strong>Notifications</strong>{unreadCount > 0 && <button onClick={markAllRead}>Mark all read</button>}</div>
              {notifications.length === 0 && <div className="notif-empty">No notifications yet</div>}
              {notifications.slice(0, 30).map((n) => (
                <div key={n.id} className={`notif-item ${n.read ? "" : "unread"}`}>
                  <span className="notif-new-dot" />
                  <div><strong>{n.message}</strong><small>{new Date(n.createdAt).toLocaleString()}</small></div>
                </div>
              ))}
            </div>
          </div>
          <div className="user-dropdown">
            <button className="user-pill" onClick={() => document.getElementById("app-user-menu")?.classList.toggle("open")}>
              <span className="user-avatar">{user.initials}</span>
              <span>{user.name}</span>
              <ChevronDown size={14} className="chevron" />
            </button>
            <div id="app-user-menu" className="dropdown-menu">
              <button onClick={() => go("settings")}><Settings size={14} />Settings</button>
              <button onClick={() => go("marketing")}><Layers size={14} />Marketing</button>
              <button className="dropdown-danger" onClick={logout}><LogOut size={14} />Sign out</button>
            </div>
          </div>
        </div>
      </header>

      <div className={`mobile-nav-overlay ${mobileMenuOpen ? "open" : ""}`} onClick={() => setMobileMenuOpen(false)}>
        <div className="mobile-nav-panel" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-nav-header">
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span className="brand-letter">R</span>
              <span className="brand-name">rwaq</span>
            </div>
            <button className="mobile-nav-close" onClick={() => setMobileMenuOpen(false)}><XIcon size={18} /></button>
          </div>
          <div className="mobile-nav-links">
            {NAV.map((item) => (
              <button key={item.key} className={active === item.key ? "active" : ""} onClick={() => go(item.key)}>
                {item.icon}{item.label}
              </button>
            ))}
          </div>
          <div className="mobile-nav-footer">
            <button onClick={onToggleDark}>{darkMode ? <Sun size={16} /> : <Moon size={16} />}{darkMode ? "Light mode" : "Dark mode"}</button>
            <button className="mobile-logout" onClick={logout}><LogOut size={16} />Sign out</button>
          </div>
        </div>
      </div>
    </>
  );
}