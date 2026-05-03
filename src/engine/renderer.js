import { streamColorIndex } from "./schema.js";

function getStreamSettings(streamCode) {
  return (typeof window !== "undefined" &&
    window.__STREAM_SETTINGS__ &&
    window.__STREAM_SETTINGS__[streamCode]) || {};
}

function getPageLayoutSettings() {
  return (typeof window !== "undefined" && window.__PAGE_LAYOUT_SETTINGS__) || {};
}

function asPositiveInt(value, fallback, max = 99) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function applyMainLayout(main) {
  const layout = getPageLayoutSettings();
  const cols = asPositiveInt(layout.mainColumns, 1, 3);
  if (cols > 1) {
    main.style.columnCount = cols;
    main.style.columnGap = "14px";
  }
}

function applyStreamsLayout(streamsWrap) {
  const layout = getPageLayoutSettings().streamsLayout || "side-by-side";
  streamsWrap.dataset.layout = layout;
  if (layout === "stacked") return;
  streamsWrap.style.display = "grid";
  streamsWrap.style.gridTemplateColumns = layout === "mishna"
    ? "minmax(0, 1fr) minmax(0, 1fr)"
    : "repeat(auto-fit, minmax(72px, 1fr))";
  streamsWrap.style.alignItems = "end";
}

function prepareNotesAndTitle(streamCode, notesArr, settings) {
  let titleText = streamCode;
  let notes = notesArr;
  if (settings.firstNoteAsTitle && notesArr.length > 0) {
    const titleIdx = notesArr.findIndex((tup) => !(tup[4] === 1 || tup[4] === true));
    if (titleIdx >= 0) {
      const candidate = (notesArr[titleIdx][1] || "").trim();
      titleText = candidate || streamCode;
      notes = notesArr.filter((_, idx) => idx !== titleIdx);
    }
  }
  return { titleText, notes };
}

