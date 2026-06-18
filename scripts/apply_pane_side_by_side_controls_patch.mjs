// apply_pane_side_by_side_controls_patch.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "src", "main.js");
const stylesPath = path.join(root, "styles.css");

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`${label} not found`);
  return source.replace(from, to);
}

function patchMain() {
  let src = fs.readFileSync(mainPath, "utf8");
  const importLine = 'import { setupPaneSideBySideControls } from "./pane_side_by_side_controls.js";';
  if (!src.includes(importLine)) {
    const paneImport = 'import { PaneManager } from "./pane_manager.js";';
    src = replaceOnce(src, paneImport, `${paneImport} ${importLine}`, "PaneManager import");
  }

  // The old width-slider code created no <input>, so it could throw before later controls were wired.
  // Keep the existing feature, but make it valid and idempotent.
  src = replaceOnce(
    src,
    `control.innerHTML = 'רוחב'; targetGroup.appendChild(control); const input = control.querySelector("input");`,
    `control.innerHTML = 'רוחב <input id="width-slider" type="range" min="18" max="100" step="1">'; targetGroup.appendChild(control); const input = control.querySelector("input");`,
    "width slider input anchor"
  );

  const oldCall = "setupWidthSlider(); setupLiveRenderToggle();";
  const newCall = "setupWidthSlider(); setupPaneSideBySideControls({ paneManager, container }); setupLiveRenderToggle();";
  if (!src.includes(newCall)) {
    src = replaceOnce(src, oldCall, newCall, "setupWidthSlider/setupLiveRenderToggle call sequence");
  }

  fs.writeFileSync(mainPath, src);
}

function patchStyles() {
  let css = fs.readFileSync(stylesPath, "utf8");
  const marker = "/* RAVTEXT PANE SIDE BY SIDE MAIN INLINE CONTROLS */";
  if (css.includes(marker)) return;

  css += `

${marker}
.pane-side-by-side-control,
.pane-side-by-side-count-control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}

.pane-side-by-side-count-control input {
  width: 48px;
  min-width: 48px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--txt);
  font: inherit;
  font-size: 12px;
  text-align: center;
}

.panes-container.streams-main-inline.has-stream-panes,
.panes-container.streams-custom-side-count.has-stream-panes {
  align-content: flex-start;
}

.panes-container.streams-main-inline.has-stream-panes .main-stream-resizer {
  display: none !important;
}

.panes-container.streams-main-inline.has-stream-panes .pane.main-pane,
.panes-container.streams-custom-side-count.has-stream-panes .pane:not(.main-pane) {
  flex: 0 0 var(--ravtext-pane-inline-basis, 33.333%) !important;
  flex-basis: var(--ravtext-pane-inline-basis, 33.333%) !important;
  width: var(--ravtext-pane-inline-basis, 33.333%) !important;
  min-width: 220px !important;
  height: auto !important;
  min-height: 220px;
  margin-bottom: 0 !important;
}

.panes-container.streams-main-inline.has-stream-panes .pane:not(.main-pane) {
  height: auto !important;
}
`;
  fs.writeFileSync(stylesPath, css);
}

patchMain();
patchStyles();
console.log("[ravtext] pane side-by-side controls patch applied");
