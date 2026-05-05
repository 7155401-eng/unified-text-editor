import { domPack, getDomPageGeom } from "./engine/dom_packer.js";
import { renderPages } from "./engine/renderer.js";
import { applyMishnaWrapToPages } from "./mishna_wrap_layout.js";
import { applyTalmudLayoutToPages } from "./talmud_layout.js";
import { applyBalancedColumnsToPages } from "./balanced_columns.js";
import { applyOpeningWordsToPages } from "./opening_word.js";
import { applyOpeningWordStretchToPages } from "./opening_word_stretch.js";
import { getStreamSettings } from "./original_stream_columns.js";
import { firePackerHook } from "./engine/packer_hooks.js";
import { installTalmudDebugV2 } from "./talmud_debug_v2.js";
import { correctTalmudOverflow, correctTalmudOverflowOnPage } from "./talmud_overflow_corrector.js";

// Expose for debug + audit harness.
if (typeof window !== "undefined") {
  window.__talmudCorrectOverflow = correctTalmudOverflow;
  window.__talmudCorrectOverflowOnPage = correctTalmudOverflowOnPage;
}

// Install spec-compliant window.__talmudDebug as soon as bridge loads.
installTalmudDebugV2();

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripDisplayNum(s) {
  return s.trim().replace(/^\[\d+\]\s*/, "");
}

let _docKeyCounter = 0;
const _docKeys = new WeakMap();
let _packerContentCache = { sig: "", value: null };

function docKey(doc) {
  if (!doc || typeof doc !== "object") return "0";
  let key = _docKeys.get(doc);
  if (!key) {
    _docKeyCounter++;
    key = String(_docKeyCounter);
    _docKeys.set(doc, key);
  }
  return key;
}

function paneManagerContentSignature(paneManager) {
  const settings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};
  return paneManager.panes
    .map((p) => [
      p.id,
      p.streamCode || "",
      p.symbol || "",
      p.label || "",
      p.streamCode && settings[p.streamCode]?.title ? settings[p.streamCode].title : "",
      p.streamCode && settings[p.streamCode]?.firstNoteAsTitle ? "title1" : "",
      p.editor ? docKey(p.editor.state.doc) : "0",
    ].join(":"))
    .join("|");
}

function extractMainParagraphs(mainPane, paneManager) {
  if (!mainPane || !mainPane.editor) return [];

  const symbols = [];
  const symbolToCode = {};
  for (const p of paneManager.panes) {
    if (!p.streamCode) continue;
    const sym = p.symbol || `@${p.streamCode}`;
    symbols.push(sym);
    symbolToCode[sym] = p.streamCode;
  }

  if (symbols.length === 0) {
    const paragraphs = [];
    mainPane.editor.state.doc.descendants((node) => {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
      let paragraphText = '';
      node.descendants((child) => {
        if (child.isText) paragraphText += child.text;
        return false;
      });
      paragraphs.push({
        paragraphText,
        markers: [],
        blockType: node.type.name,
        headingLevel: node.type.name === "heading" ? node.attrs?.level || 1 : null,
      });
      return false;
    });
    return paragraphs;
  }

  symbols.sort((a, b) => b.length - a.length);
  const escaped = symbols.map(escapeRegex);
  const re = new RegExp(`(${escaped.join('|')})`, 'g');

  const paragraphs = [];
  mainPane.editor.state.doc.descendants((node) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    let paragraphText = '';
    node.descendants((child) => {
      if (child.isText) paragraphText += child.text;
      return false;
    });
    const markers = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(paragraphText)) !== null) {
      markers.push({
        sym: m[0],
        code: symbolToCode[m[0]],
        atInPara: m.index,
      });
    }
    paragraphs.push({
      paragraphText,
      markers,
      blockType: node.type.name,
      headingLevel: node.type.name === "heading" ? node.attrs?.level || 1 : null,
    });
    return false;
  });

  return paragraphs;
}

