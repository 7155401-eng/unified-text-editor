// Copied from prosemirror-edition/src/main.js, adapted only to call the
// current render callback instead of the original local scheduleRender().

export function getStreamSettings() {
  if (!window.__STREAM_SETTINGS__) window.__STREAM_SETTINGS__ = {};
  return window.__STREAM_SETTINGS__;
}

export function ensureOriginalStreamSettings(code) {
  const settings = getStreamSettings();
  if (!settings[code]) {
    settings[code] = { cols: 1, inline: true, lastLineCenter: true, minLinesForCols: 3 };
  }
  return settings[code];
}

export function updateOriginalStreamColumnsPanel(pages, scheduleRender) {
  const panel = document.getElementById("stream-columns-panel");
  if (!panel) return;
  const used = new Set();
  for (const p of pages) for (const c of Object.keys(p.streams || {})) used.add(c);
  panel.innerHTML = "";
  if (used.size === 0) return;

  const settings = getStreamSettings();

  const heading = document.createElement("span");
  heading.className = "stream-label-static";
  heading.textContent = "הגדרות זרמים:";
  panel.appendChild(heading);

  const sorted = Array.from(used).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const code of sorted) {
    if (!settings[code]) settings[code] = { cols: 1, inline: true, lastLineCenter: true, minLinesForCols: 3 };
    const cur = settings[code];
    const block = document.createElement("span");
    block.className = "stream-settings-block";

    const codeLabel = document.createElement("strong");
    codeLabel.textContent = code;
    codeLabel.className = "stream-settings-code";
    block.appendChild(codeLabel);

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
      scheduleRender();
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
      scheduleRender();
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
      scheduleRender();
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
      scheduleRender();
    });
    lastLineLabel.appendChild(lastLineInput);
    lastLineLabel.appendChild(document.createTextNode("שורה אחרונה ממורכזת"));
    block.appendChild(lastLineLabel);

    panel.appendChild(block);
  }
}
