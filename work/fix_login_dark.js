const fs = require("fs");
const FILE = "src/app/login/page.tsx";
let s = fs.readFileSync(FILE, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";
const oldLines = [
  "  useEffect(() => {",
  '    const isDark = localStorage.getItem("rwaq-dark") === "1";',
  "    setDarkMode(isDark);",
  '    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");',
  "  }, []);",
];
const newLines = [
  "  useEffect(() => {",
  "    // eslint-disable-next-line react-hooks/set-state-in-effect",
  '    setDarkMode(localStorage.getItem("rwaq-dark") === "1");',
  "  }, []);",
  "",
  "  useEffect(() => {",
  '    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");',
  "  }, [darkMode]);",
];
const old1 = oldLines.join("\n");
const new1 = newLines.join("\n");
const old1c = oldLines.join("\r\n");
const new1c = newLines.join("\r\n");
if (s.includes(old1)) s = s.replace(old1, new1);
else if (s.includes(old1c)) s = s.replace(old1c, new1c);
else {
  console.error("NOT FOUND");
  process.exit(1);
}
fs.writeFileSync(FILE, s);
console.log("OK");