function extractStreamNotes(streamPane) {
  if (!streamPane || !streamPane.editor) return [];
  const sym = streamPane.symbol || `@${streamPane.streamCode}`;
  if (!sym) return [];
  const fullText = streamPane.editor.state.doc.textContent;
  const parts = fullText.split(sym);
  if (parts.length <= 1) return [stripDisplayNum(fullText)].filter(Boolean);
  parts.shift();
  return parts.map(stripDisplayNum).filter(Boolean);
}

function applyFirstNoteAsTitle(code, notes) {
  const settings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};
  const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
  const streamSettings = settings[code] || {};
  const manualTitle = String(streamSettings.title || "").trim();
  if (manualTitle) {
    labels[code] = manualTitle;
    return notes;
  }
  if (!streamSettings.firstNoteAsTitle || !notes.length) return notes;
  const title = stripDisplayNum(notes[0] || "");
  if (title) labels[code] = title;
  return notes.slice(1);
}

function ensureEngineStreamSettings(paneManager) {
  getStreamSettings();
  if (!window.__STREAM_LABELS__) window.__STREAM_LABELS__ = {};
  for (const p of paneManager.panes) {
    if (!p.streamCode) continue;
    window.__STREAM_SETTINGS__[p.streamCode] = {
      title: "",
      cols: 1,
      minLinesForCols: 3,
      inline: true,
      lastLineCenter: true,
      firstNoteAsTitle: false,
      ...(window.__STREAM_SETTINGS__[p.streamCode] || {}),
    };
    const manualTitle = String(window.__STREAM_SETTINGS__[p.streamCode].title || "").trim();
    window.__STREAM_LABELS__[p.streamCode] = manualTitle || p.label || `זרם ${p.streamCode}`;
  }
}

export function paneManagerToPackerContent(paneManager) {
  const sig = paneManagerContentSignature(paneManager);
  if (_packerContentCache.sig === sig && _packerContentCache.value) {
    return _packerContentCache.value;
  }

  const mainPane = paneManager.getMainPane();
  if (!mainPane) return [];

  const mainParagraphs = extractMainParagraphs(mainPane, paneManager);
  const streamNotes = {};
  for (const p of paneManager.panes) {
    if (!p.streamCode) continue;
    streamNotes[p.streamCode] = applyFirstNoteAsTitle(p.streamCode, extractStreamNotes(p));
  }

  const result = [];
  const noteCounters = {};

  for (const para of mainParagraphs) {
    const { paragraphText, markers, blockType, headingLevel } = para;
    let mainTextNet = "";
    const notes = [];
    let prevEnd = 0;

    for (const marker of markers) {
      mainTextNet += paragraphText.substring(prevEnd, marker.atInPara);
      const anchor = mainTextNet.length;
      const code = marker.code;
      const idx = noteCounters[code] || 0;
      const noteText = streamNotes[code] && streamNotes[code][idx];

      if (noteText !== undefined) {
        notes.push({ stream: code, text: noteText, anchor });
        noteCounters[code] = idx + 1;
      } else {
        mainTextNet += marker.sym;
      }

      prevEnd = marker.atInPara + marker.sym.length;
    }

    mainTextNet += paragraphText.substring(prevEnd);
    mainTextNet = mainTextNet.replace(/  +/g, ' ').trim();
    if (mainTextNet || notes.length) {
      result.push({
        mainText: mainTextNet,
        notes,
        blockType: blockType === "heading" ? "heading" : "paragraph",
        headingLevel: blockType === "heading" ? Math.max(1, Math.min(6, headingLevel || 1)) : null,
      });
    }
  }

  const displayCounters = {};
  for (const para of result) {
    for (const note of para.notes) {
      displayCounters[note.stream] = (displayCounters[note.stream] || 0) + 1;
      note.num = displayCounters[note.stream];
    }
  }

  _packerContentCache = { sig, value: result };
  return result;
}

export function configureStreamsForClick(paneManager) {
  ensureEngineStreamSettings(paneManager);
}

