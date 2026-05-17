// word_extractor.js — main entry point for the standalone JS Word extractor.
// משלב את החלקים: dialog (UI), engine (port מ-word_extractor.py),
// streams (מיפוי A/B/C/D), i18n (מחרוזות).
//
// API ציבורי:
//   - openWordExtractor(paneManager, onLoaded)
//   - setupWordExtractor(paneManager, onLoaded)
//   - re-export של engine + streams לשימוש מתקדם.

import JSZip from "jszip";
import { openWordExtractor as openWordExtractorDialog, closeModal as closeWordExtractorModal } from "./word_extractor_dialog.js";
import * as engine from "./word_extractor_engine.js";
import * as streams from "./word_extractor_streams.js";
import * as i18n from "./word_extractor_i18n.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";
import { loadTextStyles, fontSizeCssValue } from "../style_registry.js";

let _paneManagerRef = null;
let _onLoadedRef = null;
let _streamsObserver = null;
let _previewObserver = null;
let _captureInstalled = false;
let _pendingEnhancement = null;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStreamSymbol(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const match = raw.match(/^@?\s*(\d{1,3})$/);
  if (!match) return fallback;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1 || n > 999) return fallback;
  return `@${String(n).padStart(2, "0")}`;
}

function streamCodeFromSymbol(symbol) {
  return String(symbol || "").replace(/^@/, "");
}

function getExtractorModal() {
  return document.getElementById("word-extractor-modal");
}

function ensureOverwriteStylesCheckboxVisible() {
  const modal = getExtractorModal();
  if (!modal || modal.querySelector(".we-overwrite-styles")) return;

  const importStyles = modal.querySelector(".we-import-styles");
  if (!importStyles) return;

  const importStylesLabel = importStyles.closest("label");
  if (!importStylesLabel || !importStylesLabel.parentElement) return;

  const label = document.createElement("label");
  label.style.cssText = "display:block; padding:3px 0;";
  label.innerHTML = `
          <input type="checkbox" class="we-overwrite-styles" checked>
          דרוס סגנונות קיימים
        `;
  importStylesLabel.insertAdjacentElement("afterend", label);
}

function ensureHideEmptyNotesUiCheckboxVisible() {
  const modal = getExtractorModal();
  if (!modal) return;
  if (!modal.querySelector(".we-hide-empty-notes-ui")) {
    const skipEmpty = modal.querySelector(".we-skip-empty-notes");
    if (!skipEmpty) return;
    const skipLabel = skipEmpty.closest("label");
    if (!skipLabel || !skipLabel.parentElement) return;

    const label = document.createElement("label");
    label.style.cssText = "display:block; padding:3px 0;";
    label.innerHTML = `
          <input type="checkbox" class="we-hide-empty-notes-ui" disabled>
          הסתר הערות ריקות במסך הייבוא
        `;
    skipLabel.insertAdjacentElement("afterend", label);

    skipEmpty.addEventListener("change", syncHideEmptyNotesUiCheckbox);
    label.querySelector(".we-hide-empty-notes-ui")?.addEventListener("change", applyPreviewHiddenEmptyNotes);
  }
  syncHideEmptyNotesUiCheckbox();
}

function syncHideEmptyNotesUiCheckbox() {
  const modal = getExtractorModal();
  const skipEmpty = modal?.querySelector(".we-skip-empty-notes");
  const hideUi = modal?.querySelector(".we-hide-empty-notes-ui");
  if (!skipEmpty || !hideUi) return;
  const enabled = skipEmpty.checked === true;
  hideUi.disabled = !enabled;
  if (!enabled) hideUi.checked = false;
  applyPreviewHiddenEmptyNotes();
}

function stylesOptionsHtml() {
  let styles = [];
  try {
    styles = loadTextStyles() || [];
  } catch (_) {
    styles = [];
  }
  const options = ['<option value="">ללא סגנון מיוחד</option>'];
  for (const style of styles) {
    if (!style?.id) continue;
    const suffix = style.source === "docx" ? " · Word" : "";
    options.push(`<option value="${escapeHtml(style.id)}">${escapeHtml((style.name || style.id) + suffix)}</option>`);
  }
  return options.join("");
}

function getRowsInCurrentOrder() {
  const modal = getExtractorModal();
  return Array.from(modal?.querySelectorAll(".we-streams-body tr") || []);
}

function getRowCodeInput(row) {
  return row.querySelector('.we-stream-code-input')
    || row.querySelector('input[type="text"][placeholder^="@"]');
}