function createStreamElement(streamCode, streamData, streamNumLastPage, pageIndex) {
  const settings = getStreamSettings(streamCode);
  if (settings.enabled === false) return null;

  const wrap = document.createElement("div");
  wrap.className = `stream stream-color-${streamColorIndex(streamCode)}`;
  wrap.setAttribute("data-stream", streamCode);

  const userCols = asPositiveInt(settings.cols, 1, 6);
  const colGap = Number.isFinite(Number(settings.colGap)) ? Math.max(0, Number(settings.colGap)) : 8;
  const minLines = typeof settings.minLinesForCols === "number" ? settings.minLinesForCols : 3;
  const notesArrRaw = (streamData && streamData.notes) || [];
  const prepared = prepareNotesAndTitle(streamCode, notesArrRaw, settings);
  const notesArr = prepared.notes;
  let estLines = 1;
  for (const tup of notesArr) {
    const text = tup[1] || "";
    estLines += Math.max(1, Math.ceil(text.length / 52));
  }
  const cols = estLines >= minLines ? userCols : 1;
  if (cols > 1) {
    wrap.style.columnCount = cols;
    wrap.style.columnGap = `${colGap}px`;
  }
  // Stream-level default for the last line of TRULY-ENDING notes — never
  // stretched, since the user said "don't justify both sides at a real end".
  if (settings.lastLineCenter) {
    wrap.style.textAlignLast = "center";
  } else {
    wrap.style.textAlignLast = "right";
  }

  const title = document.createElement("div");
  title.className = "stream-title";
  title.textContent = prepared.titleText;
  wrap.appendChild(title);

  const notes = notesArr;
  // Default = inline (continuous notes); user can toggle off per-stream.
  const notesInline = typeof settings.inline === "boolean" ? settings.inline : true;
  const separator = typeof settings.separator === "string" ? settings.separator : " ";
  const displayNum = (tup) =>
    typeof tup[3] === "number" && tup[3] > 0 ? tup[3] : tup[0];
  const isCont = (tup) => tup[4] === 1 || tup[4] === true;

  // Build a note's DOM content: "[N] " prefix + lemma (first word, bolded
  // via .note-lemma) + rest. For continuation halves, no prefix and no
  // lemma — the lemma sits with the leading half.
  function appendNoteContent(parent, tup, leadingSpace) {
    const text = tup[1] || "";
    const lead = leadingSpace ? separator : "";
    if (isCont(tup)) {
      parent.appendChild(document.createTextNode(lead + text));
      return;
    }
    const prefix = lead + `[${displayNum(tup)}] `;
    parent.appendChild(document.createTextNode(prefix));
    const trimmed = text.replace(/^\s+/, "");
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx > 0) {
      const lemma = document.createElement("strong");
      lemma.className = "note-lemma";
      lemma.textContent = trimmed.substring(0, spaceIdx);
      parent.appendChild(lemma);
      parent.appendChild(document.createTextNode(trimmed.substring(spaceIdx)));
    } else if (trimmed.length > 0) {
      const lemma = document.createElement("strong");
      lemma.className = "note-lemma";
      lemma.textContent = trimmed;
      parent.appendChild(lemma);
    }
  }
  // A note's display end is "artificial" if there's another piece with the
  // same num on a later page — its last line should be JUSTIFIED so the cut
  // doesn't look like the note's natural end.
  const isArtificialEnd = (tup) => {
    if (!streamNumLastPage || pageIndex === undefined) return false;
    const num = tup[3];
    if (typeof num !== "number" || num <= 0) return false;
    const key = streamCode + ":" + num;
    return typeof streamNumLastPage[key] === "number" && streamNumLastPage[key] > pageIndex;
  };

  if (notesInline) {
    const noteAll = document.createElement("div");
    noteAll.className = "note note-inline";
    notes.forEach((tup, i) => appendNoteContent(noteAll, tup, i > 0));
    if (notes.length > 0 && isArtificialEnd(notes[notes.length - 1])) {
      noteAll.style.textAlignLast = "justify";
    }
    wrap.appendChild(noteAll);
  } else {
    for (const tup of notes) {
      const note = document.createElement("div");
      note.className = "note";
      appendNoteContent(note, tup, false);
      if (isArtificialEnd(tup)) {
        note.style.textAlignLast = "justify";
      }
      wrap.appendChild(note);
    }
  }

  return wrap;
}

