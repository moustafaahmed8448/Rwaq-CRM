const fs = require("fs");
const p = "src/lib/i18n.tsx";
const s = fs.readFileSync(p, "utf8");
const L = s.split("\n");
let start = -1;
for (let i = 0; i < L.length; i++) {
  if (L[i].includes("const ar:") !== -1) { start = i; break; }
}
if (start < 0) {
  console.log("FAIL_NO_AR");
  process.exit(1);
}
let brace = 0;
const lines = [];
for (let i = start; i < L.length; i++) {
  const line = L[i];
  if (brace === 0 && line.trim() === "}") { lines.push(line); break; }
  const dk = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  if (brace === 0) {
    brace = dk;
    if (line.trim() === "{") { brace = 1; continue; }
    lines.push(line);
    continue;
  }
  brace += dk;
  lines.push(line);
}
if (brace !== 0) {
  console.log("FAIL_BRACE:" + brace);
  process.exit(1);
}
const keys = [];
lines.forEach(raw => {
  const m = raw.match(/"([a-zA-Z0-9_]+)":/);
  if (m) keys.push(m[1]);
});
console.log("WORDS:" + keys.length);
fs.writeFileSync("TEMP/ar_keys.txt", keys.join("\n"), "utf8");
console.log("scanned.");

