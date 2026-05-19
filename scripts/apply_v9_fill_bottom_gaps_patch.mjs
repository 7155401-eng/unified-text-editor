import fs from "node:fs";

const TARGET = "src/vilna_v9_apply.js";
const IMPORT_ANCHOR = 'import { applyV9MainBottomGap } from "./engine/v9_main_bottom_gap.js";';
const IMPORT_LINE = 'import { fillV9BottomGapsFromNextPages } from "./engine/v9_fill_bottom_gaps.js";';

const CALL_ANCHOR = "applyV9MainBottomGap(container);";
const CALL_MARKER = "fillV9BottomGapsFromNextPages(container";
const CALL_BLOCK = `${CALL_ANCHOR}

    const v9FillBottomGaps = fillV9BottomGapsFromNextPages(container, {
      blankThresholdPx: 60,
      bottomReservePx: 20,
      maxPasses: 4,
      allowNewFooterStreams: true,
    });

    if (v9FillBottomGaps?.moved > 0) {
      applyV9MainBottomGap(container);
    }`;

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-fill-bottom-gaps] patched ${path}`);
  } else {
    console.log(`[v9-fill-bottom-gaps] no changes needed for ${path}`);
  }
}

let source = readFile(TARGET);
const before = source;

if (!source.includes(IMPORT_LINE)) {
  if (!source.includes(IMPORT_ANCHOR)) {
    throw new Error(`[v9-fill-bottom-gaps] import anchor not found in ${TARGET}`);
  }
  source = source.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\n${IMPORT_LINE}`);
}

if (!source.includes(CALL_MARKER)) {
  if (!source.includes(CALL_ANCHOR)) {
    throw new Error(`[v9-fill-bottom-gaps] call anchor not found in ${TARGET}`);
  }
  source = source.replace(CALL_ANCHOR, CALL_BLOCK);
}

writeIfChanged(TARGET, before, source);
