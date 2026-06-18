// pane_side_by_side_controls.js
// Controls for showing the main pane alongside stream panes and choosing how many panes appear per row.

const INCLUDE_MAIN_KEY = "ravtext.panes.includeMainInline";
const SIDE_BY_SIDE_COUNT_KEY = "ravtext.panes.sideBySideCount";

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function findPaneToolbarTarget() {
  const layoutButton = document.getElementById("pane-layout-btn")
    || document.querySelector('[data-cmd="pane-layout-toggle"]');
  const toolbar = layoutButton?.closest(".panes-toolbar")
    || document.querySelector(".panes-toolbar");
  if (!toolbar) return null;
  return { toolbar, layoutButton };
}

function insertAfter(parent, node, after) {
  if (after && after.parentNode === parent) {
    after.insertAdjacentElement("afterend", node);
  } else {
    parent.appendChild(node);
  }
}

function paneElements(paneManager) {
  return (paneManager?.panes || []).filter((p) => p?.element);
}

function clearPaneInlineLayout(panes) {
  for (const pane of panes) {
    const el = pane.element;
    el.style.removeProperty("flex");
    el.style.removeProperty("flex-basis");
    el.style.removeProperty("width");
    el.style.removeProperty("min-width");
    el.style.removeProperty("height");
    el.style.removeProperty("margin-bottom");
  }
}

export function setupPaneSideBySideControls({ paneManager, container }) {
  if (!paneManager || !container || document.getElementById("pane-side-by-side-count")) return;

  const target = findPaneToolbarTarget();
  if (!target?.toolbar) return;

  const includeLabel = document.createElement("label");
  includeLabel.className = "toolbar-checkbox pane-side-by-side-control";
  includeLabel.title = "במצב זרמים לרוחב: הצג גם את החלונית הראשית באותה שורה עם הזרמים";
  const includeInput = document.createElement("input");
  includeInput.type = "checkbox";
  includeInput.id = "pane-include-main-inline";
  includeInput.checked = localStorage.getItem(INCLUDE_MAIN_KEY) === "1";
  includeLabel.appendChild(includeInput);
  includeLabel.appendChild(document.createTextNode("ראשי לצד"));

  const countLabel = document.createElement("label");
  countLabel.className = "pane-side-by-side-count-control";
  countLabel.title = "כמה חלוניות להציג בכל שורה במצב זרמים לרוחב";
  countLabel.appendChild(document.createTextNode("חלוניות בשורה"));
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.id = "pane-side-by-side-count";
  countInput.min = "1";
  countInput.max = "99";
  countInput.step = "1";
  countInput.value = String(clampInt(localStorage.getItem(SIDE_BY_SIDE_COUNT_KEY), 1, 99, 3));
  countLabel.appendChild(countInput);

  insertAfter(target.toolbar, includeLabel, target.layoutButton);
  insertAfter(target.toolbar, countLabel, includeLabel);

  const apply = () => {
    const allPanes = paneElements(paneManager);
    const streamPanes = allPanes.filter((p) => p.streamCode);
    const hasStreams = streamPanes.length > 0;
    const isStacked = container.classList.contains("streams-stacked");
    const includeMain = includeInput.checked && hasStreams && !isStacked;
    const columns = clampInt(countInput.value, 1, 99, 3);
    const basis = columns <= 1
      ? "100%"
      : `calc((100% - (var(--ravtext-editor-stream-horizontal-gap, 0px) * ${columns - 1})) / ${columns})`;

    container.classList.toggle("streams-main-inline", includeMain);
    container.classList.toggle("streams-custom-side-count", hasStreams && !isStacked);
    container.style.setProperty("--ravtext-pane-inline-columns", String(columns));
    container.style.setProperty("--ravtext-pane-inline-basis", basis);

    clearPaneInlineLayout(allPanes);

    if (isStacked) {
      container.classList.remove("streams-main-inline", "streams-custom-side-count");
      return;
    }

    const targets = includeMain ? allPanes : streamPanes;
    for (const pane of targets) {
      const el = pane.element;
      el.style.flex = `0 0 ${basis}`;
      el.style.flexBasis = basis;
      el.style.width = basis;
      el.style.minWidth = "220px";
      el.style.height = "auto";
      el.style.marginBottom = "0";
    }
  };

  includeInput.addEventListener("change", () => {
    localStorage.setItem(INCLUDE_MAIN_KEY, includeInput.checked ? "1" : "0");
    apply();
  });

  countInput.addEventListener("input", () => {
    const value = clampInt(countInput.value, 1, 99, 3);
    localStorage.setItem(SIDE_BY_SIDE_COUNT_KEY, String(value));
    apply();
  });

  paneManager.on?.("change", apply);

  const previousApplyPaneWidths = window.__ravtextApplyPaneWidths;
  window.__ravtextApplyPaneWidths = () => {
    if (typeof previousApplyPaneWidths === "function") previousApplyPaneWidths();
    apply();
  };

  apply();
}
