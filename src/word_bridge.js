import { applyDemoWatermarkToHtml, ensureDemoAccess, isDemoMode } from "./demo_mode.js";

const DEFAULT_MARKERS = Array.from({ length: 99 }, (_, i) => `@${String(i + 1).padStart(2, "0")}`);

let importPath = "";
let importStreams = [];
let paneManagerRef = null;
let onLoadedRef = null;
let lastUserActivity = Date.now();
let syncBusy = false;
let syncHubStarted = false;

function getBridge() {
  return window.pywebview?.api || null;
}

function getBridgeMethod(names) {
  const api = getBridge();
  if (!api) return null;
  for (const name of names) {
    if (typeof api[name] === "function") return api[name].bind(api);
  }
  return null;
}

function hasWordBridge() {
  return !!(
    getBridgeMethod(["import_word", "editor_import_word"]) &&
    getBridgeMethod(["extract_word", "editor_extract_word"]) &&
    getBridgeMethod(["export_word", "editor_export_word"])
  );
}

function wordUnavailable() {
  alert("ייבוא/ייצוא Word המקורי דורש את bridge של התוכנה הישנה. בדפדפן רגיל אין גישה ל-window.pywebview.api.");
}

function emptyDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function loadWordContent(editor, htmlContent) {
  if (!editor || !htmlContent) return;
  if (htmlContent.includes("<")) {
    editor.commands.setContent(htmlContent);
    return;
  }
  const escaped = htmlContent
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  editor.commands.setContent(`<p>${escaped.replace(/\n/g, "<br>")}</p>`);
}

function streamCodeFromSymbol(symbol, fallbackIndex) {
  const m = String(symbol || "").match(/@(\d{1,3})/);
  if (m) return String(parseInt(m[1], 10)).padStart(2, "0");
  return String(fallbackIndex + 1).padStart(2, "0");
}

function normalizeStreamSource(stream) {
  const normalized = { ...(stream || {}) };
  if (!normalized.source && normalized.source_type) normalized.source = normalized.source_type;
  if (!normalized.source_type && normalized.source) normalized.source_type = normalized.source;
  return normalized;
}

function sourceDisplayName(stream) {
  const source = stream?.source_type || stream?.source || "";
  const names = {
    footnote: "הערות שוליים",
    endnote: "הערות סיום",
    comment: "הערות בלון",
    custom: "סימון מותאם",
    external: "מסמך מקושר",
    sidenote: "הערת צד",
    parallel: "טקסט מקביל",
  };
  return names[source] || source || "זרם";
}

function markerDisplayName(stream) {
  if (stream?.custom_pattern) return `תבנית מותאמת ${stream.custom_pattern}`;
  if (stream?.target_marker) return `קישור לפי ${stream.target_marker}`;
  if (stream && Object.prototype.hasOwnProperty.call(stream, "marker")) {
    const marker = stream.marker;
    if (marker === null || marker === undefined || String(marker).trim() === "") return "ללא סימון מקור";
    return `סימון מקור @${marker}`;
  }
  if (String(stream?.id || "").endsWith("_none")) return "ללא סימון מקור";
  return "";
}

function resetMainPane(paneManager) {
  paneManager.load({
    version: 1,
    activeId: "word-main",
    panes: [{
      id: "word-main",
      streamCode: null,
      symbol: "",
      label: "ראשי",
      content: emptyDoc(),
    }],
  });
  return paneManager.getMainPane();
}

function openImportModal() {
  document.getElementById("word-import-modal")?.classList.add("active");
}

export function closeWordImportModal() {
  document.getElementById("word-import-modal")?.classList.remove("active");
}

function renderImportStreams() {
  const list = document.getElementById("word-stream-list");
  if (!list) return;
  list.innerHTML = "";
  importStreams.forEach((stream, i) => {
    const row = document.createElement("div");
    row.className = "stream-row";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.id = `word-stream-${i}`;

    const label = document.createElement("label");
    label.htmlFor = check.id;

    const title = document.createElement("span");
    title.className = "word-stream-title";
    const icon = stream.icon ? `${stream.icon} ` : "";
    title.textContent = `${icon}${stream.label || stream.id || "stream"}`;

    const meta = document.createElement("span");
    meta.className = "word-stream-meta";
    const details = [
      sourceDisplayName(stream),
      markerDisplayName(stream),
      `${stream.count || 0} הערות`,
    ].filter(Boolean);
    meta.textContent = details.join(" · ");

    label.appendChild(title);
    label.appendChild(meta);

    const input = document.createElement("input");
    input.type = "text";
    input.id = `word-symbol-${i}`;
    input.value = DEFAULT_MARKERS[i] || `@${i + 1}`;

    row.appendChild(check);
    row.appendChild(label);
    row.appendChild(input);
    list.appendChild(row);
  });
}

function setImportStreams(path, streams) {
  importPath = path || "";
  importStreams = streams || [];
  renderImportStreams();
  if (importStreams.length) openImportModal();
}

