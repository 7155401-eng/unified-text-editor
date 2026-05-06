import { domPack, getDomPageGeom } from "./engine/dom_packer.js";
import { isDemoMode, DEMO_WATERMARK_POOL } from "./demo_mode.js";

function injectDemoWatermarksIfNeeded(content) {
  if (!isDemoMode() || !Array.isArray(content) || content.length === 0) return content;
  // Inject watermark text into mainText of REGULAR paragraphs only — never
  // headings, never opening-word, never stream titles, never heading 1/2/...
  // משה 2026-05-06: צפיפות גבוהה — כמה פעמים בכל עמוד.
  // אסטרטגיה: בכל פסקה רגילה, הזרקה אחת פר ~80 מילים (לפחות אחת אם > 40 תווים).
  const out = content.map((para) => ({
    ...para,
    notes: para.notes ? para.notes.map(n => ({ ...n })) : [],
  }));
  let phraseIdx = 0;
  function inject(text) {
    // דלג על טקסט קצר (פחות מ-120 תווים) כדי לא להעמיס.
    if (!text || text.length < 120) return text;
    const words = text.split(/(\s+)/);
    const wordTokenCount = words.filter(w => /\S/.test(w)).length;
    if (wordTokenCount < 30) return text;
    // הזרקה אחת לכל ~60 מילים (פחות צפוף — לא יוצר חריגות עמוד).
    const insertions = Math.max(1, Math.floor(wordTokenCount / 60));
    for (let k = 0; k < insertions; k++) {
      const phrase = DEMO_WATERMARK_POOL[phraseIdx++ % DEMO_WATERMARK_POOL.length];
      const wm = ` ⟦${phrase}⟧ `;
      // ודא שהמיקום הוא BETWEEN words (אינדקס זוגי+1 כי הזוגיים הם מילים).
      // Words array: [w0, space0, w1, space1, ...]. Insert AFTER a space.
      const minIdx = Math.min(20, Math.max(10, Math.floor(words.length / 4)));
      let target = Math.max(minIdx, Math.floor(words.length * (k + 1) / (insertions + 1)));
      if (target % 2 === 1) target++; // align to "after space" position
      target = Math.min(words.length - 1, target);
      words.splice(target, 0, wm);
    }
    return words.join("");
  }
  for (let i = 0; i < out.length; i++) {
    const para = out[i];
    if (!para) continue;
    // Main text (skip headings).
    if (para.blockType !== "heading" && !para.headingLevel) {
      para.mainText = inject(para.mainText || "");
    }
    // Stream notes (every stream gets watermarks too).
    if (para.notes && para.notes.length > 0) {
      for (const note of para.notes) {
        if (note && typeof note.text === "string") {
          note.text = inject(note.text);
        }
      }
    }
  }
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[demo-watermark] injected into source", { paraCount: out.length, totalInjections: phraseIdx });
  }
  return out;
}
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
import { repaginateCatastrophicPages } from "./talmud_repagination.js";
import { pullBackwardAcrossAllPages } from "./talmud_pull_backward.js";
import { repaginateMainOverflow } from "./talmud_overflow_repagination.js";
import { logEvent } from "./settings_pane.js";

