const fs = require("fs");
const SRC = "src/lib/i18n.tsx";
const NEW = Object.assign(
  {},
  require("./new_keys_1.js"),
  require("./new_keys_2.js"),
  require("./new_keys_3.js"),
  require("./new_keys_4.js"),
  require("./new_keys_5.js"),
);
const raw = fs.readFileSync(SRC, "utf8");
const esc = (s) => JSON.stringify(s);
const line = (k, v) => "  " + esc(k) + ": " + esc(v) + ",";
const arAdd = [];
const enAdd = [];
for (const k of Object.keys(NEW)) {
  const pair = NEW[k];
  enAdd.push(line(k, pair[0]));
  arAdd.push(line(k, pair[1]));
}
const arClose = raw.indexOf("\n};\n\nconst en:");
if (arClose === -1) throw new Error("ar block close not found");
let out = raw.slice(0, arClose) + "\n" + arAdd.join("\n") + raw.slice(arClose);
const enClose = out.indexOf('"settings.dangerZoneSubtitle": "Irreversible actions",};');
if (enClose === -1) throw new Error("en block close not found");
const enEnd = enClose + '"settings.dangerZoneSubtitle": "Irreversible actions",};'.length;
out = out.slice(0, enClose) + '"settings.dangerZoneSubtitle": "Irreversible actions",\n' + enAdd.join("\n") + out.slice(enEnd);
fs.writeFileSync(SRC, out, "utf8");
const check = fs.readFileSync(SRC, "utf8");
const missing = Object.keys(NEW).filter((k) => !check.includes(esc(k)));
if (missing.length) {
  console.error("MISSING: " + missing.join(", "));
  process.exit(1);
}
console.log("added keys: " + Object.keys(NEW).length);
