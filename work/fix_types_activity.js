const fs = require("fs");
const P = "src/lib/types.ts";
let s = fs.readFileSync(P, "utf8");

const OLD = "  opts?: { field?: string; oldValue?: string; newValue?: string; summary?: string }";
const NEW = "  opts?: { field?: string; oldValue?: string; newValue?: string; clientName?: string },";
const ANCHOR = "): ActivityEntry {";
const NOTE = [
  "  // No English prose is stored: the UI localizes the entry from `action` +",
  "  // `field` at render time (see describeActivity in src/lib/reporting.ts), so",
  "  // the same log reads correctly in Arabic and English.",
];

if (!s.includes(OLD)) { console.error("FAIL: opts signature not found"); process.exit(1); }
s = s.replace(OLD, NEW);

const BAD = [
  "  // No English prose is stored: the UI localizes the entry from `action` +",
  "  // `field` at render time (see describeActivity in src/lib/reporting.ts), so",
  "  // the same log reads correctly in Arabic and English.",
];
const nl = s.includes("\r\n") ? "\r\n" : "\n";
const lines = s.split(/\r?\n/);
const at = lines.findIndex((l) => l.trim() === BAD[0]);
if (at === -1) { console.error("FAIL: misplaced comment not found"); process.exit(1); }
lines.splice(at, 3);
const ret = lines.findIndex((l) => l.trim() === "return {");
if (ret === -1) { console.error("FAIL: return not found"); process.exit(1); }
lines.splice(ret, 0, ...BAD);
s = lines.join(nl);

fs.writeFileSync(P, s, "utf8");
console.log("ok");
