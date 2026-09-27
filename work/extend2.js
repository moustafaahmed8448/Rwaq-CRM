// Append the round-6 keys to both dictionaries in src/lib/i18n.tsx.
const fs = require("fs");
const SRC = "src/lib/i18n.tsx";
const NEW = require("./new_keys_6.js");
const raw = fs.readFileSync(SRC, "utf8");
const esc = (s) => JSON.stringify(s);
const line = (k, v) => "  " + esc(k) + ": " + esc(v) + ",";
const arAdd = [];
const enAdd = [];
for (const k of Object.keys(NEW)) {
  enAdd.push(line(k, NEW[k][0]));
  arAdd.push(line(k, NEW[k][1]));
}
const arAnchor = "\n};\n\nconst en:";
const enAnchor = "\n};\n\nconst dictionaries: Record<Lang";
const arAt = raw.indexOf(arAnchor);
const enAt = raw.indexOf(enAnchor);
if (arAt === -1) throw new Error("ar block close not found");
if (enAt === -1) throw new Error("en block close not found");
let out = raw.slice(0, enAt) + "\n" + enAdd.join("\n") + raw.slice(enAt);
out = out.slice(0, arAt) + "\n" + arAdd.join("\n") + out.slice(arAt);
fs.writeFileSync(SRC, out, "utf8");
const check = fs.readFileSync(SRC, "utf8");
const missing = Object.keys(NEW).filter((k) => (check.match(new RegExp('"' + k.replace(/\./g, "\\.") + '"', "g")) || []).length < 2);
if (missing.length) {
  console.error("NOT IN BOTH BLOCKS: " + missing.join(", "));
  process.exit(1);
}
console.log("added keys (ar+en): " + Object.keys(NEW).length);
