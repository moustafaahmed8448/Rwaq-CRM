const fs = require("fs");
const P = "src/app/api/export/clients/route.ts";
let s = fs.readFileSync(P, "utf8");

const start = s.indexOf("    // The four multi-select groups combine with OR");
if (start === -1) { console.error("start marker not found"); process.exit(1); }
const endMarker = "return true;\r\n  });";
const endIdx = s.indexOf(endMarker, start);
if (endIdx === -1) { console.error("end marker not found"); process.exit(1); }
const end = endIdx + endMarker.length;

const repl = [
  "    // Every selected group must match (AND) — same semantics as",
  "    // matchesFilters() in src/app/page.tsx, so the exported Excel file shows",
  "    // exactly what the UI shows: Status=X + Channel=Y exports only clients",
  "    // that are both. Date range, free-text query, and explicit ids narrow too.",
  "    if (statuses.length > 0)",
  "      rows = rows.filter((c) => statuses.includes(String(c.status).toUpperCase()));",
  "    if (channels.length > 0)",
  "      rows = rows.filter((c) => channels.includes(String(c.acquisitionChannel).toUpperCase()));",
  "    if (locations.length > 0)",
  "      rows = rows.filter((c) => locations.includes(c.location.toLowerCase()));",
  "    if (salespeople.length > 0)",
  "      rows = rows.filter(",
  "        (c) =>",
  "          salespeople.includes(c.firstContactPerson.toLowerCase()) ||",
  "          salespeople.includes(c.secondContactPerson.toLowerCase()),",
  "      );",
  "    if (from) rows = rows.filter((c) => day(c.createdAt) >= from);",
  "    if (to) rows = rows.filter((c) => day(c.createdAt) <= to);",
  "    if (query) {",
  "      // Same space-insensitive matching as the dashboard, so the exported",
  "      // filtered view matches what the user sees (phone numbers with or",
  "      // without spaces/dashes).",
  "      const norm = (s: string) => s.replace(/[\\s\\-().]/g, \"\").toLowerCase();",
  "      rows = rows.filter((c) =>",
  "        norm(`${c.name} ${c.phoneNumber} ${c.project} ${c.notes ?? \"\"}`).includes(norm(query)),",
  "      );",
  "    }",
].join("\r\n");

s = s.slice(0, start) + repl + s.slice(end);
fs.writeFileSync(P, s, "utf8");

// Verify no OR leftovers and the AND filters are back.
const check = fs.readFileSync(P, "utf8");
if (check.includes("groups.some(Boolean)")) { console.error("OR logic still present"); process.exit(1); }
if (!check.includes("if (statuses.length > 0)\r\n      rows = rows.filter")) { console.error("AND filters missing"); process.exit(1); }
console.log("export route reverted to AND semantics");
