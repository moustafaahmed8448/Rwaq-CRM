"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, BarChart3, ClipboardCheck, History, UsersRound } from "lucide-react";
import AppHeader, { type HeaderUser } from "@/components/AppHeader";
import FollowUpWorkspace from "@/components/FollowUpWorkspace";
import StaleClientsPanel from "@/components/StaleClientsPanel";
import ActivityFeedPanel from "@/components/ActivityFeedPanel";
import TeamReportPanel from "@/components/TeamReportPanel";
import DataQualityPanel from "@/components/DataQualityPanel";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-errors";
import { statusLabel } from "@/lib/reporting";
import type { Client, TFn } from "@/lib/client-types";
import type { ActivityEntry } from "@/lib/types";

type InsightTab = "status" | "followup" | "stale" | "activity" | "team" | "quality";
type ClientWithActivity = Client & { activityLog?: ActivityEntry[] };
type User = HeaderUser & { role: string };

const TABS: Array<{ key: InsightTab; label: string; icon: typeof Activity }> = [
  { key: "status", label: "insights.statusOverview", icon: BarChart3 },
  { key: "followup", label: "followupWorkspace.title", icon: Activity },
  { key: "stale", label: "stale.title", icon: ClipboardCheck },
  { key: "activity", label: "activityFeed.title", icon: History },
  { key: "team", label: "team.title", icon: UsersRound },
  { key: "quality", label: "dq.title", icon: ClipboardCheck },
];

export default function InsightsPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [clients, setClients] = useState<ClientWithActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<InsightTab>("status");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    const match = TABS.find((tab) => tab.key === requested);
    // The query string is an external navigation input used to select the initial tab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setActiveTab(match.key);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const data = await response.json() as { authenticated?: boolean; user?: User };
        if (!data.authenticated || !data.user) {
          router.replace("/login");
          return;
        }
        setUser(data.user);
      })
      .catch(() => router.replace("/login"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkMode(localStorage.getItem("rwaq-dark") === "1");
  }, [router]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/crm/clients", { cache: "no-store" });
      const data = await response.json() as { clients?: ClientWithActivity[]; error?: unknown };
      if (!response.ok) throw new Error(apiErrorMessage(t, data.error));
      setClients(data.clients ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errors.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Client data is loaded only after the session is confirmed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void loadClients();
  }, [user, loadClients]);

  const patchClient = async (id: string, patch: { nextFollowUpAt: string | null }) => {
    try {
      const response = await fetch("/api/crm/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await response.json() as { error?: unknown };
      if (!response.ok) throw new Error(apiErrorMessage(t, data.error));
      await loadClients();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errors.generic"));
    }
  };

  if (!user) return <main className="shell"><div className="loading-screen">{t("common.loading")}</div></main>;

  return (
    <main className="shell">
      <AppHeader
        user={user}
        active="insights"
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((value) => !value)}
      />
      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><BarChart3 size={14} />{t("insights.title")}</div>
            <h1>{t("insights.title")}</h1>
            <p>{t("insights.subtitle")}</p>
          </div>
          <button type="button" className="btn-outline" onClick={() => void loadClients()} disabled={loading}>
            {t("common.refresh")}
          </button>
        </div>
        <section className="panel insights-page-panel">
          <div className="segmented insights-page-tabs" role="tablist" aria-label={t("insights.title")}>
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                className={activeTab === key ? "seg-active" : ""}
                onClick={() => {
                  setActiveTab(key);
                  router.replace(key === "status" ? "/insights" : `/insights?tab=${key}`);
                }}
              >
                <Icon size={14} />
                {t(label)}
              </button>
            ))}
          </div>
          {error && <p className="settings-error">{error}</p>}
          {loading && <p className="muted">{t("common.loading")}</p>}
          {!loading && !error && (
            <div className="insights-page-body">
              {activeTab === "status" && <StatusOverviewPanel t={t} />}
              {activeTab === "followup" && (
                <FollowUpWorkspace
                  clients={clients}
                  onSnooze={(id, days) => patchClient(id, { nextFollowUpAt: new Date(Date.now() + days * 86_400_000).toISOString() })}
                  onDone={(id) => patchClient(id, { nextFollowUpAt: null })}
                  onOpenDetail={(client) => router.push(`/clients/${encodeURIComponent(client.id)}`)}
                  t={t}
                  lang={lang}
                />
              )}
              {activeTab === "stale" && (
                <StaleClientsPanel
                  clients={clients}
                  onOpenDetail={(client) => router.push(`/clients/${encodeURIComponent(client.id)}`)}
                  t={t}
                  lang={lang}
                />
              )}
              {activeTab === "activity" && (
                <ActivityFeedPanel
                  clients={clients}
                  onOpenDetail={(id) => router.push(`/clients/${encodeURIComponent(id)}`)}
                  t={t}
                  lang={lang}
                />
              )}
              {activeTab === "team" && <TeamReportPanel t={t} lang={lang} />}
              {activeTab === "quality" && <DataQualityPanel t={t} canExport={user.role === "Admin"} />}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusOverviewPanel({ t }: { t: TFn }) {
  const [data, setData] = useState<{ statusCounts: Record<string, number>; totals: { total: number } } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/analytics/weekly?period=all", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as {
          statusCounts?: Record<string, number>;
          totals?: { total: number };
          error?: unknown;
        };
        if (!response.ok) throw new Error(apiErrorMessage(t, result.error));
        if (active) setData({ statusCounts: result.statusCounts ?? {}, totals: result.totals ?? { total: 0 } });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t("errors.generic"));
      });
    return () => { active = false; };
  }, [t]);

  if (error) return <p className="settings-error">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const rows = Object.entries(data.statusCounts).sort((a, b) => b[1] - a[1]);
  return (
    <section className="panel status-overview-panel">
      <div className="panel-heading">
        <h3>{t("insights.statusOverview")}</h3>
        <span className="muted">{t("stage.total")}: {data.totals.total}</span>
      </div>
      {rows.length === 0 ? <div className="empty-state">{t("common.noData")}</div> : (
        <div className="status-overview-list">
          {rows.map(([status, count]) => {
            const percentage = data.totals.total > 0 ? Math.round((count / data.totals.total) * 100) : 0;
            return (
              <div className="status-overview-row" key={status}>
                <span>{statusLabel(t, status)}</span>
                <span className="status-overview-track"><i style={{ width: `${percentage}%` }} /></span>
                <strong>{count}</strong>
                <span className="muted">{percentage}%</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
