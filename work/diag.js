const fs = require("fs");
const s = fs.readFileSync("src/lib/i18n.tsx", "utf8");
const m = s.match(/const ar: Record<string, string> = \{([\s\S]*?)\n\};/);
const re = /"([a-zA-Z0-9_./]+)"\s*:\s*"([^"]*)"/g;
let mm, ar = {};
while ((mm = re.exec(m[1])) !== null) ar[mm[1]] = mm[2];
for (const k of ["common.save", "nav.settings", "kpi.customersWon", "settings.title", "client.field.name", "dash.heroTitle"]) {
  const v = ar[k] || "<MISSING>";
  const buf = Buffer.from(v, "utf8");
  const hasFFFD = v.includes("\uFFFD");
  const high = [...v].some(c => c.charCodeAt(0) > 0x7f);
  console.log("KEY:", k);
  console.log("  value:", v);
  console.log("  hex:", buf.toString("hex"));
  console.log("  hasReplacement:", hasFFFD, "hasHigh:", high);
}
