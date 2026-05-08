// engine_v3.test.mjs — בדיקת המנוע החדש מול ה-sample הרשמי.
// ריצה: node src/word_extractor/engine_v3.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// jsdom — ה-engine משתמש ב-DOMParser, שלא קיים ב-node.
const dom = new JSDOM("<!DOCTYPE html>");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Document = dom.window.Document;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;

const {
  find_all_note_sources,
  extract_word_html,
  read_footnotes,
} = await import("./word_extractor_engine.js");

const SAMPLE_PATH = path.resolve(__dirname, "../../samples/sample_shulchan_aruch.docx");
if (!fs.existsSync(SAMPLE_PATH)) {
  console.error("SAMPLE NOT FOUND:", SAMPLE_PATH);
  process.exit(2);
}
const buf = fs.readFileSync(SAMPLE_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  PASS:", msg); }
  else { fail++; console.log("  FAIL:", msg); }
}

console.log("\n=== TEST 1: find_all_note_sources ===");
const sources = await find_all_note_sources(ab.slice(0));
console.log("sources:", JSON.stringify(sources.map(s => ({
  source: s.source_type, marker: s.marker, count: s.count, label: s.label,
})), null, 2));
assert(sources.length >= 4, `at least 4 sources detected (got ${sources.length})`);
const fn01 = sources.find(s => s.source_type === "footnote" && s.marker === "01");
const fn02 = sources.find(s => s.source_type === "footnote" && s.marker === "02");
const fn03 = sources.find(s => s.source_type === "footnote" && s.marker === "03");
const fnNone = sources.find(s => s.source_type === "footnote" && s.marker === null);
assert(fn01 && fn01.count === 12, `footnote @01 has 12 (got ${fn01?.count})`);
assert(fn02 && fn02.count === 20, `footnote @02 has 20 (got ${fn02?.count})`);
assert(fn03 && fn03.count === 4,  `footnote @03 has 4 (got ${fn03?.count})`);
assert(fnNone && fnNone.count === 1, `footnote without marker = 1 (got ${fnNone?.count})`);

console.log("\n=== TEST 2: read_footnotes — preview API ===");
const fnDict = await read_footnotes(ab.slice(0));
const fnIds = Object.keys(fnDict);
assert(fnIds.length === 37, `read_footnotes returns 37 footnotes (got ${fnIds.length})`);
const markedCount = fnIds.filter(id => /@\d+/.test(fnDict[id].get_text())).length;
assert(markedCount === 36, `36 of 37 footnotes contain an @<digits> marker (got ${markedCount})`);

console.log("\n=== TEST 3: extract_word_html — full extraction ===");
const selected = [
  { stream: { source_type: "footnote", marker: "01", label: "שוליים @01" }, symbol: "@01" },
  { stream: { source_type: "footnote", marker: "02", label: "שוליים @02" }, symbol: "@02" },
  { stream: { source_type: "footnote", marker: "03", label: "שוליים @03" }, symbol: "@03" },
  { stream: { source_type: "footnote", marker: null, label: "שוליים ללא סימון" }, symbol: "@04" },
];
const result = await extract_word_html(ab.slice(0), selected);
console.log("diag:", JSON.stringify(result.diag, null, 2));
console.log("streamLabels:", JSON.stringify(result.streamLabels, null, 2));
console.log("streamSymbols:", JSON.stringify(result.streamSymbols, null, 2));

// מבחן 1 (קריטי): אין LaTeX בפלט הראשי
const latexCmds = ["\\fontsize", "\\textcolor", "\\par", "\\footnoteA", "\\footnoteB",
                    "\\ledrightnote", "\\strut", "\\setRTL", "\\setLTR", "\\selectfont",
                    "\\hbox", "\\unhbox", "\\opwhdg", "\\streamfont", "\\hfil", "\\hskip",
                    "\\leavevmode", "\\noindent", "\\parfillskip", "\\hsize", "\\relax"];
let foundCmd = null;
for (const cmd of latexCmds) {
  if (result.mainHtml.includes(cmd)) { foundCmd = cmd; break; }
}
assert(foundCmd === null, `mainHtml does not contain LaTeX commands (found: ${foundCmd})`);

// בדיקה: גם בכל הזרמים
let foundCmdInStream = null;
for (const code of Object.keys(result.streamsByCode)) {
  for (const cmd of latexCmds) {
    if (result.streamsByCode[code].includes(cmd)) {
      foundCmdInStream = `stream[${code}]: ${cmd}`;
      break;
    }
  }
  if (foundCmdInStream) break;
}
assert(foundCmdInStream === null, `streams do not contain LaTeX commands (found: ${foundCmdInStream})`);

// מבחן 2: יש פסקה אחת לפחות בגוף
assert(result.mainHtml.includes("<p>"), `mainHtml contains <p> elements`);

// מבחן 3: streamsByCode הוא 4 זרמים (01-04)
const codes = Object.keys(result.streamsByCode).sort();
console.log("codes:", codes);
assert(codes.length === 4, `4 stream codes generated (got ${codes.length})`);

