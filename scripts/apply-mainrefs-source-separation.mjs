#!/usr/bin/env node
// Applies source-based main reference separation.
//
// Goal:
// - Main-text reference markers come from the original main-body consumers.
// - Apparatus note tuples can still be split/moved/rebalanced without creating
//   duplicate/missing main refs.
// - Legacy fallback remains for older page data without mainRefs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`\n[mainrefs] ${message}`);
  process.exit(1);
}

function replaceExact(src, oldText, newText, label) {
  if (!src.includes(oldText)) fail(`Could not find expected snippet: ${label}`);
  return src.replace(oldText, newText);
}

function patchEngineBridge() {
  const target = path.join(repoRoot, 'src', 'engine_bridge.js');
  let src = fs.readFileSync(target, 'utf8');
  const original = src;

  if (!src.includes('const cleanMainRefs = paraNotes.map((n) => {')) {
    const oldText = `  // === Phase E — emit one paragraph object per source paragraph, with all
  // its consumers (across streams) merged and sorted by anchor + priority. ===
  const result = [];
  for (const info of paragraphsInfo) {
    const paraNotes = [];
    for (const code of Object.keys(consumersByStream)) {
      for (const c of consumersByStream[code]) {
        if (c.paraIdx !== info.paraIdx || c.text === null) continue;
        paraNotes.push({ stream: code, text: c.text, runs: c.runs || [], anchor: c.anchor, num: c.num, priority: c.priority });
      }
    }
    paraNotes.sort((a, b) => (a.anchor - b.anchor) || (a.priority - b.priority));
    const cleanNotes = paraNotes.map((n) => ({ stream: n.stream, text: n.text, runs: n.runs || [], anchor: n.anchor, num: n.num }));
    if (info.mainTextNet || cleanNotes.length) {
      result.push({
        mainText: info.mainTextNet,
        mainRuns: info.mainRuns || [],
        notes: cleanNotes,
        blockType: info.blockType === "heading" ? "heading" : "paragraph",
        ...(info.blockType === "table" ? { blockType: "table", tableRows: info.tableRows || [] } : {}),
        headingLevel: info.blockType === "heading" ? Math.max(1, Math.min(6, info.headingLevel || 1)) : null,
        style: info.style || {},
      });
    }
  }
`;
    const newText = `  // === Phase E — emit one paragraph object per source paragraph, with all
  // its consumers (across streams) merged and sorted by anchor + priority. ===
  // 2026-05-17: keep source main refs separate from apparatus notes.
  // Apparatus notes are later split/rebalanced between pages; main refs must
  // remain tied to the original main-body marker positions only.
  const result = [];
  for (const info of paragraphsInfo) {
    const paraNotes = [];
    for (const code of Object.keys(consumersByStream)) {
      for (const c of consumersByStream[code]) {
        if (c.paraIdx !== info.paraIdx || c.text === null) continue;
        paraNotes.push({ stream: code, text: c.text, runs: c.runs || [], anchor: c.anchor, num: c.num, priority: c.priority });
      }
    }
    paraNotes.sort((a, b) => (a.anchor - b.anchor) || (a.priority - b.priority));
    const cleanNotes = paraNotes.map((n) => {
      const uid = String(n.stream || "") + ":" + String(n.num || 0) + ":" + String(info.paraIdx) + ":" + String(n.anchor || 0);
      return {
        stream: n.stream,
        text: n.text,
        runs: n.runs || [],
        anchor: n.anchor,
        absoluteAnchor: n.anchor,
        localAnchor: n.anchor,
        num: n.num,
        uid,
        priority: n.priority || 0,
      };
    });
    const cleanMainRefs = paraNotes.map((n) => {
      const uid = String(n.stream || "") + ":" + String(n.num || 0) + ":" + String(info.paraIdx) + ":" + String(n.anchor || 0);
      return {
        stream: n.stream,
        code: n.stream,
        num: n.num,
        uid,
        anchor: n.anchor,
        absoluteAnchor: n.anchor,
        localAnchor: n.anchor,
        priority: n.priority || 0,
      };
    });
    if (info.mainTextNet || cleanNotes.length) {
      result.push({
        mainText: info.mainTextNet,
        mainRuns: info.mainRuns || [],
        notes: cleanNotes,
        mainRefs: cleanMainRefs,
        blockType: info.blockType === "heading" ? "heading" : "paragraph",
        ...(info.blockType === "table" ? { blockType: "table", tableRows: info.tableRows || [] } : {}),
        headingLevel: info.blockType === "heading" ? Math.max(1, Math.min(6, info.headingLevel || 1)) : null,
        style: info.style || {},
      });
    }
  }
`;
    src = replaceExact(src, oldText, newText, 'engine_bridge Phase E');
  }

  if (src !== original) {
    fs.writeFileSync(target, src, 'utf8');
    console.log('[mainrefs] patched engine_bridge.js');
  } else {
    console.log('[mainrefs] engine_bridge.js already patched');
  }
}