export function setupPageClickHandler(paneManager, pagesContainer) {
  pagesContainer.addEventListener("click", (ev) => {
    const noteEl = ev.target.closest(".note");
    if (!noteEl) return;

    const streamEl = noteEl.closest(".stream[data-stream]");
    if (!streamEl) return;
    const code = streamEl.getAttribute("data-stream");
    const targetPane = paneManager.panes.find(p => p.streamCode === code);
    if (!targetPane) return;

    const text = noteEl.textContent;
    const match = text.match(/^\s*\[(\d+)\]/);
    if (!match) return;

    const num = parseInt(match[1], 10);
    const sym = targetPane.symbol || `@${code}`;
    targetPane.jumpToNth(sym, num);
  });
}

function schedulePaneMarkerRescan(paneManager) {
  const run = () => {
    for (const pane of paneManager.panes || []) {
      const editor = pane.editor;
      if (!editor) continue;
      const docSize = editor.state.doc.content.size;
      if (docSize > 120000) continue;
      editor.view.dispatch(editor.state.tr.setMeta("forceStreamMarkScan", true));
      pane.scheduleMarkerBarUpdate?.({ immediate: true });
    }
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 0);
  }
}

export function paneManagerFromEngineDoc(paneManager, engineDoc) {
  const paragraphs = [];
  const allStreamCodes = new Set();

  engineDoc.forEach((paragraphNode) => {
    const mainParts = [];
    const notes = [];
    let pending = null;

    function flushPending() {
      if (!pending) return;
      const sym = `@${pending.stream}`;
      mainParts.push(sym);
      notes.push({ stream: pending.stream, text: pending.text });
      allStreamCodes.add(pending.stream);
      pending = null;
    }

    paragraphNode.forEach((child) => {
      if (!child.isText) return;
      const fnMark = child.marks.find((m) => m.type.name === "footnote");
      if (fnMark) {
        const { stream, uid } = fnMark.attrs;
        if (pending && pending.stream === stream && pending.uid === uid) {
          pending.text += child.text;
        } else {
          flushPending();
          pending = { stream, uid, text: child.text };
        }
      } else {
        flushPending();
        mainParts.push(child.text);
      }
    });
    flushPending();
    paragraphs.push({ main: mainParts.join(""), notes });
  });

  function paragraphNodeFromText(text) {
    const value = String(text || "");
    return value
      ? { type: "paragraph", content: [{ type: "text", text: value }] }
      : { type: "paragraph" };
  }

  function docFromParagraphTexts(items) {
    return {
      type: "doc",
      content: items.length ? items.map(paragraphNodeFromText) : [{ type: "paragraph" }],
    };
  }

  if (typeof paneManager._beginBatch === "function") paneManager._beginBatch();
  const prevScanDisabled = typeof window !== "undefined" ? window.__STREAM_MARK_SCAN_DISABLED__ : false;
  if (typeof window !== "undefined") window.__STREAM_MARK_SCAN_DISABLED__ = true;
  try {
  const mainDoc = docFromParagraphTexts(paragraphs.map((p) => p.main));
  const mainPane = paneManager.getMainPane();
  if (mainPane && mainPane.editor) {
    mainPane.load(mainDoc);
  }

  const notesByStream = {};
  for (const para of paragraphs) {
    for (const note of para.notes) {
      if (!notesByStream[note.stream]) notesByStream[note.stream] = [];
      notesByStream[note.stream].push(note.text);
    }
  }

  const sortedCodes = [...allStreamCodes].sort((a, b) => parseInt(a) - parseInt(b));
  for (const code of sortedCodes) {
    const sym = `@${code}`;
    const noteDoc = docFromParagraphTexts(
      (notesByStream[code] || []).map((text, idx) => `${sym} [${idx + 1}] ${text}`)
    );
    let pane = paneManager.panes.find(p => p.streamCode === code);
    if (!pane) {
      pane = paneManager.addPane({
        streamCode: code,
        symbol: sym,
        content: noteDoc,
        label: `זרם ${code}`,
      });
    }
    else if (pane) {
      pane.load(noteDoc);
    }
  }

    paneManager._pendingChange = true;
    paneManager._pendingMarkerRefresh = true;
    paneManager._savePending = true;
  } finally {
    if (typeof window !== "undefined") window.__STREAM_MARK_SCAN_DISABLED__ = prevScanDisabled;
    if (!prevScanDisabled) schedulePaneMarkerRescan(paneManager);
    if (typeof paneManager._endBatch === "function") paneManager._endBatch();
  }

  return true;
}

