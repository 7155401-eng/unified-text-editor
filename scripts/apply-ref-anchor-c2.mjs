#!/usr/bin/env node
// Applies Stage C2 of the ref-anchor identity work.
//
// C2 goals:
// 1. Renderer: when tup[7] identity metadata exists, use absoluteAnchor only.
//    Do not reinterpret that absolute anchor as a local split offset.
// 2. dom_packer post-pass: preserve tup[7] metadata when rebalance/split code
//    manually constructs note tuples.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`\n[ref-anchor-c2] ${message}`);
  process.exit(1);
}

function replaceExact(src, oldText, newText, label) {
  if (!src.includes(oldText)) fail(`Could not find expected snippet: ${label}`);
  return src.replace(oldText, newText);
}

function patchRenderer() {
  const target = path.join(repoRoot, 'src', 'engine', 'renderer.js');
  let src = fs.readFileSync(target, 'utf8');
  const original = src;

  if (!src.includes('const hasIdentityMeta = tup && tup[7] && typeof tup[7] === "object";')) {
    src = replaceExact(
      src,
      '      const tupleMeta = tup && tup[7] && typeof tup[7] === "object" ? tup[7] : {};\n      const tupleAnchor = typeof tup[2] === "number" ? tup[2] : 0;\n',
      '      const hasIdentityMeta = tup && tup[7] && typeof tup[7] === "object";\n      const tupleMeta = hasIdentityMeta ? tup[7] : {};\n      const tupleAnchor = typeof tup[2] === "number" ? tup[2] : 0;\n',
      'renderer tupleMeta declaration'
    );
  }

  if (!src.includes('        hasIdentityMeta,')) {
    src = replaceExact(
      src,
      '        sourceAnchor: tupleAnchor,\n',
      '        sourceAnchor: tupleAnchor,\n        hasIdentityMeta,\n',
      'renderer hasIdentityMeta field'
    );
  }

  if (!src.includes('When tup[7] exists, anchor identity is explicit')) {
    const localMainRefPattern = /function localMainRefPos\(ref, segText, segStart, segEnd\) \{[\s\S]*?\n\}\n\nfunction isCombiningMark/;
    const nextSrc = src.replace(localMainRefPattern, `function localMainRefPos(ref, segText, segStart, segEnd) {
  const textLen = String(segText || "").length;

  // When tup[7] exists, anchor identity is explicit: absoluteAnchor is the
  // original paragraph coordinate. Do not run the legacy "maybe local" fallback
  // on it, otherwise an absolute anchor whose numeric value happens to fit in
  // a continuation segment can be inserted at the wrong local position.
  if (ref?.hasIdentityMeta && typeof ref.absoluteAnchor === "number") {
    const anchor = ref.absoluteAnchor;
    if (anchor >= segStart && anchor <= segEnd) {
      return Math.max(0, Math.min(textLen, anchor - segStart));
    }
    return null;
  }

  const anchor = typeof ref.anchor === "number" ? ref.anchor : 0;

  // Legacy fallback for old packer tuples without tup[7]. Some split-paragraph
  // refs were serialized as local offsets in tup[2], so keep the previous
  // behavior only for those legacy tuples.
  if (segStart > 0 && anchor >= 0 && anchor <= textLen) {
    return anchor;
  }

  if (anchor >= segStart && anchor <= segEnd) {
    return Math.max(0, Math.min(textLen, anchor - segStart));
  }

  return null;
}

function isCombiningMark`);
    if (nextSrc === src) fail('Could not replace renderer localMainRefPos');
    src = nextSrc;
  }

  if (src !== original) {
    fs.writeFileSync(target, src, 'utf8');
    console.log('[ref-anchor-c2] Patched renderer.js');
  } else {
    console.log('[ref-anchor-c2] renderer.js already patched');
  }
}

