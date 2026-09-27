const fs = require("fs");
const P = "src/components/AppHeader.tsx";
let s = fs.readFileSync(P, "utf8");
const oldStr = `className={active === item.key ? "active" : ""}`;
const newStr = `className={active === item.key ? "nav-active" : ""} aria-current={active === item.key ? "page" : undefined}`;
const parts = s.split(oldStr);
if (parts.length !== 3) { console.error("expected 2 occurrences, got " + (parts.length - 1)); process.exit(1); }
// First occurrence = desktop topbar nav (needs the styled .nav-active class);
// second = mobile drawer (keeps .active, which has its own CSS).
fs.writeFileSync(P, parts[0] + newStr + parts[1] + oldStr + parts[2], "utf8");
console.log("desktop nav now uses styled .nav-active class");