async function loadInitialFileFromBridge() {
  const getInitialFileCall = getBridgeMethod(["get_initial_file", "editor_get_initial_file"]);
  if (!getInitialFileCall) return;
  try {
    const data = JSON.parse(await getInitialFileCall());
    if (!data.path) return;
    const streams = data.streams || [];
    importPath = data.path;
    importStreams = streams;
    if (!streams.length) return;
    renderImportStreams();
    openImportModal();
  } catch (err) {
    console.error("[word_bridge] initial load failed:", err);
  }
}

async function pollSyncHub() {
  if (syncBusy) return;
  const pollSyncCall = getBridgeMethod(["poll_sync", "editor_poll_sync"]);
  if (!pollSyncCall) return;
  syncBusy = true;
  try {
    const data = JSON.parse(await pollSyncCall());
    const events = data.events || [];
    for (const ev of events) {
      if (ev.type !== "loaded" || !ev.file_path) continue;
      if (Date.now() - lastUserActivity < 2000) {
        setTimeout(pollSyncHub, 2200);
        return;
      }
      const meta = ev.metadata || {};
      let msg = `חלון אחר (${ev.source}) טען קובץ:\n`;
      msg += `${String(ev.file_path).split(/[\\/]/).pop()}\n`;
      if (meta.doc_title) msg += `${meta.doc_title}\n`;
      if (meta.n_streams !== undefined) msg += `${meta.n_streams} זרמים\n`;
      msg += "\nהאם לטעון אותו גם כאן?";
      if (!confirm(msg)) continue;

      const importPathCall = getBridgeMethod(["import_path", "editor_import_path"]);
      if (!importPathCall) continue;
      const imported = JSON.parse(await importPathCall(ev.file_path));
      if (imported.error) {
        alert("שגיאה: " + imported.error);
      } else if (imported.streams) {
        setImportStreams(imported.path, imported.streams);
        if (!importStreams.length) alert("הקובץ נטען (אין זרמי הערות)");
      }
    }
  } catch {
    // The sync hub is optional in browser-only runs.
  } finally {
    syncBusy = false;
  }
}

function setupWordSyncHub() {
  if (syncHubStarted) return;
  if (!getBridgeMethod(["poll_sync", "editor_poll_sync"]) && !getBridgeMethod(["get_initial_file", "editor_get_initial_file"])) return;
  syncHubStarted = true;
  document.addEventListener("input", () => {
    lastUserActivity = Date.now();
    getBridgeMethod(["set_modified", "editor_set_modified"])?.(true);
  });
  setInterval(pollSyncHub, 1500);
  setTimeout(pollSyncHub, 1000);
  setTimeout(loadInitialFileFromBridge, 1500);
}

export async function importWord(paneManager, onLoaded) {
  paneManagerRef = paneManager;
  onLoadedRef = onLoaded || null;
  if (!hasWordBridge()) {
    wordUnavailable();
    return;
  }

  const importWordCall = getBridgeMethod(["import_word", "editor_import_word"]);
  const extractWordCall = getBridgeMethod(["extract_word", "editor_extract_word"]);
  const result = JSON.parse(await importWordCall());
  if (result.error) return;

  importPath = result.path;
  importStreams = result.streams || [];

  if (!importStreams.length) {
    const extracted = JSON.parse(await extractWordCall(importPath, "[]"));
    if (extracted.error) return;
    const main = resetMainPane(paneManager);
    loadWordContent(main?.editor, extracted.main);
    onLoaded?.();
    return;
  }

  renderImportStreams();
  openImportModal();
}

