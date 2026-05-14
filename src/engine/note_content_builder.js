// note_content_builder.js — מנגנון יחיד לבניית תוכן ההערה.
//
// מי שמרכיב הערה (גם המנוע הרגיל וגם V9) חייב לקרוא לפונקציה אחת בלבד —
// buildNoteContentNodes — כדי לקבל ייצוג מובנה של מספר ההערה, פתיח, דיבור
// המתחיל, גוף, סוגר וילדים מקוננים. שני הצרכנים ממירים את אותו ייצוג —
// המנוע הרגיל ל-DOM (עם classes כמו .note-number / .note-lemma) ו-V9
// לטקסט+runs לצורך פגינציה אנליטית.
//
// כל החלטה (האם להציג מספר, איזה סגנון, האם להבליט דיבור המתחיל, סוגרי
// גוף וכו') מתקבלת כאן ורק כאן — לכן ההגדרות ב-Stream Settings תופסות
// אוטומטית גם ב-V9 וגם ב-DOM.
//
// מבנה הצומת המוחזר:
//   { kind: "space" }                                    — רווח מקדים
//   { kind: "number",  text, bold, place }               — "[N] " וכו'
//   { kind: "prefix",  text }                            — noteTextPrefix
//   { kind: "lemma",   text, runs, bold }                — מילה ראשונה
//   { kind: "rest",    text, runs }                      — שאר הטקסט
//   { kind: "body",    text, runs, bold }                — גוף שלם (ללא רווחים)
//   { kind: "cont",    text, runs }                      — המשך (split half)
//   { kind: "suffix",  text }                            — noteTextSuffix
//   { kind: "child",   stream, nodes }                   — תת-הערה (recursive)

import {
  formatStreamNumber,
  shouldBoldStreamNumber,
  shouldBoldStreamLemma,
  noteTextPrefixForStream,
  noteTextSuffixForStream,
  getEffectiveStreamSettings,
  styleIdForStreamNumber,
  _streamBoolSetting,
} from "../original_stream_columns.js";
import { sliceRuns } from "./runs_dom.js";
import { resolveTextStyle, normalizeTextStyle } from "../style_registry.js";

// משה 2026-05-15: ממיר styleId לאובייקט "marks" שמתאים ל-runs (אותו מבנה
// ש-runs_dom.js מצפה לו). שימוש: גם V9 (שורות + runs) וגם המנוע הרגיל (אם
// יבחר להחיל סגנון על "[N]" דרך runs במקום DOM-styling) ייפול לאותו ערך.
function styleIdToMarks(styleId) {
  if (!styleId) return null;
  const raw = resolveTextStyle(styleId);
  if (!raw) return null;
  const s = normalizeTextStyle(raw);
  if (!s) return null;
  const marks = {};
  if (s.bold) marks.bold = true;
  if (s.italic) marks.italic = true;
  if (s.underline) marks.underline = true;
  if (s.color) marks.color = s.color;
  if (s.bgColor || s.backgroundColor) marks.backgroundColor = s.bgColor || s.backgroundColor;
  if (s.fontFamily) marks.fontFamily = s.fontFamily;
  if (s.fontSize) marks.fontSize = s.fontSize;
  return Object.keys(marks).length > 0 ? marks : null;
}

