// Proves work/check_keys.js actually catches a missing `render` on a status
// picker, by removing the prop, running the check, then restoring the file.
const fs = require("fs");
const { execFileSync } = require("child_process");

const target = "src/app/page.tsx";
const original = fs.readFileSync(target, "utf8");
const needle = ' onChange={v => setMultiFilter("status", v)} render={v => statusLabel(t, v)}';

if (!original.includes(needle)) {
  console.log("TEST SETUP FAILED: needle not found in " + target);
  process.exit(2);
}

const run = () => {
  try {
    return execFileSync("node", ["work/check_keys.js"], { encoding: "utf8" });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
};

const clean = run().split("\n")[0];
console.log("1. as committed        -> " + clean);

fs.writeFileSync(target, original.replace(needle, ' onChange={v => setMultiFilter("status", v)}'), "utf8");
const broken = run().split("\n").slice(0, 3).join("\n");
console.log("2. with render removed ->");
console.log(broken);

fs.writeFileSync(target, original, "utf8");
const restored = run().split("\n")[0];
console.log("3. restored            -> " + restored);

const caught = /PICKERS WITHOUT render/.test(broken) && /STATUS/.test(broken);
const restoredClean = !/PICKERS WITHOUT render/.test(restored);
const fileIntact = fs.readFileSync(target, "utf8") === original;
console.log("");
console.log("caught the bug    : " + (caught ? "YES" : "NO  <-- guard is useless"));
console.log("no false positives: " + (clean.includes("all pass") ? "YES" : "NO"));
console.log("file restored     : " + (fileIntact ? "YES" : "NO"));
process.exit(caught && restoredClean && fileIntact ? 0 : 1);
