// stream_parser.test.js
// בדיקות יחידה ל‑stream_parser.js
// הרצה: node src/stream_parser.test.js

import { parseRawTextToHTML, scanRawText } from "./stream_parser.js";

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

function test(name, fn) {
  console.log(name);
  try { fn(); } catch (e) { fail++; console.error(`  ✗ זריקת שגיאה: ${e.message}`); }
}

test("@NN — כל מספר זרם בנפרד", () => {
  const text = "מילה @01 ועוד @02 ושוב @01 ובסוף @17";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 4, "ארבעה סימנים זוהו", `קיבל ${stats.total}`);
  assert(stats.byStream["01"] === 2, "שני מופעים של 01");
  assert(stats.byStream["02"] === 1, "מופע אחד של 02");
  assert(stats.byStream["17"] === 1, "מופע אחד של 17");
});

test("[N] — סוגריים מרובעות עם מספרים", () => {
  const text = "הערה [1] ועוד [2] בלי [99]";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 3, "שלושה סימנים");
  assert(stats.byStream["b1"] && stats.byStream["b2"] && stats.byStream["b99"], "כל זרם בנפרד");
});

test("(N) — סוגריים עגולות עם מספרים", () => {
  const text = "טקסט (1) ועוד (2)";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 2, "שני סימנים");
  assert(stats.byStream["p1"] && stats.byStream["p2"], "p1 ו‑p2");
});

test("{...} — סוגריים מסולסלות = זרם curly", () => {
  const text = "טקסט {הערה ראשונה} ועוד {שנייה}";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 2, "שני סימנים");
  assert(stats.byStream["curly"] === 2, "שניהם בזרם curly");
});

test("* — כוכביות לפי כמות", () => {
  const text = "א* ב** ג*** ד*";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 4, "ארבע כוכביות");
  assert(stats.byStream["asterisk-1"] === 2, "שני * בודדים");
  assert(stats.byStream["asterisk-2"] === 1, "** בודד");
  assert(stats.byStream["asterisk-3"] === 1, "*** בודד");
});

test("† ‡ — פגיון וחרב נפרדים", () => {
  const text = "א† ב‡ ג†";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.byStream["dagger"] === 2, "שני †");
  assert(stats.byStream["double-dagger"] === 1, "‡ אחד");
});

test("מעורב — כל הסוגים יחד", () => {
  const text = "טקסט @01 עם [1] וגם {הערה} ועוד * ופגיון †";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 5, `חמישה סימנים מסוגים שונים — קיבל ${stats.total}`);
});

test("טקסט ללא סימנים — 0 התאמות", () => {
  const text = "סתם טקסט בלי שום סימון מיוחד";
  const { stats } = parseRawTextToHTML(text);
  assert(stats.total === 0, "אין סימנים");
});

test("חפיפה — לא להחיל פעמיים", () => {
  // {abc} מסולסלות זוכות; @01 בתוכם נדחה
  const text = "טקסט {הערה @01 בתוך} עוד";
  const { stats } = parseRawTextToHTML(text);
  // התבנית curly לפני atNN — ה‑@01 נופל בתוך החפיפה
  assert(stats.total === 1, "רק curly נשמר");
  assert(stats.byStream["curly"] === 1, "curly אחד");
});

test("פלט HTML מכיל data-stream + data-uid", () => {
  const { html } = parseRawTextToHTML("טקסט @01 פה");
  assert(html.includes('data-stream="01"'), "data-stream נכון");
  assert(/data-uid="auto-/.test(html), "data-uid יוצר");
  assert(html.includes("stream-marker"), "class נכון");
});

test("פסקאות מרובות נשמרות", () => {
  const { html } = parseRawTextToHTML("פסקה ראשונה.\n\nפסקה שנייה עם @01.");
  const pCount = (html.match(/<p>/g) || []).length;
  assert(pCount === 2, `שתי פסקאות — קיבל ${pCount}`);
});

test("עברית עם ניקוד וטעמים נשמרת", () => {
  const text = "בְּרֵאשִׁ֖ית בָּרָ֣א @01 אֱלֹהִ֑ים";
  const { html } = parseRawTextToHTML(text);
  assert(/[ְ-ׇ]/.test(html), "ניקוד נמצא");
  assert(/[֑-֯]/.test(html), "טעם נמצא");
  assert(html.includes('data-stream="01"'), "סימן הוטמע");
});

test("escapeHtml — תווים מיוחדים", () => {
  const { html } = parseRawTextToHTML("טקסט עם <tag> ו־& ו־\"מירכאות\"");
  assert(html.includes("&lt;tag&gt;"), "<tag> בורח");
  assert(html.includes("&amp;"), "& בורח");
  assert(html.includes("&quot;"), "מירכאות בורחות");
});

console.log(`\n  pass: ${pass}  fail: ${fail}`);
if (fail > 0) process.exit(1);