function ensureStreamMappingControlsVisible() {
  const modal = getExtractorModal();
  if (!modal) return;
  ensureOverwriteStylesCheckboxVisible();
  ensureHideEmptyNotesUiCheckboxVisible();

  const codeHeader = modal.querySelector(".we-streams thead th:nth-child(5)");
  if (codeHeader) codeHeader.textContent = "קוד זרם";

  const rows = getRowsInCurrentOrder();
  if (!rows.length) return;

  rows.forEach((row, index) => {
    const defaultSym = `@${String(index + 1).padStart(2, "0")}`;
    const cells = row.querySelectorAll("td");
    const seriesCell = cells[4];
    if (!seriesCell) return;

    const originalSeriesSelect = seriesCell.querySelector("select:not(.we-stream-style-select)");
    if (originalSeriesSelect) {
      originalSeriesSelect.classList.add("we-original-series-select");
      originalSeriesSelect.setAttribute("aria-hidden", "true");
      originalSeriesSelect.tabIndex = -1;
    }

    let codeInput = getRowCodeInput(row);
    if (!codeInput) {
      codeInput = document.createElement("input");
      codeInput.type = "text";
      codeInput.style.cssText = "width:54px;margin-right:4px;font-size:12px;padding:2px 4px;";
      seriesCell.insertBefore(codeInput, seriesCell.firstChild);
    }
    codeInput.classList.add("we-stream-code-input");
    codeInput.placeholder = defaultSym;
    codeInput.title = "קוד מזהה לזרם — למשל @01, @02. ברירת המחדל היא לפי הסדר.";
    const prevAuto = codeInput.dataset.autoValue || "";
    const userTouched = codeInput.dataset.userTouched === "1";
    if (!userTouched || !codeInput.value.trim() || codeInput.value.trim() === prevAuto) {
      codeInput.value = defaultSym;
      codeInput.dataset.autoValue = defaultSym;
    }
    if (codeInput.dataset.listenerInstalled !== "1") {
      codeInput.dataset.listenerInstalled = "1";
      codeInput.addEventListener("input", () => {
        codeInput.dataset.userTouched = "1";
      });
    }

    if (!row.querySelector(".we-stream-style-select")) {
      const wrap = document.createElement("div");
      wrap.className = "we-stream-style-wrap";
      wrap.style.cssText = "margin-top:4px;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;";
      wrap.innerHTML = `
        <span style="font-size:11px;color:#64748b;">סגנון:</span>
        <select class="we-stream-style-select" title="סגנון שיוחל על כל הזרם אחרי הייבוא" style="max-width:150px;font-size:12px;padding:2px 4px;">
          ${stylesOptionsHtml()}
        </select>
      `;
      seriesCell.appendChild(wrap);
    }
  });
}

function installStreamsObserver() {
  const modal = getExtractorModal();
  const body = modal?.querySelector(".we-streams-body");
  if (!modal || !body) return;

  if (_streamsObserver) {
    try { _streamsObserver.disconnect(); } catch (_) {}
  }
  _streamsObserver = new MutationObserver(() => {
    ensureStreamMappingControlsVisible();
  });
  _streamsObserver.observe(body, { childList: true, subtree: true });
  ensureStreamMappingControlsVisible();
}

function installPreviewObserver() {
  const modal = getExtractorModal();
  const list = modal?.querySelector(".we-preview-list");
  if (!modal || !list) return;
  if (_previewObserver) {
    try { _previewObserver.disconnect(); } catch (_) {}
  }
  _previewObserver = new MutationObserver(applyPreviewHiddenEmptyNotes);
  _previewObserver.observe(list, { childList: true, subtree: true });
  applyPreviewHiddenEmptyNotes();
}

function previewTextWithoutMarker(text) {
  return String(text || "")
    .replace(/^\s*@\d+\s*:?\s*/, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function applyPreviewHiddenEmptyNotes() {
  const modal = getExtractorModal();
  const hideUi = modal?.querySelector(".we-hide-empty-notes-ui");
  const list = modal?.querySelector(".we-preview-list");
  const shouldHide = !!hideUi && !hideUi.disabled && hideUi.checked === true;
  if (!list) return;
  list.querySelectorAll("li").forEach((li) => {
    const isEmpty = previewTextWithoutMarker(li.textContent).length === 0;
    li.classList.toggle("we-empty-note-hidden", shouldHide && isEmpty);
  });
}

function readIncludedRowsAndMappings() {
  const rows = getRowsInCurrentOrder();
  const includedRows = rows.filter((row) => {
    const include = row.querySelector('td input[type="checkbox"]');
    return include ? include.checked !== false : true;
  });

  return includedRows.map((row, orderIndex) => {
    const autoSym = `@${String(orderIndex + 1).padStart(2, "0")}`;
    const codeInput = getRowCodeInput(row);
    const targetSym = normalizeStreamSymbol(codeInput?.value, autoSym);
    const styleId = row.querySelector(".we-stream-style-select")?.value || "";
    return {
      rowIndex: Number(row.dataset.idx || orderIndex),
      orderIndex,
      autoSym,
      targetSym,
      styleId,
    };
  });
}

function installConfirmCapture() {
  if (_captureInstalled || typeof document === "undefined") return;
  _captureInstalled = true;
  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".we-confirm");
    const modal = btn?.closest?.("#word-extractor-modal");
    if (!btn || !modal) return;
    captureImportEnhancementState(modal);
  }, true);
}

