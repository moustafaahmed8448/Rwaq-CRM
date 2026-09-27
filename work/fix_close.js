const fs = require("fs");
const p = "src/lib/i18n.tsx";
let s = fs.readFileSync(p, "utf8");
const needle = "notif.updateFailShort\": \"Unable to update notifications.\",\n\nconst dictionaries";
s = s.replace(needle, "notif.updateFailShort\": \"Unable to update notifications.\",\n};\n\nconst dictionaries");
fs.writeFileSync(p, s, "utf8");
console.log("done");

