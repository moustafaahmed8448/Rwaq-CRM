// Reliable ar/en key-parity check: parse each block separately and compare key sets.
const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");

const arStart = s.indexOf("const ar: Record<string, string> = {");
const enStart = s.indexOf("const en: Record<string, string> = {");
const dictStart = s.indexOf("const dictionaries:");
if (arStart < 0 || enStart < 0 || dictStart < 0) throw new Error("markers not found");

function keysOf(text) {
  const set = new Set();
  let dupes = [];
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
if (onlyAr.length === 0 && onlyEn.length === 0 && ar.dupes.length === 0 && en.dupes.length === 0) {
  console.log("PASS: both dictionaries are in sync with no duplicates.");
} else {
  process.exit(1);
}

const fs = require("fs");
const FILE = "src/lib/i18n.tsx";
let raw = fs.readFileSync(FILE, "utf8");

const arStart = raw.indexOf("const ar: Record<string, string> = {");
const enStart = raw.indexOf("const en: Record<string, string> = {");
const dictStart = raw.indexOf("const dictionaries:");
if (arStart < 0 || enStart < 0 || dictStart < 0) throw new Error("block markers not found");

const HEAD = raw.slice(0, arStart);
const AR = raw.slice(arStart, enStart);
const EN = raw.slice(enStart, dictStart);
const TAIL = raw.slice(dictStart);

function dedupe(block, name) {
  const lines = block.split(/\r?\n/);
  const seen = new Map();
  const out = [];
  const dups = [];
  for (const line of lines) {
    const m = line.match(/^\s*"([a-zA-Z0-9._]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/);
    if (!m) { out.push(line); continue; }
    const key = m[1];
    if (seen.has(key)) {
      dups.push(key + " (line " + (lines.indexOf(line) + 1) + ")");
      continue;
    }
    seen.set(key, m[2]);
    out.push(line);
  }
  console.log(name + ": " + seen.size + " unique keys, " + dups.length + " duplicates removed");
  if (dups.length) console.log("   " + dups.join(", "));
  return { text: out.join("\n"), keys: seen };
}

const ar = dedupe(AR, "ar");
const en = dedupe(EN, "en");

// Value drift check between the two languages.
const drift = [...ar.keys].filter(k => !en.keys.has(k));
const extra = [...en.keys].filter(k => !ar.keys.has(k));
if (drift.length) console.log("only in ar: " + drift.join(", "));
if (extra.length) console.log("only in en: " + extra.join(", "));

if (process.argv.includes("--write")) {
  fs.writeFileSync(FILE, HEAD + ar.text + en.text + TAIL, "utf8");
  console.log("written: " + FILE);
}
