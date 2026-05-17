const SETTINGS_KEY = "ravtext.streamSettings.v1";
const FLAG = "__RAVTEXT_FIRST_NOTE_TITLE_HELPER__";

function clean(value) {
  return String(value || "").trim().replace(/^\[\d+\]\s*/, "").trim();
}

function flat(doc) {
  let text = "";
  const pos = [];
  doc?.descendants?.((node, at) => {
    if (!node.isText) return true;
    const v = node.text || "";
    for (let i = 0; i < v.length; i++) {
      pos.push(at + i);
      text += v[i];
    }
    return false;
  });
  return { text, pos };
}

function streamPane(code) {
  return window.paneManager?.panes?.find?.((p) => String(p.streamCode || "") === String(code)) || null;
}

function mainPane() {
  return window.paneManager?.getMainPane?.() || window.paneManager?.panes?.find?.((p) => !p.streamCode) || null;
}

function loadSettings() {
  if (!window.__STREAM_SETTINGS__) {
    try { window.__STREAM_SETTINGS__ = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; }
    catch (_) { window.__STREAM_SETTINGS__ = {}; }
  }
  return window.__STREAM_SETTINGS__;
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s || {})); }
  catch (err) { console.warn("[first-note-title] save failed", err); }
}

function replaceAt(editor, from, to, value) {
  if (!editor || typeof from !== "number" || typeof to !== "number" || to <= from) return false;
  editor.commands.insertContentAt({ from, to }, value || "", { updateSelection: false });
  return true;
}

function firstSymbolRange(editor, symbol) {
  const f = flat(editor.state.doc);
  const start = f.text.indexOf(symbol);
  if (start < 0) return null;
  const end = start + symbol.length;
  return { from: f.pos[start], to: end < f.pos.length ? f.pos[end] : editor.state.doc.content.size };
}

function clearFirstRef(editor, symbol) {
  const r = firstSymbolRange(editor, symbol);
  if (!r) return false;
  return replaceAt(editor, r.from, r.to, "");
}

function findSymbols(text, symbol) {
  const out = [];
  let start = text.indexOf(symbol);
  while (start !== -1) {
    out.push({ start, end: start + symbol.length });
    start = text.indexOf(symbol, start + symbol.length);
  }
  return out;
}

function takeFirstNote(editor, symbol) {
  const f = flat(editor.state.doc);
  const hits = findSymbols(f.text, symbol);
  if (hits.length > 0) {
    const first = hits[0];
    const second = hits[1] || null;
    const title = clean(f.text.slice(first.end, second ? second.start : f.text.length));
    if (!title) return "";
    const from = f.pos[first.start];
    const to = second ? f.pos[second.start] : editor.state.doc.content.size;
    return replaceAt(editor, from, to, "") ? title : "";
  }
  const title = clean(f.text);
  if (!title) return "";
  replaceAt(editor, 0, editor.state.doc.content.size, "");
  return title;
}

function setHeader(pane, title) {
  pane.label = title;
  const el = pane.element?.querySelector?.(".pane-label");
  if (el) el.textContent = title;
}

function materialize(code, checkbox) {
  const sp = streamPane(code);
  const mp = mainPane();
  if (!sp?.editor || !mp?.editor) {
    if (checkbox) checkbox.checked = false;
    return;
  }
  const all = loadSettings();
  const cur = all[code] || {};
  if (String(cur.title || "").trim()) {
    cur.firstNoteAsTitle = false;
    all[code] = cur;
    saveSettings(all);
    if (checkbox) checkbox.checked = false;
    return;
  }
  const symbol = sp.symbol || `@${code}`;
  const title = takeFirstNote(sp.editor, symbol);
  if (!title) {
    cur.firstNoteAsTitle = false;
    all[code] = cur;
    saveSettings(all);
    if (checkbox) checkbox.checked = false;
    return;
  }
  clearFirstRef(mp.editor, symbol);
  cur.title = title;
  cur.firstNoteAsTitle = false;
  all[code] = cur;
  saveSettings(all);
  if (checkbox) checkbox.checked = false;
  setHeader(sp, title);
  window.dispatchEvent(new CustomEvent("ravtext:first-note-title-materialized", { detail: { code, title } }));
}

function isFirstNoteCheckbox(input) {
  const label = input?.closest?.("label");
  return input?.type === "checkbox" && !!label && label.textContent.includes("הערה ראשונה ככותרת");
}

export function installFirstNoteTitleHelper() {
  if (typeof window === "undefined" || window[FLAG]) return;
  window[FLAG] = true;
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!isFirstNoteCheckbox(input) || !input.checked) return;
    const block = input.closest?.(".stream-settings-block");
    const code = block?.dataset?.streamCode;
    if (!code) return;
    setTimeout(() => materialize(code, input), 0);
  });
}

installFirstNoteTitleHelper();
