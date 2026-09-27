// Report duplicate keys inside the ar/en dictionaries of src/lib/i18n.tsx.
const fs = require("fs");
const src = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const lines = src.split(/\r?\n/);
console.log("total lines: " + lines.length);

// Find block boundaries.
const blocks = [];
lines.forEach((l, i) => {
  const m = l.match(/^const (ar|en): Record<string, string> = \{/);
  if (m) blocks.push({ name: m[1], start: i });
});
console.log("blocks: " + JSON.stringify(blocks));

for (const b of blocks) {
  const seen = new Map();
  for (let i = b.start; i < lines.length; i++) {
    if (/^\};/.test(lines[i])) break;
    const m = lines[i].match(/^\s*"([a-zA-Z0-9._]+)":\s*"/);
    if (!m) continue;
    const k = m[1];
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(i + 1);
  }
  const dupes = [...seen].filter(([, v]) => v.length > 1);
  console.log(`--- ${b.name}: ${seen.size} keys, ${dupes.length} duplicated`);
  for (const [k, v] of dupes) console.log(`    ${k} @ ${v.join(", ")}`);
}
