const fs = require("fs");
const a = fs.readFileSync("work/AppHeader.part1.tsx", "utf8");
const b = fs.readFileSync("work/AppHeader.part2.tsx", "utf8");
fs.writeFileSync("src/components/AppHeader.tsx", a + b, "utf8");
console.log("wrote src/components/AppHeader.tsx (" + (a + b).length + " chars)");