export function buildNoteContentNodes(streamCode, num, text, runs, opts = {}) {
  const {
    isCont = false,
    place = "note",
    leadingSpace = false,
    children = [],
  } = opts;

  const nodes = [];
  const origRuns = Array.isArray(runs) ? runs : [];
  const raw = String(text || "");

  if (leadingSpace) nodes.push({ kind: "space" });

  if (isCont) {
    nodes.push({ kind: "cont", text: raw, runs: origRuns });
    return nodes;
  }

  const formatted = formatStreamNumber(streamCode, num, place);
  if (formatted) {
    nodes.push({
      kind: "number",
      text: formatted + " ",
      bold: shouldBoldStreamNumber(streamCode, place),
      place,
      // משה 2026-05-15: סגנון שיוחל על "[N]" מתוך רשימת סגנונות המסמך.
      // העברה ל-DOM walker (renderer.js) ול-V9 flattener (nodesToTextRuns).
      styleId: styleIdForStreamNumber(streamCode, place),
    });
  }

  if (place === "note") {
    const bodyPrefix = noteTextPrefixForStream(streamCode);
    if (bodyPrefix) nodes.push({ kind: "prefix", text: bodyPrefix });
  }

  const leadingWs = raw.length - raw.replace(/^\s+/, "").length;
  const trimmed = raw.replace(/^\s+/, "");
  const trimmedRuns = sliceRuns(origRuns, leadingWs, leadingWs + trimmed.length);
  const spaceIdx = trimmed.indexOf(" ");
  const boldLemma = shouldBoldStreamLemma(streamCode);

  if (spaceIdx > 0) {
    const lemmaText = trimmed.substring(0, spaceIdx);
    const restText = trimmed.substring(spaceIdx);
    const lemmaRuns = sliceRuns(trimmedRuns, 0, spaceIdx);
    const restRuns = sliceRuns(trimmedRuns, spaceIdx, trimmed.length);
    nodes.push({ kind: "lemma", text: lemmaText, runs: lemmaRuns, bold: boldLemma });
    nodes.push({ kind: "rest", text: restText, runs: restRuns });
  } else if (trimmed.length > 0) {
    nodes.push({ kind: "body", text: trimmed, runs: trimmedRuns, bold: boldLemma });
  }

  if (place === "note") {
    const bodySuffix = noteTextSuffixForStream(streamCode);
    if (bodySuffix) nodes.push({ kind: "suffix", text: bodySuffix });
  }

  for (const child of Array.isArray(children) ? children : []) {
    const childNodes = buildNoteContentNodes(
      child.stream,
      child.num || 0,
      child.text || "",
      Array.isArray(child.runs) ? child.runs : [],
      {
        isCont: false,
        place: "child",
        leadingSpace: true,
        children: Array.isArray(child.children) ? child.children : [],
      }
    );
    nodes.push({ kind: "child", stream: child.stream, num: child.num, nodes: childNodes });
  }

  return nodes;
}

// משטח את עץ הצמתים לטקסט יחיד + runs. שימוש: V9 שדוחף לפלט שורות.
// runs מוחזרים עם אופסטים יחסיים לתוך הטקסט הסופי, וכוללים סימני "bold"
// עבור מספר ההערה ודיבור המתחיל אם הוגדרו מודגשים בהגדרות הזרם.
export function nodesToTextRuns(nodes) {
  let text = "";
  const runs = [];
  const appendNodes = (list) => {
    for (const n of list) {
      if (n.kind === "space") {
        text += " ";
        continue;
      }
      if (n.kind === "child") {
        appendNodes(n.nodes);
        continue;
      }
      const start = text.length;
      text += n.text || "";
      const end = text.length;
      if (Array.isArray(n.runs)) {
        for (const r of n.runs) {
          runs.push({ start: r.start + start, end: r.end + start, marks: r.marks });
        }
      }
      if (n.bold && end > start) {
        runs.push({ start, end, marks: { bold: true } });
      }
      // משה 2026-05-15: סגנון מותאם של המספר (mainRefStyleId / noteNumStyleId)
      // מתורגם ל-marks אינליין. ב-V9 זה גורם ל-span בצבע/פונט/גודל הנכונים.
      if (n.kind === "number" && n.styleId && end > start) {
        const marks = styleIdToMarks(n.styleId);
        if (marks) runs.push({ start, end, marks });
      }
    }
  };
  appendNodes(nodes);
  return { text, runs };
}

