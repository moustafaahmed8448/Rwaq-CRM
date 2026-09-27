const fs = require("fs");
const EN = require("./en_map.js");
const SRC = "src/lib/i18n.tsx";

const PRE = [
  '"use client";',
  "",
  "/**",
  " * Bilingual UI (Arabic default + English) with RTL support and a persisted",
  " * per-user preference. Usage:",
  ' *   const { t, lang, setLang } = useLang();',
  ' *   t("kpi.totalSpend")   t("toast.created", { name: "Sara" })',
  " */",
  'import { useCallback, useEffect, useMemo, useState } from "react";',
  "",
  'export type Lang = "ar" | "en";',
  'export const LANG_KEY = "rwaq-lang";',
  'export const DEFAULT_LANG: Lang = "ar";',
  'export const LANGS: Lang[] = ["ar", "en"];',
  ""
].join("\n");

// Arabic values for keys that do not exist (or are empty) in the recovered block.
const AR_EXTRA = {
  "dash.heroTitle": "مسارك. صورة أوضح.",
  "dash.heroSubtitle": "العملاء، القنوات، وأداء الفريق — كل في مكان واحد.",
  "dash.workspaceOverview": "نظرة على مساحة العمل",
  "dash.clientOverview": "نظرة على العملاء",
  "dash.clientsInThisView": "عميل في هذا العرض",
  "status.waiting": "بالانتظار",
  "status.won": "فاز",
  "status.lost": "خسر",
  "status.new": "جديد",
  "client.field.name": "الاسم",
  "client.field.phone": "رقم الهاتف",
  "client.field.status": "الحالة",
  "client.field.source": "المصدر",
  "client.field.channel": "القناة",
  "client.field.project": "المشروع",
  "client.field.location": "الموقع",
  "client.field.operation": "العملية المطلوبة",
  "client.field.firstContact": "اسم شخص التواصل الأول",
  "client.field.secondContact": "اسم شخص التواصل الثاني",
  "client.field.notes": "ملاحظات",
  "client.field.created": "تاريخ الإنشاء",
  "client.noActivity": "لا توجد أنشطة بعد",
  "common.back": "رجوع",
  "toast.created": "تم إنشاء العميل {name}",
  "settings.title": "الإعدادات",
  "settings.preferences": "التفضيلات",
  "settings.language": "اللغة",
  "settings.account": "الحساب",
  "settings.profile": "الملف الشخصي",
  "settings.changePassword": "تغيير كلمة المرور",
  "settings.teamMembers": "أعضاء الفريق",
  "settings.addUser": "إضافة مستخدم",
  "settings.dangerZone": "منطقة الخطر",
  "settings.clearLocal": "مسح البيانات المحلية",
  "settings.signOut": "تسجيل الخروج",
  "settings.profileSaved": "تم حفظ الملف الشخصي بنجاح",
  "settings.passwordChanged": "تم تغيير كلمة المرور بنجاح",
    "settings.darkMode": "الوضع الداكن",
  "settings.lightMode": "الوضع الفاتح",
  "settings.subtitle": "إدارة حسابك وتفضيلاتك.",
  "settings.profileSubtitle": "معلومات عامة",
  "settings.saveProfile": "حفظ الملف الشخصي",
  "settings.field.fullName": "الاسم الكامل",
  "settings.field.email": "البريد الإلكتروني",
  "settings.field.username": "اسم المستخدم",
  "settings.field.role": "الدور",
  "settings.noEmail": "لا يوجد بريد إلكتروني",
  "settings.remove": "إزالة",
  "settings.saving": "جارٍ الحفظ...",
  "settings.passwordSubtitle": "تحديث بيانات اعتمادك",
  "settings.field.currentPassword": "كلمة المرور الحالية",
  "settings.field.newPassword": "كلمة المرور الجديدة",
  "settings.updatePassword": "تحديث كلمة المرور",
  "settings.noTeam": "لا يوجد أعضاء فريق بعد.",
  "settings.dangerZoneSubtitle": "إجراءات لا رجعة لها"
};

// Recover the Arabic dictionary from the double-encoded (mojibake) file.
const raw = fs.readFileSync(SRC, "utf8");
const arMatch = raw.match(/const ar: Record<string, string> = \{([\s\S]*?)\n(?:const en:|^\/\/)/m);
const pairRe = /"([a-zA-Z0-9_./]+)"\s*:\s*"([^"]*)"/g;

// Reverse-mapping for the bytes 0x80-0x9F, which CP1252 maps to extra Unicode
// points (0x81/0x8D/0x90/0x9D are undefined in CP1252 and survive as raw controls).
const CP1252_INV = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2122: 0x99, 0x0161: 0x9a,
  0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e,
};
function cp1252toBytes(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp in CP1252_INV) bytes.push(CP1252_INV[cp]);
    else if (cp <= 0xff) bytes.push(cp);
    else return null; // already proper Unicode (e.g. real Arabic) -> leave as-is
  }
  return Buffer.from(bytes);
}
function recover(value) {
  const b = cp1252toBytes(value);
  if (!b) return value; // already proper text
  const r = b.toString("utf8");
  return r.includes("\uFFFD") ? value : r;
}

const recoveredAr = {};
if (arMatch) {
  let m;
  while ((m = pairRe.exec(arMatch[1])) !== null) recoveredAr[m[1]] = recover(m[2]);
}

const keys = Array.from(new Set([...Object.keys(recoveredAr), ...Object.keys(EN), ...Object.keys(AR_EXTRA)]));
const missingEn = keys.filter(k => !(k in EN));
const missingAr = keys.filter(k => !(k in recoveredAr) && !(k in AR_EXTRA));
if (missingEn.length) console.warn("WARN missing EN:", missingEn.join(", "));
if (missingAr.length) console.warn("WARN missing AR:", missingAr.join(", "));

function line(k, v) { return "  " + JSON.stringify(k) + ": " + JSON.stringify(v) + ","; }
const arBlock = "const ar: Record<string, string> = {\n" + keys.map(k => line(k, recoveredAr[k] || AR_EXTRA[k] || k)).join("\n") + "\n};\n";
const enBlock = "const en: Record<string, string> = {\n" + keys.map(k => line(k, EN[k] || k)).join("\n") + "};\n";

const hook = fs.readFileSync("work/hook.txt", "utf8");

fs.writeFileSync(SRC, PRE + "\n" + arBlock + "\n" + enBlock + "\n" + hook + "\n", "utf8");

console.log("wrote " + SRC);
console.log("total keys:", keys.length);
console.log("recovered ar keys:", Object.keys(recoveredAr).length);
console.log("sample:", JSON.stringify({ "common.save": recoveredAr["common.save"], "nav.settings": recoveredAr["nav.settings"], "kpi.customersWon": recoveredAr["kpi.customersWon"] }));