function patchDomPacker() {
  const target = path.join(repoRoot, 'src', 'engine', 'dom_packer.js');
  let src = fs.readFileSync(target, 'utf8');
  const original = src;

  if (!src.includes('function makeNoteTuple(')) {
    src = replaceExact(
      src,
      `function clonePageData(p) {
  const streams = {};
  for (const code of Object.keys(p.streams || {})) {
    streams[code] = {
      ...p.streams[code],
      notes: ((p.streams[code] && p.streams[code].notes) || []).map((n) => n.slice()),
    };
  }
  return {
    ...p,
    main: (p.main || []).map((s) => s.slice()),
    streams,
  };
}
`,
      `function clonePageData(p) {
  const streams = {};
  for (const code of Object.keys(p.streams || {})) {
    streams[code] = {
      ...p.streams[code],
      notes: ((p.streams[code] && p.streams[code].notes) || []).map((n) => n.slice()),
    };
  }
  return {
    ...p,
    main: (p.main || []).map((s) => s.slice()),
    streams,
  };
}

function makeNoteTuple(paraIdx, text, anchor, num, cont, children, runs, sourceMeta = {}, streamCode = "") {
  const meta = sourceMeta && typeof sourceMeta === "object" ? { ...sourceMeta } : {};
  if (streamCode) meta.stream = streamCode;
  if (typeof num === "number") meta.num = num;
  if (typeof anchor === "number") {
    meta.anchor = anchor;
    if (typeof meta.localAnchor !== "number") meta.localAnchor = anchor;
    if (typeof meta.absoluteAnchor !== "number") meta.absoluteAnchor = anchor;
  }
  if (!meta.uid) {
    meta.uid = String(meta.stream || streamCode || "") + ":" + String(num || 0) + ":" + String(paraIdx) + ":" + String(meta.absoluteAnchor || anchor || 0);
  }
  return [paraIdx, text, anchor, num, cont, children, runs, meta];
}
`,
      'dom_packer makeNoteTuple helper'
    );
  }

  // Preserve object metadata in the older splitNote implementation.
  src = src.replace(
    `    const part1 = {
      stream: note.stream,
      anchor: note.anchor,
      num: note.num,
      isContinuation: !!note.isContinuation,
      text: note.text.substring(0, wordEnd).trimEnd() + SPLIT_MARK,
      wasSplit: true,
      children: note.isContinuation ? [] : (note.children || []),
      runs: sliceRuns(Array.isArray(note.runs) ? note.runs : [], 0, part1RawLen),
    };
    const part2 = {
      stream: note.stream,
      anchor: note.anchor,
      num: note.num,
      isContinuation: true,
      text: SPLIT_MARK + tail.trimStart(),
      wasSplit: true,
      children: [],
      runs: part2RunsShifted,
    };
`,
    `    const part1 = {
      ...note,
      stream: note.stream,
      anchor: note.anchor,
      num: note.num,
      isContinuation: !!note.isContinuation,
      text: note.text.substring(0, wordEnd).trimEnd() + SPLIT_MARK,
      wasSplit: true,
      children: note.isContinuation ? [] : (note.children || []),
      runs: sliceRuns(Array.isArray(note.runs) ? note.runs : [], 0, part1RawLen),
    };
    const part2 = {
      ...note,
      stream: note.stream,
      anchor: note.anchor,
      num: note.num,
      isContinuation: true,
      text: SPLIT_MARK + tail.trimStart(),
      wasSplit: true,
      children: [],
      runs: part2RunsShifted,
    };
`
  );

  src = src.replace(
    '  const tupRuns = Array.isArray(tup[6]) ? tup[6] : [];\n  if (!text || text.length < 4) return false;\n',
    '  const tupRuns = Array.isArray(tup[6]) ? tup[6] : [];\n  const tupMeta = tup && tup[7] && typeof tup[7] === "object" ? tup[7] : {};\n  if (!text || text.length < 4) return false;\n'
  );
  src = src.replace(
    '    trialCur.streams[target.code].notes.push([paraIdx, part1, target.anchor, tupNum, tupCont, tupCont ? [] : tupChildren, part1Runs]);\n    trialNxt.streams[target.code].notes[target.idx] = [paraIdx, part2, target.anchor, tupNum, 1, [], part2Runs];\n',
    '    trialCur.streams[target.code].notes.push(makeNoteTuple(paraIdx, part1, target.anchor, tupNum, tupCont, tupCont ? [] : tupChildren, part1Runs, tupMeta, target.code));\n    trialNxt.streams[target.code].notes[target.idx] = makeNoteTuple(paraIdx, part2, target.anchor, tupNum, 1, [], part2Runs, tupMeta, target.code);\n'
  );

  src = src.replace(
    '        const runs = Array.isArray(tup[6]) ? tup[6] : [];\n        earliest = { code, idx: i, paraIdx, text, anchor, num, cont, children, runs };\n',
    '        const runs = Array.isArray(tup[6]) ? tup[6] : [];\n        const meta = tup && tup[7] && typeof tup[7] === "object" ? tup[7] : {};\n        earliest = { code, idx: i, paraIdx, text, anchor, num, cont, children, runs, meta };\n'
  );
  src = src.replace(
    '    trialCur.streams[earliest.code].notes.push([earliest.paraIdx, earliest.text, earliest.anchor, earliest.num, earliest.cont, earliest.cont ? [] : earliest.children, earliest.runs]);\n',
    '    trialCur.streams[earliest.code].notes.push(makeNoteTuple(earliest.paraIdx, earliest.text, earliest.anchor, earliest.num, earliest.cont, earliest.cont ? [] : earliest.children, earliest.runs, earliest.meta, earliest.code));\n'
  );
  src = src.replace(
    '    trialCur.streams[earliest.code].notes.push([earliest.paraIdx, part1, earliest.anchor, earliest.num, earliest.cont, earliest.cont ? [] : earliest.children, part1Runs]);\n    trialNxt.streams[earliest.code].notes[earliest.idx] = [earliest.paraIdx, part2, earliest.anchor, earliest.num, 1, [], part2Runs];\n',
    '    trialCur.streams[earliest.code].notes.push(makeNoteTuple(earliest.paraIdx, part1, earliest.anchor, earliest.num, earliest.cont, earliest.cont ? [] : earliest.children, part1Runs, earliest.meta, earliest.code));\n    trialNxt.streams[earliest.code].notes[earliest.idx] = makeNoteTuple(earliest.paraIdx, part2, earliest.anchor, earliest.num, 1, [], part2Runs, earliest.meta, earliest.code);\n'
  );

  src = src.replace(
    '        const runs = Array.isArray(tup[6]) ? tup[6] : [];\n        target = { code, idx: i, paraIdx, text, anchor, num, cont, children, runs };\n',
    '        const runs = Array.isArray(tup[6]) ? tup[6] : [];\n        const meta = tup && tup[7] && typeof tup[7] === "object" ? tup[7] : {};\n        target = { code, idx: i, paraIdx, text, anchor, num, cont, children, runs, meta };\n'
  );
  src = src.replace(
    '    trialCur.streams[target.code].notes.push([target.paraIdx, target.text, target.anchor, target.num, target.cont, target.cont ? [] : target.children, target.runs]);\n',
    '    trialCur.streams[target.code].notes.push(makeNoteTuple(target.paraIdx, target.text, target.anchor, target.num, target.cont, target.cont ? [] : target.children, target.runs, target.meta, target.code));\n'
  );
  src = src.replace(
    '        t2.streams[target.code].notes.push([target.paraIdx, pt, target.anchor, target.num, target.cont, target.cont ? [] : target.children, ptRuns]);\n',
    '        t2.streams[target.code].notes.push(makeNoteTuple(target.paraIdx, pt, target.anchor, target.num, target.cont, target.cont ? [] : target.children, ptRuns, target.meta, target.code));\n'
  );
  src = src.replace(
    '      trialNxt.streams[target.code].notes[targetIdxAdjusted] = [target.paraIdx, part2, target.anchor, target.num, 1, [], part2Runs];\n',
    '      trialNxt.streams[target.code].notes[targetIdxAdjusted] = makeNoteTuple(target.paraIdx, part2, target.anchor, target.num, 1, [], part2Runs, target.meta, target.code);\n'
  );

  if (src !== original) {
    fs.writeFileSync(target, src, 'utf8');
    console.log('[ref-anchor-c2] Patched dom_packer.js');
  } else {
    console.log('[ref-anchor-c2] dom_packer.js already patched');
  }
}

patchRenderer();
patchDomPacker();
console.log('[ref-anchor-c2] Done.');
