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

const OPTICAL_LOWER_NIQQUD_RE = /^[\u05B0-\u05B8\u05BB\u05C7]+$/u;
const OPTICAL_NIQQUD_PROFILES = Object.freeze({
  // Long right descender: tuck the lower mark into the free left-side pocket.
  "\u05DA": Object.freeze({ base: "\u05DA", xPercent: 27, raiseEm: 0.44 }),
  // Long left descender: move the lower mark into the free right-side pocket.
  "\u05E7": Object.freeze({ base: "\u05E7", xPercent: 73, raiseEm: 0.34 }),
});

const OPTICAL_REFERENCE_MARKS = Object.freeze(["\u05B7", "\u05B8"]); // patah, qamats
const OPTICAL_MARK_ADJUST_LIMIT_EM = 0.18;
const opticalMarkMetricCache = new Map();
let opticalMetricCanvasContext = null;

function cssFontSizePx(value, fallback = 16) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const m = raw.match(/^(-?\d+(?:\.\d+)?)(px|pt)?$/i);
  if (!m) return fallback;
  const amount = Number(m[1]);
  if (!(amount > 0)) return fallback;
  return String(m[2] || "px").toLowerCase() === "pt" ? amount * 4 / 3 : amount;
}

function opticalTypography(parent, inheritedTypography, styleElement = null) {
  let computed = null;
  try {
    if (parent?.isConnected && parent.ownerDocument?.defaultView?.getComputedStyle) {
      computed = parent.ownerDocument.defaultView.getComputedStyle(parent);
    }
  } catch {}
  const style = styleElement?.style || {};
  const fontSize = style.fontSize || inheritedTypography?.fontSize || computed?.fontSize || "16px";
  return {
    fontSizePx: cssFontSizePx(fontSize, 16),
    fontFamily: style.fontFamily || inheritedTypography?.fontFamily || computed?.fontFamily || "serif",
    fontWeight: style.fontWeight || inheritedTypography?.fontWeight || computed?.fontWeight || "400",
    fontStyle: style.fontStyle || inheritedTypography?.fontStyle || computed?.fontStyle || "normal",
  };
}

function opticalCanvasContext() {
  if (opticalMetricCanvasContext) return opticalMetricCanvasContext;
  try {
    const canvas = document.createElement("canvas");
    opticalMetricCanvasContext = canvas.getContext("2d");
  } catch {
    opticalMetricCanvasContext = null;
  }
  return opticalMetricCanvasContext;
}

function opticalMarkInkCenterPx(markText, typography) {
  const ctx = opticalCanvasContext();
  if (!ctx || !(typography?.fontSizePx > 0)) return null;
  const font = `${typography.fontStyle || "normal"} ${typography.fontWeight || "400"} ${typography.fontSizePx}px ${typography.fontFamily || "serif"}`;
  const key = `${font}\u0000${markText}`;
  if (opticalMarkMetricCache.has(key)) return opticalMarkMetricCache.get(key);
  let center = null;
  try {
    ctx.font = font;
    const metric = ctx.measureText(markText);
    const ascent = Number(metric.actualBoundingBoxAscent);
    const descent = Number(metric.actualBoundingBoxDescent);
    if (Number.isFinite(ascent) && Number.isFinite(descent) && (ascent > 0 || descent > 0)) {
      // Canvas y grows downward: negative ascent is above the baseline.
      center = (descent - ascent) / 2;
    }
  } catch {}
  opticalMarkMetricCache.set(key, center);
  return center;
}

export function opticalNiqqudUniformAdjustmentEm(markText, typography) {
  const mark = String(markText || "");
  if (!mark || !(typography?.fontSizePx > 0)) return 0;
  const current = opticalMarkInkCenterPx(mark, typography);
  const refs = OPTICAL_REFERENCE_MARKS
    .map(ref => opticalMarkInkCenterPx(ref, typography))
    .filter(Number.isFinite);
  if (!Number.isFinite(current) || refs.length !== OPTICAL_REFERENCE_MARKS.length) return 0;
  const commonCenter = refs.reduce((sum, value) => sum + value, 0) / refs.length;
  const delta = (commonCenter - current) / typography.fontSizePx;
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-OPTICAL_MARK_ADJUST_LIMIT_EM, Math.min(OPTICAL_MARK_ADJUST_LIMIT_EM, delta));
}