function captureImportEnhancementState(modal) {
  const file = modal.querySelector(".we-file-input")?.files?.[0] || null;
  const mappings = readIncludedRowsAndMappings();
  const skipEmptyNotes = modal.querySelector(".we-skip-empty-notes")?.checked !== false;
  const markerMatchMode = modal.querySelector(".we-marker-match-mode")?.value || "starts";

  _pendingEnhancement = {
    file,
    mappings,
    skipEmptyNotes,
    markerMatchMode,
    emptyReferencePlan: skipEmptyNotes && file
      ? buildEmptyReferencePlan(file, mappings, markerMatchMode).catch((err) => {
          console.warn("[word_extractor] empty-note link plan failed:", err);
          return [];
        })
      : Promise.resolve([]),
  };
}

async function buildEmptyReferencePlan(file, mappings, markerMatchMode) {
  const buf = await file.arrayBuffer();
  const sources = await engine.find_all_note_sources(buf.slice(0));
  const defaultStreams = streams.buildDefaultStreamMapping(sources || []);

  const selected = mappings.map((mapping) => {
    const src = defaultStreams[mapping.rowIndex] || {};
    return {
      ...mapping,
      sourceType: src.source_type || src.sourceType || src.source,
      marker: src.marker || null,
    };
  });

  const routing = {
    footnote: { markerToSymbol: {}, noneSymbol: null },
    endnote: { markerToSymbol: {}, noneSymbol: null },
    comment: { markerToSymbol: {}, noneSymbol: null },
  };
  for (const item of selected) {
    const bucket = routing[item.sourceType];
    if (!bucket) continue;
    if (item.marker) bucket.markerToSymbol[String(item.marker)] = item.autoSym;
    else bucket.noneSymbol = bucket.noneSymbol || item.autoSym;
  }

  const [footnotes, endnotes, comments] = await Promise.all([
    engine.read_footnotes(buf.slice(0)).catch(() => ({})),
    engine.read_endnotes(buf.slice(0)).catch(() => ({})),
    engine.read_comments(buf.slice(0)).catch(() => ({})),
  ]);

  const zip = await JSZip.loadAsync(buf.slice(0));
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) return [];

  const refs = refsInDocumentOrder(docXml);
  const plan = [];

  for (const ref of refs) {
    const note = ref.type === "footnote"
      ? footnotes[ref.id]
      : ref.type === "endnote"
        ? endnotes[ref.id]
        : comments[ref.id];
    if (!note) continue;

    const text = typeof note.get_text === "function" ? note.get_text() : String(note || "");
    const resolved = resolveNoteRouting(text, routing[ref.type], markerMatchMode);
    if (!resolved?.symbol) continue;

    const cleaned = stripRoutingMarker(text, resolved.marker, markerMatchMode);
    plan.push({
      symbol: resolved.symbol,
      keep: !isEmptyImportedNoteText(cleaned),
    });
  }

  return plan;
}

function refsInDocumentOrder(docXml) {
  const doc = new DOMParser().parseFromString(docXml, "application/xml");
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      const local = node.localName;
      if (local === "footnoteReference" || local === "endnoteReference" || local === "commentReference") {
        const id = node.getAttributeNS(engine.WNS, "id") || node.getAttribute("w:id") || node.getAttribute("id");
        if (id != null) {
          out.push({
            type: local === "footnoteReference" ? "footnote" : local === "endnoteReference" ? "endnote" : "comment",
            id: String(id),
          });
        }
      }
    }
    for (const child of Array.from(node.childNodes || [])) walk(child);
  };
  walk(doc.documentElement);
  return out;
}