// v33: expose helpers for diagnostic tools to call directly.
if (typeof window !== "undefined") {
  window.__talmudPullBackward = pullBackwardAcrossAllPages;
}

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
      const allowed = ['paragraph', 'heading', 'codeBlock', 'blockquote'];
      if (!allowed.includes(node.type.name)) return;
      let paragraphText = '';
      node.descendants((child) => {
        if (child.isText) paragraphText += child.text;
        return false;
      });
      paragraphs.push({
        paragraphText,
        markers: [],
        blockType: node.type.name === "heading" ? "heading" : node.type.name,
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
    const allowed = ['paragraph', 'heading', 'codeBlock', 'blockquote'];
    if (!allowed.includes(node.type.name)) return;
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
      blockType: node.type.name === "heading" ? "heading" : node.type.name,
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
    let content = paneManagerToPackerContent(paneManager);
    // v33: inject demo watermarks INTO source content BEFORE pagination —
    // engine then measures heights including marks, so pages don't overflow.
    content = injectDemoWatermarksIfNeeded(content);
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
    logEvent("talmud_layout");
    if (localStorage.getItem("ravtext.talmudLayout.useV2") === "1") {
      const v2 = await import("./talmud_engine_v2.js");
      v2.applyTalmudLayoutToPagesV2(pagesContainer);
    } else {
      applyTalmudLayoutToPages(pagesContainer);
    }
    logEvent("mishna_wrap");
    applyMishnaWrapToPages(pagesContainer);
    logEvent("balanced_columns");
    applyBalancedColumnsToPages(pagesContainer);
    logEvent("opening_word");
    applyOpeningWordsToPages(pagesContainer);
    // Bug 17 + 18: cap stretch at 250% and switch to SVG textLength
    // for visually-correct kerning. Runs AFTER opening_word so it can
    // upgrade existing .opening-word elements.
    logEvent("opening_word_stretch", { pageCount: pagesContainer.querySelectorAll(".page").length });
    applyOpeningWordStretchToPages(pagesContainer);
    // משה 2026-05-06: זרם בודד מתחת לתלמוד שתופס גובה גדול > 50% מהעמוד —
    // אילוץ multi-column אוטומטי. מונע חריגה ב-page-streams עם הערה ענקית.
    pagesContainer.querySelectorAll(".page:not(.page-placeholder)").forEach(p => {
      const pageH = p.clientHeight || 537;
      // כל זרם — בכל מקום (לא רק page-streams ישיר)
      p.querySelectorAll(".stream[data-stream]:not([data-stream-cols])").forEach(s => {
        // לא נוגעים בכתרי תלמוד או בbody
        if (s.classList.contains("talmud-crown-portion") ||
            s.classList.contains("talmud-body-portion") ||
            s.classList.contains("talmud-body-expanded") ||
            s.classList.contains("talmud-no-crown-side") ||
            s.classList.contains("talmud-other-side")) return;
        const h = s.getBoundingClientRect().height;
        if (h > pageH * 0.5) {
          s.style.columnCount = "2";
          s.style.columnGap = "8px";
          s.dataset.streamCols = "auto-2";
        }
      });
    });
    // v33: post-process pipeline for "0 overflows + 0 gaps" goal.
    //  1. Cap any catastrophic overflows first (lossless visual cap).
    //  2. Pull content backward to fill gaps from next page (lossless DOM move).
    //  3. Shrink page sizes to fit actual content (with overflow guard).
    //  4. Final cap pass for any new overflows.
    logEvent("overflow_cap_pass1");
    correctTalmudOverflow(pagesContainer);
    repaginateCatastrophicPages(pagesContainer); // no-op kept for compat
    logEvent("pull_backward_+_shrink_+_move_orphans");
    pullBackwardAcrossAllPages(pagesContainer);
    // v33: repaginateMainOverflow disabled — caused regression in NO-LARGE-GAP.
    // Need more careful integration before re-enabling.
    // logEvent("repaginate_main_overflow_start");
    // repaginateMainOverflow(pagesContainer);
    // logEvent("repaginate_main_overflow_done");
    logEvent("overflow_cap_pass2");
    correctTalmudOverflow(pagesContainer);

    // משה 2026-05-06: בדיקה איטרטיבית — מעמוד לעמוד, אם חורג — דוחפים
    // את הילד האחרון (ראשי או הערה) לעמוד הבא, חוזרים ובודקים.
    // מקסימום 10 איטרציות. עדיפות: דוחפים קודם הערות זרם, אח"כ ראשי.
    // משה 2026-05-06 (חירום): מנגנון זה גורם קטסטרופה ב-talmud mode כי
    // מזיז הערות בלי לעדכן את מבנה הכתר/body. מוגבל למקרה NON-talmud בלבד.
    const isTalmudActive = typeof window !== "undefined" &&
      window.localStorage?.getItem("ravtext.talmudLayout") === "1";
    logEvent("strict_overflow_pushdown_loop_start", { talmudMode: isTalmudActive });
    // משה 2026-05-06: 5 איטרציות, סף 5px. אנטי-פינג-פונג: זוכר אילו פסקאות
    // הוזזו כדי שלא להזיז שוב חזרה.
    const ITERS = isTalmudActive ? 0 : 5;
    const PUSH_THRESHOLD_PX = 5;
    const _movedThisRender = new WeakSet();

    // Talmud-safe push-down: דוחפים הערה אחרונה של זרם NON-talmud (משנ"ב/רגיל)
    // לעמוד הבא כשיש חריגה — לא נוגעים בכתר, body, body-expanded, main.
    if (isTalmudActive) {
      const TALMUD_PUSH_THRESHOLD_PX = 5;
      // Cloud-Chrome 2026-05-06: page-streams pagination אמיתית.
      // לעבור על כל עמוד; אם page-streams גולש מעבר לדף, להעביר ילדי-זרם
      // האחרונים לעמוד הבא עד שהמכל מתאים. עובד כפעולה ראשונה לפני loops אחרים.
      function splitPageStreamsBetweenPages() {
        const pages = Array.from(
          pagesContainer.querySelectorAll(".page:not(.page-placeholder)")
        );
        for (let i = 0; i < pages.length; i++) {
          const cur = pages[i];
          const ps = cur.querySelector(":scope > .page-streams");
          if (!ps) continue;
          void cur.offsetHeight;
          let pageOv = cur.scrollHeight - cur.clientHeight;
          if (pageOv <= TALMUD_PUSH_THRESHOLD_PX) continue;
          // מצא או צור עמוד הבא
          let next = pages[i + 1];
          if (!next) {
            next = document.createElement("div");
            next.className = "page talmud-layout-page";
            next.dir = "rtl";
            // pass 150: למנוע duplication של pageIndex עם placeholders שיוצרו
            // ע"י ה-engine. במקום להשתמש ב-pages.length שעלול להתנגש, מחפשים
            // את ה-max page-index קיים בdom ומקצים +1.
            const allWithIdx = pagesContainer.querySelectorAll("[data-page-index]");
            let maxIdx = -1;
            allWithIdx.forEach(p => {
              const n = parseInt(p.dataset.pageIndex, 10);
              if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
            });
            next.dataset.pageIndex = String(maxIdx + 1);
            const newPS = document.createElement("div");
            newPS.className = "page-streams";
            next.appendChild(newPS);
            // pass 149: להכניס מיד אחרי cur, לא בסוף — אחרת ייכנס אחרי
            // page-placeholder slots וייעלם מהתצוגה.
            if (cur.nextSibling) cur.parentNode.insertBefore(next, cur.nextSibling);
            else cur.parentNode.appendChild(next);
            pages.push(next);
          }
          let nextPS = next.querySelector(":scope > .page-streams");
          if (!nextPS) {
            nextPS = document.createElement("div");
            nextPS.className = "page-streams";
            next.appendChild(nextPS);
          }
          // לולאה: בכל איטרציה, מוצאים את הזרם הכי-נמוך-Y בpage-streams,
          // ומעבירים את הילד האחרון שלו (או ילד-בודד עם spans פנימיים) לnext.
          let safety = 50;
          while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {
            const streams = Array.from(ps.querySelectorAll(":scope > .stream[data-stream]"));
            if (streams.length === 0) break;
            // לוקחים את הזרם האחרון (גיאוגרפית/DOM)
            const lastStream = streams[streams.length - 1];
            const code = lastStream.getAttribute("data-stream");
            // ירידה בעוטפים בודדים
            let pushSrc = lastStream;
            for (let depth = 0; depth < 4; depth++) {
              const realCh = Array.from(pushSrc.children).filter(
                c => !c.classList?.contains("stream-title")
              );
              if (realCh.length === 1 && /^(DIV|SPAN)$/i.test(realCh[0].tagName) &&
                  realCh[0].children.length > 1) {
                pushSrc = realCh[0];
              } else break;
            }
            const childrenLeft = Array.from(pushSrc.children).filter(
              c => !c.classList?.contains("stream-title")
            );
            if (childrenLeft.length === 0) break; // נשארה רק כותרת — אי אפשר להוריד עוד
            const lastChild = childrenLeft[childrenLeft.length - 1];
            // יעד ב-next: חיפוש או יצירה
            let target = code
              ? nextPS.querySelector(`:scope > .stream[data-stream="${code}"]`)
              : null;
            if (!target) {
              target = document.createElement("div");
              target.className = lastStream.className;
              if (code) target.setAttribute("data-stream", code);
              const oldTitle = lastStream.querySelector(":scope > .stream-title");
              if (oldTitle) {
                const t = oldTitle.cloneNode(true);
                target.appendChild(t);
              }
              nextPS.insertBefore(target, nextPS.firstChild);
            }
            // יעד פנימי (אם יש wrapper)
            let dest = target;
            if (pushSrc !== lastStream) {
              // נניח לפשטות: dest = target (ה-wrappers ייווצרו אם צריך)
              const wrapClass = pushSrc.className;
              const sel = `:scope > ${pushSrc.tagName.toLowerCase()}` +
                (wrapClass ? "." + wrapClass.trim().split(/\s+/).join(".") : "");
              let existing = target.querySelector(sel);
              if (!existing) {
                existing = pushSrc.cloneNode(false);
                target.appendChild(existing);
              }
              dest = existing;
            }
            const nextTitle = dest.querySelector(":scope > .stream-title");
            if (nextTitle) dest.insertBefore(lastChild, nextTitle.nextSibling);
            else dest.insertBefore(lastChild, dest.firstChild);
            void cur.offsetHeight;
            pageOv = cur.scrollHeight - cur.clientHeight;
          }
          // pass 150: עדכון ה-attribute אחרי הפיצול. ה-attr הישן (1049) משאיר
          // את ה-validator (INV-8) חושב שיש failure גם אחרי שהtkov ירד. גם
          // לסמן/להסיר את ה-class talmud-page-overflow לפי המצב הנוכחי.
          void cur.offsetHeight;
          const finalOv = cur.scrollHeight - cur.clientHeight;
          if (finalOv > 1) {
            cur.setAttribute("data-talmud-overflow-px", String(Math.round(finalOv)));
            cur.classList.add("talmud-page-overflow");
          } else {
            cur.removeAttribute("data-talmud-overflow-px");
            cur.classList.remove("talmud-page-overflow");
          }
        }
      }
      splitPageStreamsBetweenPages();
      // משה 2026-05-06 (pass 153): לולאת מתקנים רציפה — לא רק 200ms+1500ms.
      // רץ עד שאין שינוי במצב ה-overflow ב-3 איטרציות רצופות, או עד 30
      // איטרציות (cap בטיחותי). כל איטרציה: split + measure + repeat אם
      // משהו השתנה.
      function measureTotalOverflow() {
        let sum = 0;
        pagesContainer.querySelectorAll(".page:not(.page-placeholder)").forEach(p => {
          const ov = p.scrollHeight - p.clientHeight;
          if (ov > 1) sum += ov;
        });
        return sum;
      }
      function runFullSplitterPass() {
        try {
          splitPageStreamsBetweenPages();
          if (typeof splitBodyExpandedBetweenPages === "function") {
            splitBodyExpandedBetweenPages();
          }
        } catch (e) { console.warn("[splitter] error:", e); }
      }
      function loopUntilStable() {
        let prevOverflow = measureTotalOverflow();
        let stableHits = 0;
        const MAX_ITERS = 30;
        for (let i = 0; i < MAX_ITERS; i++) {
          runFullSplitterPass();
          const curOverflow = measureTotalOverflow();
          if (curOverflow === 0) break; // ניצחון מלא
          if (curOverflow === prevOverflow) {
            stableHits++;
            if (stableHits >= 3) break; // לא משתנה — עוצרים
          } else {
            stableHits = 0;
          }
          prevOverflow = curOverflow;
        }
      }
      // הרצה ראשונה מיד; שתי הרצות מאוחרות (200ms + 1500ms) בלולאה רציפה
      // לכל אחת — לתפוס late-layout/font-loading.
      setTimeout(loopUntilStable, 200);
      setTimeout(loopUntilStable, 1500);
      // pass 146: גם body-expanded בתוך talmud-layout יכול לגלוש (P5 case).
      // אם ה-body-expanded ארוך מדי, מעבירים note-parts (spans) האחרונים לעמוד הבא.
      function splitBodyExpandedBetweenPages() {
        const pages = Array.from(
          pagesContainer.querySelectorAll(".page:not(.page-placeholder)")
        );
        window.__SPLIT_BE_DEBUG__ = window.__SPLIT_BE_DEBUG__ || [];
        for (let i = 0; i < pages.length; i++) {
          const cur = pages[i];
          void cur.offsetHeight;
          let pageOv = cur.scrollHeight - cur.clientHeight;
          if (pageOv <= TALMUD_PUSH_THRESHOLD_PX) continue;
          const expandedList = cur.querySelectorAll(".talmud-body-expanded, [data-talmud-role*='expanded']");
          window.__SPLIT_BE_DEBUG__.push({ page: i, ov: pageOv, expCount: expandedList.length });
          if (expandedList.length === 0) continue;
          // צור/מצא next page
          let next = pages[i + 1];
          if (!next) {
            next = document.createElement("div");
            next.className = "page talmud-layout-page";
            next.dir = "rtl";
            // pass 150: למנוע duplication של pageIndex עם placeholders שיוצרו
            // ע"י ה-engine. במקום להשתמש ב-pages.length שעלול להתנגש, מחפשים
            // את ה-max page-index קיים בdom ומקצים +1.
            const allWithIdx = pagesContainer.querySelectorAll("[data-page-index]");
            let maxIdx = -1;
            allWithIdx.forEach(p => {
              const n = parseInt(p.dataset.pageIndex, 10);
              if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
            });
            next.dataset.pageIndex = String(maxIdx + 1);
            const newPS = document.createElement("div");
            newPS.className = "page-streams";
            next.appendChild(newPS);
            // pass 149: להכניס מיד אחרי cur, לא בסוף — אחרת ייכנס אחרי
            // page-placeholder slots וייעלם מהתצוגה.
            if (cur.nextSibling) cur.parentNode.insertBefore(next, cur.nextSibling);
            else cur.parentNode.appendChild(next);
            pages.push(next);
          }
          let safety = 50;
          while (pageOv > TALMUD_PUSH_THRESHOLD_PX && safety-- > 0) {
            // מוצאים את ה-body-expanded האחרון בעמוד; יורדים בעוטפים בודדים;
            // מעבירים את הילד האחרון לעמוד הבא (יוצרים stream חדש בpage-streams)
            const exps = Array.from(cur.querySelectorAll(".talmud-body-expanded"));
            if (exps.length === 0) break;
            const exp = exps[exps.length - 1];
            let pushSrc = exp;
            for (let depth = 0; depth < 5; depth++) {
              const realCh = Array.from(pushSrc.children).filter(
                c => !c.classList?.contains("stream-title")
              );
              if (realCh.length === 1 && realCh[0].children.length > 1) {
                pushSrc = realCh[0];
              } else break;
            }
            const childrenLeft = Array.from(pushSrc.children).filter(
              c => !c.classList?.contains("stream-title")
            );
            if (childrenLeft.length <= 1) break;
            const lastChild = childrenLeft[childrenLeft.length - 1];
            // יעד בעמוד הבא: stream חדש בpage-streams עם code זהה
            const code = exp.dataset.talmudBodyOf || exp.getAttribute("data-stream") || "";
            const nextPS = next.querySelector(":scope > .page-streams");
            if (!nextPS) break;
            let target = code
              ? nextPS.querySelector(`:scope > .stream[data-stream="${code}"]`)
              : null;
            if (!target) {
              target = document.createElement("div");
              target.className = `stream stream-color-${(parseInt(code, 10) - 1) % 6 + 1} talmud-body-expanded-continued`;
              if (code) target.setAttribute("data-stream", code);
              const title = document.createElement("div");
              title.className = "stream-title";
              title.textContent = `זרם ${code} (המשך)`;
              target.appendChild(title);
              nextPS.insertBefore(target, nextPS.firstChild);
            }
            const nextTitle = target.querySelector(":scope > .stream-title");
            if (nextTitle) target.insertBefore(lastChild, nextTitle.nextSibling);
            else target.insertBefore(lastChild, target.firstChild);
            void cur.offsetHeight;
            pageOv = cur.scrollHeight - cur.clientHeight;
          }
          // pass 150: עדכון attribute + class גם כאן (סינכרון אחרי body-expanded split).
          void cur.offsetHeight;
          const finalOv = cur.scrollHeight - cur.clientHeight;
          if (finalOv > 1) {
            cur.setAttribute("data-talmud-overflow-px", String(Math.round(finalOv)));
            cur.classList.add("talmud-page-overflow");
          } else {
            cur.removeAttribute("data-talmud-overflow-px");
            cur.classList.remove("talmud-page-overflow");
          }
        }
      }
      splitBodyExpandedBetweenPages();
      // אם העמוד האחרון חורג — צור עמוד חדש בסוף לקבל את העודף
      function ensureNextPage(allPages) {
        const last = allPages[allPages.length - 1];
        if (!last) return allPages;
        const ov = last.scrollHeight - last.clientHeight;
        if (ov <= TALMUD_PUSH_THRESHOLD_PX) return allPages;
        const newPage = document.createElement("div");
        newPage.className = "page talmud-layout-page";
        newPage.dir = "rtl";
        newPage.dataset.pageIndex = String(allPages.length);
        newPage.dataset.realized = "1";
        const ms = last.querySelector(":scope > .page-main");
        const ss = last.querySelector(":scope > .page-streams");
        if (ms) {
          const np = document.createElement("div");
          np.className = "page-main talmud-main";
          newPage.appendChild(np);
        }
        if (ss) {
          const np = document.createElement("div");
          np.className = "page-streams";
          newPage.appendChild(np);
        }
        // pass 149: להכניס מיד אחרי last, לא בסוף — אחרת ייכנס אחרי
        // page-placeholder slots וייעלם מהתצוגה.
        if (last.nextSibling) last.parentNode.insertBefore(newPage, last.nextSibling);
        else last.parentNode.appendChild(newPage);
        return Array.from(
          pagesContainer.querySelectorAll(".page:not(.page-placeholder)")
        );
      }
      for (let it = 0; it < 20; it++) {
        let pushed = false;
        let allPages = Array.from(
          pagesContainer.querySelectorAll(".page:not(.page-placeholder)")
        );
        // אם העמוד האחרון חורג — הוסף עמוד חדש קודם
        if (allPages.length > 0) {
          const lastP = allPages[allPages.length - 1];
          const lov = lastP.scrollHeight - lastP.clientHeight;
          if (lov > TALMUD_PUSH_THRESHOLD_PX) {
            allPages = ensureNextPage(allPages);
          }
        }
        for (let i = 0; i < allPages.length - 1; i++) {
          const cur = allPages[i];
          const next = allPages[i + 1];
          void cur.offsetHeight;
          const ov = cur.scrollHeight - cur.clientHeight;
          if (ov <= TALMUD_PUSH_THRESHOLD_PX) continue;
          // רק זרמים ב-page-streams (לא בתוך talmud-layout)
          const curStreams = Array.from(
            cur.querySelectorAll(":scope > .page-streams > .stream[data-stream]")
          );
          let movedThis = false;
          for (const s of curStreams) {
            // Cloud-Claude 2026-05-06: ירידה בעוטפים גם לזרמים רגילים בpage-streams.
            // הערה ארוכה אחת מפוצלת ל-spans של data-cont — צריך לדחוף span בודד.
            let pushSrc = s;
            for (let depth = 0; depth < 4; depth++) {
              const realChildren = Array.from(pushSrc.children).filter(c =>
                !c.classList?.contains("stream-title")
              );
              if (realChildren.length === 1 && /^(DIV|SPAN)$/i.test(realChildren[0].tagName) &&
                  realChildren[0].children.length > 1) {
                pushSrc = realChildren[0];
              } else {
                break;
              }
            }
            const lastNote = Array.from(pushSrc.children).filter(c =>
              !c.classList?.contains("stream-title") && !_movedThisRender.has(c)
            ).pop();
            if (!lastNote) continue;
            const code = s.getAttribute("data-stream");
            if (!code) continue;
            let nextS = next.querySelector(
              `:scope > .page-streams > .stream[data-stream="${code}"]`
            );
            if (!nextS) {
              const nextPS = next.querySelector(":scope > .page-streams");
              if (!nextPS) continue;
              nextS = document.createElement("div");
              nextS.className = s.className;
              nextS.setAttribute("data-stream", code);
              const oldTitle = s.querySelector(":scope > .stream-title");
              if (oldTitle) nextS.appendChild(oldTitle.cloneNode(true));
              nextPS.insertBefore(nextS, nextPS.firstChild);
            }
            const nextTitle = nextS.querySelector(":scope > .stream-title");
            if (nextTitle) nextS.insertBefore(lastNote, nextTitle.nextSibling);
            else nextS.insertBefore(lastNote, nextS.firstChild);
            _movedThisRender.add(lastNote);
            movedThis = true;
            pushed = true;
            break;
          }
          if (movedThis) break;
          // אם לא הזזנו זרם רגיל ויש חריגה גדולה — הזז גם הערה אחרונה מ-body-expanded
          if (!movedThis && ov > 50) {
            const expanded = cur.querySelectorAll(".talmud-body-expanded, [data-talmud-role='commentary-expanded'], [data-talmud-role='commentary-expanded-lower']");
            for (const exp of Array.from(expanded).reverse()) {
              // Cloud-Claude 2026-05-06: לרדת ב-DIV/note wrappers בודדים עד
              // שמוצאים אוסף ילדים שאפשר לפצל. המקרה הטיפוסי בתלמוד-mode:
              // <div class="note note-inline"><span data-cont="0">part1</span><span data-cont="1">part2</span>…</div>
              let pushSrc = exp;
              for (let depth = 0; depth < 4; depth++) {
                const realChildren = Array.from(pushSrc.children).filter(c =>
                  !c.classList?.contains("stream-title")
                );
                if (realChildren.length === 1 && /^(DIV|SPAN)$/i.test(realChildren[0].tagName) &&
                    realChildren[0].children.length > 1) {
                  pushSrc = realChildren[0];
                } else {
                  break;
                }
              }
              const lastNote = Array.from(pushSrc.children).filter(c =>
                !c.classList?.contains("stream-title") && !_movedThisRender.has(c)
              ).pop();
              if (!lastNote) continue;
              const code = exp.dataset.talmudBodyOf || "";
              // נסה למצוא יעד תואם בעמוד הבא; אם אין, צור stream חדש ב-page-streams
              let target = code ? next.querySelector(
                `.talmud-body-expanded[data-talmud-body-of="${code}"], .stream[data-stream="${code}"]`
              ) : null;
              if (!target) {
                const nextPS = next.querySelector(":scope > .page-streams");
                if (!nextPS) continue;
                target = document.createElement("div");
                target.className = `stream stream-color-${(parseInt(code, 10) - 1) % 6 + 1}`;
                if (code) target.setAttribute("data-stream", code);
                const title = document.createElement("div");
                title.className = "stream-title";
                title.textContent = `זרם ${code}`;
                target.appendChild(title);
                nextPS.insertBefore(target, nextPS.firstChild);
              }
              // Cloud-Claude 2026-05-06: אם pushSrc אינו exp עצמו (יש wrapper),
              // משחזרים את ה-wrapper הזה ב-target כדי לא לאבד עיצוב/data-cont.
              let dest = target;
              if (pushSrc !== exp) {
                const ancestors = [];
                let p = pushSrc;
                while (p && p !== exp) { ancestors.unshift(p); p = p.parentElement; }
                for (const anc of ancestors) {
                  // נחפש wrapper מקביל ב-target; אם אין — ניצור clone ריק
                  const sel = anc.tagName.toLowerCase() +
                    (anc.className ? "." + anc.className.trim().split(/\s+/).join(".") : "");
                  let existing = dest.querySelector(":scope > " + sel);
                  if (!existing) {
                    existing = anc.cloneNode(false); // shallow clone — no children
                    dest.appendChild(existing);
                  }
                  dest = existing;
                }
              }
              const nextTitle = dest.querySelector(":scope > .stream-title");
              if (nextTitle) dest.insertBefore(lastNote, nextTitle.nextSibling);
              else dest.insertBefore(lastNote, dest.firstChild);
              _movedThisRender.add(lastNote);
              movedThis = true; pushed = true; break;
            }
            if (movedThis) break;
          }
        }
        if (!pushed) break;
      }
    }
    // (פאס 70 הוסר זמנית — גרם להרס במצב תלמוד. צריך עיצוב מחדש שלא
    //  מפרק את מבנה הכתר/body. נבנה בנפרד כשאהיה בטוח שאי-אפשר לשבור.)
    for (let it = 0; it < ITERS; it++) {
      let pushedAny = false;
      const allPages = Array.from(
        pagesContainer.querySelectorAll(".page:not(.page-placeholder)")
      );
      for (let i = 0; i < allPages.length - 1; i++) {
        const cur = allPages[i];
        const next = allPages[i + 1];
        void cur.offsetHeight;
        const ov = cur.scrollHeight - cur.clientHeight;
        if (ov <= PUSH_THRESHOLD_PX) continue;
        // STRATEGY 1: דחוף הערה אחרונה של איזה זרם בעמוד הנוכחי לעמוד הבא
        const curStreams = Array.from(
          cur.querySelectorAll(".talmud-layout .stream[data-stream], .page-streams > .stream[data-stream]")
        );
        let pushedStream = false;
        for (const s of curStreams) {
          const code = s.getAttribute("data-stream");
          if (!code) continue;
          // מצא את הילד האחרון של הזרם (לא כותרת, לא הוזז כבר ב-render הזה)
          const lastNote = Array.from(s.children).filter(c =>
            !c.classList?.contains("stream-title") && !_movedThisRender.has(c)
          ).pop();
          if (!lastNote) continue;
          // מצא זרם מקביל בעמוד הבא, או צור חדש
          let nextS = next.querySelector(
            `.talmud-layout .stream[data-stream="${code}"], .page-streams > .stream[data-stream="${code}"]`
          );
          if (nextS) {
            // הוסף את ההערה ראשונה שם (אחרי הכותרת אם קיימת)
            const nextTitle = nextS.querySelector(":scope > .stream-title");
            if (nextTitle) nextS.insertBefore(lastNote, nextTitle.nextSibling);
            else nextS.insertBefore(lastNote, nextS.firstChild);
            _movedThisRender.add(lastNote);
            pushedStream = true;
            pushedAny = true;
            break;
          }
        }
        if (pushedStream) continue;
        // STRATEGY 2: דחוף ילד ראשי אחרון
        const curMain = cur.querySelector(":scope > .page-main, :scope .page-main.talmud-main");
        const nextMain = next.querySelector(":scope > .page-main, :scope .page-main.talmud-main");
        if (!curMain || !nextMain) continue;
        const lastMainChild = Array.from(curMain.children).filter(c =>
          !c.classList?.contains("talmud-body-portion") &&
          !c.classList?.contains("talmud-body-expanded") &&
          !c.classList?.contains("stream") &&
          /^(P|H[1-6]|DIV|BLOCKQUOTE|PRE)$/i.test(c.tagName)
        ).pop();
        if (!lastMainChild) continue;
        nextMain.insertBefore(lastMainChild, nextMain.firstChild);
        pushedAny = true;
      }
      if (!pushedAny) break;
      logEvent(`strict_overflow_pushdown_iter_${it + 1}`);
    }
    logEvent("strict_overflow_pushdown_loop_end");
    logEvent("render_pipeline_complete", {
      durationMs: Math.round(performance.now() - t2),
      pageCount: pagesContainer.querySelectorAll(".page:not(.page-placeholder)").length,
    });
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
