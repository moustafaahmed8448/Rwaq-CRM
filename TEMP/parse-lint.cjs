// Prints the ESLint JSON report with readable paths. Written as a file rather than
// piped to `node -e` because PowerShell mangles the quotes in an inline script.
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync("TEMP/lint.json", "utf8"));

let errors = 0;
let warnings = 0;
for (const file of report) {
  const rel = file.filePath.split("Rwaq CRM").pop().replace(/^[\\/]/, "");
  for (const m of file.messages) {
    if (m.severity === 2) errors += 1;
    else warnings += 1;
    if (m.ruleId && String(m.ruleId).includes("no-unused-vars")) {
      console.log(`${rel}:${m.line}  ${m.message}`);
    }
  }
}
console.log(`\nerrors=${errors} warnings=${warnings}`);