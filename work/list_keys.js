// List unique dictionary keys in src/lib/i18n.tsx, optionally filtered by regex.
const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const keys = [...s.matchAll(/"([a-zA-Z0-9._]+)":\s*"/g)].map(m => m[1]);
const uniq = [...new Set(keys)];
console.log(uniq.length + " unique keys");
const filt = process.argv[2];
const out = filt ? uniq.filter(k => new RegExp(filt).test(k)) : uniq;
console.log(out.join("\n"));
