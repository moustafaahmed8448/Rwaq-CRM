// Report duplicate keys inside the ar and en dictionary blocks (later wins at runtime).
const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const arStart = s.indexOf("const ar");
const enStart = s.indexOf("const en:");
const arBlock = s.slice(arStart, enStart);
const enBlock = s.slice(enStart);

function dupes(name, block) {
  const seen = new Map();
  const lines = block.split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = l.match(/^\s*"([a-zA-Z0-9._]+)":/);
    if (!m) return;
    if (seen.has(m[1])) dupes.list.push(`${name}: ${m[1]} (first line ${seen.get(m[1])}, again at ${i + 1})`);
    else seen.set(m[1], i + 1);
  });
}
dupes.list = [];
dupes("ar", arBlock);
dupes("en", enBlock);
if (dupes.list.length === 0) console.log("no duplicate keys");
else dupes.list.forEach(l => console.log(l));
