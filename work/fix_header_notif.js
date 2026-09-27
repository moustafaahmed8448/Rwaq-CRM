const fs = require("fs");
const P = "src/components/AppHeader.tsx";
let s = fs.readFileSync(P, "utf8");
const before = s.length;

const edits = [
  [
    'import { useLang } from "@/lib/i18n";',
    'import { useLang } from "@/lib/i18n";\r\nimport { dateLocale } from "@/lib/format";\r\nimport { notificationMessage } from "@/lib/reporting";',
  ],
  [
    "type Notif = { id: string; message: string; read: boolean; createdAt: string };",
    'type Notif = { id: string; message: string; read: boolean; createdAt: string; type?: string; clientName?: string };',
  ],
];

for (const [oldText, newText] of edits) {
  if (!s.includes(oldText)) { console.error("NOT FOUND: " + oldText.slice(0, 60)); process.exit(1); }
  s = s.replace(oldText, newText);
}

fs.writeFileSync(P, s, "utf8");
console.log("ok, " + (s.length - before) + " chars added");
