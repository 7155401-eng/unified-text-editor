// runs_dom.js — utilities for rendering text + inline-runs to DOM.
// Used by both the regular renderer and V9 so per-word bold/highlight/color
// from the editor reaches the final preview at the exact character range.

export function applyMarksToSpan(span, marks) {
  if (!marks || typeof marks !== "object") return;
  if (marks.bold) span.style.fontWeight = "700";
  if (marks.italic) span.style.fontStyle = "italic";
  if (marks.underline) span.style.textDecoration = "underline";
  if (marks.strike) {
    const existing = span.style.textDecoration || "";
    span.style.textDecoration = existing
      ? existing + " line-through"
      : "line-through";
  }
  if (marks.color) span.style.color = marks.color;
  if (marks.backgroundColor) span.style.backgroundColor = marks.backgroundColor;
  if (marks.fontFamily) span.style.fontFamily = marks.fontFamily;
  if (marks.fontSize) {
    const n = Number(marks.fontSize);
    span.style.fontSize = Number.isFinite(n) ? `${n}px` : String(marks.fontSize);
  }
}

function hasMarks(marks) {
  if (!marks || typeof marks !== "object") return false;
  for (const _ in marks) return true;
  return false;
}

// מנקה רשימת runs: מיון לפי start, חיתוך לטווח הטקסט, מילוי "פערים" עם marks ריקים.
// מחזיר מערך רציף שמכסה את כל [0, text.length).
function normalizeRuns(text, runs) {
  const len = text ? text.length : 0;
  if (!len) return [];
  const list = Array.isArray(runs)
    ? runs
        .map(r => ({
          start: Math.max(0, Math.min(len, Number(r.start) || 0)),
          end: Math.max(0, Math.min(len, Number(r.end) || 0)),
          marks: r.marks || {},
        }))
        .filter(r => r.end > r.start)
        .sort((a, b) => a.start - b.start)
    : [];
  const out = [];
  let cursor = 0;
  for (const r of list) {
    if (r.start > cursor) out.push({ start: cursor, end: r.start, marks: {} });
    if (r.start < cursor) r.start = cursor;
    if (r.start >= r.end) continue;
    out.push({ start: r.start, end: r.end, marks: r.marks });
    cursor = r.end;
  }
  if (cursor < len) out.push({ start: cursor, end: len, marks: {} });
  return out;
}

// מוסיף לתוך parent את הטקסט הנתון, מחולק ל-spans לפי runs. שומר על marks
// כפי שהם בעורך. אם אין runs בכלל — מוסיף טקסט אחד.
export function appendTextWithRuns(parent, text, runs) {
  const str = String(text || "");
  if (!str) return;
  const normalized = normalizeRuns(str, runs);
  if (normalized.length === 0 || !normalized.some(r => hasMarks(r.marks))) {
    parent.appendChild(document.createTextNode(str));
    return;
  }
  for (const r of normalized) {
    const slice = str.slice(r.start, r.end);
    if (!slice) continue;
    if (hasMarks(r.marks)) {
      const span = document.createElement("span");
      applyMarksToSpan(span, r.marks);
      span.textContent = slice;
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode(slice));
    }
  }
}

// חותך runs ל-slice [start, end) ומחזיר runs עם אופסטים יחסיים לטווח החדש.
// שימושי כשמחלקים טקסט-מקור לחלקים (e.g., prefix/segment/suffix במילת פתיח,
// או שורה ב-V9).
export function sliceRuns(runs, start, end) {
  if (!Array.isArray(runs)) return [];
  const out = [];
  for (const r of runs) {
    if (r.end <= start || r.start >= end) continue;
    out.push({
      start: Math.max(0, r.start - start),
      end: Math.min(end - start, r.end - start),
      marks: r.marks,
    });
  }
  return out;
}
