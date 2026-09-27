// Authoritative dictionary checks for src/lib/i18n.tsx:
//  1. ar/en key parity (a key missing on one side falls back to Arabic/key).
//  2. duplicate keys inside a block.
//  3. empty values.
const fs = require("fs");
const src = fs.readFileSync("src/lib/i18n.tsx", "utf8");

function block(name) {
  const start = src.indexOf("const " + name + ": Record<string, string> = {");
  const end = src.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error(name + " block not found");
  const body = src.slice(start, end);
  const map = new Map();
  const dupes = [];
  for (const m of body.matchAll(/^ {2}"([a-zA-Z0-9._]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$/gm)) {
    const key = m[1];
    const value = JSON.parse(m[2]);
    if (map.has(key)) dupes.push(key);
    map.set(key, value);
  }
  return { map, dupes };
}

const ar = block("ar");
const en = block("en");
const onlyAr = [...ar.map.keys()].filter(k => !en.map.has(k));
const onlyEn = [...en.map.keys()].filter(k => !ar.map.has(k));
const empty = [...ar.map, ...en.map].filter(([, v]) => v.trim() === "").map(([k]) => k);

console.log("ar keys: " + ar.map.size + " | en keys: " + en.map.size);
console.log("duplicates ar: " + (ar.dupes.join(", ") || "none"));
console.log("duplicates en: " + (en.dupes.join(", ") || "none"));
console.log("only in ar: " + (onlyAr.join(", ") || "none"));
console.log("only in en: " + (onlyEn.join(", ") || "none"));
console.log("empty values: " + (empty.join(", ") || "none"));

// Interpolation placeholder parity: {name} etc. must match on both sides.
const mismatch = [];
for (const [key, value] of ar.map) {
  const other = en.map.get(key);
  if (other === undefined) continue;
  const a = (value.match(/\{(\w+)\}/g) ?? []).sort().join(",");
  const b = (other.match(/\{(\w+)\}/g) ?? []).sort().join(",");
  if (a !== b) mismatch.push(key + " (ar: " + (a || "none") + " / en: " + (b || "none") + ")");
}
console.log("placeholder mismatch: " + (mismatch.join("; ") || "none"));
