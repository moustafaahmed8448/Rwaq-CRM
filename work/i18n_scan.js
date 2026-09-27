const fs = require("fs");
const f = "src/lib/i18n.tsx";
const s = fs.readFileSync(f, "utf8");
const M = s.match(/"(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)"/g) || [];
const keys = new Set(M.map((m) => m.slice(1, -1)).filter((k) => !k.startsWith("__") && !k.startsWith("rwaq-")));
// keys already paired with a literal Arabic value in the AR dict (avoid double-translating those)
const arr = s.match(/const ar: Record<string, string> = \{[\s\S]*?\n\};/s) || [];
const translated = new Set();
for (const chunk of arr.join("\n").match(/^\s*"([^"]+)":\s*"([^"]+)"/gm) || []) {
  const [, k] = chunk.match(/^\s*"([^"]+)"\s*:/) || [];
  if (k) translated.add(k);
}
const out = [...keys].filter((k) => !translated.has(k)).join("\n");
fs.writeFileSync("work/i18n_remaining_keys.txt", out + "\n", "utf8");
console.log("total unique keys in file:", keys.size);
console.log("already-translated (in AR dict):", translated.size);
console.log("remaining (EN still needed for these):", out.length);
if (out) {
  console.log("\nREMAINING KEY LIST:");
  console.log(out);
}
