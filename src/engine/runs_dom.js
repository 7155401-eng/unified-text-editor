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

function isV9AnalyticLine(parent) {
  if (!parent || !parent.classList) return false;
  return parent.classList.contains("v9-line") ||
    parent.classList.contains("v9-role-main") ||
    parent.dataset?.v9Role === "main";
}

function stabilizeMarksForV9Line(parent, marks) {
  if (!isV9AnalyticLine(parent) || !marks || typeof marks !== "object") return marks;
  const out = { ...marks };
  delete out.fontSize;
  delete out.fontFamily;
  return out;
}

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

export function appendTextWithRuns(parent, text, runs) {
  const str = String(text || "");
  if (!str) return;
  const normalized = normalizeRuns(str, runs).map((r) => ({
    ...r,
    marks: stabilizeMarksForV9Line(parent, r.marks),
  }));
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
