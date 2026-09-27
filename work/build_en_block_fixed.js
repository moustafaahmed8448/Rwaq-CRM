const fs = require("fs");
const L = fs.readFileSync("work/i18n_remaining_keys.txt", "utf8")
  .split("\n").map(s => s.trim()).filter(Boolean);
const EXCLUDE = new Set(["Sara", "react", "ar", "en"]); // internal / not UI labels
const keyList = L.filter(l => {
  const m = l.match(/^"([^"]+)"$/);
  return m && !EXCLUDE.has(m[1]);
}).map(l => l.replace(/^"|"$/g, ""));

const K = (k) => `  "${k}"`;

// True English translations (no placeholders — every key resolves to a real English string)
var EN = {
  // ── Common buttons / labels ──
  [K("common.save")] : "Save",
  [K("common.saveChanges")] : "Save changes",
  [K("common.cancel")] : "Cancel",
  [K("common.delete")] : "Delete",
  [K("common.edit")] : "Edit",
  [K("common.close")] : "Close",
  [K("common.loading")] : "Loading…",
  [K("common.export")] : "Export",
  [K("common.search")] : "Search",
  // ── Navigation (AppHeader) ──
  [K("nav.dashboard")] : "Dashboard",
  [K("nav.clients")] : "Clients",
  [K("nav.archived")] : "Archived",
  [K("nav.marketing")] : "Marketing",
  [K("nav.settings")] : "Settings",
  // ── Header actions ──
  [K("header.notifications")] : "Notifications",
  [K("header.markAllRead")] : "Mark all as read",
  [K("header.allCaughtUp")] : "All caught up",
  [K("header.viewAll")] : "Show all",
  [K("header.signOut")] : "Sign out",
  [K("header.switchLight")] : "Light mode",
  [K("header.switchDark")] : "Dark mode",
  [K("header.menu")] : "Menu",
  // ── Dashboard ──
  [K("dash.exportReport")] : "Export report",
  [K("dash.exporting")] : "Exporting…",
  [K("dash.clientsInView")] : "clients in view",
  [K("kpi.weeklyInvestment")] : "Weekly investment",
  [K("kpi.totalReach")] : "Total reach",
  [K("kpi.acrossChannels")] : "across channels",
  [K("kpi.won")] : "Won",
  [K("kpi.winRate")] : "win rate",
  [K("kpi.lost")] : "Lost",
  [K("kpi.ofTotal")] : "of total",
  [K("kpi.pipeline")] : "Pipeline",
  [K("kpi.awaiting")] : "Awaiting",
  [K("kpi.avgCpa")] : "Avg CPA",
  [K("kpi.customersWon")] : "Customers won",
  [K("kpi.noWins")] : "No wins yet",
  // ── Conversion funnel ──
  [K("funnel.title")] : "Conversion funnel",
  [K("funnel.total")] : "Total clients",
  [K("funnel.waiting")] : "Waiting",
  [K("funnel.won")] : "Won",
  [K("funnel.lost")] : "Lost",
  // ── Sales Performance ──
  [K("sp.title")] : "Sales performance",
  [K("sp.noData")] : "No sales data yet",
  // ── Channel ROI ──
  [K("roi.title")] : "Channel ROI",
  [K("roi.channel")] : "Channel",
  [K("roi.spend")] : "Spend",
  [K("roi.won")] : "Won",
  [K("roi.cpa")] : "CPA",
  // ── Recent clients ──
  [K("recent.title")] : "Recent clients",
  [K("recent.empty")] : "No clients were created recently",
  [K("recent.project")] : "Project",
  [K("recent.location")] : "Location",
  // ── Top locations ──
  [K("loc.title")] : "Top locations",
  [K("loc.clients")] : "clients",
  [K("loc.noData")] : "No location data yet",
  // ── Channel breakdown ──
  [K("brk.title")] : "Channel breakdown",
  [K("brk.platform")] : "Platform",
  [K("brk.reach")] : "Reach",
  [K("brk.clients")] : "clients",
  // ── Clients page ──
  [K("clients.title")] : "Clients",
  [K("clients.subtitle")] : "Every lead, deal, and conversation — all in one place.",
  [K("clients.table")] : "Table",
  [K("clients.kanban")] : "Kanban",
  [K("clients.newClient")] : "New client",
  [K("clients.exportSelected")] : "Export selected",
  [K("clients.exportAll")] : "Export all",
  [K("clients.showing")] : "showing",
  [K("clients.selected")] : "selected",
  [K("clients.deleteSelected")] : "Delete selected",
  [K("clients.archiveSelected")] : "Archive selected",
  // ── Filter bar ──
  [K("filter.allStatuses")] : "All statuses",
  [K("filter.allChannels")] : "All channels",
  [K("filter.allLocations")] : "All locations",
  [K("filter.allSalespeople")] : "All salespeople",
  [K("filter.queryPh")] : "Filter by phone, name, or project…",
  [K("filter.clear")] : "Clear filters",
  [K("filter.addStatus")] : "Add status",
  [K("filter.addChannel")] : "Add channel",
  [K("filter.addLocation")] : "Add location",
  // ── Date filters ──
  [K("date.today")] : "Today",
  [K("date.week")] : "This week",
  [K("date.last7")] : "Last 7 days",
  [K("date.month")] : "This month",
  // ── Table headers ──
  [K("th.client")] : "Client",
  [K("th.status")] : "Status",
  [K("th.source")] : "Source",
  [K("th.project")] : "Project",
  [K("th.location")] : "Location",
  [K("th.date")] : "Date",
  // ── Toast template (uses {name}) ──
  [K("toast.created")] : "Client {name} created",
};
const lines = ["const en: Record<string, string> = {", ...Object.keys(EN).map(k => `  ${K(k)} : "${EN[k]}"`), "};"];
fs.writeFileSync("work/en_block.txt", lines.join("\n") + "\n", "utf8");
console.log("wrote EN block with", Object.keys(EN).length, "keys to work/en_block.txt");
console.log("AR dict keys in file:", Object.keys(EN).length, "(should match AR count once AR is complete)");
