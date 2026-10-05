// Reports the exact context around each invalid byte, decoding the surrounding
// region as Latin-1 so the raw bytes are visible instead of being swallowed.
const fs = require("node:fs");

const files = process.argv.slice(2);
for (const file of files) {
  const bytes = fs.readFileSync(file);
  const bad = [];
  // Walk forward with a strict decoder to find every failure point.
  for (let i = 0; i < bytes.length; i += 1) {
    const slice = bytes.subarray(0, i + 1);
    if (Buffer.from(slice.toString("utf8"), "utf8").length !== slice.length) bad.push(i);
  }
  console.log(`\n=== ${file} (${bytes.length} bytes) ===`);
  // Collapse runs so one bad byte is not reported ten times over.
  const shown = [];
  let last = -99;
  for (const i of bad) {
    if (i - last < 3) continue;
    last = i;
    shown.push(i);
    const from = Math.max(0, i - 30);
    const to = Math.min(bytes.length, i + 30);
    const raw = bytes.subarray(from, to).toString("latin1").replace(/\n/g, "\\n");
    console.log(`  offset ${i}: 0x${bytes[i].toString(16)}`);
    console.log(`    ...${raw}...`);
  }
  console.log(`  total bad byte positions: ${bad.length}`);
}