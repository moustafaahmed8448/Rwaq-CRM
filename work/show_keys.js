// Print i18n entries whose key matches the given regex, with their ar+en values.
const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const lines = s.split(/\r?\n/);
const re = new RegExp(process.argv[2]);
lines.forEach((l, i) => {
  const m = l.match(/"([a-zA-Z0-9._]+)":\s*"(.*)",?\s*$/);
  if (m && re.test(m[1])) console.log(`${i + 1}: ${m[1]} = ${JSON.stringify(m[2])}`);
});
