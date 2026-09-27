// Detect (and optionally remove) duplicate keys inside the ar / en blocks of i18n.tsx.
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
