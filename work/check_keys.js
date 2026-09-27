// Cross-check every t("key") used in src against the dictionary in src/lib/i18n.tsx.
const fs = require("fs");
const path = require("path");

// A MultiSelect/RefPicker with no `render` falls back to printing the RAW
// stored value, so a status dropdown silently shows "NO_RESPONSE" instead of
// the Arabic label even though the dictionary entry exists. TypeScript and
// the build cannot catch it, so it is checked here.
const PICKERS = /<(MultiSelect|RefPicker)\b/g;
const pickers = [];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name) && !p.includes("i18n.tsx")) out.push(p);
  }
  return out;
}
/**
 * Read an opening JSX tag starting at `start`. The '>' of an arrow function
 * (`onChange={v => ...}`) is a '>' too, so a naive /[^>]*>/ stops at the arrow
 * and never sees the props after it. It is identified by the '=' in front of
 * it: "=>" is '=' then '>'. A real tag terminator is either '/>' or a '>'
 * preceded by anything other than '='.
 */
function readTag(src, start) {
  for (let i = start; i < src.length; i++) {
    if (src[i] === "/" && src[i + 1] === ">") return src.slice(start, i + 2);
    if (src[i] === ">" && src[i - 1] !== "=") return src.slice(start, i + 1);
  }
  return "";
}
for (const file of walk("src")) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(PICKERS)) {
    const tag = readTag(src, m.index);
    if (/render=/.test(tag)) continue;
    // Salesperson names are user data and must stay untranslated.
    if (/salesperson/.test(tag)) continue;
    const isStatus = /status|Status/.test(tag);
    const line = src.slice(0, m.index).split("\n").length;
    pickers.push({ file, line, isStatus, tag: tag.replace(/\s+/g, " ").slice(0, 80) });
  }
}
if (pickers.length) {
  console.log("PICKERS WITHOUT render= : " + pickers.length);
  for (const p of pickers) console.log("  " + p.file + ":" + p.line + (p.isStatus ? "  <<< STATUS" : "") + "  " + p.tag);
} else {
  console.log("pickers: all pass render= (or are user data)");
}

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
