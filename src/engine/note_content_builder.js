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
  boldOverrideStyleIdForStream,
  _streamBoolSetting,
} from "../original_stream_columns.js";
import { sliceRuns } from "./runs_dom.js";
import { resolveTextStyle, normalizeTextStyle } from "../style_registry.js";

// משה 2026-05-19: ממיר styleId ל-marks מלאים ככל האפשר עבור inline-runs.
// הסיבה: V9 אינו יוצר DOM element עצמאי למספרי ההפניה בראשי; הוא מזריק אותם
// לתוך mainRuns. לכן אסור לצמצם את הסגנון רק לצבע/פונט/בולד, אחרת כתב
// עילי/תחתי, יחידות pt ו-line-height נעלמים לפני PDF.JS.
function styleIdToMarks(styleId) {
  if (!styleId) return null;
  const raw = resolveTextStyle(styleId);
  if (!raw) return null;
  const s = normalizeTextStyle(raw);
  if (!s) return null;
  const marks = {};

  if (s.bold) marks.bold = true;
  if (s.fontWeight) marks.fontWeight = s.fontWeight;
  if (s.italic) marks.italic = true;
  if (s.fontStyle) marks.fontStyle = s.fontStyle;
  if (s.underline) marks.underline = true;
  if (s.strike) marks.strike = true;
  if (s.textDecoration) marks.textDecoration = s.textDecoration;

  if (s.color) marks.color = s.color;
  if (s.bgColor || s.backgroundColor) marks.backgroundColor = s.bgColor || s.backgroundColor;
  if (s.fontFamily) marks.fontFamily = s.fontFamily;
  if (s.fontSize) marks.fontSize = s.fontSize;
  if (s.fontSizeUnit) marks.fontSizeUnit = s.fontSizeUnit;
  if (s.lineHeight) marks.lineHeight = s.lineHeight;

  if (s.superscript || s.superScript || s.sup) {
    marks.superscript = true;
    marks.verticalAlign = "super";
  } else if (s.subscript || s.subScript || s.sub) {
    marks.subscript = true;
    marks.verticalAlign = "sub";
  } else if (s.verticalAlign) {
    marks.verticalAlign = s.verticalAlign;
  }

  return Object.keys(marks).length > 0 ? marks : null;
}

// משה 2026-05-15: כאשר זרם הוגדר עם "סגנון מותאם לבולד", כל סימן bold:true
// ב-runs מוחלף ב-marks של הסגנון הנבחר. בעלי-marks נוספים בריצה (כמו color
// שצויר ידנית) נשמרים — רק "bold" מתחלף בסגנון. מחזיר עותק; לא מזיק לקלט.
function applyBoldOverrideToRuns(runs, overrideMarks) {
  if (!Array.isArray(runs) || !overrideMarks) return runs;
  let touched = false;
  const out = runs.map((r) => {
    if (!r || !r.marks || !r.marks.bold) return r;
    touched = true;
    const newMarks = { ...r.marks };
    delete newMarks.bold;
    for (const k of Object.keys(overrideMarks)) {
      if (newMarks[k] == null) newMarks[k] = overrideMarks[k];
    }
    return { start: r.start, end: r.end, marks: newMarks };
  });
  return touched ? out : runs;
}

export function buildNoteContentNodes(streamCode, num, text, runs, opts = {}) {
  const {
    isCont = false,
    place = "note",
    leadingSpace = false,
    children = [],
  } = opts;

  const nodes = [];
  // משה 2026-05-15: דריסת בולד (אופציונלית, פר-זרם) — אם המשתמש סימן
  // boldOverrideEnabled ובחר סגנון, כל הופעת בולד תוחלף ב-marks של הסגנון.
  const boldOverrideMarks = styleIdToMarks(boldOverrideStyleIdForStream(streamCode));
  const origRuns = applyBoldOverrideToRuns(Array.isArray(runs) ? runs : [], boldOverrideMarks);
  const raw = String(text || "");

  if (leadingSpace) nodes.push({ kind: "space" });

  if (isCont) {
    nodes.push({ kind: "cont", text: raw, runs: origRuns });
    return nodes;
  }

  const formatted = formatStreamNumber(streamCode, num, place);
  if (formatted) {
    const numBold = shouldBoldStreamNumber(streamCode, place);
    nodes.push({
      kind: "number",
      text: formatted + " ",
      // כשיש סגנון מותאם לבולד, ה"בולד" של [N] מתבטא דרך המארקים האלה
      // במקום font-weight:700, כדי שהמספר יקבל גם הוא את הסגנון המוגדר.
      bold: numBold && !boldOverrideMarks,
      boldOverrideMarks: numBold && boldOverrideMarks ? boldOverrideMarks : null,
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
  const boldLemmaRaw = shouldBoldStreamLemma(streamCode);
  const boldLemma = boldLemmaRaw && !boldOverrideMarks;
  const lemmaOverride = boldLemmaRaw && boldOverrideMarks ? boldOverrideMarks : null;

  if (spaceIdx > 0) {
    const lemmaText = trimmed.substring(0, spaceIdx);
    const restText = trimmed.substring(spaceIdx);
    const lemmaRuns = sliceRuns(trimmedRuns, 0, spaceIdx);
    const restRuns = sliceRuns(trimmedRuns, spaceIdx, trimmed.length);
    nodes.push({ kind: "lemma", text: lemmaText, runs: lemmaRuns, bold: boldLemma, boldOverrideMarks: lemmaOverride });
    nodes.push({ kind: "rest", text: restText, runs: restRuns });
  } else if (trimmed.length > 0) {
    nodes.push({ kind: "body", text: trimmed, runs: trimmedRuns, bold: boldLemma, boldOverrideMarks: lemmaOverride });
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
      // משה 2026-05-15: אם הזרם הגדיר "סגנון מותאם לבולד", הצומת נושא marks
      // מוכנים — מזריקים אותם כריצה ב-V9 (במקום bold:true).
      if (n.boldOverrideMarks && end > start) {
        runs.push({ start, end, marks: n.boldOverrideMarks });
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
    const rawBold = shouldBoldStreamNumber(n.stream, "main");
    const overrideMarks = styleIdToMarks(boldOverrideStyleIdForStream(n.stream));
    refs.push({
      noteIndex: i,
      anchor: Math.max(0, Math.min(text.length, n.anchor)),
      text: formatted,
      // משה 2026-05-15: כשבזרם הוגדר "סגנון מותאם לבולד", גם ה-[N] בראשי
      // מאמץ את הסגנון במקום font-weight:700.
      bold: rawBold && !overrideMarks,
      boldOverrideMarks: rawBold && overrideMarks ? overrideMarks : null,
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
    if (ref.boldOverrideMarks) {
      outRuns.push({ start: refStart, end: refEnd, marks: ref.boldOverrideMarks });
    }
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
