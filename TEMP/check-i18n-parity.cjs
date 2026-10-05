// Guards the i18n dictionaries: every key must exist in BOTH the Arabic and the
// English block, or one language silently renders the raw key ("errors.generic"
// appearing verbatim in the UI).
const fs = require("node:fs");

const src = fs.readFileSync("src/lib/i18n.tsx", "utf8");

// The two dictionaries are two contiguous objects: `const ar = {…}` then
// `const en = {…}`. Split on the declaration, not on any `"en"` key, because the
// Arabic block itself contains an `"en"` entry (the language switch).
const split = src.indexOf("const en: Record<string, string> = {");
if (split < 0) {
  console.log("Could not find the English dictionary declaration.");
  process.exit(1);
}

const keysOf = (chunk) =>
  new Set([...chunk.matchAll(/"([a-zA-Z][\w.]*)"\s*:\s*"/g)].map((m) => m[1]));

const ar = keysOf(src.slice(0, split));
const en = keysOf(src.slice(split));

const missingInEn = [...ar].filter((k) => !en.has(k));
const missingInAr = [...en].filter((k) => !ar.has(k));

console.log(`Arabic keys: ${ar.size}`);
console.log(`English keys: ${en.size}`);

if (missingInEn.length) {
  console.log(`\nMissing from ENGLISH (${missingInEn.length}):`);
  for (const k of missingInEn) console.log(`  - ${k}`);
} else {
  console.log("\nEvery Arabic key has an English entry.");
}

if (missingInAr.length) {
  console.log(`\nMissing from ARABIC (${missingInAr.length}):`);
  for (const k of missingInAr) console.log(`  - ${k}`);
} else {
  console.log("Every English key has an Arabic entry.");
}

for (const probe of ["errors.nothingToSave", "users.photoInvalid"]) {
  console.log(`probe ${probe}: ar=${ar.has(probe)} en=${en.has(probe)}`);
}

process.exit(missingInEn.length + missingInAr.length ? 1 : 0);