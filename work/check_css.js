// CSS sanity check: every /* must be closed, and the new rules must survive
// into the compiled bundle. `next build`'s exit code alone is not a reliable
// CSS check — a cached bundle can pass while globals.css is broken.
const fs = require("fs");

const src = fs.readFileSync("src/app/globals.css", "utf8");
const opens = (src.match(/\/\*/g) || []).length;
const closes = (src.match(/\*\//g) || []).length;
console.log("comments: /* =", opens, " */ =", closes, opens === closes ? "OK" : "MISMATCH");

// A stray "*/"-less block usually shows up as a selector-looking orphan line.
const orphans = src
  .split(/\r?\n/)
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /^[^\s/*][^{}]*\*\/\s*$/.test(l));
if (orphans.length) {
  console.log("ORPHANED comment tails:", orphans.map(([n]) => n).join(", "));
}

let bad = opens !== closes || orphans.length > 0;

// The "selected option" state is applied to .ms-opt-row (the wrapper) while
// .ms-opt is its child button. Any rule written as `.ms-opt.ms-opt-on` needs
// both classes on ONE element and never matches — the dropdown then shows no
// tick even though the filter is applied. This regressed silently once, so it
// is now a hard failure rather than something to spot in a screenshot.
const staleSelected = src
  .split(/\r?\n/)
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /(^|[\s,>+~])\.ms-opt\.ms-opt-on\b/.test(l) && !/ROW|nothing|no longer/i.test(l));
if (staleSelected.length) {
  console.log("STALE .ms-opt.ms-opt-on (class lives on the row, not the button):");
  for (const [n, l] of staleSelected) console.log("  " + n + ": " + l.trim());
  bad = true;
}

// Confirm the compiled bundle actually contains the rules we added.
const bundle = fs
  .readdirSync(".next", { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".css"))
  .map((f) => {
    try { return fs.readFileSync(".next/" + f.replace(/\\/g, "/"), "utf8"); } catch { return ""; }
  })
  .join("\n");

if (bundle) {
  const required = ["ms-opt-del", "ms-opt-row", "stage-row-fill", "funnel2-fill", "ltr-num", "login-v2-logo-img", "ms-opt-row.ms-opt-on"];
  const missing = required.filter((k) => !bundle.includes(k));
  console.log("compiled rules:", missing.length === 0 ? "all present" : "MISSING " + missing.join(", "));
  if (missing.length) bad = true;
} else {
  console.log("compiled rules: no bundle found (run a build first) — skipped");
}

process.exit(bad ? 1 : 0);
