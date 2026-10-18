"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import {
  LayoutDashboard, UsersRound, BarChart3, Archive, Layers,
  TableProperties, UserCog, Settings2, UserRound, Settings, LogOut,
} from "lucide-react";

export type NavTab = "dashboard" | "clients" | "insights" | "archived" | "marketing" | "metrics" | "users" | "options" | "profile" | "settings";
export type MenuLocation = "header" | "sidebar";

const NAV: { key: NavTab; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { key: "dashboard", icon: <LayoutDashboard size={16} /> },
  { key: "clients", icon: <UsersRound size={16} /> },
  { key: "insights", icon: <BarChart3 size={16} /> },
  { key: "archived", icon: <Archive size={16} /> },
  { key: "marketing", icon: <Layers size={16} /> },
  { key: "metrics", icon: <TableProperties size={16} /> },
  { key: "users", icon: <UserCog size={16} />, adminOnly: true },
  { key: "options", icon: <Settings2 size={16} />, adminOnly: true },
  { key: "profile", icon: <UserRound size={16} /> },
  { key: "settings", icon: <Settings size={16} /> },
];

export default function Sidebar({
  user, active, onLogout, onNavigate,
}: {
  user: { name: string; initials: string; role?: string };
  active?: NavTab;
  onLogout: () => void;
  onNavigate?: (tab: NavTab) => void;
}) {
  const router = useRouter();
  const { t } = useLang();
  const visibleNav = NAV.filter((item) => !item.adminOnly || user.role === "Admin");

  const go = (key: NavTab) => {
    if (onNavigate && (key === "dashboard" || key === "clients")) {
      onNavigate(key);
      return;
    }
    if (key === "profile") { router.push("/profile"); return; }
    if (key === "users") { router.push("/users"); return; }
    if (key === "insights") { router.push("/insights"); return; }
    if (key === "dashboard") { router.push("/"); return; }
    if (key === "clients") { router.push("/?view=clients"); return; }
    if (key === "archived") { router.push("/archived"); return; }
    if (key === "marketing") { router.push("/marketing"); return; }
    if (key === "metrics") { router.push("/metrics"); return; }
    if (key === "options") { router.push("/options"); return; }
    router.push("/settings");
  };

  return (
    <aside className="sidebar app-sidebar" aria-label={t("header.menu")}>
      <div className="sidebar-wrap">
        <nav className="sidebar-nav">
          {visibleNav.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => go(item.key)}
              className={active === item.key ? "nav-active" : ""}
              aria-current={active === item.key ? "page" : undefined}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-text">{t("nav." + item.key)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="sidebar-logout" onClick={onLogout}>
            <LogOut size={16} />
            <span>{t("header.signOut")}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
