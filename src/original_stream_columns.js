// Copied from prosemirror-edition/src/main.js, adapted only to call the
// current render callback instead of the original local scheduleRender().

import { normalizeStreamOpeningWordSettings } from "./opening_word.js";
import { styleOptionsHtml } from "./style_registry.js";

const STREAM_SETTINGS_KEY = "ravtext.streamSettings.v1";
const DEFAULT_STREAM_SETTINGS = {
  title: "",
  cols: 1,
  inline: true,
  lastLineCenter: true,
  firstNoteAsTitle: false,
  minLinesForCols: 3,
  styleId: "",
  titleStyleId: "",
};

export function getStreamSettings() {
  if (!window.__STREAM_SETTINGS__) {
    try {
      window.__STREAM_SETTINGS__ = JSON.parse(localStorage.getItem(STREAM_SETTINGS_KEY) || "{}") || {};
    } catch (_err) {
      window.__STREAM_SETTINGS__ = {};
    }
  }
  return window.__STREAM_SETTINGS__;
}

export function saveStreamSettings() {
  try {
    localStorage.setItem(STREAM_SETTINGS_KEY, JSON.stringify(getStreamSettings()));
  } catch (err) {
    console.warn("[stream-settings] save failed:", err);
  }
}

export function ensureOriginalStreamSettings(code) {
  const settings = getStreamSettings();
  if (!settings[code]) {
    settings[code] = { ...DEFAULT_STREAM_SETTINGS };
  }
  settings[code] = { ...DEFAULT_STREAM_SETTINGS, ...settings[code] };
  settings[code] = normalizeStreamOpeningWordSettings(settings[code]);
  return settings[code];
}

function makeSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "stream-col-select";
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function makeLabeledInput(labelText, value, attrs, onChange) {
  const label = document.createElement("label");
  label.className = "stream-col-input";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = attrs.type || "text";
  if (attrs.min !== undefined) input.min = String(attrs.min);
  if (attrs.max !== undefined) input.max = String(attrs.max);
  if (attrs.step !== undefined) input.step = String(attrs.step);
  input.value = value ?? "";
  input.addEventListener("change", () => onChange(input));
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

function makeCheckbox(labelText, checked, onChange) {
  const label = document.createElement("label");
  label.className = "toolbar-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(document.createTextNode(labelText));
  return label;
}

function makeStyleSelect(labelText, value, onChange) {
  const label = document.createElement("label");
  label.className = "stream-col-input";
  const span = document.createElement("span");
  span.textContent = labelText;
  const select = document.createElement("select");
  select.className = "stream-style-select";
  select.innerHTML = styleOptionsHtml(value || "");
  select.addEventListener("change", () => {
    if (select.value === "__add-custom__") {
      const gallery = document.getElementById("styles-gallery-select");
      if (gallery) {
        gallery.value = "__add-custom__";
        gallery.dispatchEvent(new Event("change", { bubbles: true }));
      }
      select.value = value || "";
      return;
    }
    onChange(select.value);
  });
  label.appendChild(span);
  label.appendChild(select);
  return label;
}

export function updateOriginalStreamColumnsPanel(pages, scheduleRender) {
  const panel = document.getElementById("stream-columns-panel");
  if (!panel) return;
  if (!panel.dataset.styleRefreshBound) {
    panel.dataset.styleRefreshBound = "1";
    window.addEventListener("ravtext:styles-changed", () => updateOriginalStreamColumnsPanel(pages, scheduleRender));
  }
  const used = new Set();
  for (const p of pages) for (const c of Object.keys(p.streams || {})) used.add(c);
  for (const pane of window.paneManager?.panes || []) {
    if (pane.streamCode) used.add(pane.streamCode);
  }
  panel.innerHTML = "";
  if (used.size === 0) return;

  const settings = getStreamSettings();
  const commitRender = () => {
    saveStreamSettings();
    scheduleRender();
  };

  const heading = document.createElement("span");
  heading.className = "stream-label-static";
  heading.textContent = "הגדרות זרמים במקום אחד:";
  panel.appendChild(heading);

  const sorted = Array.from(used).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const code of sorted) {
    if (!settings[code]) settings[code] = { ...DEFAULT_STREAM_SETTINGS };
    settings[code] = normalizeStreamOpeningWordSettings({ ...DEFAULT_STREAM_SETTINGS, ...settings[code] });
    const cur = settings[code];
    const block = document.createElement("span");
    block.className = "stream-settings-block";

    const codeLabel = document.createElement("strong");
    codeLabel.textContent = code;
    codeLabel.className = "stream-settings-code";
    block.appendChild(codeLabel);

    block.appendChild(makeLabeledInput("כותרת:", cur.title || "", { type: "text" }, (input) => {
      cur.title = input.value.trim();
      input.value = cur.title;
      commitRender();
    }));

    const colsLabel = document.createElement("label");
    colsLabel.className = "stream-col-input";
    const colsSpan = document.createElement("span");
    colsSpan.textContent = "טורים:";
    const colsInput = document.createElement("input");
    colsInput.type = "number";
    colsInput.min = "1";
    colsInput.max = "6";
    colsInput.value = cur.cols || 1;
    colsInput.addEventListener("change", () => {
      let n = parseInt(colsInput.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 6) n = 6;
      colsInput.value = n;
      cur.cols = n;
      commitRender();
    });
    colsLabel.appendChild(colsSpan);
    colsLabel.appendChild(colsInput);
    block.appendChild(colsLabel);

    const minLinesLabel = document.createElement("label");
    minLinesLabel.className = "stream-col-input";
    const minLinesSpan = document.createElement("span");
    minLinesSpan.textContent = "מינ׳ שורות:";
    const minLinesInput = document.createElement("input");
    minLinesInput.type = "number";
    minLinesInput.min = "1";
    minLinesInput.max = "20";
    minLinesInput.value = typeof cur.minLinesForCols === "number" ? cur.minLinesForCols : 3;
    minLinesInput.addEventListener("change", () => {
      let n = parseInt(minLinesInput.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 20) n = 20;
      minLinesInput.value = n;
      cur.minLinesForCols = n;
      commitRender();
    });
    minLinesLabel.appendChild(minLinesSpan);
    minLinesLabel.appendChild(minLinesInput);
    block.appendChild(minLinesLabel);

    const inlineLabel = document.createElement("label");
    inlineLabel.className = "toolbar-checkbox";
    const inlineInput = document.createElement("input");
    inlineInput.type = "checkbox";
    inlineInput.checked = !!cur.inline;
    inlineInput.addEventListener("change", () => {
      cur.inline = inlineInput.checked;
      commitRender();
    });
    inlineLabel.appendChild(inlineInput);
    inlineLabel.appendChild(document.createTextNode("רצופות"));
    block.appendChild(inlineLabel);

    const lastLineLabel = document.createElement("label");
    lastLineLabel.className = "toolbar-checkbox";
    const lastLineInput = document.createElement("input");
    lastLineInput.type = "checkbox";
    lastLineInput.checked = !!cur.lastLineCenter;
    lastLineInput.addEventListener("change", () => {
      cur.lastLineCenter = lastLineInput.checked;
      commitRender();
    });
    lastLineLabel.appendChild(lastLineInput);
    lastLineLabel.appendChild(document.createTextNode("שורה אחרונה ממורכזת"));
    block.appendChild(lastLineLabel);

    block.appendChild(makeCheckbox("הערה ראשונה ככותרת", cur.firstNoteAsTitle, (checked) => {
      cur.firstNoteAsTitle = checked;
      commitRender();
    }));

    block.appendChild(makeStyleSelect("סגנון זרם:", cur.styleId || "", (value) => {
      cur.styleId = value;
      commitRender();
    }));

    block.appendChild(makeStyleSelect("סגנון כותרת:", cur.titleStyleId || "", (value) => {
      cur.titleStyleId = value;
      commitRender();
    }));

    const opwLabel = document.createElement("label");
    opwLabel.className = "toolbar-checkbox";
    const opwInput = document.createElement("input");
    opwInput.type = "checkbox";
    opwInput.checked = !!cur.opwEnabled;
    opwInput.addEventListener("change", () => {
      cur.opwEnabled = opwInput.checked;
      commitRender();
    });
    opwLabel.appendChild(opwInput);
    opwLabel.appendChild(document.createTextNode("מילה פותחת"));
    block.appendChild(opwLabel);

    block.appendChild(makeSelect(
      [["word", "מילה"], ["letter", "אות"], ["words", "מילים"]],
      cur.opwTarget,
      (value) => {
        cur.opwTarget = value;
        commitRender();
      }
    ));

    const opwCountLabel = document.createElement("label");
    opwCountLabel.className = "stream-col-input";
    const opwCountSpan = document.createElement("span");
    opwCountSpan.textContent = "N:";
    const opwCountInput = document.createElement("input");
    opwCountInput.type = "number";
    opwCountInput.min = "1";
    opwCountInput.max = "12";
    opwCountInput.value = cur.opwCount || 1;
    opwCountInput.addEventListener("change", () => {
      cur.opwCount = Math.max(1, Math.min(12, parseInt(opwCountInput.value, 10) || 1));
      opwCountInput.value = cur.opwCount;
      commitRender();
    });
    opwCountLabel.appendChild(opwCountSpan);
    opwCountLabel.appendChild(opwCountInput);
    block.appendChild(opwCountLabel);

    block.appendChild(makeLabeledInput("סגנון:", cur.opwStyle || "", { type: "text" }, (input) => {
      cur.opwStyle = input.value.trim();
      commitRender();
    }));

    block.appendChild(makeSelect(
      [["raised", "מוגבהת"], ["dropped", "נפתחת"]],
      cur.opwPosition,
      (value) => {
        cur.opwPosition = value;
        commitRender();
      }
    ));

    const opwSizeLabel = document.createElement("label");
    opwSizeLabel.className = "stream-col-input";
    const opwSizeSpan = document.createElement("span");
    opwSizeSpan.textContent = "%:";
    const opwSizeInput = document.createElement("input");
    opwSizeInput.type = "number";
    opwSizeInput.min = "80";
    opwSizeInput.max = "500";
    opwSizeInput.value = cur.opwSize || 135;
    opwSizeInput.addEventListener("change", () => {
      cur.opwSize = Math.max(80, Math.min(500, parseInt(opwSizeInput.value, 10) || 135));
      opwSizeInput.value = cur.opwSize;
      commitRender();
    });
    opwSizeLabel.appendChild(opwSizeSpan);
    opwSizeLabel.appendChild(opwSizeInput);
    block.appendChild(opwSizeLabel);

    block.appendChild(makeLabeledInput("גופן:", cur.opwFont || "David", { type: "text" }, (input) => {
      cur.opwFont = input.value.trim() || "David";
      input.value = cur.opwFont;
      commitRender();
    }));

    block.appendChild(makeSelect(
      [["normal", "רגיל"], ["bold", "מודגש"], ["heavy", "כבד"]],
      cur.opwWeight,
      (value) => {
        cur.opwWeight = value;
        commitRender();
      }
    ));

    block.appendChild(makeLabeledInput("שורות:", cur.opwDropLines || 1, { type: "number", min: 1, max: 8 }, (input) => {
      cur.opwDropLines = Math.max(1, Math.min(8, parseInt(input.value, 10) || 1));
      input.value = cur.opwDropLines;
      commitRender();
    }));

    block.appendChild(makeLabeledInput("רווח:", cur.opwSpaceAfter ?? 0.3, { type: "number", min: 0, max: 4, step: 0.1 }, (input) => {
      const n = parseFloat(input.value);
      cur.opwSpaceAfter = Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 0.3;
      input.value = cur.opwSpaceAfter;
      commitRender();
    }));

    block.appendChild(makeCheckbox("דלג קצר", cur.opwSkipOrphan, (checked) => {
      cur.opwSkipOrphan = checked;
      commitRender();
    }));

    block.appendChild(makeCheckbox("מרכז מלא", cur.opwCenterFull, (checked) => {
      cur.opwCenterFull = checked;
      commitRender();
    }));

    const mbWidthLabel = document.createElement("label");
    mbWidthLabel.className = "stream-col-input";
    const mbWidthSpan = document.createElement("span");
    mbWidthSpan.textContent = "משנ\"ב %:";
    const mbWidthInput = document.createElement("input");
    mbWidthInput.type = "number";
    mbWidthInput.min = "0";
    mbWidthInput.max = "95";
    mbWidthInput.value = cur.mishnaWidth || 0;
    mbWidthInput.title = "0 = ברירת מחדל";
    mbWidthInput.addEventListener("change", () => {
      cur.mishnaWidth = Math.max(0, Math.min(95, parseInt(mbWidthInput.value, 10) || 0));
      mbWidthInput.value = cur.mishnaWidth;
      commitRender();
    });
    mbWidthLabel.appendChild(mbWidthSpan);
    mbWidthLabel.appendChild(mbWidthInput);
    block.appendChild(mbWidthLabel);

    block.appendChild(makeSelect(
      [["auto", "אוטו"], ["right", "ימין"], ["left", "שמאל"], ["outer", "חיצוני"], ["inner", "פנימי"]],
      cur.mishnaSide || "auto",
      (value) => {
        cur.mishnaSide = value;
        commitRender();
      }
    ));

    panel.appendChild(block);
  }
}
