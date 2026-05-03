const STREAM_KEY = "ravtext.stream.settings.v1";
const LAYOUT_KEY = "ravtext.page.layout.v1";

const DEFAULT_STREAM = {
  cols: 1,
  minLinesForCols: 3,
  colGap: 8,
  inline: true,
  separator: " ",
  lastLineCenter: true,
  firstNoteAsTitle: false,
  enabled: true,
};

const DEFAULT_LAYOUT = {
  streamsLayout: "side-by-side",
  mainColumns: 1,
};

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getStreamSettings() {
  if (!window.__STREAM_SETTINGS__) {
    window.__STREAM_SETTINGS__ = readJson(STREAM_KEY, {});
  }
  return window.__STREAM_SETTINGS__;
}

export function getLayoutSettings() {
  if (!window.__PAGE_LAYOUT_SETTINGS__) {
    window.__PAGE_LAYOUT_SETTINGS__ = { ...DEFAULT_LAYOUT, ...readJson(LAYOUT_KEY, {}) };
  }
  return window.__PAGE_LAYOUT_SETTINGS__;
}

export function saveStreamSettings() {
  saveJson(STREAM_KEY, getStreamSettings());
  saveJson(LAYOUT_KEY, getLayoutSettings());
}

export function ensureStreamSetting(code) {
  const settings = getStreamSettings();
  if (!settings[code]) settings[code] = { ...DEFAULT_STREAM };
  else settings[code] = { ...DEFAULT_STREAM, ...settings[code] };
  return settings[code];
}

export function initStreamSettings(paneManager) {
  getLayoutSettings();
  for (const pane of paneManager.panes || []) {
    if (pane.streamCode) ensureStreamSetting(pane.streamCode);
  }
  saveStreamSettings();
}

function collectCodes(paneManager, pages) {
  const codes = new Set();
  for (const pane of paneManager.panes || []) {
    if (pane.streamCode) codes.add(pane.streamCode);
  }
  for (const page of pages || []) {
    for (const code of Object.keys(page.streams || {})) codes.add(code);
  }
  return Array.from(codes).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function makeInput(type, value, onChange) {
  const input = document.createElement("input");
  input.type = type;
  if (type === "checkbox") input.checked = !!value;
  else input.value = value;
  input.addEventListener("change", () => onChange(input));
  return input;
}

function addLabel(parent, text, control) {
  const label = document.createElement("label");
  label.className = "stream-setting-control";
  const span = document.createElement("span");
  span.textContent = text;
  label.appendChild(span);
  label.appendChild(control);
  parent.appendChild(label);
}

export function updateStreamSettingsPanel(paneManager, pages, onChange) {
  const panel = document.getElementById("stream-settings-panel");
  if (!panel) return;

  initStreamSettings(paneManager);
  const layout = getLayoutSettings();
  const settings = getStreamSettings();
  const codes = collectCodes(paneManager, pages);

  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "stream-settings-header";
  header.textContent = "הגדרות זרמים וכללי עימוד";
  panel.appendChild(header);

  const global = document.createElement("div");
  global.className = "stream-settings-global";

  const layoutSelect = document.createElement("select");
  [
    ["side-by-side", "זרמים זה לצד זה"],
    ["stacked", "זרמים אחד מתחת לשני"],
    ["mishna", "משנה ברורה: 01+02 במקביל"],
  ].forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    layoutSelect.appendChild(opt);
  });
  layoutSelect.value = layout.streamsLayout || "side-by-side";
  layoutSelect.addEventListener("change", () => {
    layout.streamsLayout = layoutSelect.value;
    saveStreamSettings();
    onChange && onChange();
  });
  addLabel(global, "פריסת זרמים:", layoutSelect);

  const mainCols = makeInput("number", layout.mainColumns || 1, (input) => {
    let n = parseInt(input.value, 10);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 3) n = 3;
    input.value = n;
    layout.mainColumns = n;
    saveStreamSettings();
    onChange && onChange();
  });
  mainCols.min = "1";
  mainCols.max = "3";
  addLabel(global, "טורי טקסט ראשי:", mainCols);

  panel.appendChild(global);

  if (codes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stream-settings-empty";
    empty.textContent = "אין זרמים במסמך כרגע";
    panel.appendChild(empty);
    return;
  }

  for (const code of codes) {
    const cur = settings[code] = { ...DEFAULT_STREAM, ...(settings[code] || {}) };
    const row = document.createElement("div");
    row.className = "stream-settings-row";

    const codeEl = document.createElement("strong");
    codeEl.className = "stream-settings-code";
    codeEl.textContent = code;
    row.appendChild(codeEl);

    const cols = makeInput("number", cur.cols, (input) => {
      let n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 6) n = 6;
      input.value = n;
      cur.cols = n;
      saveStreamSettings();
      onChange && onChange();
    });
    cols.min = "1";
    cols.max = "6";
    addLabel(row, "טורים", cols);

    const minLines = makeInput("number", cur.minLinesForCols, (input) => {
      let n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 30) n = 30;
      input.value = n;
      cur.minLinesForCols = n;
      saveStreamSettings();
      onChange && onChange();
    });
    minLines.min = "1";
    minLines.max = "30";
    addLabel(row, "מינ' שורות", minLines);

    const colGap = makeInput("number", cur.colGap, (input) => {
      let n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 0) n = 0;
      if (n > 40) n = 40;
      input.value = n;
      cur.colGap = n;
      saveStreamSettings();
      onChange && onChange();
    });
    colGap.min = "0";
    colGap.max = "40";
    addLabel(row, "רווח טורים", colGap);

    const sep = makeInput("text", cur.separator, (input) => {
      cur.separator = input.value;
      saveStreamSettings();
      onChange && onChange();
    });
    sep.className = "stream-separator-input";
    addLabel(row, "מפריד רציף", sep);

    addLabel(row, "רצופות", makeInput("checkbox", cur.inline, (input) => {
      cur.inline = input.checked;
      saveStreamSettings();
      onChange && onChange();
    }));
    addLabel(row, "מרכז סיום", makeInput("checkbox", cur.lastLineCenter, (input) => {
      cur.lastLineCenter = input.checked;
      saveStreamSettings();
      onChange && onChange();
    }));
    addLabel(row, "ראשונה ככותרת", makeInput("checkbox", cur.firstNoteAsTitle, (input) => {
      cur.firstNoteAsTitle = input.checked;
      saveStreamSettings();
      onChange && onChange();
    }));
    addLabel(row, "פעיל", makeInput("checkbox", cur.enabled, (input) => {
      cur.enabled = input.checked;
      saveStreamSettings();
      onChange && onChange();
    }));

    panel.appendChild(row);
  }
}