function patchDomPacker() {
  const target = path.join(repoRoot, 'src', 'engine', 'dom_packer.js');
  let src = fs.readFileSync(target, 'utf8');
  const original = src;

  if (!src.includes('mainRefs: Array.isArray(item?.mainRefs)')) {
    src = replaceExact(
      src,
      `    mainRuns: Array.isArray(item?.mainRuns) ? item.mainRuns : [],
    fullMainText: typeof item?.mainText === "string" ? item.mainText : "",
`,
      `    mainRuns: Array.isArray(item?.mainRuns) ? item.mainRuns : [],
    // Source-of-truth main refs: copied from engine_bridge mainConsumers.
    // Renderer filters these by the actual page segment start/end. This avoids
    // deriving main refs from apparatus tuples after note split/rebalance.
    mainRefs: Array.isArray(item?.mainRefs)
      ? item.mainRefs.map((ref) => ({ ...ref }))
      : [],
    fullMainText: typeof item?.mainText === "string" ? item.mainText : "",
`,
      'dom_packer active content meta mainRefs'
    );
  }

  if (src !== original) {
    fs.writeFileSync(target, src, 'utf8');
    console.log('[mainrefs] patched dom_packer.js');
  } else {
    console.log('[mainrefs] dom_packer.js already patched');
  }
}

