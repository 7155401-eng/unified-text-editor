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
  if (marks.v9NoteKey) span.dataset.v9NoteKey = marks.v9NoteKey;
  if (marks.v9NoteStart) span.dataset.v9NoteStart = marks.v9NoteStart;
  if (marks.bold) span.style.fontWeight = "700";
  if (marks.fontWeight) span.style.fontWeight = String(marks.fontWeight);
  if (marks.italic) span.style.fontStyle = "italic";
  if (marks.fontStyle) span.style.fontStyle = String(marks.fontStyle);
  if (marks.underline) appendTextDecoration(span, "underline");
  if (marks.strike) appendTextDecoration(span, "line-through");
  if (marks.textDecoration) appendTextDecoration(span, marks.textDecoration);
  if (marks.code) {
    span.classList.add("rt-inline-code");
    span.style.fontFamily = '"Consolas", "Menlo", "Monaco", monospace';
    span.style.fontSize = "0.92em";
    span.style.direction = "ltr";
    span.style.unicodeBidi = "isolate";
  }
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

  if (marks.fontFeatureSettings) span.style.fontFeatureSettings = String(marks.fontFeatureSettings);
  if (marks.fontVariant) span.style.fontVariant = String(marks.fontVariant);
  if (marks.fontKerning) span.style.fontKerning = String(marks.fontKerning);

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

const COMBINING_MARK_RE = /\p{M}/u;
function isCombiningMarkAt(text, index) {
  if (index < 0 || index >= text.length) return false;
  return COMBINING_MARK_RE.test(String.fromCodePoint(text.codePointAt(index)));
}

function previousCodePointStart(text, index) {
  const previous = index - 1;
  const unit = text.charCodeAt(previous);
  const before = text.charCodeAt(previous - 1);
  return previous > 0 && unit >= 0xDC00 && unit <= 0xDFFF && before >= 0xD800 && before <= 0xDBFF
    ? previous - 1 : previous;
}

function cleanRun(r, text) {
  const len = text.length;
  let start = Math.max(0, Math.min(len, Number(r?.start) || 0));
  let end = Math.max(0, Math.min(len, Number(r?.end) || 0));
  // Reject empty/reversed ranges BEFORE expansion. A cursor inside a marked
  // letter is not a request to format the whole letter.
  if (end <= start) return null;

  // Preserve the base and its combining marks in one font/shaping run. This
  // lets the selected font place marks beside descenders using its own anchors;
  // no source characters, vertical offsets or font substitutions are introduced.
  while (start > 0 && isCombiningMarkAt(text, start)) start = previousCodePointStart(text, start);
  while (end < len && isCombiningMarkAt(text, end)) end += String.fromCodePoint(text.codePointAt(end)).length;
  return { start, end, marks: r?.marks || {} };
}

// מנקה רשימת runs בצורה יציבה: במקום לתת ל-run אחד לדרוס run חופף לפי סדר
// מקרי, חותכים את הטקסט לפי כל נקודות הגבול וממזגים את כל ה-marks החופפים.
// זה מונע קפיצות של bold/color באמצע מילה כאשר קיימים כמה marks באותו טווח.
function normalizeRuns(text, runs) {
  const len = text ? text.length : 0;
  if (!len) return [];
  const list = Array.isArray(runs)
    ? runs.map((r) => cleanRun(r, text)).filter(Boolean)
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

// A smaller styled run must not inherit the full pixel leading of a larger
// parent: equal pixel line boxes with different baselines can enlarge the row.
// This hint is supplied only by the measured V9 path, equally for measure/paint.
// Explicit run leading and raised/lowered text remain authoritative. Real glyph
// extents are still measured by V9; this is not a fixed-height or clipping rule.
function applyInheritedInlineLeading(span, typography) {
  if (!typography || span.style.lineHeight || span.style.verticalAlign) return;
  const parentSize = String(typography.fontSize || '').trim();
  const parentLeading = String(typography.lineHeight || '').trim();
  if (!/^\d+(?:\.\d+)?px$/.test(parentSize) || !/^\d+(?:\.\d+)?px$/.test(parentLeading)) return;
  const base = parseFloat(parentSize), leading = parseFloat(parentLeading);
  if (!(base > 0 && leading > 0)) return;
  const size = String(span.style.fontSize || '').trim();
  const match = size.match(/^(\d+(?:\.\d+)?)(px|pt|em|%)$/);
  if (!match) return;
  const amount = Number(match[1]);
  const px = match[2] === 'em' ? amount * base : match[2] === '%' ? amount * base / 100
    : match[2] === 'pt' ? amount * 4 / 3 : amount;
  if (px > 0 && px < base) span.style.lineHeight = String(leading / base);
}

// מוסיף לתוך parent את הטקסט הנתון, מחולק ל-spans לפי runs. שומר על marks
// כפי שהם בעורך. אם אין runs בכלל — מוסיף טקסט אחד.
export function appendTextWithRuns(parent, text, runs, inheritedTypography = null) {
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
      applyInheritedInlineLeading(span, inheritedTypography);
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
