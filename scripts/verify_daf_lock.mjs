// verify_daf_lock.mjs — בדיקות אוטומטיות ל"נעילת דף" (src/vilna_daf_lock.js).
//
// הבדיקות רצות בלי דפדפן: DOM מדומה (jsdom) + מנוע-עמודים מדומה שמתנהג
// כמו V9 מבחינת מה שחשוב לנו — כמה תוכן נכנס בעמוד בגודל אות נתון.
// כך אפשר לבדוק את הלוגיקה של החיתוך והחיפוש בלי להריץ רינדור אמיתי.
//
// שימוש: node scripts/verify_daf_lock.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='pages' class='pages-container'></div></body></html>",
  { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;

const {
  splitParagraphsByDaf, hasDafMarkers, makeDafMark, DAF_MARK_RE,
  buildPagesDafLocked, measurePageFill,
} = await import("../src/vilna_daf_lock.js");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const para = (text, notes = []) => ({ mainText: text, mainRuns: [], notes });

// ===================== 1. זיהוי הסימן =====================
console.log("\n[1] זיהוי סימן הדף");
check("סימן פשוט", DAF_MARK_RE.test("⟦דף ב.⟧"));
check("עם רווחים", DAF_MARK_RE.test("⟦ דף  ב:  ⟧"));
check('גם "עמוד"', DAF_MARK_RE.test("⟦עמוד ג.⟧"));
check("טקסט רגיל אינו סימן", !DAF_MARK_RE.test("דף ב. מתחיל כאן"));
check("makeDafMark מייצר סימן תקין", DAF_MARK_RE.test(makeDafMark('ה ע"ב')));
check("makeDafMark מנקה סוגריים", makeDafMark("⟦ז.⟧") === "⟦דף ז.⟧", makeDafMark("⟦ז.⟧"));
check("hasDafMarkers", hasDafMarkers([para("שלום"), para("⟦דף ב.⟧")]));
check("hasDafMarkers שלילי", !hasDafMarkers([para("שלום"), para("עולם")]));

// ===================== 2. חיתוך לקטעי-דף =====================
console.log("\n[2] חיתוך לקטעי-דף");
{
  const ps = [para("⟦דף ב.⟧"), para("אאא"), para("בבב"), para("⟦דף ב:⟧"), para("גגג")];
  const { segments, markerCount } = splitParagraphsByDaf(ps);
  check("שני סימנים נספרו", markerCount === 2, `=${markerCount}`);
  check("שני קטעים", segments.length === 2, `=${segments.length}`);
  check("תווית ראשונה", segments[0].label === "ב.", `="${segments[0].label}"`);
  check("תווית שנייה", segments[1].label === "ב:", `="${segments[1].label}"`);
  check("קטע ראשון = 2 פסקאות", segments[0].paragraphs.length === 2);
  check("קטע שני = פסקה אחת", segments[1].paragraphs.length === 1);
}
{
  // סימן בתוך פסקה — החצי הראשון נשאר, החצי השני פותח דף חדש
  const ps = [para("ראש הפסקה ⟦דף ג.⟧ סוף הפסקה", [
    { stream: "01", text: "הערה מוקדמת", anchor: 3 },
    { stream: "01", text: "הערה מאוחרת", anchor: 22 },
  ])];
  const { segments } = splitParagraphsByDaf(ps);
  check("שני קטעים מפסקה אחת", segments.length === 2, `=${segments.length}`);
  check("חצי ראשון בלי הסימן", segments[0].paragraphs[0].mainText === "ראש הפסקה", `="${segments[0].paragraphs[0].mainText}"`);
  check("חצי שני בלי הסימן", segments[1].paragraphs[0].mainText === "סוף הפסקה", `="${segments[1].paragraphs[0].mainText}"`);
  check("הערה מוקדמת נשארה בחצי הראשון", segments[0].paragraphs[0].notes.length === 1);
  check("הערה מאוחרת עברה לחצי השני", segments[1].paragraphs[0].notes.length === 1);
  const movedAnchor = segments[1].paragraphs[0].notes[0].anchor;
  check("עוגן ההערה הוזז ולא נשאר במקום הישן", movedAnchor >= 0 && movedAnchor < 12, `=${movedAnchor}`);
}
{
  // טקסט לפני הסימן הראשון = קטע בלי תווית (למשל שם המסכת)
  const ps = [para("מסכת ברכות"), para("⟦דף ב.⟧"), para("אאא")];
  const { segments } = splitParagraphsByDaf(ps);
  check("קטע פתיחה בלי תווית", segments.length === 2 && segments[0].label === "");
}
{
  // שני סימנים באותה פסקה
  const ps = [para("⟦דף ב.⟧ אאא ⟦דף ב:⟧ בבב")];
  const { segments, markerCount } = splitParagraphsByDaf(ps);
  check("שני סימנים בפסקה אחת", markerCount === 2 && segments.length === 2, `segs=${segments.length}`);
  check("תוכן חולק נכון", segments[0].paragraphs[0].mainText === "אאא" && segments[1].paragraphs[0].mainText === "בבב");
}
{
  const { segments } = splitParagraphsByDaf([]);
  check("רשימה ריקה לא מפילה", segments.length === 0);
}

// ===================== 3. מנוע מדומה + חיפוש הגודל =====================
// המנוע המדומה: כל פסקה = 100 "יחידות" בגודל אות 10. הגובה בעמוד = 500
// יחידות. בגודל אות s כל פסקה תופסת 100*s/10. כך: בגודל 10 נכנסות 5 פסקאות.
console.log("\n[3] חיפוש הגודל המתאים (מנוע מדומה)");
const PAGE_UNITS = 500;
let buildCalls = 0;

function fakeBuildPages(container, paragraphs, cfg) {
  buildCalls++;
  const unitPerPara = 100 * ((cfg.mainFontSize || 13) / 10);
  const perPage = Math.max(1, Math.floor(PAGE_UNITS / unitPerPara));
  const pages = [];
  const total = paragraphs.length;
  const maxPages = cfg.maxPages || 100;
  for (let i = 0; i < total && pages.length < maxPages; i += perPage) {
    const el = container.ownerDocument.createElement("div");
    el.className = "page v9-page";
    const used = Math.min(perPage, total - i) * unitPerPara;
    // jsdom לא מחשב פריסה, לכן מספקים את המדידות ידנית.
    Object.defineProperty(el, "offsetHeight", { value: PAGE_UNITS, configurable: true });
    Object.defineProperty(el, "scrollHeight", { value: Math.max(PAGE_UNITS, used), configurable: true });
    const inner = container.ownerDocument.createElement("div");
    Object.defineProperty(inner, "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(inner, "offsetHeight", { value: used, configurable: true });
    el.appendChild(inner);
    container.appendChild(el);
    pages.push(el);
  }
  return Promise.resolve({ pages });
}

const baseCfg = { pageHeight: PAGE_UNITS, padding: 0, reservedBottom: 0, mainFontSize: 10, sideFontSize: 8 };
const settings = { enabled: "1", mode: "strict", minScale: 0.5, maxScale: 1.5, showLabel: true };

{
  // 3 דפים: 5 פסקאות, 3 פסקאות, 7 פסקאות.
  const ps = [
    para("⟦דף ב.⟧"), ...Array.from({ length: 5 }, (_, i) => para(`a${i}`)),
    para("⟦דף ב:⟧"), ...Array.from({ length: 3 }, (_, i) => para(`b${i}`)),
    para("⟦דף ג.⟧"), ...Array.from({ length: 7 }, (_, i) => para(`c${i}`)),
  ];
  const container = document.getElementById("pages");
  container.innerHTML = "";
  buildCalls = 0;
  const { pages, report } = await buildPagesDafLocked(container, ps, baseCfg, { settings, buildPages: fakeBuildPages });

  check("נוצרו 3 עמודים בדיוק — דף לעמוד", pages.length === 3, `=${pages.length}`);
  check("כל העמודים במיכל האמיתי", container.querySelectorAll(".page").length === 3,
    `=${container.querySelectorAll(".page").length}`);
  check("לא נשארו מיכלי-ניסיון ב-DOM", document.querySelectorAll("[data-daf-trial]").length === 0,
    `=${document.querySelectorAll("[data-daf-trial]").length}`);
  check("תוויות הדפים בסדר הנכון",
    pages.map((p) => p.dataset.dafLabel).join("|") === "ב.|ב:|ג.",
    pages.map((p) => p.dataset.dafLabel).join("|"));
  check("מספור עמודים רציף", pages.map((p) => p.dataset.pageIndex).join(",") === "0,1,2",
    pages.map((p) => p.dataset.pageIndex).join(","));

  const [s1, s2, s3] = report.segments;
  check("דף עם 5 פסקאות נשאר בגודל מלא", Math.abs(s1.scale - 1.5) < 0.2 || s1.scale >= 1,
    `scale=${s1.scale}`);
  check("דף קצר (3 פסקאות) קיבל אות גדולה יותר מדף ארוך (7)", s2.scale > s3.scale,
    `${s2.scale} > ${s3.scale}`);
  check("דף ארוך הוקטן מתחת ל-1", s3.scale < 1, `scale=${s3.scale}`);
  check("אף דף לא חרג", report.dafimOverflowed === 0);
  check("מספר בניות סביר (≤ 12 לדף)", buildCalls <= 3 * 12, `=${buildCalls}`);
  check("התווית מוצגת על העמוד", pages[0].querySelector(".v9-daf-label")?.textContent === "ב.");
}

{
  // דף שלא נכנס גם בגודל המינימלי — חייב לזלוג ולהיות מדווח, לא להיחתך
  const ps = [para("⟦דף ד.⟧"), ...Array.from({ length: 40 }, (_, i) => para(`x${i}`))];
  const container = document.getElementById("pages");
  container.innerHTML = "";
  const { pages, report } = await buildPagesDafLocked(container, ps, baseCfg, { settings, buildPages: fakeBuildPages });
  check("דף ענק נשפך ליותר מעמוד אחד", pages.length > 1, `=${pages.length}`);
  check("הזליגה מדווחת", report.dafimOverflowed === 1, `=${report.dafimOverflowed}`);
  check("סומן חלק מתוך כמה", pages[0].dataset.dafPart === `1/${pages.length}`, `=${pages[0].dataset.dafPart}`);
  check("כל העמודים נושאים את שם הדף", pages.every((p) => p.dataset.dafLabel === "ד."));
}

{
  // מצב "רק גבול" — בלי שינוי גודל אות
  const soft = { ...settings, mode: "soft" };
  const ps = [
    para("⟦דף ה.⟧"), ...Array.from({ length: 7 }, (_, i) => para(`a${i}`)),
    para("⟦דף ה:⟧"), ...Array.from({ length: 2 }, (_, i) => para(`b${i}`)),
  ];
  const container = document.getElementById("pages");
  container.innerHTML = "";
  const { pages, report } = await buildPagesDafLocked(container, ps, baseCfg, { settings: soft, buildPages: fakeBuildPages });
  check("מצב רך: הדף הארוך תופס 2 עמודים", report.segments[0].pages === 2, `=${report.segments[0].pages}`);
  check("מצב רך: הדף השני מתחיל בעמוד חדש", report.segments[1].pages === 1);
  check("מצב רך: אין ערבוב בין דפים",
    pages.filter((p) => p.dataset.dafLabel === "ה.").length === 2 &&
    pages.filter((p) => p.dataset.dafLabel === "ה:").length === 1);
  check("מצב רך: גודל האות לא שונה", report.segments.every((s) => s.scale === 1));
}

{
  // מסמך בלי סימני דף — הכול קטע אחד, המנוע עובד כרגיל
  const ps = [para("אאא"), para("בבב")];
  const container = document.getElementById("pages");
  container.innerHTML = "";
  const { report } = await buildPagesDafLocked(container, ps, baseCfg, { settings: { ...settings, mode: "soft" }, buildPages: fakeBuildPages });
  check("בלי סימנים — קטע אחד", report.segments.length === 1 && report.markerCount === 0);
}

console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
