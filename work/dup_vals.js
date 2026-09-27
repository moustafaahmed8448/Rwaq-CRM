// Show the values of duplicated i18n keys so we can keep the right one.
const fs = require("fs");
const src = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const lines = src.split(/\r?\n/);
const dupes = require("./dupe_keys.json");
const want = new Set(dupes);
for (const block of ["ar", "en"]) {
  console.log("=== " + block);
  for (const k of dupes) {
    const hits = [];
    lines.forEach((l, i) => {
      const m = l.match(/^\s*"([a-zA-Z0-9._]+)":\s*(.*?),?$/);
      if (m && m[1] === k) hits.push(`${i + 1}: ${m[2]}`);
    });
    if (hits.length > 1) console.log(`${k}\n   ${hits.join("\n   ")}`);
  }
}
