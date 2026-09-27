// Find user-facing HTML attributes that still contain hardcoded English text
// (placeholder / title / aria-label / alt) plus confirm()/alert() literals.
const fs = require("fs");
const path = require("path");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const ATTR = /\b(placeholder|title|aria-label|alt|label)=("([^"{}]+)"|'([^'{}]+)')/g;
const DIALOG = /\b(confirm|alert)\(\s*(["'`])([^"'`]+)\2/g;
const TEXT = /([>{}]\s*|\|\|\s*)(["'`])([A-Z][A-Za-z][^"'`]{2,})\2/g;

let total = 0;
for (const file of walk("src")) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const hits = [];
    let m;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(line))) hits.push(`${m[1]}=${JSON.stringify(m[3] ?? m[4])}`);
    DIALOG.lastIndex = 0;
    while ((m = DIALOG.exec(line))) hits.push(`${m[1]}(${JSON.stringify(m[3])})`);
    TEXT.lastIndex = 0;
    while ((m = TEXT.exec(line))) {
      const inner = m[3];
      if (/^\s*$/.test(inner)) continue;
      if (/^[a-z-]+$/.test(inner)) continue; // css class / dom string
      hits.push(JSON.stringify(inner));
    }
    if (hits.length) {
      total += hits.length;
      console.log(`${path.relative(process.cwd(), file)}:${i + 1}: ${hits.join("  |  ")}`);
    }
  });
}
console.log("--- total: " + total);
