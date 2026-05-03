import { domPack, DOM_PAGE_GEOM } from "./engine/dom_packer.js";
import { renderPages } from "./engine/renderer.js";
import { applyMishnaWrapToPages } from "./mishna_wrap_layout.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripDisplayNum(s) {
  return s.trim().replace(/^\[\d+\]\s*/, "");
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
      paragraphs.push({ paragraphText, markers: [] });
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
    paragraphs.push({ paragraphText, markers });
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

function ensureEngineStreamSettings(paneManager) {
  if (!window.__STREAM_SETTINGS__) window.__STREAM_SETTINGS__ = {};
  for (const p of paneManager.panes) {
    if (!p.streamCode) continue;
    window.__STREAM_SETTINGS__[p.streamCode] = {
      cols: 1,
      minLinesForCols: 3,
      inline: true,
      lastLineCenter: true,
      ...(window.__STREAM_SETTINGS__[p.streamCode] || {}),
    };
  }
}

export function paneManagerToPackerContent(paneManager) {
  const mainPane = paneManager.getMainPane();
  if (!mainPane) return [];

  const mainParagraphs = extractMainParagraphs(mainPane, paneManager);
  const streamNotes = {};
  for (const p of paneManager.panes) {
    if (!p.streamCode) continue;
    streamNotes[p.streamCode] = extractStreamNotes(p);
  }

  const result = [];
  const noteCounters = {};

  for (const para of mainParagraphs) {
    const { paragraphText, markers } = para;
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
    if (mainTextNet || notes.length) result.push({ mainText: mainTextNet, notes });
  }

  const displayCounters = {};
  for (const para of result) {
    for (const note of para.notes) {
      displayCounters[note.stream] = (displayCounters[note.stream] || 0) + 1;
      note.num = displayCounters[note.stream];
    }
  }

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

  const mainHtml = paragraphs.map(p => `<p>${escapeHtml(p.main)}</p>`).join('') || '<p></p>';
  const mainPane = paneManager.getMainPane();
  if (mainPane && mainPane.editor) {
    mainPane.editor.commands.setContent(mainHtml);
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
    let pane = paneManager.panes.find(p => p.streamCode === code);
    if (!pane) {
      pane = paneManager.addPane({
        streamCode: code,
        symbol: sym,
        label: `זרם ${code}`,
      });
    }
    if (pane && pane.editor && notesByStream[code]) {
      const noteHtml = notesByStream[code]
        .map((text, idx) => `<p>${escapeHtml(sym)} [${idx + 1}] ${escapeHtml(text)}</p>`)
        .join('');
      pane.editor.commands.setContent(noteHtml);
    }
  }

  return true;
}

let _renderToken = 0;
let _debounceTimer = null;

export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken);
  }, 200);
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

    const pages = await domPack(content, DOM_PAGE_GEOM, {
      isCurrent: () => myToken === _renderToken,
    });
    if (myToken !== _renderToken) return;

    const t2 = performance.now();
    renderPages(pages, pagesContainer);
    applyMishnaWrapToPages(pagesContainer);
    const t3 = performance.now();
    const statusEl = document.getElementById("status");
    if (statusEl) {
      const utils = pages.map((p) => (p.total / DOM_PAGE_GEOM.maxPageHeight) * 100);
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