function resolveNoteRouting(text, route, markerMatchMode) {
  if (!route) return null;
  const marker = findMatchedMarker(text, route.markerToSymbol, markerMatchMode);
  if (marker && route.markerToSymbol[marker]) {
    return { symbol: route.markerToSymbol[marker], marker };
  }
  if (!/@\d+/.test(String(text || "")) && route.noneSymbol) {
    return { symbol: route.noneSymbol, marker: null };
  }
  return null;
}

function findMatchedMarker(text, markerToSymbol, markerMatchMode) {
  const source = String(text || "");
  const markers = Object.keys(markerToSymbol || {});
  if (!markers.length) return null;

  if (markerMatchMode === "contains") {
    const found = source.match(/@(\d+)/);
    if (found && markerToSymbol[found[1]]) return found[1];
    return null;
  }

  const trimmed = source.trimStart();
  const found = trimmed.match(/^@(\d+)/);
  if (found && markerToSymbol[found[1]]) return found[1];
  return null;
}

function stripRoutingMarker(text, marker, markerMatchMode) {
  let out = String(text || "");
  if (!marker) return out;
  const esc = escapeRegExp(marker);
  const re = markerMatchMode === "contains"
    ? new RegExp(`^[\\s\\S]*?@${esc}\\s*:?\\s*`)
    : new RegExp(`^\\s*@${esc}\\s*:?\\s*`);
  return out.replace(re, "");
}

function isEmptyImportedNoteText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, "")
    .length === 0;
}

async function applyPendingImportEnhancements() {
  const pending = _pendingEnhancement;
  _pendingEnhancement = null;
  if (!pending || !_paneManagerRef) return;

  const mainPane = _paneManagerRef.getMainPane?.();
  const emptyPlan = await pending.emptyReferencePlan;

  if (pending.skipEmptyNotes && emptyPlan?.length && mainPane?.editor) {
    removeSkippedEmptyNoteLinks(mainPane.editor, emptyPlan);
  }

  applyStreamSymbolMappings(pending.mappings || []);
  applyStreamStyles(pending.mappings || []);
}

function removeSkippedEmptyNoteLinks(editor, plan) {
  const bySymbol = {};
  for (const item of plan) {
    if (!item?.symbol) continue;
    if (!bySymbol[item.symbol]) bySymbol[item.symbol] = [];
    bySymbol[item.symbol].push(item);
  }
  const symbols = Object.keys(bySymbol);
  if (!symbols.length) return;

  const template = document.createElement("template");
  const before = editor.getHTML();
  template.innerHTML = before;
  const re = new RegExp(symbols.map(escapeRegExp).join("|"), "g");
  let changed = false;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const next = node.nodeValue.replace(re, (sym) => {
      const queue = bySymbol[sym];
      const decision = queue && queue.length ? queue.shift() : null;
      if (decision && decision.keep === false) {
        changed = true;
        return "";
      }
      return sym;
    });
    node.nodeValue = next;
  }

  if (changed) editor.commands.setContent(template.innerHTML);
}

function applyStreamSymbolMappings(mappings) {
  const changes = (mappings || []).filter((m) => m.autoSym && m.targetSym && m.autoSym !== m.targetSym);
  if (!changes.length || !_paneManagerRef) return;

  const mainPane = _paneManagerRef.getMainPane?.();
  if (mainPane?.editor) replaceSymbolsInEditor(mainPane.editor, changes);

  for (const pane of _paneManagerRef.panes || []) {
    if (!pane?.editor) continue;
    replaceSymbolsInEditor(pane.editor, changes);
  }

  for (const mapping of changes) {
    const oldCode = streamCodeFromSymbol(mapping.autoSym);
    const newCode = streamCodeFromSymbol(mapping.targetSym);
    const pane = (_paneManagerRef.panes || []).find((p) => p.streamCode === oldCode || p.symbol === mapping.autoSym);
    if (!pane) continue;
    pane.streamCode = newCode;
    pane.symbol = mapping.targetSym;
    pane.label = `זרם ${mapping.targetSym}`;
    if (pane.editor?.storage?.streamMark) pane.editor.storage.streamMark.symbol = mapping.targetSym;
    if (pane.element) {
      pane.element.dataset.streamCode = newCode;
      const title = pane.element.querySelector?.(".pane-title, .pane-label, header h3, h3");
      if (title) title.textContent = pane.label;
    }
  }
}

