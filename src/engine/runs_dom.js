// runs_dom.js — utilities for rendering text + inline-runs to DOM.
// Used by both the regular renderer and V9 so per-word bold/highlight/color
// from the editor reaches the final preview at the exact character range.

function fontSizeToCss(value, unit = "px") {
  if (value === undefined || value === null || value === "") return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i.test(raw)) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  const u = String(unit || "px").trim().toLowerCase();
  return `${n}${u === "pt" ? "pt" : "px"}`;
}

function appendTextDecoration(span, value) {
  const v = String(value || "").trim();
  if (!v) return;
  const existing = span.style.textDecoration || "";
  span.style.textDecoration = existing ? `${existing} ${v}` : v;
}

function hasExplicitFontSize(marks) {
  return marks && marks.fontSize !== undefined && marks.fontSize !== null && marks.fontSize !== "";
}

export function applyMarksToSpan(span, marks) {
  if (!marks || typeof marks !== "object") return;
  if (marks.bold) span.style.fontWeight = "700";
  if (marks.fontWeight) span.style.fontWeight = String(marks.fontWeight);
  if (marks.italic) span.style.fontStyle = "italic";
  if (marks.fontStyle) span.style.fontStyle = String(marks.fontStyle);
  if (marks.underline) appendTextDecoration(span, "underline");
  if (marks.strike) appendTextDecoration(span, "line-through");
  if (marks.textDecoration) appendTextDecoration(span, marks.textDecoration);
  if (marks.color) span.style.color = marks.color;
  if (marks.backgroundColor || marks.bgColor) span.style.backgroundColor = marks.backgroundColor || marks.bgColor;
  if (marks.fontFamily) span.style.fontFamily = marks.fontFamily;
  if (hasExplicitFontSize(marks)) {
    const css = fontSizeToCss(marks.fontSize, marks.fontSizeUnit);
    if (css) span.style.fontSize = css;
  }
  if (marks.lineHeight !== undefined && marks.lineHeight !== null && marks.lineHeight !== "") {
    span.style.lineHeight = String(marks.lineHeight);
  }

  const verticalAlign = marks.verticalAlign || (marks.superscript ? "super" : (marks.subscript ? "sub" : ""));
  if (verticalAlign) {
    span.style.verticalAlign = verticalAlign;
    // Word/TipTap superscript and subscript are character-level styles. If the
    // user did not specify a size in the selected style, render them like normal
    // typographic super/subscript instead of keeping full-size glyphs floating.
    if (!hasExplicitFontSize(marks)) span.style.fontSize = "0.75em";
  }
}

function hasMarks(marks) {
  if (!marks || typeof marks !== "object") return false;
  for (const _ in marks) return true;
  return false;
}

function sameMarks(a, b) {
  const ak = Object.keys(a || {}).sort();
  const bk = Object.keys(b || {}).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (a[ak[i]] !== b[bk[i]]) return false;
  }
  return true;
}

function mergeAdjacentRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    if (!r || r.end <= r.start) continue;
    const prev = out[out.length - 1];
    if (prev && prev.end === r.start && sameMarks(prev.marks, r.marks)) {
      prev.end = r.end;
    } else {
      out.push({ start: r.start, end: r.end, marks: r.marks || {} });
    }
  }
  return out;
}

function cleanRun(r, len) {
  const start = Math.max(0, Math.min(len, Number(r?.start) || 0));
  const end = Math.max(0, Math.min(len, Number(r?.end) || 0));
  if (end <= start) return null;
  return { start, end, marks: r?.marks || {} };
}

// מנקה רשימת runs בצורה יציבה: במקום לתת ל-run אחד לדרוס run חופף לפי סדר
// מקרי, חותכים את הטקסט לפי כל נקודות הגבול וממזגים את כל ה-marks החופפים.
// זה מונע קפיצות של bold/color באמצע מילה כאשר קיימים כמה marks באותו טווח.
function normalizeRuns(text, runs) {
  const len = text ? text.length : 0;
  if (!len) return [];
  const list = Array.isArray(runs)
    ? runs.map((r) => cleanRun(r, len)).filter(Boolean)
    : [];
  if (list.length === 0) return [{ start: 0, end: len, marks: {} }];

  const points = new Set([0, len]);
  for (const r of list) {
    points.add(r.start);
    points.add(r.end);
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const marks = {};
    for (const r of list) {
      if (r.start <= start && r.end >= end) {
        Object.assign(marks, r.marks || {});
      }
    }
    out.push({ start, end, marks });
  }
  return mergeAdjacentRuns(out);
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
    const sliced = {
      start: Math.max(0, r.start - start),
      end: Math.min(end - start, r.end - start),
      marks: r.marks,
    };
    if (sliced.end > sliced.start) out.push(sliced);
  }
  return mergeAdjacentRuns(out);
}