export function opticalNiqqudProfileForCluster(cluster) {
  const text = String(cluster || "");
  if (!text) return null;
  const base = String.fromCodePoint(text.codePointAt(0));
  const profile = OPTICAL_NIQQUD_PROFILES[base];
  if (!profile) return null;
  const rest = text.slice(base.length);
  if (!rest || !OPTICAL_LOWER_NIQQUD_RE.test(rest)) return null;
  return profile;
}

function appendOpticalNiqqudCluster(parent, cluster, profile, inheritedTypography = null, styleElement = null) {
  const base = profile.base;
  const marks = cluster.slice(base.length);
  const wrapper = document.createElement("span");
  wrapper.className = "rt-optical-niqqud";
  wrapper.dataset.opticalNiqqudBase = base;
  wrapper.dataset.opticalNiqqudX = String(profile.xPercent);
  wrapper.dataset.opticalNiqqudRaiseEm = String(profile.raiseEm);
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.verticalAlign = "baseline";
  wrapper.style.whiteSpace = "pre";

  // Keep source text exact in DOM order and make the base independently
  // inspectable in visual acceptance tests.
  const baseSpan = document.createElement("span");
  baseSpan.className = "rt-optical-niqqud-base";
  baseSpan.textContent = base;
  wrapper.appendChild(baseSpan);

  const mark = document.createElement("span");
  mark.className = "rt-optical-niqqud-mark";
  mark.textContent = marks;
  mark.style.position = "absolute";
  mark.style.display = "inline-block";
  mark.style.pointerEvents = "none";
  mark.style.whiteSpace = "pre";
  mark.style.lineHeight = "1";
  mark.style.width = "1em";
  mark.style.textAlign = "center";
  mark.style.left = `${profile.xPercent}%`;
  mark.style.bottom = `${profile.raiseEm}em`;

  // One visual target per base letter. Different raw offsets here are only
  // compensation for the font glyph's own internal vertical origin; patah,
  // qamats and the other lower marks converge on the SAME target center.
  const typography = opticalTypography(parent, inheritedTypography, styleElement);
  const normalizeEm = opticalNiqqudUniformAdjustmentEm(marks, typography);
  wrapper.dataset.opticalNiqqudNormalizeEm = String(normalizeEm);
  mark.style.transform = normalizeEm
    ? `translate(-50%, ${normalizeEm}em)`
    : "translateX(-50%)";
  wrapper.appendChild(mark);
  parent.appendChild(wrapper);
}

function appendTextWithOpticalNiqqud(parent, text, inheritedTypography = null, styleElement = null) {
  const str = String(text || "");
  if (!str) return;
  let emitted = 0;
  for (let i = 0; i < str.length;) {
    const base = String.fromCodePoint(str.codePointAt(i));
    const profile = OPTICAL_NIQQUD_PROFILES[base];
    if (!profile) { i += base.length; continue; }
    let end = i + base.length;
    while (end < str.length && isCombiningMarkAt(str, end)) {
      end += String.fromCodePoint(str.codePointAt(end)).length;
    }
    const cluster = str.slice(i, end);
    const clusterProfile = opticalNiqqudProfileForCluster(cluster);
    if (!clusterProfile) { i = end; continue; }
    if (i > emitted) parent.appendChild(document.createTextNode(str.slice(emitted, i)));
    appendOpticalNiqqudCluster(parent, cluster, clusterProfile, inheritedTypography, styleElement);
    emitted = end;
    i = end;
  }
  if (emitted < str.length) parent.appendChild(document.createTextNode(str.slice(emitted)));
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
    appendTextWithOpticalNiqqud(parent, str, inheritedTypography, parent);
    return;
  }
  for (const r of normalized) {
    const slice = str.slice(r.start, r.end);
    if (!slice) continue;
    if (hasMarks(r.marks)) {
      const span = document.createElement("span");
      applyMarksToSpan(span, r.marks);
      applyInheritedInlineLeading(span, inheritedTypography);
      appendTextWithOpticalNiqqud(span, slice, inheritedTypography, span);
      parent.appendChild(span);
    } else {
      appendTextWithOpticalNiqqud(parent, slice, inheritedTypography, parent);
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