function replaceSymbolsInEditor(editor, changes) {
  let html = editor.getHTML();
  const before = html;
  changes.forEach((mapping, index) => {
    html = html.replace(new RegExp(escapeRegExp(mapping.autoSym), "g"), `__RT_STREAM_SYMBOL_${index}__`);
  });
  changes.forEach((mapping, index) => {
    html = html.replace(new RegExp(`__RT_STREAM_SYMBOL_${index}__`, "g"), mapping.targetSym);
  });
  if (html !== before) editor.commands.setContent(html);
}

function applyStreamStyles(mappings) {
  if (!_paneManagerRef) return;
  let styles = [];
  try { styles = loadTextStyles() || []; } catch (_) { styles = []; }
  if (!styles.length) return;

  for (const mapping of mappings || []) {
    if (!mapping.styleId) continue;
    const style = styles.find((s) => s.id === mapping.styleId || s.name === mapping.styleId);
    if (!style) continue;
    const symbol = mapping.targetSym || mapping.autoSym;
    const code = streamCodeFromSymbol(symbol);
    const pane = (_paneManagerRef.panes || []).find((p) => p.streamCode === code || p.symbol === symbol);
    if (pane?.editor) applyStyleToWholeEditor(pane.editor, style);
  }
}

function applyStyleToWholeEditor(editor, style) {
  try {
    const size = editor.state?.doc?.content?.size || 0;
    let chain = editor.chain().focus();
    if (size > 0 && typeof chain.setTextSelection === "function") {
      chain = chain.setTextSelection({ from: 0, to: size });
    }
    if (style.block) {
      if (style.block === "paragraph" && chain.setParagraph) chain = chain.setParagraph();
      else if (/^heading-[1-6]$/.test(style.block) && chain.setHeading) {
        chain = chain.setHeading({ level: Number(style.block.replace("heading-", "")) });
      } else if (style.block === "blockquote" && chain.setBlockquote) {
        chain = chain.setBlockquote();
      }
    }
    if (style.fontFamily && chain.setFontFamily) chain = chain.setFontFamily(style.fontFamily);
    const fontSizeCss = fontSizeCssValue(style);
    if (fontSizeCss && chain.setFontSize) chain = chain.setFontSize(fontSizeCss);
    if (style.color && chain.setColor) chain = chain.setColor(style.color);
    if (style.bgColor && chain.setBackgroundColor) chain = chain.setBackgroundColor(style.bgColor);
    if (style.bold && chain.setBold) chain = chain.setBold();
    if (style.italic && chain.setItalic) chain = chain.setItalic();
    if (style.underline && chain.setUnderline) chain = chain.setUnderline();
    if (style.align && chain.setTextAlign) chain = chain.setTextAlign(style.align);
    if (style.lineHeight && chain.setLineHeight) chain = chain.setLineHeight(String(style.lineHeight));
    if (style.indent != null && chain.setTextIndent) chain = chain.setTextIndent(style.indent);
    if ((style.marginTop != null || style.marginBottom != null) && chain.setBlockSpacing) {
      chain = chain.setBlockSpacing({ marginTop: style.marginTop, marginBottom: style.marginBottom });
    }
    chain.run();
  } catch (err) {
    console.warn("[word_extractor] applying stream style failed:", err);
  }
}

function openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded) {
  installConfirmCapture();
  const wrappedOnLoaded = async () => {
    await applyPendingImportEnhancements();
    if (typeof onLoaded === "function") onLoaded();
  };
  const result = openWordExtractorDialog(paneManager, wrappedOnLoaded);
  // הדיאלוג נבנה סינכרונית, אבל חלק מה-UI נטען אחרי בחירת קובץ.
  ensureOverwriteStylesCheckboxVisible();
  ensureHideEmptyNotesUiCheckboxVisible();
  ensureStreamMappingControlsVisible();
  installStreamsObserver();
  installPreviewObserver();
  setTimeout(() => {
    ensureOverwriteStylesCheckboxVisible();
    ensureHideEmptyNotesUiCheckboxVisible();
    ensureStreamMappingControlsVisible();
    installStreamsObserver();
    installPreviewObserver();
  }, 0);
  return result;
}

export function setupWordExtractor(paneManager, onLoaded) {
  _paneManagerRef = paneManager || null;
  _onLoadedRef = onLoaded || null;
  installConfirmCapture();
}

export async function openImport() {
  await assertToolAllowed("word-extractor");
  return openWordExtractorDialogWithOverwriteStyles(_paneManagerRef, _onLoadedRef);
}

export async function openWordExtractor(paneManager, onLoaded) {
  await assertToolAllowed("word-extractor");
  return openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded);
}

export {
  closeWordExtractorModal,
  engine,
  streams,
  i18n,
};
