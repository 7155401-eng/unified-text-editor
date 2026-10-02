// בדיקות לעיצוב כותרת ותחתית העמוד.
// מריצים: node scripts/verify_header_styles.mjs

import {
  emptyHeaderStyle, normalizeHeaderStyle, resolveAlign,
  headerStyleDeclarations, buildHeaderStyleSheet, markPageParity,
  loadHeaderStyle, saveHeaderStyle, ALIGN_OPTIONS, HEADER_STYLE_KEY,
} from "../src/document/header_styles.js";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  if (ok) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}\n      צפוי: ${JSON.stringify(e)}\n      קיבלנו: ${JSON.stringify(a)}`); }
};
const checkThat = (n, c, d = "") => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); }
};
const on = (extra = {}) => ({ ...emptyHeaderStyle(), enabled: true, ...extra });

console.log("\n[1] ברירת מחדל — כבוי, ולכן אין שום עיצוב");
check("כבוי", emptyHeaderStyle().enabled, false);
check("כבוי ⟵ אין גיליון", buildHeaderStyleSheet(emptyHeaderStyle()), "");
check("כבוי ⟵ אין הצהרות", headerStyleDeclarations(emptyHeaderStyle()), "");
check("חמש אפשרויות יישור", ALIGN_OPTIONS.length, 5);
checkThat("וכולן בעברית", ALIGN_OPTIONS.every((a) => !/[a-zA-Z]{3,}/u.test(a.label)));

console.log("\n[2] הצהרות העיצוב");
checkThat("גודל", headerStyleDeclarations(on({ sizePt: 12 })).includes("font-size:12pt"));
checkThat("מודגש", headerStyleDeclarations(on({ bold: true })).includes("font-weight:700"));
checkThat("ולא מודגש הוא 400", headerStyleDeclarations(on()).includes("font-weight:400"));
checkThat("נטוי", headerStyleDeclarations(on({ italic: true })).includes("font-style:italic"));
checkThat("פונט", headerStyleDeclarations(on({ font: "FrankRuehl" })).includes("font-family:FrankRuehl"));
checkThat("יישור קבוע", headerStyleDeclarations(on({ align: "right" })).includes("text-align:right"));
checkThat("יישור מתחלף אינו נכתב כאן", !headerStyleDeclarations(on({ align: "outer" })).includes("text-align"));

console.log("\n[3] ⭐ חיצוני ופנימי מתחלפים בין עמודים, כמו בספר פתוח");
check("חיצוני באי-זוגי = ימין", resolveAlign("outer", 1), "right");
check("חיצוני בזוגי = שמאל", resolveAlign("outer", 2), "left");
check("פנימי באי-זוגי = שמאל", resolveAlign("inner", 1), "left");
check("פנימי בזוגי = ימין", resolveAlign("inner", 2), "right");
check("יישור קבוע אינו מתחלף", resolveAlign("center", 7), "center");
check("עמוד 11 הוא אי-זוגי", resolveAlign("outer", 11), "right");

console.log("\n[4] הגיליון המלא");
const sheet = buildHeaderStyleSheet(on({ align: "outer", sizePt: 11 }));
checkThat("יש כלל לכותרת", sheet.includes(".ravtext-page-header"), sheet);
checkThat("ולתחתית כברירת מחדל", sheet.includes(".ravtext-page-footer"), sheet);
checkThat("ושני כללי זוגיות", sheet.includes('data-page-parity="odd"') && sheet.includes('data-page-parity="even"'), sheet);
const noFooter = buildHeaderStyleSheet(on({ applyToFooter: false }));
checkThat("אפשר לא להחיל על התחתית", !noFooter.includes(".ravtext-page-footer"), noFooter);
checkThat("קו מפריד", buildHeaderStyleSheet(on({ rule: true })).includes("border-bottom"), "");

console.log("\n[5] גבולות ואבטחה");
check("גודל מתחת ל-4 נחתך", normalizeHeaderStyle({ sizePt: 0 }).sizePt, 4);
check("גודל מעל 72 נחתך", normalizeHeaderStyle({ sizePt: 500 }).sizePt, 72);
check("זבל בגודל ⟵ ברירת מחדל", normalizeHeaderStyle({ sizePt: "אבג" }).sizePt, 10);
check("יישור לא מוכר ⟵ באמצע", normalizeHeaderStyle({ align: "לא קיים" }).align, "center");
check("⛔ צבע תקין מתקבל", normalizeHeaderStyle({ color: "#1a2b3c" }).color, "#1a2b3c");
check("⛔ צבע פסול נזרק", normalizeHeaderStyle({ color: "red;}body{display:none" }).color, "");
checkThat("ולכן הגיליון אינו יכול לשאת קוד",
  !buildHeaderStyleSheet(on({ color: "red;}body{display:none" })).includes("body{display:none"), "");

console.log("\n[6] שמירה וטעינה");
const store = new Map();
const fake = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
check("ברירת מחדל כשאין כלום", loadHeaderStyle(fake).enabled, false);
saveHeaderStyle(on({ sizePt: 14, bold: true }), fake);
check("נשמר במפתח הנכון", store.has(HEADER_STYLE_KEY), true);
check("ונטען", [loadHeaderStyle(fake).sizePt, loadHeaderStyle(fake).bold], [14, true]);
store.set(HEADER_STYLE_KEY, "{{{");
check("קובץ פגום אינו מפיל", loadHeaderStyle(fake).enabled, false);

console.log("\n[7] סימון זוגיות — וכותב רק מה שהשתנה");
const mkPage = () => { const a = {}; return {
  className: "page", getAttribute: (k) => (k in a ? a[k] : null), setAttribute: (k, v) => { a[k] = v; }, _a: a }; };
const pages = [mkPage(), mkPage(), mkPage()];
const container = { querySelectorAll: () => pages };
check("שלושה עמודים סומנו", markPageParity(container), 3);
check("הסימון נכון", pages.map((p) => p._a["data-page-parity"]), ["odd", "even", "odd"]);
check("⭐ קריאה שנייה אינה כותבת כלום", markPageParity(container), 0);
check("בלי מיכל אינו מפיל", markPageParity(null), 0);

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
