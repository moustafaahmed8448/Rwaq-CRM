// Dump dictionary key names (one per line) so we can grep them without noise.
const fs = require("fs");
const lines = fs.readFileSync("src/lib/i18n.tsx", "utf8").split(/\r?\n/);
const names = [];
for (const l of lines) {
  const m = l.match(/^ {2}"([a-zA-Z0-9._]+)":/);
  if (m) names.push(m[1]);
}
fs.writeFileSync("work/keys.txt", names.join("\n"), "utf8");
console.log("total keys: " + names.length);