export async function confirmWordImport() {
  if (!paneManagerRef || !hasWordBridge()) {
    wordUnavailable();
    return;
  }

  const selected = [];
  importStreams.forEach((stream, i) => {
    const check = document.getElementById(`word-stream-${i}`);
    const input = document.getElementById(`word-symbol-${i}`);
    if (check?.checked) {
      selected.push({ stream: normalizeStreamSource(stream), symbol: (input?.value || DEFAULT_MARKERS[i] || "").trim() });
    }
  });

  if (!selected.length) {
    alert("יש לבחור לפחות זרם אחד לטעינה.");
    return;
  }

  closeWordImportModal();

  const extractWordCall = getBridgeMethod(["extract_word", "editor_extract_word"]);
  const extracted = JSON.parse(await extractWordCall(importPath, JSON.stringify(selected)));
  if (extracted.error) return;

  const main = resetMainPane(paneManagerRef);
  loadWordContent(main?.editor, extracted.main);

  (extracted.streams || []).forEach(([symbol, text], i) => {
    const code = streamCodeFromSymbol(symbol, i);
    let pane = paneManagerRef.panes.find(p => p.streamCode === code);
    if (!pane) {
      pane = paneManagerRef.addPane({
        streamCode: code,
        symbol,
        label: `זרם ${code}`,
      });
    }
    if (pane?.editor) {
      pane.symbol = symbol;
      pane.editor.storage.streamMark.symbol = symbol || null;
      loadWordContent(pane.editor, text);
    }
  });

  onLoadedRef?.();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inlineNodeHtml(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "<br>";

  const inner = Array.from(node.childNodes).map(inlineNodeHtml).join("");
  switch (tag) {
    case "strong":
    case "b":
      return `<b>${inner}</b>`;
    case "em":
    case "i":
      return `<i>${inner}</i>`;
    case "u":
      return `<u>${inner}</u>`;
    case "s":
    case "strike":
    case "del":
      return `<s>${inner}</s>`;
    case "sup":
      return `<sup>${inner}</sup>`;
    case "sub":
      return `<sub>${inner}</sub>`;
    case "a": {
      const href = node.getAttribute("href") || "";
      return href ? `<a href="${escapeAttr(href)}">${inner}</a>` : inner;
    }
    case "span": {
      const style = node.getAttribute("style") || "";
      return style ? `<span style="${escapeAttr(style)}">${inner}</span>` : inner;
    }
    default:
      return inner;
  }
}

function getRichHtml(editor) {
  if (!editor) return "";
  const template = document.createElement("template");
  template.innerHTML = editor.getHTML();
  const lines = [];
  for (const node of Array.from(template.content.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && /^(p|div|li|h[1-6])$/i.test(node.tagName)) {
      lines.push(Array.from(node.childNodes).map(inlineNodeHtml).join(""));
    } else {
      const html = inlineNodeHtml(node);
      if (html) lines.push(html);
    }
  }
  return lines.join("<br>");
}

function mainWordHtml(editor) {
  const mainRich = getRichHtml(editor);
  return mainRich.split("<br>").join("</span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>");
}

function notePartsFromPane(pane) {
  const symbol = pane.symbol || (pane.streamCode ? `@${pane.streamCode}` : "");
  if (!symbol || !pane.editor) return null;
  const noteRich = getRichHtml(pane.editor);
  const parts = noteRich.split(symbol);
  if (parts.length > 0 && parts[0].trim() === "") parts.shift();
  return { symbol, prefix: `[${pane.streamCode}] `, parts, counter: 0 };
}

export async function exportWord(paneManager) {
  if (!hasWordBridge()) {
    wordUnavailable();
    return;
  }

  const main = paneManager.getMainPane();
  let mainContent = mainWordHtml(main?.editor);
  const configs = paneManager.panes
    .filter(p => p.streamCode)
    .map(notePartsFromPane)
    .filter(Boolean)
    .sort((a, b) => b.symbol.length - a.symbol.length);

  let footnoteHtml = "";
  let nextId = 1;
  if (configs.length) {
    const regex = new RegExp(`(${configs.map(c => c.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    mainContent = mainContent.replace(regex, (match) => {
      const cfg = configs.find(c => c.symbol === match);
      if (!cfg || cfg.counter >= cfg.parts.length) return match;

      const note = cfg.parts[cfg.counter].trim().replace(/<br>/g, " ");
      cfg.counter++;
      const id = nextId++;
      const ref = `<a style='mso-footnote-id:ftn${id}; vertical-align:super; font-size:80%;' href='#_ftn${id}' name='_ftnref${id}'><span class='MsoFootnoteReference'><span style='mso-special-character:footnote'></span></span></a>`;
      footnoteHtml += `<div style='mso-element:footnote' id='ftn${id}'><p class="MsoFootnoteText"><a style='mso-footnote-id:ftn${id}' href='#_ftnref${id}' name='_ftn${id}'><span class='MsoFootnoteReference'><span style='mso-special-character:footnote'></span></span></a><span dir="rtl" lang="HE"> <b>${cfg.prefix}</b> ${note}</span></p></div>`;
      return ref;
    });
  }

  if (isDemoMode()) {
    ensureDemoAccess();
    mainContent = applyDemoWatermarkToHtml(mainContent);
    footnoteHtml = applyDemoWatermarkToHtml(footnoteHtml);
  }

  const exportWordCall = getBridgeMethod(["export_word", "editor_export_word"]);
  const result = JSON.parse(await exportWordCall(mainContent, footnoteHtml));
  if (result.success) {
    try { await getBridgeMethod(["set_modified", "editor_set_modified"])?.(false); } catch {}
    alert(`הקובץ נשמר בהצלחה:\n${result.path}`);
  }
}

export function setupWordBridge(paneManager, onLoaded) {
  paneManagerRef = paneManager;
  onLoadedRef = onLoaded || null;
  setupWordSyncHub();
  window.addEventListener("pywebviewready", setupWordSyncHub, { once: true });
  document.getElementById("word-import-confirm")?.addEventListener("click", () => {
    confirmWordImport();
  });
  document.getElementById("word-import-cancel")?.addEventListener("click", () => {
    closeWordImportModal();
  });
}
