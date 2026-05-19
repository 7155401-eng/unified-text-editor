import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = (p) => path.resolve(root, p);
const read = (p) => fs.readFileSync(file(p), "utf8");
const write = (p, s) => fs.writeFileSync(file(p), s, "utf8");

function replaceOnce(rel, name, oldText, newText, marker) {
  let s = read(rel);
  if (s.includes(marker)) {
    console.log(`[deep-render-cancel] ${name}: already patched`);
    return false;
  }
  if (!s.includes(oldText)) {
    console.warn(`[deep-render-cancel] ${name}: source block not found in ${rel}; skipped`);
    return false;
  }
  s = s.replace(oldText, newText);
  write(rel, s);
  console.log(`[deep-render-cancel] ${name}: patched`);
  return true;
}

function replaceAllSafe(rel, name, oldText, newText) {
  let s = read(rel);
  if (!s.includes(oldText)) {
    console.warn(`[deep-render-cancel] ${name}: source text not found in ${rel}; skipped`);
    return false;
  }
  s = s.replaceAll(oldText, newText);
  write(rel, s);
  console.log(`[deep-render-cancel] ${name}: patched`);
  return true;
}

// This script runs after apply_perfect_render_safety_patch.mjs. It turns the
// earlier token invalidation into a stronger cancellation contract that is
// checked in long DOM post-processing loops and late observers.

replaceOnce(
  "src/engine_bridge.js",
  "add render current helper",
`let _renderToken = 0;
let _debounceTimer = null;
const LIVE_RENDER_DELAY_MS = 650;`,
`let _renderToken = 0;
let _debounceTimer = null;
const LIVE_RENDER_DELAY_MS = 650;

function isRenderCurrent(myToken) {
  if (myToken !== _renderToken) return false;
  if (typeof window !== "undefined" && window.__ravtextRenderCancelRequested) return false;
  return true;
}`,
  "function isRenderCurrent(myToken)"
);

replaceOnce(
  "src/engine_bridge.js",
  "clear cancel flag at scheduled render start",
`  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);`,
`  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _renderToken++;
    if (typeof window !== "undefined") window.__ravtextRenderCancelRequested = false;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);`,
  "window.__ravtextRenderCancelRequested = false;\n    const myToken = _renderToken;"
);

replaceOnce(
  "src/engine_bridge.js",
  "cancel sets global flag",
`export function cancelEngineRender(reason = "user") {
  if (_debounceTimer) {`,
`export function cancelEngineRender(reason = "user") {
  if (typeof window !== "undefined") window.__ravtextRenderCancelRequested = true;
  if (_debounceTimer) {`,
  "window.__ravtextRenderCancelRequested = true;"
);

replaceOnce(
  "src/engine_bridge.js",
  "run render clear cancel flag",
`async function _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, skipSmartTune = false) {
  try {`,
`async function _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, skipSmartTune = false) {
  try {
    if (typeof window !== "undefined") window.__ravtextRenderCancelRequested = false;`,
  "async function _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, skipSmartTune = false) {\n  try {\n    if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = false;"
);

replaceAllSafe("src/engine_bridge.js", "isCurrent callback uses helper", "isCurrent: () => myToken === _renderToken", "isCurrent: () => isRenderCurrent(myToken)");
replaceAllSafe("src/engine_bridge.js", "token checks use helper", "if (myToken !== _renderToken) return;", "if (!isRenderCurrent(myToken)) return;");

replaceOnce(
  "src/engine_bridge.js",
  "split page streams while cancel checkpoint",
`          while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {
            const streams = Array.from(ps.querySelectorAll(":scope > .stream[data-stream]"));`,
`          while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {
            if (!isRenderCurrent(myToken)) return;
            const streams = Array.from(ps.querySelectorAll(":scope > .stream[data-stream]"));`,
  "while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {\n            if (!isRenderCurrent(myToken)) return;\n            const streams = Array.from(ps.querySelectorAll"
);

replaceOnce(
  "src/engine_bridge.js",
  "full splitter pass cancel checkpoint",
`      function runFullSplitterPass() {
        try {
          const startIdx = findFirstOverflowIdx();`,
`      function runFullSplitterPass() {
        try {
          if (!isRenderCurrent(myToken)) return;
          const startIdx = findFirstOverflowIdx();`,
  "function runFullSplitterPass() {\n        try {\n          if (!isRenderCurrent(myToken)) return;"
);

replaceOnce(
  "src/engine_bridge.js",
  "stable loop cancel checkpoint",
`        for (let i = 0; i < MAX_ITERS; i++) {
          runFullSplitterPass();`,
`        for (let i = 0; i < MAX_ITERS; i++) {
          if (!isRenderCurrent(myToken)) return;
          runFullSplitterPass();`,
  "for (let i = 0; i < MAX_ITERS; i++) {\n          if (!isRenderCurrent(myToken)) return;"
);

replaceOnce(
  "src/engine_bridge.js",
  "body expanded while cancel checkpoint",
`          while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {
            // מוצאים את ה-body-expanded האחרון בעמוד; יורדים בעוטפים בודדים;`,
`          while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {
            if (!isRenderCurrent(myToken)) return;
            // מוצאים את ה-body-expanded האחרון בעמוד; יורדים בעוטפים בודדים;`,
  "body-expanded האחרון בעמוד; יורדים בעוטפים בודדים;"
);

replaceOnce(
  "src/engine_bridge.js",
  "observer debounce cancel checkpoint",
`          debounceTimer = setTimeout(() => {
            // suppress observer during loop's own DOM mutations`,
`          debounceTimer = setTimeout(() => {
            if (!isRenderCurrent(myToken)) return;
            // suppress observer during loop's own DOM mutations`,
  "debounceTimer = setTimeout(() => {\n            if (!isRenderCurrent(myToken)) return;"
);

replaceOnce(
  "template-picker.js",
  "toolbar stop status real cancellation",
`  function stopRender() {
    try { window.__ravtextCancelRender?.('toolbar'); } catch (_) {}
    state.running = false;`,
`  function stopRender() {
    try { window.__ravtextCancelRender?.('toolbar'); } catch (_) {}
    try { window.__ravtextRenderCancelRequested = true; } catch (_) {}
    state.running = false;`,
  "window.__ravtextRenderCancelRequested = true;"
);

replaceOnce(
  "src/render_progress_ui.js",
  "progress cancel sets global flag",
`      try { window.__ravtextCancelRender?.("progress-dialog"); } catch (_) {}
      hideVilnaRenderProgressImmediately();`,
`      try { window.__ravtextRenderCancelRequested = true; } catch (_) {}
      try { window.__ravtextCancelRender?.("progress-dialog"); } catch (_) {}
      hideVilnaRenderProgressImmediately();`,
  "window.__ravtextRenderCancelRequested = true;"
);

console.log("[deep-render-cancel] done");
