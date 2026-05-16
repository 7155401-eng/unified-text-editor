import { sliceRuns } from "./runs_dom.js";

export function makeRichText(text, runs = []) {
  return {
    text: String(text || ""),
    runs: Array.isArray(runs) ? runs.filter(r => r && r.end > r.start) : [],
  };
}

export function normalizeRichTextEntry(entry) {
  if (!entry) return makeRichText("");
  if (typeof entry === "string") return makeRichText(entry, []);
  return makeRichText(entry.text || "", entry.runs || []);
}

export function richTextToString(entry) {
  return normalizeRichTextEntry(entry).text;
}

export function sliceRichText(entry, start, end) {
  const rt = normalizeRichTextEntry(entry);
  const len = rt.text.length;
  const s = Math.max(0, Math.min(len, Number(start) || 0));
  const e = Math.max(0, Math.min(len, Number(end) || 0));
  if (e <= s) return makeRichText("");
  return makeRichText(rt.text.substring(s, e), sliceRuns(rt.runs, s, e));
}

export function trimStartRichText(entry) {
  const rt = normalizeRichTextEntry(entry);
  const leading = rt.text.length - rt.text.replace(/^\s+/, "").length;
  return sliceRichText(rt, leading, rt.text.length);
}

export function trimEndRichText(entry) {
  const rt = normalizeRichTextEntry(entry);
  const trimmedLen = rt.text.replace(/\s+$/, "").length;
  return sliceRichText(rt, 0, trimmedLen);
}

export function trimRichText(entry) {
  return trimEndRichText(trimStartRichText(entry));
}

export function concatRichTextParts(parts, separator = " ") {
  let text = "";
  const runs = [];

  for (const raw of parts || []) {
    const part = normalizeRichTextEntry(raw);
    if (!part.text) continue;

    if (text.length > 0 && separator) {
      text += separator;
    }

    const offset = text.length;
    text += part.text;

    for (const r of part.runs || []) {
      if (!r || r.end <= r.start) continue;
      runs.push({
        start: offset + r.start,
        end: offset + r.end,
        marks: r.marks || {},
      });
    }
  }

  return makeRichText(text, runs);
}

export function appendRichTextPart(base, part, separator = " ") {
  return concatRichTextParts(
    [normalizeRichTextEntry(base), normalizeRichTextEntry(part)],
    separator
  );
}