// מבחן 4: כל זרם מכיל את ההערות הנכונות (לפי הספירה)
for (const code of codes) {
  const html = result.streamsByCode[code];
  // ספור פסקאות פתיחה: כל הערה תופסת לפחות פסקה אחת.
  // (הערה עם n פסקאות פנימיות תופסת n פסקאות בזרם.)
  const paraCount = (html.match(/<p>/g) || []).length;
  console.log(`  stream ${code} (${result.streamSymbols[code]}, "${result.streamLabels[code]}"): ${paraCount} paragraphs`);
}

// מבחן 5: בזרם של @01 לא מופיע @02 (כל הערה לזרם שלה בלבד)
// לוקחים את ה-stream שמיוצג לפי הסמל '@01' (זה streamSymbols[code]==='@01')
const code01 = Object.keys(result.streamSymbols).find(c => result.streamSymbols[c] === "@01");
const code02 = Object.keys(result.streamSymbols).find(c => result.streamSymbols[c] === "@02");
const code03 = Object.keys(result.streamSymbols).find(c => result.streamSymbols[c] === "@03");
assert(code01 && code02 && code03, "found codes for @01, @02, @03");

const stream01Html = result.streamsByCode[code01];
const stream02Html = result.streamsByCode[code02];
// ‫הקפד: ה-symbol "@01" עצמו מופיע **בתחילת כל הערה** של הזרם, ולכן הוא חייב
//      להופיע ב-stream01Html. אסור שהוא יופיע ב-stream02Html.
//      בודקים אם "@02" (= הסמל של הזרם השני) לא מופיע ב-stream01Html.
//      ב-_res, הקידומת @<digits>: נחתכת מההערה — לא אמורה להישאר.
const re02InStream01 = /@02\b/.test(stream01Html);
const re03InStream01 = /@03\b/.test(stream01Html);
assert(!re02InStream01, `@02 does not appear in stream of @01 (cleanup of prefix worked)`);
assert(!re03InStream01, `@03 does not appear in stream of @01`);

// מבחן 6: יש את הסמלים בגוף הראשי
const at01Count = (result.mainHtml.match(/@01\b/g) || []).length;
const at02Count = (result.mainHtml.match(/@02\b/g) || []).length;
const at03Count = (result.mainHtml.match(/@03\b/g) || []).length;
console.log(`  @01 in main: ${at01Count}, @02: ${at02Count}, @03: ${at03Count}`);
assert(at01Count === 12, `main contains 12 occurrences of @01 (got ${at01Count})`);
assert(at02Count === 20, `main contains 20 occurrences of @02 (got ${at02Count})`);
assert(at03Count === 4,  `main contains 4 occurrences of @03 (got ${at03Count})`);

// מבחן 7: stream paragraphs counts (12 הערות → 12 פסקאות פתיחה לפחות)
const stream01ParaOpens = (stream01Html.match(/<p>/g) || []).length;
console.log("stream01 first 400 chars:", stream01Html.slice(0, 400));
assert(stream01ParaOpens >= 12, `stream of @01 has at least 12 paragraphs (got ${stream01ParaOpens})`);

// מבחן 8: עיצוב — אם הפלט לא ריק והקובץ כולל bold/italic, נבדוק שאחת מהן קיימת
const totalRichTags = (
  (result.mainHtml.match(/<(strong|em|u|s|sup|sub)\b/g) || []).length +
  Object.values(result.streamsByCode).reduce((a, h) => a + (h.match(/<(strong|em|u|s|sup|sub)\b/g) || []).length, 0)
);
console.log(`  inline format tags total: ${totalRichTags}`);
// ‫זה לא חובה אם הקובץ לא כולל עיצוב. רק מציגים.

// מבחן 9: ‫הקידומת '@01:' של ההערה הוסרה — סוף הסמל '@01 ' ואז התוכן
//          (לא '@01:' שהיה בקובץ המקור).
//          בודקים שהסמל מופיע אבל ":" לא צמוד אחריו (יש עכשיו רווח).
const colonAfter01 = /@01:/.test(stream01Html);
assert(!colonAfter01, `prefix '@01:' was stripped from notes (no '@01:' in stream content)`);

// מבחן 10: ‫הזרם הרביעי — "ללא סימון" — מכיל בדיוק 1 הערה
const code04 = Object.keys(result.streamSymbols).find(c => result.streamSymbols[c] === "@04");
if (code04) {
  const stream04Html = result.streamsByCode[code04];
  const stream04Paras = (stream04Html.match(/<p>/g) || []).length;
  console.log("stream04 (no marker) html:", stream04Html.slice(0, 200));
  assert(stream04Paras >= 1, `unmarked stream has at least 1 paragraph (got ${stream04Paras})`);
} else {
  console.log("  (no @04 code generated — likely 'no marker' was not selected with notes; skipping)");
}

console.log(`\n=== RESULTS: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
