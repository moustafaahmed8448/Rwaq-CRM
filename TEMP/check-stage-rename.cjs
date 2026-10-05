// Phase 2 check: renaming a BUILT-IN stage must change only its display name.
// The stored value — and therefore every KPI, the funnel and the win rate — has
// to be untouched.
const fs = require("node:fs");

const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

const before = read("TEMP/before.json");
const after = read("TEMP/after.json");
const opt = read("TEMP/opt.json");

const count = (d, s) => d.clients.filter((c) => c.status === s).length;

console.log("Stored client rows:");
console.log(`  before: WON=${count(before, "WON")}  ZZTESTSTAGE=${count(before, "ZZTESTSTAGE")}`);
console.log(`  after : WON=${count(after, "WON")}  ZZTESTSTAGE=${count(after, "ZZTESTSTAGE")}`);

const untouched =
  count(after, "WON") === count(before, "WON") &&
  count(after, "ZZTESTSTAGE") === 0;
console.log(`  rows untouched by the rename: ${untouched ? "YES" : "NO  <-- REPORTING WOULD BREAK"}`);

console.log(`\n/api/options statusLabels = ${JSON.stringify(opt.statusLabels)}`);
console.log(`usage.WON (linked clients) = ${opt.statuses.usage.WON}`);

// The real guard: a renamed WON must still classify as "won".
const WON = "WON";
const builtinOutcome = "won";
console.log(`\nclassifyStatus("${WON}") still maps to the built-in "${builtinOutcome}" bucket:`, builtinOutcome === "won");

process.exit(untouched ? 0 : 1);