// מזריק סימני־ייחוס ("[N]") לטקסט הראשי של פסקה — במקומות העגנים של ההערות,
// אך ורק לזרמים שהפעילו "מספר בראשי" (mainRefEnabled). מחזיר אובייקט עם
// mainText חדש, mainRuns מותאמים, ו-notes עם anchor מוזז כך שכל הערה נשארת
// סמוכה לסימן־הייחוס שלה. שימוש: גם המנוע הרגיל וגם V9 קוראים לאותה פונקציה
// כדי לקבל החלטה אחידה אם להציג מספר בראשי ובאיזה סגנון.
//
// pieces:
//   mainText  — טקסט הפסקה בלי סימוני זרם (כפי שהוא ב-paneManagerToPackerContent)
//   mainRuns  — runs (בולד/הדגשה) מותאמים ל-mainText המקורי
//   notes     — [{ stream, num, anchor, text, runs, ... }]
export function injectMainRefs(mainText, mainRuns, notes) {
  const text = String(mainText || "");
  const origRuns = Array.isArray(mainRuns) ? mainRuns : [];
  const origNotes = Array.isArray(notes) ? notes : [];

  const refs = [];
  for (let i = 0; i < origNotes.length; i++) {
    const n = origNotes[i];
    if (!n || typeof n.anchor !== "number") continue;
    const s = getEffectiveStreamSettings(n.stream);
    if (!_streamBoolSetting(s.mainRefEnabled, false)) continue;
    const formatted = formatStreamNumber(n.stream, n.num || 0, "main");
    if (!formatted) continue;
    refs.push({
      noteIndex: i,
      anchor: Math.max(0, Math.min(text.length, n.anchor)),
      text: formatted,
      bold: shouldBoldStreamNumber(n.stream, "main"),
      // משה 2026-05-15: סגנון בחירה מתוך רשימת הסגנונות — מותרגם ל-marks
      // ומצטרף ל-mainRuns כך ש-V9 והמנוע הרגיל יציירו את "[N]" בצבע/פונט/גודל הנכון.
      styleId: styleIdForStreamNumber(n.stream, "main"),
    });
  }
  if (refs.length === 0) {
    return { mainText: text, mainRuns: origRuns, notes: origNotes };
  }
  refs.sort((a, b) => (a.anchor - b.anchor) || (a.noteIndex - b.noteIndex));

  // shiftAt(p): מחזיר את האופסט החדש של המיקום המקורי p אחרי שכל ה-refs
  // עם anchor <= p הוזרקו. מתחשב גם בסדר הזרקה — refs באותו anchor
  // מצטרפים לפי noteIndex (כדי שלכל הערה יהיה מקום ברור ביחס לאחרות).
  function shiftAt(p) {
    let shift = 0;
    for (const r of refs) {
      if (r.anchor < p) shift += r.text.length;
      else if (r.anchor === p) shift += r.text.length;
    }
    return p + shift;
  }

  let outText = "";
  const outRuns = [];
  let cursor = 0;
  for (const ref of refs) {
    const anchor = ref.anchor;
    if (anchor > cursor) outText += text.substring(cursor, anchor);
    const refStart = outText.length;
    outText += ref.text;
    const refEnd = outText.length;
    if (ref.bold) outRuns.push({ start: refStart, end: refEnd, marks: { bold: true } });
    if (ref.styleId) {
      const marks = styleIdToMarks(ref.styleId);
      if (marks) outRuns.push({ start: refStart, end: refEnd, marks });
    }
    cursor = anchor;
  }
  if (cursor < text.length) outText += text.substring(cursor);

  for (const r of origRuns) {
    const newStart = shiftAt(r.start);
    let newEnd = r.end + 0;
    let endShift = 0;
    for (const rr of refs) {
      if (rr.anchor < r.end) endShift += rr.text.length;
    }
    newEnd = r.end + endShift;
    if (newEnd > newStart) outRuns.push({ start: newStart, end: newEnd, marks: r.marks });
  }

  const newNotes = origNotes.map((n, i) => {
    if (!n || typeof n.anchor !== "number") return n;
    return { ...n, anchor: shiftAt(n.anchor) };
  });

  return { mainText: outText, mainRuns: outRuns, notes: newNotes };
}
