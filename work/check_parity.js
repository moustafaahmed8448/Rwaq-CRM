// Reliable ar/en key-parity check: parse each block separately, compare key sets.
const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");

const arStart = s.indexOf("const ar: Record<string, string> = {");
const enStart = s.indexOf("const en: Record<string, string> = {");
const dictStart = s.indexOf("const dictionaries:");
if (arStart < 0 || enStart < 0 || dictStart < 0) throw new Error("markers not found");

function keysOf(text) {
  const set = new Set();
  const dupes = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*"([a-zA-Z0-9._]+)":\s*"/);
    if (!m) continue;
    if (set.has(m[1])) dupes.push(m[1]);
    set.add(m[1]);
  }
  return { set, dupes };
}

const ar = keysOf(s.slice(arStart, enStart));
const en = keysOf(s.slice(enStart, dictStart));
const onlyAr = [...ar.set].filter(k => !en.set.has(k));
const onlyEn = [...en.set].filter(k => !ar.set.has(k));

console.log("ar keys:", ar.set.size, "| en keys:", en.set.size);
console.log("ar dupes:", ar.dupes.length, ar.dupes.join(", ") || "-");
console.log("en dupes:", en.dupes.length, en.dupes.join(", ") || "-");
console.log("only in ar:", onlyAr.length, onlyAr.join(", ") || "-");
console.log("only in en:", onlyEn.length, onlyEn.join(", ") || "-");

if (onlyAr.length || onlyEn.length || ar.dupes.length || en.dupes.length) {
  process.exit(1);
}
console.log("PASS: both dictionaries are in sync with no duplicates.");
