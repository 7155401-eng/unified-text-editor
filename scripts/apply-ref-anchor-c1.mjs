#!/usr/bin/env node
// Applies Stage C1 of the ref-anchor identity work to src/engine/dom_packer.js.
//
// Stage C1 goal:
// - Preserve current pagination behavior.
// - Keep note.anchor local exactly where the current packer expects it.
// - Add explicit note metadata so renderer/debug output can see:
//   absoluteAnchor, localAnchor, uid, stream, num.
//
// This script is intentionally conservative: it replaces exact known snippets
// and exits without writing if the file no longer matches the expected shape.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const target = path.join(repoRoot, 'src', 'engine', 'dom_packer.js');

function fail(message) {
  console.error(`\n[ref-anchor-c1] ${message}`);
  process.exit(1);
}

let src = fs.readFileSync(target, 'utf8');
const original = src;

if (src.includes('function noteAbsoluteAnchor(note)')) {
  console.log('[ref-anchor-c1] note metadata helpers already exist; no changes needed.');
  process.exit(0);
}

const oldAddNotesToStreams = `function addNotesToStreams(streams, paraIdx, notes) {
  const out = cloneStreams(streams);
  for (const note of notes) {
    if (!out[note.stream]) out[note.stream] = [];
    const anchor = typeof note.anchor === "number" ? note.anchor : 0;
    const num = typeof note.num === "number" ? note.num : 0;
    const cont = note.isContinuation ? 1 : 0;
    // tup[5] = children (nested notes — "הערה על הערה"). Empty array for
    // legacy mark-form notes and for continuation halves of split notes.
    const children = Array.isArray(note.children) ? note.children : [];
    // משה 2026-05-13: tup[6] = runs (inline marks) — בולד/הדגשה/צבע פר-מילה.
    const runs = Array.isArray(note.runs) ? note.runs : [];
    out[note.stream].push([paraIdx, note.text, anchor, num, cont, children, runs]);
  }
  return out;
}
`;

const newAddNotesToStreams = `function noteAbsoluteAnchor(note) {
  if (typeof note?.absoluteAnchor === "number") return note.absoluteAnchor;
  if (typeof note?.anchor === "number") return note.anchor;
  return 0;
}

function noteLocalAnchor(note, fallbackAnchor = 0) {
  if (typeof note?.localAnchor === "number") return note.localAnchor;
  if (typeof note?.anchor === "number") return note.anchor;
  return fallbackAnchor;
}

function noteUid(note, paraIdx, num, absoluteAnchor) {
  if (note?.uid) return String(note.uid);
  return String(note?.stream || "") + ":" + String(num || 0) + ":" + String(paraIdx) + ":" + String(absoluteAnchor || 0);
}

function noteTupleMeta(note, paraIdx, num, anchor) {
  const absoluteAnchor = noteAbsoluteAnchor(note);
  const localAnchor = noteLocalAnchor(note, anchor);
  return {
    stream: note?.stream || "",
    num,
    uid: noteUid(note, paraIdx, num, absoluteAnchor),
    // Keep the current tuple anchor as-is for backward compatibility.
    anchor,
    // Preserve the original paragraph coordinate for exact identity/debugging.
    absoluteAnchor,
    // Preserve the current split-segment coordinate for future cleanup.
    localAnchor,
  };
}

function addNotesToStreams(streams, paraIdx, notes) {
  const out = cloneStreams(streams);
  for (const note of notes) {
    if (!out[note.stream]) out[note.stream] = [];
    const anchor = typeof note.anchor === "number" ? note.anchor : 0;
    const num = typeof note.num === "number" ? note.num : 0;
    const cont = note.isContinuation ? 1 : 0;
    // tup[5] = children (nested notes — "הערה על הערה"). Empty array for
    // legacy mark-form notes and for continuation halves of split notes.
    const children = Array.isArray(note.children) ? note.children : [];
    // משה 2026-05-13: tup[6] = runs (inline marks) — בולד/הדגשה/צבע פר-מילה.
    const runs = Array.isArray(note.runs) ? note.runs : [];
    // tup[7] = identity metadata. Stage C1 intentionally leaves tup[2]
    // unchanged so pagination behavior stays identical, while renderer/debug
    // can still read absoluteAnchor/localAnchor without guessing from [N].
    const meta = noteTupleMeta(note, paraIdx, num, anchor);
    out[note.stream].push([paraIdx, note.text, anchor, num, cont, children, runs, meta]);
  }
  return out;
}
`;

if (!src.includes(oldAddNotesToStreams)) {
  fail('Could not find the expected addNotesToStreams block. Aborting without writing.');
}
src = src.replace(oldAddNotesToStreams, newAddNotesToStreams);

const oldRemainingNotes = `      const remainingNotes = para.notes
        .filter((n) => n.anchor >= prefix)
        .map((n) => ({ ...n, anchor: n.anchor - prefix }))
        .flatMap(preSplitLongNote);
`;

const newRemainingNotes = `      const remainingNotes = para.notes
        .filter((n) => noteAbsoluteAnchor(n) >= prefix)
        .map((n) => {
          const absoluteAnchor = noteAbsoluteAnchor(n);
          const localAnchor = absoluteAnchor - prefix;
          return {
            ...n,
            absoluteAnchor,
            localAnchor,
            // Keep existing forward-packer semantics: downstream fit/clamp
            // code still reads note.anchor as a local offset for this segment.
            anchor: localAnchor,
          };
        })
        .flatMap(preSplitLongNote);
`;

if (!src.includes(oldRemainingNotes)) {
  fail('Could not find the expected remainingNotes conversion block. Aborting without writing.');
}
src = src.replace(oldRemainingNotes, newRemainingNotes);

if (src === original) {
  fail('No changes were produced.');
}

fs.writeFileSync(target, src, 'utf8');
console.log('[ref-anchor-c1] Applied Stage C1 metadata preservation to src/engine/dom_packer.js');
console.log('[ref-anchor-c1] Next: review the diff, run a render, then run RavTextAuditRefIdentity().');