let _renderToken = 0;
let _debounceTimer = null;
const LIVE_RENDER_DELAY_MS = 650;

export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken);
  }, LIVE_RENDER_DELAY_MS);
}

async function _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken) {
  try {
    ensureEngineStreamSettings(paneManager);
    const t0 = performance.now();
    const content = paneManagerToPackerContent(paneManager);
    const t1 = performance.now();

    if (content.length === 0) {
      pagesContainer.innerHTML = '<div class="empty-hint">אין תוכן לרינדור</div>';
      if (pdfToolbarApi) pdfToolbarApi.setTotal(0);
      window.dispatchEvent(new CustomEvent("ravtext:engine-rendered", {
        detail: { pages: [], content: [] },
      }));
      return;
    }

    const pageGeom = getDomPageGeom();
    const pages = await domPack(content, pageGeom, {
      isCurrent: () => myToken === _renderToken,
    });
    if (myToken !== _renderToken) return;

    const t2 = performance.now();
    renderPages(pages, pagesContainer);
    // Spec-compliant phase order: hooks fire around the layout passes so
    // any future module can hook in without surgery on the packer.
    await firePackerHook("beforeBuild", { container: pagesContainer, pages });
    applyTalmudLayoutToPages(pagesContainer);
    applyMishnaWrapToPages(pagesContainer);
    applyBalancedColumnsToPages(pagesContainer);
    applyOpeningWordsToPages(pagesContainer);
    // Bug 17 + 18: cap stretch at 250% and switch to SVG textLength
    // for visually-correct kerning. Runs AFTER opening_word so it can
    // upgrade existing .opening-word elements.
    applyOpeningWordStretchToPages(pagesContainer);
    // v30-sync: ה-overflow corrector שינה התנהגות לסימון בלבד, וה-overflow check
    // מתבצע כעת סינכרונית בתוך applyTalmudLayoutToPage. הקריאה כאן נשארת
    // כסריקה סופית סינכרונית — בלי RAF, כדי שהמנוע יראה תוצאה אמיתית.
    correctTalmudOverflow(pagesContainer);
    await firePackerHook("afterBuild", { container: pagesContainer, pages });
    const t3 = performance.now();
    const statusEl = document.getElementById("status");
    if (statusEl) {
      const utils = pages.map((p) => Math.min(100, (p.total / pageGeom.maxPageHeight) * 100));
      const avg = utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : 0;
      const allStreams = new Set();
      for (const p of pages) for (const c of Object.keys(p.streams || {})) allStreams.add(c);
      const streams = Array.from(allStreams).sort((a, b) => parseInt(a) - parseInt(b)).join(", ") || "אין";
      statusEl.textContent =
        `${pages.length} עמודים, ניצול ממוצע ${avg.toFixed(1)}% — זרמים: ${streams}`;
    }
    window.dispatchEvent(new CustomEvent("ravtext:engine-rendered", {
      detail: { pages, content },
    }));

    if (pdfToolbarApi) {
      pdfToolbarApi.setTotal(pages.length);
      requestAnimationFrame(() => {
        pdfToolbarApi.rememberBaseSize();
        pdfToolbarApi.applyZoom();
      });
    }

    console.log(`[engine] ${pages.length} pages | extract=${(t1-t0).toFixed(0)}ms pack=${(t2-t1).toFixed(0)}ms render=${(t3-t2).toFixed(0)}ms`);
  } catch (err) {
    console.error("Engine render error:", err);
    pagesContainer.innerHTML = `<div class="error-hint">שגיאת רינדור: ${escapeHtml(err.message)}</div>`;
    if (pdfToolbarApi) pdfToolbarApi.setTotal(0);
    window.dispatchEvent(new CustomEvent("ravtext:engine-rendered", {
      detail: { pages: [], content: [], error: err.message },
    }));
  }
}
