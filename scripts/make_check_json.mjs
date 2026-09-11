// make_check_json.mjs — מייצר קובץ JSON אחד שאפשר לפתוח ולבדוק בעיניים:
// מה נכנס (המקור), מה יצא (הטקסט שנכנס לעורך), ומה קיבלנו על המסך.
//
// שימוש: node scripts/make_check_json.mjs [slug] [fromAmud] [toAmud]

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const slug = process.argv[2] || "berakhot";
const from = parseInt(process.argv[3] || "2", 10);
const to = parseInt(process.argv[4] || "5", 10);
const OUT = process.env.CHECK_OUT || "C:/Users/User/Downloads/בדיקת-נעילת-דף.json";

const { buildVilnaRawText, amudLabel, amudLabelLong } = await import("../src/vilna_import.js");
const data = JSON.parse(await readFile(resolve(ROOT, "public", "data", "sefaria", "vilna_shas", `${slug}.json`), "utf8"));
const book = data.book;

const { text, stats } = buildVilnaRawText(book, { fromAmud: from, toAmud: to, withRashi: true, includeTitle: false });

// דוח הרינדור מהבדיקה בדפדפן (אם רצה)
let browser = null;
try {
  browser = JSON.parse(await readFile(resolve(ROOT, "verify-daf-lock-report.json"), "utf8"));
} catch { /* לא חובה */ }

const dafim = [];
for (let ai = from; ai <= to; ai++) {
  const segs = (book.gemara[ai] || []).filter(Boolean);
  if (!segs.length) continue;
  const rashiFlat = [];
  for (const line of (book.rashi[ai] || [])) {
    for (const c of (line || [])) rashiFlat.push(c);
  }
  const gemaraJoined = segs.join(" ");
  dafim.push({
    דף: amudLabelLong(ai),
    סימן_בטקסט: `⟦דף ${amudLabel(ai)}⟧`,
    גמרא: {
      מספר_קטעים: segs.length,
      מספר_תווים: gemaraJoined.length,
      פסיקים: (gemaraJoined.match(/,/g) || []).length,
      נקודות: (gemaraJoined.match(/\./g) || []).length,
      ניקוד: (gemaraJoined.match(/[֑-ׇ]/g) || []).length,
      מילים_ראשונות: gemaraJoined.split(/\s+/).slice(0, 8).join(" "),
      מילים_אחרונות: gemaraJoined.split(/\s+/).slice(-8).join(" "),
      הטקסט_המלא: gemaraJoined,
    },
    רשי: {
      מספר_פירושים: rashiFlat.length,
      שלושת_הראשונים: rashiFlat.slice(0, 3).map((c) => ({
        דיבור_מתחיל: c.dh,
        גוף: c.body,
        כפי_שייכנס: `${c.dh ? c.dh.replace(/[.:]$/, "") + ". " : ""}${c.body}`,
      })),
      כל_הפירושים: rashiFlat.map((c) => ({ דיבור_מתחיל: c.dh, גוף: c.body })),
    },
  });
}

const gemaraOnly = text.replace(/\{@\d+ [^}]*\}/g, "").replace(/⟦[^⟧]*⟧/g, "");

const out = {
  מה_זה: "קובץ בדיקה לנעילת דף — מה נלקח מהמאגר, איך הוא נראה אחרי הסידור, ומה יצא על המסך",
  נוצר: new Date().toISOString().slice(0, 16).replace("T", " "),
  מסכת: book.heTitle,
  טווח: `${amudLabelLong(from)} – ${amudLabelLong(to)}`,
  מקור_הנתונים: data.source,
  סיכום: {
    עמודים_שיובאו: stats.amudim,
    תווי_גמרא: stats.gemaraChars,
    פירושי_רשי: stats.rashiNotes,
    רשי_שנתלה_על_הדיבור_המתחיל: stats.rashiAnchored,
    רשי_שנתלה_בסוף_השורה: stats.rashiAtEnd,
    אחוז_עיגון_מדויק: Math.round((stats.rashiAnchored / Math.max(1, stats.rashiNotes)) * 100) + "%",
  },
  // מנקים גם את הערות רש"י וגם את סימני הדף (⟦דף ב.⟧ מכיל נקודה!) לפני
  // שסופרים — אחרת מקבלים "2 נקודות בגמרא" שהן בכלל שמות הדפים.
  בדיקות_איכות_הטקסט: {
    פסיקים_בגמרא: (gemaraOnly.match(/,/g) || []).length,
    נקודות_בגמרא: (gemaraOnly.match(/\./g) || []).length,
    ניקוד: (text.match(/[֑-ׇ]/g) || []).length,
    תגיות_HTML: (text.match(/<[^>]+>/g) || []).length,
    סימני_דף: (text.match(/⟦דף [^⟧]+⟧/g) || []).length,
  },
  דפים: dafim,
  הטקסט_שנכנס_לעורך: text,
  מה_יצא_על_המסך: browser ? {
    הערה: "מתוך הרצת הבדיקה האחרונה בדפדפן (8 דפי ברכות על עמוד A4)",
    עמודים: browser.pages.map((p) => ({
      דף: p.label,
      גודל_אות: Math.round(p.scale * 100) + "%",
      גובה_העמוד: p.height,
      גובה_התוכן: p.scrollHeight,
      תווים_בעמוד: p.chars,
    })),
    דפים_שלא_נכנסו_בעמוד_אחד: browser.daf?.dafimOverflowed ?? null,
  } : "לא נמצא דוח דפדפן — הרץ npm run verify:daf-lock-browser",
};

await writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
console.log("נכתב:", OUT);
console.log("עמודים:", stats.amudim, "· רש\"י:", stats.rashiNotes, "· עיגון מדויק:", out.סיכום.אחוז_עיגון_מדויק);
