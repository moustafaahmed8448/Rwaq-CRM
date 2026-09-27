/* Whole-file scan for leftover hardcoded English UI strings.
   Usage: node work/scan_full.js <file...> */
const fs = require("fs");

// Remove arguments of t(...) calls (keys are ours), so translated text doesn't show up.
function maskT(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "t" && src[i + 1] === "(" && !/[A-Za-z0-9_$.]/.test(src[i - 1] || " ")) {
      let depth = 0, j = i + 1;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) break; }
      }
      out += "t(" + " ".repeat(j - i - 1) + ")";
      i = j;
    } else out += src[i];
  }
  return out;
}

const TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
const ATTR = /(placeholder|title|aria-label|alt|label)="([^"]*[A-Za-z][^"]*)"/g;
const CALL = /(?:alert|confirm)\(\s*"([^"]*[A-Za-z][^"]*)"/g;
const TOAST = /addToast\(\s*"[a-z]+"\s*,\s*"([^"]*[A-Za-z][^"]*)"/g;
const SETMSG = /set(?:Error|SaveMsg|UserErr|Msg|Err)\(\s*"([^"]*[A-Za-z][^"]*)"/g;
const ERRORTHROW = /new Error\(\s*"([^"]*[A-Za-z][^"]*)"/g;

const NOISE = /^[\s\d.,:;*·—–\-/|+×%$()&]*$/;
// TS type annotations / identifiers leak through the JSX-text regex – drop them.
const TYPE_NOISE = /[();=]|\bvoid\b|\bPromise\b|\bPartial\b|\bSet<|\bRecord\b|=>/;

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const masked = maskT(src);
  const lineOf = (idx) => masked.slice(0, idx).split(/\r?\n/).length;
  const rows = [];
  const collect = (re, tag, gi = 1) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked))) {
      const s = (m[gi] || "").trim();
      if (!s || NOISE.test(s)) continue;
      if (TYPE_NOISE.test(s)) continue;
      if (/^https?:|^data:|^[A-Z_]{4,}$|^[\w-]+\.(tsx?|css|mjs)$/.test(s)) continue;
      rows.push([lineOf(m.index), tag, s]);
    }
  };
  collect(TEXT, "jsx-text");
  collect(ATTR, "attr", 2);
  collect(CALL, "alert/confirm");
  collect(TOAST, "toast");
  collect(SETMSG, "setMsg");
  collect(ERRORTHROW, "throw");
  rows.sort((a, b) => a[0] - b[0]);
  console.log(`=== ${file}: ${rows.length} hit(s)`);
  for (const [ln, tag, s] of rows) console.log(`  ${ln} [${tag}] ${JSON.stringify(s)}`);
}