function patchRenderer() {
  const target = path.join(repoRoot, 'src', 'engine', 'renderer.js');
  let src = fs.readFileSync(target, 'utf8');
  const original = src;

  if (!src.includes('function addMainRefToIndex(index, seen, paraIdx, ref, fallbackCode = "", segStart = 0)')) {
    const pattern = /function buildParaNotesIndex\(pageData\) \{[\s\S]*?\n\}\n\nfunction mainBlockTagFor/;
    const replacement = `function addMainRefToIndex(index, seen, paraIdx, ref, fallbackCode = "", segStart = 0) {
  if (!ref || typeof ref !== "object") return;
  const code = String(ref.stream || ref.code || fallbackCode || "");
  if (!code) return;
  const num = typeof ref.num === "number" && ref.num > 0 ? ref.num : 0;
  if (!num) return;
  const absoluteAnchor = typeof ref.absoluteAnchor === "number"
    ? ref.absoluteAnchor
    : typeof ref.anchor === "number"
      ? ref.anchor
      : 0;
  const uid = ref.uid || (code + ":" + String(num) + ":" + String(paraIdx) + ":" + String(absoluteAnchor));
  const key = String(uid);
  if (seen.has(key)) return;
  seen.add(key);
  const localAnchor = typeof ref.localAnchor === "number" ? ref.localAnchor : absoluteAnchor - segStart;
  if (!index[paraIdx]) index[paraIdx] = [];
  index[paraIdx].push({
    code,
    anchor: absoluteAnchor,
    num,
    uid: key,
    absoluteAnchor,
    localAnchor,
    sourceAnchor: typeof ref.anchor === "number" ? ref.anchor : absoluteAnchor,
    hasIdentityMeta: true,
  });
}

// Builds a per-paragraph index of all source main refs. Prefer meta.mainRefs
// from the original main-body markers. Only fall back to page streams for old
// pageData that predates source mainRefs.
function buildParaNotesIndex(pageData) {
  const index = {};
  const seen = new Set();
  let hasSourceMainRefs = false;

  for (const tup of pageData.main || []) {
    const paraIdx = tup[0];
    const segStart = typeof tup[2] === "number" ? tup[2] : 0;
    const segText = String(tup[1] || "");
    const segEnd = typeof tup[3] === "number" ? tup[3] : segStart + segText.length;
    const meta = (tup && tup[4]) || {};
    const refs = Array.isArray(meta.mainRefs) ? meta.mainRefs : null;
    if (!refs) continue;
    hasSourceMainRefs = true;
    const fullLen = typeof meta.fullMainText === "string" ? meta.fullMainText.length : null;
    const isFinalSegment = typeof fullLen === "number" && segEnd >= fullLen;
    for (const ref of refs) {
      const anchor = typeof ref?.absoluteAnchor === "number"
        ? ref.absoluteAnchor
        : typeof ref?.anchor === "number"
          ? ref.anchor
          : null;
      if (typeof anchor !== "number") continue;
      // Use half-open page segments [start,end) to avoid duplicating a ref
      // exactly at a split boundary on both pages. The very last segment keeps
      // an inclusive end so a ref at paragraph end is not lost.
      if (anchor < segStart || (isFinalSegment ? anchor > segEnd : anchor >= segEnd)) continue;
      addMainRefToIndex(index, seen, paraIdx, ref, "", segStart);
    }
  }

  if (hasSourceMainRefs) {
    for (const key of Object.keys(index)) {
      index[key].sort((a, b) => a.anchor - b.anchor);
    }
    return index;
  }

  // Legacy fallback: old packer output has no meta.mainRefs, so derive refs
  // from apparatus notes as before.
  const streams = pageData.streams || {};
  for (const code of Object.keys(streams)) {
    const notes = (streams[code].notes || []);
    for (const tup of notes) {
      const paraIdx = tup[0];
      const hasIdentityMeta = tup && tup[7] && typeof tup[7] === "object";
      const tupleMeta = hasIdentityMeta ? tup[7] : {};
      const tupleAnchor = typeof tup[2] === "number" ? tup[2] : 0;
      const num = typeof tup[3] === "number" && tup[3] > 0 ? tup[3] : tup[0];
      const absoluteAnchor = typeof tupleMeta.absoluteAnchor === "number"
        ? tupleMeta.absoluteAnchor
        : typeof tupleMeta.anchor === "number"
          ? tupleMeta.anchor
          : tupleAnchor;
      addMainRefToIndex(index, seen, paraIdx, {
        stream: code,
        num,
        uid: tupleMeta.uid || (code + ":" + String(num) + ":" + String(paraIdx) + ":" + String(absoluteAnchor)),
        anchor: absoluteAnchor,
        absoluteAnchor,
        localAnchor: typeof tupleMeta.localAnchor === "number" ? tupleMeta.localAnchor : undefined,
      }, code, 0);
      const row = index[paraIdx] && index[paraIdx][index[paraIdx].length - 1];
      if (row) {
        row.hasIdentityMeta = hasIdentityMeta;
        row.sourceAnchor = tupleAnchor;
      }
    }
  }
  for (const key of Object.keys(index)) {
    index[key].sort((a, b) => a.anchor - b.anchor);
  }
  return index;
}

function mainBlockTagFor`;
    const nextSrc = src.replace(pattern, replacement);
    if (nextSrc === src) fail('Could not replace renderer buildParaNotesIndex');
    src = nextSrc;
  } else if (!src.includes('Use half-open page segments [start,end)')) {
    src = replaceExact(
      src,
      `    for (const ref of refs) {
      const anchor = typeof ref?.absoluteAnchor === "number"
        ? ref.absoluteAnchor
        : typeof ref?.anchor === "number"
          ? ref.anchor
          : null;
      if (typeof anchor !== "number") continue;
      if (anchor < segStart || anchor > segEnd) continue;
      addMainRefToIndex(index, seen, paraIdx, ref, "", segStart);
    }
`,
      `    const fullLen = typeof meta.fullMainText === "string" ? meta.fullMainText.length : null;
    const isFinalSegment = typeof fullLen === "number" && segEnd >= fullLen;
    for (const ref of refs) {
      const anchor = typeof ref?.absoluteAnchor === "number"
        ? ref.absoluteAnchor
        : typeof ref?.anchor === "number"
          ? ref.anchor
          : null;
      if (typeof anchor !== "number") continue;
      // Use half-open page segments [start,end) to avoid duplicating a ref
      // exactly at a split boundary on both pages. The very last segment keeps
      // an inclusive end so a ref at paragraph end is not lost.
      if (anchor < segStart || (isFinalSegment ? anchor > segEnd : anchor >= segEnd)) continue;
      addMainRefToIndex(index, seen, paraIdx, ref, "", segStart);
    }
`,
      'renderer source mainrefs boundary guard'
    );
  }

  if (src !== original) {
    fs.writeFileSync(target, src, 'utf8');
    console.log('[mainrefs] patched renderer.js');
  } else {
    console.log('[mainrefs] renderer.js already patched');
  }
}

patchEngineBridge();
patchDomPacker();
patchRenderer();
console.log('[mainrefs] done');