function createPageElement(pageData, paraIdxLastPage, pageIndex, streamNumLastPage) {
  const page = document.createElement("div");
  page.className = "page";
  page.setAttribute("dir", "rtl");

  const main = document.createElement("div");
  main.className = "page-main";
  applyMainLayout(main);
  let lastIdx = null;
  let lastP = null;
  for (const tup of pageData.main) {
    const idx = tup[0];
    const text = tup[1];
    if (idx === lastIdx && lastP) {
      lastP.textContent += " " + text;
    } else {
      const p = document.createElement("p");
      p.textContent = text;
      main.appendChild(p);
      lastP = p;
      lastIdx = idx;
    }
    // If this paragraph continues on a later page, force its last line to
    // justify so the cut doesn't look like a real paragraph end.
    if (paraIdxLastPage && pageIndex !== undefined &&
        typeof paraIdxLastPage[idx] === "number" &&
        paraIdxLastPage[idx] > pageIndex) {
      lastP.style.textAlignLast = "justify";
    }
  }
  page.appendChild(main);

  const codes = Object.keys(pageData.streams || {})
    .filter((code) => {
      const sd = pageData.streams[code];
      return sd && sd.notes && sd.notes.length > 0;
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (codes.length > 0) {
    const streamsWrap = document.createElement("div");
    streamsWrap.className = "page-streams";
    applyStreamsLayout(streamsWrap);
    for (const code of codes) {
      const streamEl = createStreamElement(code, pageData.streams[code], streamNumLastPage, pageIndex);
      if (streamEl) streamsWrap.appendChild(streamEl);
    }
    if (streamsWrap.children.length > 0) page.appendChild(streamsWrap);
  }

  return page;
}

function computeLastPageByParaIdx(pages) {
  const last = {};
  for (let i = 0; i < pages.length; i++) {
    for (const seg of pages[i].main || []) {
      const idx = seg[0];
      if (!(idx in last) || last[idx] < i) last[idx] = i;
    }
  }
  return last;
}

function computeLastPageByStreamNum(pages) {
  const last = {};
  for (let i = 0; i < pages.length; i++) {
    for (const code of Object.keys(pages[i].streams || {})) {
      const arr = (pages[i].streams[code] && pages[i].streams[code].notes) || [];
      for (const tup of arr) {
        const num = tup[3];
        if (typeof num !== "number" || num <= 0) continue;
        const key = code + ":" + num;
        if (!(key in last) || last[key] < i) last[key] = i;
      }
    }
  }
  return last;
}

export function renderPages(packerOutput, container) {
  container.innerHTML = "";
  const paraLastPage = computeLastPageByParaIdx(packerOutput);
  const streamNumLastPage = computeLastPageByStreamNum(packerOutput);

  // Force-sync: skip the placeholder/progressive machinery entirely. Used by
  // verify-pages.mjs and other automated tests so all pages are in the DOM
  // by the time we measure them.
  if (typeof window !== "undefined" && window.__FORCE_SYNC_RENDER__) {
    const allFrag = document.createDocumentFragment();
    const realPages = [];
    for (let i = 0; i < packerOutput.length; i++) {
      const real = createPageElement(packerOutput[i], paraLastPage, i, streamNumLastPage);
      real.dataset.pageIndex = String(i);
      real.dataset.realized = "1";
      allFrag.appendChild(real);
      realPages.push(real);
    }
    container.appendChild(allFrag);
    container.__getPageElement = (i) => realPages[i] || null;
    container.__realizePage = () => {};
    container.__pageCount = packerOutput.length;
    return;
  }

  // Progressive rendering: every page is created as a same-sized placeholder
  // so scroll height and page navigation are correct from frame 1. Page 1
  // is realized immediately (user sees content instantly). The rest are
  // realized in small batches via setTimeout so the main thread can repaint
  // and process input events while pages fill in.
  const frag = document.createDocumentFragment();
  const PAGE_W = 380;
  const PAGE_H = 537;
  const placeholders = [];
  for (let i = 0; i < packerOutput.length; i++) {
    const ph = document.createElement("div");
    ph.className = "page page-placeholder";
    ph.style.width = PAGE_W + "px";
    ph.style.height = PAGE_H + "px";
    ph.dataset.pageIndex = String(i);
    const label = document.createElement("div");
    label.className = "page-placeholder-label";
    label.textContent = `עמוד ${i + 1}`;
    ph.appendChild(label);
    frag.appendChild(ph);
    placeholders.push(ph);
  }
  container.appendChild(frag);

  function realize(i) {
    const ph = placeholders[i];
    if (!ph || !ph.parentNode || ph.dataset.realized === "1") return;
    const real = createPageElement(packerOutput[i], paraLastPage, i, streamNumLastPage);
    real.dataset.pageIndex = String(i);
    real.dataset.realized = "1";
    if (ph.style.zoom) real.style.zoom = ph.style.zoom;
    ph.parentNode.replaceChild(real, ph);
    placeholders[i] = real;
  }

  realize(0);

  const BATCH = 10;
  let nextIdx = 1;
  function step() {
    const end = Math.min(nextIdx + BATCH, packerOutput.length);
    for (let i = nextIdx; i < end; i++) realize(i);
    nextIdx = end;
    if (nextIdx < packerOutput.length) setTimeout(step, 0);
  }
  if (placeholders.length > 1) setTimeout(step, 0);

  container.__getPageElement = (i) => placeholders[i] || null;
  container.__realizePage = realize;
  container.__pageCount = packerOutput.length;
}
