import fs from 'node:fs';

const file = 'src/engine_bridge.js';
let src = fs.readFileSync(file, 'utf8');

const marker = 'function applyFirstNoteAsTitle(code, notes) {';
const start = src.indexOf(marker);
if (start === -1) {
  console.log('[stream-title-note-guard] applyFirstNoteAsTitle not found; skipping');
  process.exit(0);
}

const nextMarker = '\n\nfunction ensureEngineStreamSettings';
const end = src.indexOf(nextMarker, start);
if (end === -1) {
  console.log('[stream-title-note-guard] function boundary not found; skipping');
  process.exit(0);
}

const replacement = `function normalizeStreamTitleNoteText(value) {
  return String(value || "")
    .replace(/^\\s*\\[[^\\]]+\\]\\s*/, "")
    .replace(/[\\u200e\\u200f\\u202a-\\u202e]/g, "")
    .replace(/\\s+/g, " ")
    .trim();
}

function isDuplicateStreamTitleNote(noteText, title) {
  const a = normalizeStreamTitleNoteText(noteText);
  const b = normalizeStreamTitleNoteText(title);
  return !!a && !!b && a === b;
}

function applyFirstNoteAsTitle(code, notes) {
  const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
  const streamSettings = getEffectiveStreamSettings(code);
  const manualTitle = String(streamSettings.title || "").trim();
  const first = notes && notes.length ? String(notes[0] || "") : "";
  const existingTitle = manualTitle || labels[code] || defaultLabelForCode(code);

  // 2026-05-19: אם ההערה הראשונה היא טקסט זהה לכותרת הזרם, אל תספור אותה
  // כהערה ואל תקשור אותה לעוגן הראשון בראשי. אחרת V9/regular משייכים את
  // הכותרת למיקום ההפניה הראשון, וכל המספור שאחריה נראה מוזז.
  const duplicateTitleNote = isDuplicateStreamTitleNote(first, existingTitle);

  if (manualTitle) {
    labels[code] = manualTitle;
    return duplicateTitleNote ? notes.slice(1) : notes;
  }

  if (!streamSettings.firstNoteAsTitle && !duplicateTitleNote) return notes;

  const title = duplicateTitleNote ? existingTitle : stripDisplayNum(first || "");
  if (title) labels[code] = title;
  return notes.slice(1);
}`;

const before = src.slice(0, start);
const after = src.slice(end);
const next = before + replacement + after;

if (next === src) {
  console.log('[stream-title-note-guard] already up to date');
} else {
  fs.writeFileSync(file, next);
  console.log('[stream-title-note-guard] patched applyFirstNoteAsTitle');
}
