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
} from "../original_stream_columns.js";
import { sliceRuns } from "./runs_dom.js";

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
    }
  };
  appendNodes(nodes);
  return { text, runs };
}
