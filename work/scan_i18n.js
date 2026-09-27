/* Scan a TSX file for leftover hardcoded English UI strings.
   Usage: node work/scan_i18n.js src/app/page.tsx ...            */
const fs = require("fs");

const SKIP_LINE = /import |from "|localStorage|rwaq-|export |\/\/|\* |id=\"|#|rgba|px|rem\b|font-|url\(|to=|d=\"M|stroke|fill=|viewBox|href=\"http|type=\"(button|submit|hidden)\"|role=\"|data-|dir=\"|alt=\"\"|key=|use client/;
// String literal or JSX text that starts with an ASCII capital and has >= 2 words,
// or placeholder/title/aria-label/label/alt attrs with English content.
const ATTR = /(?:placeholder|title|aria-label|label|alt)=\"([^\"]*[A-Za-z][^\"]*)\"/g;
const JSX_TEXT = />\s*([A-Z][A-Za-z]+(?:\s+[A-Za-z][\w'"{}-]*)+)\s*</g;
const CONFIRM = /(?:confirm|alert)\(\s*["'`]([A-Z][^"'`]+)["'`]/g;
const TOAST = /addToast\(\s*"[a-z]+"\s*,\s*["'`]([A-Z][^"'`]+)["'`]/g;
const OBJ_LABEL = /\blabel:\s*["'`]([A-Z][a-z][^"'`]+)["'`]/g;
const PLAIN = /=\s*["'`]([A-Z][a-z]+(?:\s+[A-Za-z][\w'"]*)+)["'`]/g;
// Plain JSX text (may start with a digit, e.g. "1st:") followed by < or { or end tag.
const JSX_ANY = />\s*(\d?(?:st|nd|rd|th)?[A-Za-z][^<>{}"'`\n]{2,}?)\s*(?=[<{]|$)/g;
// Any quoted literal with >= 3 words (catches sentences with commas, brackets, etc.)
const PROSE = /["'`]([A-Za-z][A-Za-z0-9 ,.'’:;!?%$()\-\/]{8,})["'`]/g;
const CODEY = /=>|\{|\}|\\|\$\{|http|\.xlsx|\.json|,\s*$|["'`]/;


for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  let hits = 0;
  lines.forEach((line, i) => {
    if (SKIP_LINE.test(line)) return;
    const found = [];
    for (const re of [ATTR, JSX_TEXT, CONFIRM, TOAST, OBJ_LABEL, PLAIN, JSX_ANY, PROSE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const s = m[1];
        if (!s || s.length < 3) continue;
        if (re === PROSE && !/^[A-Z][A-Za-z'’\-]+(?: [A-Za-z0-9'’\-…,]+)+[.?!]?$/.test(s)) continue;
        found.push(s);
      }
    }
    if (found.length) {
      hits++;
      console.log(`${file}:${i + 1}: ${found.map(x => JSON.stringify(x)).join(" | ")}`);
    }
  });
  console.log(`--- ${file}: ${hits} suspicious line(s)\n`);
}
