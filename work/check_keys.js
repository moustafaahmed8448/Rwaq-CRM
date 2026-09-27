// Cross-check every t("key") used in src against the dictionary in src/lib/i18n.tsx.
const fs = require("fs");
const path = require("path");

const dict = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const defined = new Set([...dict.matchAll(/"([a-zA-Z0-9._]+)":\s*"/g)].map(m => m[1]));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name) && !p.includes("i18n.tsx")) out.push(p);
  }
  return out;
}

const missing = new Map();
for (const file of walk("src")) {
  const src = fs.readFileSync(file, "utf8");
  const used = new Set([...src.matchAll(/\bt\(\s*"([^"]+)"/g)].map(m => m[1]));
  for (const k of used) {
    if (!defined.has(k)) {
      if (!missing.has(k)) missing.set(k, []);
      missing.get(k).push(file);
    }
  }
}

if (missing.size === 0) console.log("OK: every t() key is defined (" + defined.size + " keys).");
else {
  console.log("MISSING KEYS: " + missing.size);
  for (const [k, files] of missing) console.log("  " + k + "  <- " + [...new Set(files)].join(", "));
}
// Also report dictionary keys that are never used (informational).
const allSrc = walk("src").map(f => fs.readFileSync(f, "utf8")).join("\n");
const unusedList = [...defined].filter(k => !allSrc.includes('"' + k + '"'));
console.log("unused dictionary keys: " + unusedList.length);
console.log(unusedList.join("\n"));
