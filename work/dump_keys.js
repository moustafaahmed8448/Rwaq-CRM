// Print every dictionary key with its Arabic and English value, sorted by key.
const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const arBlock = s.slice(s.indexOf("const ar:"), s.indexOf("const en:"));
const enBlock = s.slice(s.indexOf("const en:"));
const parse = (block) => {
  const map = new Map();
  for (const m of block.matchAll(/"([a-zA-Z0-9._]+)":\s*"((?:[^"\\]|\\.)*)"/g)) map.set(m[1], m[2]);
  return map;
};
const ar = parse(arBlock);
const en = parse(enBlock);
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
for (const k of [...ar.keys()].sort()) {
  if (only && !only.test(k)) continue;
  const a = ar.get(k) ?? "";
  const e = en.get(k) ?? "<missing in en>";
  console.log(k + "\n    ar: " + a + "\n    en: " + e);
}
