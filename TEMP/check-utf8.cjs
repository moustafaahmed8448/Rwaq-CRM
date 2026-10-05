// Scans source files for invalid UTF-8.
//
// PowerShell's `Add-Content` with a here-string writes in the console's ANSI
// code page, NOT UTF-8. Any non-ASCII character typed into one of those blocks
// (an em-dash, curly quotes, Arabic) becomes a lone invalid byte, and the
// bundler then refuses the file outright:
//
//   Error: Reading source code for parsing failed
//   invalid utf-8 sequence of 1 bytes from index 6523
//
// TypeScript does not catch it — it happily parses bytes as code points — so the
// only reliable check is decoding the file as strict UTF-8.
const fs = require("node:fs");
const path = require("node:path");

const SKIP = new Set(["node_modules", ".next", ".git", "data", "work", "TEMP"]);
const bad = [];
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|css|json|js|mjs|cjs)$/.test(entry.name)) continue;
    checked += 1;
    const bytes = fs.readFileSync(full);
    // Round-trip through a strict decoder: Buffer -> string -> Buffer.
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      // Locate the first offending byte for a useful message.
      let index = -1;
      for (let i = 0; i < bytes.length; i += 1) {
        const slice = bytes.subarray(0, i + 1);
        if (Buffer.from(slice.toString("utf8"), "utf8").length !== slice.length) {
          index = i;
          break;
        }
      }
      bad.push({ file: full.replace(/\\/g, "/"), index, size: bytes.length });
    }
  }
}

walk(process.cwd());

console.log(`checked ${checked} files`);
if (bad.length === 0) {
  console.log("all files are valid UTF-8");
} else {
  console.log(`INVALID UTF-8 in ${bad.length} file(s):`);
  for (const b of bad) console.log(`  ${b.file}  first bad byte at index ${b.index} (size ${b.size})`);
}
process.exit(bad.length ? 1 : 0);