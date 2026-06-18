// apply_pane_side_by_side_controls_patch.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "src", "main.js");
const stylesPath = path.join(root, "styles.css");

function patchMain() {
  let src = fs.readFileSync(mainPath, "utf8");
  const importLine = 'import { setupPaneSideBySideControls } from "./pane_side_by_side_controls.js";';
  if (!src.includes(importLine)) {
    const paneImport = 'import { PaneManager } from "./pane_manager.js";';
    if (!src.includes(paneImport)) throw new Error("PaneManager import not found in src/main.js");
    src = src.replace(paneImport, `${paneImport} ${importLine}`);
  }

  const oldCall = "setupWidthSlider(); setupLiveRenderToggle();";
  const newCall = "setupWidthSlider(); setupPaneSideBySideControls({ paneManager, container }); setupLiveRenderToggle();";
  if (!src.includes(newCall)) {
    if (!src.includes(oldCall)) throw new Error("setupWidthSlider/setupLiveRenderToggle call sequence not found in src/main.js");
    src = src.replace(oldCall, newCall);
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
}

.panes-container.streams-main-inline.has-stream-panes {
  align-content: stretch;
}

.panes-container.streams-main-inline.has-stream-panes .main-stream-resizer,
.panes-container.streams-main-inline.has-stream-panes .resizer {
  display: none !important;
}

.panes-container.streams-main-inline.has-stream-panes .pane.main-pane,
.panes-container.streams-main-inline.has-stream-panes .pane:not(.main-pane) {
  flex: 0 0 var(--ravtext-pane-inline-basis, 33.333%) !important;
  flex-basis: var(--ravtext-pane-inline-basis, 33.333%) !important;
  width: var(--ravtext-pane-inline-basis, 33.333%) !important;
  min-width: 220px !important;
  height: auto !important;
  min-height: 220px;
  margin-bottom: 0 !important;
}
`;
  fs.writeFileSync(stylesPath, css);
}

patchMain();
patchStyles();
console.log("[ravtext] pane side-by-side controls patch applied");
