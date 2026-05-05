const STORAGE_KEY = "ravtext.talmudLayout";
const STREAMS_KEY = "ravtext.talmudLayout.streams";
const CROWN_LINES_KEY = "ravtext.talmudLayout.crownLines";
const MAIN_WIDTH_KEY = "ravtext.talmudLayout.mainWidth";
const SIDE_MODE_KEY = "ravtext.talmudLayout.sideMode";
import { applyFloatFlowLevel, originalOrder, streamTextLength, widthForFlowFloat } from "./flow_layout.js";

export function isTalmudLayoutEnabled() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setTalmudLayoutEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

export function getTalmudStreamsText() {
  return localStorage.getItem(STREAMS_KEY) || "";
}

export function setTalmudStreamsText(value) {
  localStorage.setItem(STREAMS_KEY, value || "");
}

export function getTalmudCrownLines() {
  const n = parseInt(localStorage.getItem(CROWN_LINES_KEY) || "4", 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(12, n)) : 4;
}

export function setTalmudCrownLines(value) {
  const n = Math.max(0, Math.min(12, parseInt(value, 10) || 4));
  localStorage.setItem(CROWN_LINES_KEY, String(n));
}

export function getTalmudMainWidth() {
  const n = parseFloat(localStorage.getItem(MAIN_WIDTH_KEY) || "42");
  return Number.isFinite(n) ? Math.max(20, Math.min(80, n)) : 42;
}

export function setTalmudMainWidth(value) {
  const n = Math.max(20, Math.min(80, parseFloat(value) || 42));
  localStorage.setItem(MAIN_WIDTH_KEY, String(n));
}

export function getTalmudSideMode() {
  const value = localStorage.getItem(SIDE_MODE_KEY) || "auto";
  return ["auto", "right-left", "inner-outer"].includes(value) ? value : "auto";
}

export function setTalmudSideMode(value) {
  localStorage.setItem(SIDE_MODE_KEY, value || "auto");
}

function normalizeCode(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(n).padStart(2, "0");
}

function parseTalmudStreams() {
  const codes = (getTalmudStreamsText().match(/\d{1,3}/g) || [])
    .map(normalizeCode)
    .filter(Boolean);
  return Array.from(new Set(codes)).slice(0, 3);
}

function defaultTalmudStreams(streams) {
  return streams
    .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
    .slice(0, 2);
}

function codeForStream(streamEl) {
  return streamEl.getAttribute("data-stream") || "";
}

function firstContentTextNode(streamEl) {
  const root = streamEl.querySelector(":scope .note-inline, :scope .note") || streamEl;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if ((node.textContent || "").trim()) return node;
  }
  return null;
}

function lineBoundaryForTextNode(textNode, maxLines) {
  const text = textNode?.textContent || "";
  if (!text || maxLines <= 0) return 0;
  let best = text.length;
  let lastTop = null;
  let lines = 0;
  for (let i = 1; i <= text.length; i++) {
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, i);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    range.detach();
    const last = rects[rects.length - 1];
    if (!last) continue;
    if (lastTop === null || Math.abs(last.top - lastTop) > Math.max(2, last.height / 2)) {
      lines += 1;
      lastTop = last.top;
      if (lines > maxLines) {
        best = Math.max(0, i - 1);
        break;
      }
    }
  }
  while (best > 0 && best < text.length && !/\s/.test(text[best])) best--;
  return Math.max(0, best);
}

function createCrownStream(stream, side) {
  if (!stream.dataset.talmudOriginalHtml) stream.dataset.talmudOriginalHtml = stream.innerHTML;
  const clone = stream.cloneNode(true);
  clone.classList.add("talmud-crown-stream", side === "right" ? "talmud-right" : "talmud-left");
  clone.classList.remove("talmud-commentary");
  clone.dataset.talmudRole = `${stream.dataset.talmudRole || "commentary"}-crown`;
  clone.dataset.talmudClone = "crown";
  clone.style.float = "none";
  clone.style.width = "";
  return clone;
}

function finalizeCrownSplits(block) {
  const maxLines = getTalmudCrownLines();
  const pairs = Array.from(block.querySelectorAll(":scope .talmud-crown-stream")).map((crown) => {
    const code = crown.getAttribute("data-stream");
    const body = Array.from(block.querySelectorAll(":scope > .stream.talmud-commentary"))
      .find((stream) => stream.getAttribute("data-stream") === code);
    return { crown, body };
  });
  pairs.forEach(({ crown, body }) => {
    const crownTextNode = firstContentTextNode(crown);
    const bodyTextNode = firstContentTextNode(body);
    if (!crownTextNode || !bodyTextNode) return;
    const sourceText = crownTextNode.textContent || "";
    const cut = lineBoundaryForTextNode(crownTextNode, maxLines);
    if (cut <= 0 || cut >= sourceText.length) return;
    crownTextNode.textContent = sourceText.slice(0, cut).trimEnd();
    bodyTextNode.textContent = sourceText.slice(cut).trimStart();
  });
}

function resetTalmud(streamEl) {
  if (streamEl.dataset.talmudOriginalHtml) {
    streamEl.innerHTML = streamEl.dataset.talmudOriginalHtml;
    delete streamEl.dataset.talmudOriginalHtml;
  }
  streamEl.classList.remove("talmud-commentary", "talmud-main-surrogate", "talmud-right", "talmud-left", "talmud-crown-stream");
  streamEl.removeAttribute("data-talmud-role");
  streamEl.removeAttribute("data-talmud-clone");
  streamEl.style.float = "";
  streamEl.style.width = "";
  streamEl.style.margin = "";
  streamEl.style.clear = "";
  streamEl.style.height = "";
  streamEl.style.overflow = "";
}

function resetMain(mainEl) {
  if (!mainEl) return;
  mainEl.classList.remove("talmud-main");
  mainEl.removeAttribute("data-talmud-role");
  mainEl.style.width = "";
  mainEl.style.margin = "";
  mainEl.style.clear = "";
  mainEl.style.position = "";
  mainEl.style.top = "";
  mainEl.style.right = "";
}

function unwrapTalmud(streamsWrap) {
  const pageEl = streamsWrap.closest(".page");
  const blocks = Array.from(pageEl?.querySelectorAll(":scope > .talmud-layout") || []);
  for (const block of blocks) {
    const main = block.querySelector(":scope .page-main");
    if (main && pageEl) {
      resetMain(main);
      pageEl.insertBefore(main, streamsWrap);
    }
    const streams = Array.from(block.querySelectorAll(":scope .stream"));
    for (const stream of streams) {
      resetTalmud(stream);
      streamsWrap.appendChild(stream);
    }
    block.remove();
  }
}

function pageNumberFor(streamsWrap) {
  const pageEl = streamsWrap.closest(".page");
  const idx = parseInt(pageEl?.dataset.pageIndex || "0", 10);
  return Number.isFinite(idx) ? idx + 1 : 1;
}

function orderedSides(streamsWrap) {
  const mode = getTalmudSideMode();
  if (mode === "right-left") return ["right", "left"];
  const pageNo = pageNumberFor(streamsWrap);
  if (mode === "inner-outer") return pageNo % 2 === 1 ? ["right", "left"] : ["left", "right"];
  return ["right", "left"];
}

function applySingleCommentary(block, stream) {
  const crownLines = getTalmudCrownLines();
  block.classList.add("talmud-single-commentary");
  block.style.setProperty("--talmud-crown-lines", String(crownLines));
  stream.classList.add("talmud-commentary", "talmud-right");
  stream.dataset.talmudRole = "commentary";
  stream.style.float = "right";
  stream.style.width = "var(--talmud-side-width)";
  block.appendChild(stream);
}

function widthForNoMainStream(levelCount) {
  return widthForFlowFloat(levelCount);
}

function applyNoMainCommentaries(block, streamsWrap, measured) {
  applyFloatFlowLevel({
    container: block,
    streams: measured.map((item) => item.stream),
    streamsWrap,
    sideForStream: (_stream, idx, wrap) => orderedSides(wrap)[idx] || (idx % 2 === 0 ? "right" : "left"),
    floatClass: "talmud-commentary-float",
    flowClass: "talmud-commentary-flow",
    rightClass: "talmud-right",
    leftClass: "talmud-left",
    roleDataset: "talmudRole",
    floatRole: "commentary-float",
    flowRole: "commentary-flow",
    widthForStream: (_stream, count) => widthForNoMainStream(count),
  });
  measured.forEach((item) => item.stream.classList.add("talmud-commentary"));
}

function updateFlowMetrics(block) {
  const main = block.querySelector(":scope .page-main.talmud-main");
  if (!main) return;
  const streams = Array.from(block.querySelectorAll(":scope .stream.talmud-commentary"));
  const firstStream = streams[0];
  let lineHeight = 0;
  let titleHeight = 0;
  if (firstStream) {
    const style = getComputedStyle(firstStream);
    lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 14;
    const title = firstStream.querySelector(":scope > .stream-title");
    if (title) {
      const titleStyle = getComputedStyle(title);
      titleHeight =
        title.getBoundingClientRect().height +
        (parseFloat(titleStyle.marginTop) || 0) +
        (parseFloat(titleStyle.marginBottom) || 0);
    }
  }
  const crownOffset = Math.max(0, Math.ceil(titleHeight + getTalmudCrownLines() * lineHeight));
  block.style.setProperty("--talmud-crown-offset", `${crownOffset}px`);
}

function scheduleFlowMetrics(block) {
  updateFlowMetrics(block);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => updateFlowMetrics(block));
    requestAnimationFrame(() => requestAnimationFrame(() => updateFlowMetrics(block)));
  }
  setTimeout(() => updateFlowMetrics(block), 80);
  setTimeout(() => updateFlowMetrics(block), 250);
}

function layoutTalmudBlock(pageEl, streamsWrap, talmudStreams) {
  if (talmudStreams.length === 0) return;
  const mainEl = pageEl.querySelector(":scope > .page-main");
  const hasActiveMain = Boolean(mainEl && (mainEl.textContent || "").trim());
  const block = document.createElement("div");
  block.className = "talmud-layout talmud-flow-layout";
  const mainWidth = getTalmudMainWidth();
  block.style.setProperty("--talmud-crown-lines", String(getTalmudCrownLines()));
  block.style.setProperty("--talmud-main-width", `${mainWidth}%`);
  block.style.setProperty("--talmud-half-main-width", `${(mainWidth / 2).toFixed(4)}%`);
  block.style.setProperty("--talmud-side-width", `${((100 - mainWidth) / 2).toFixed(4)}%`);

  const measured = talmudStreams.map((stream) => ({ stream, len: streamTextLength(stream) }));
  block.classList.toggle("talmud-has-main", hasActiveMain);
  block.classList.toggle("talmud-no-main", !hasActiveMain);
  block.classList.toggle("talmud-one-commentary", measured.length === 1);
  block.classList.toggle("talmud-two-commentaries", measured.length >= 2);

  if (measured.length === 1) {
    applySingleCommentary(block, measured[0].stream);
    if (hasActiveMain) {
      mainEl.classList.add("talmud-main");
      mainEl.dataset.talmudRole = "main";
      block.appendChild(mainEl);
    }
    pageEl.insertBefore(block, streamsWrap);
    return;
  }

  if (!hasActiveMain) {
    applyNoMainCommentaries(block, streamsWrap, measured);
    pageEl.insertBefore(block, streamsWrap);
    return;
  }

  const sides = orderedSides(streamsWrap);
  const crownBox = hasActiveMain ? document.createElement("div") : null;
  if (crownBox) crownBox.className = "talmud-crown";
  measured
    .sort((a, b) => originalOrder(a.stream, 0) - originalOrder(b.stream, 0))
    .forEach((item, idx) => {
      const side = sides[idx] || (idx % 2 === 0 ? "right" : "left");
      const stream = item.stream;
      stream.classList.add("talmud-commentary", side === "right" ? "talmud-right" : "talmud-left");
      stream.dataset.talmudRole = idx === 0 ? "commentary-a" : "commentary-b";
      stream.style.float = side;
      stream.style.width = "var(--talmud-side-width)";
      if (crownBox) crownBox.appendChild(createCrownStream(stream, side));
      block.appendChild(stream);
    });
  if (crownBox) block.insertBefore(crownBox, block.firstChild);
  if (hasActiveMain) {
    mainEl.classList.add("talmud-main");
    mainEl.dataset.talmudRole = "main";
    mainEl.style.width = "";
    mainEl.style.margin = "";
    block.appendChild(mainEl);
  }
  pageEl.insertBefore(block, streamsWrap);
  if (crownBox) finalizeCrownSplits(block);
  scheduleFlowMetrics(block);
}

function validateTalmudBlock(pageEl, expectedCommentaries) {
  const block = pageEl?.querySelector(":scope > .talmud-layout");
  if (!block) return true;
  const bodyStreams = Array.from(block.querySelectorAll(":scope > .stream.talmud-commentary"));
  const main = block.querySelector(":scope > .page-main.talmud-main");
  if (!main && !block.classList.contains("talmud-no-main")) return false;
  if (expectedCommentaries >= 2 && bodyStreams.length !== expectedCommentaries) return false;
  if (bodyStreams.some((stream) => !stream.dataset.talmudRole)) return false;
  return true;
}

export function applyTalmudLayoutToPage(pageEl) {
  const streamsWrap = pageEl && pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  unwrapTalmud(streamsWrap);
  const streams = Array.from(streamsWrap.querySelectorAll(":scope > .stream"));
  streams.forEach((stream, idx) => {
    originalOrder(stream, idx);
    resetTalmud(stream);
  });
  resetMain(pageEl.querySelector(":scope > .page-main"));

  if (!isTalmudLayoutEnabled()) {
    pageEl.classList.remove("talmud-layout-page");
    streams.sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0)).forEach((stream) => streamsWrap.appendChild(stream));
    return;
  }

  const codes = parseTalmudStreams();
  if (codes.length === 0) return;
  const byCode = new Map(streams.map((stream) => [codeForStream(stream), stream]));
  const explicitStreams = codes.map((code) => byCode.get(code)).filter(Boolean).slice(0, 3);
  const talmudStreams = explicitStreams;
  if (talmudStreams.length === 0) return;

  pageEl.classList.add("talmud-layout-page");
  const used = new Set(talmudStreams);
  layoutTalmudBlock(pageEl, streamsWrap, talmudStreams);
  if (!validateTalmudBlock(pageEl, talmudStreams.length)) {
    console.warn("Talmud layout validation failed", pageEl);
  }
  streams
    .filter((stream) => !used.has(stream))
    .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
    .forEach((stream) => {
      resetTalmud(stream);
      stream.style.float = "none";
      stream.style.width = "";
      stream.style.clear = "both";
      streamsWrap.appendChild(stream);
    });
}

export function applyTalmudLayoutToPages(container) {
  if (!isTalmudLayoutEnabled()) return;
  container.querySelectorAll(".page:not(.page-placeholder)").forEach((page) => applyTalmudLayoutToPage(page));

  const prevProcessor = container.__processRealizedPage;
  if (!prevProcessor || !prevProcessor.__talmudLayout) {
    const processor = function (page, idx) {
      if (typeof prevProcessor === "function") prevProcessor(page, idx);
      applyTalmudLayoutToPage(page);
    };
    processor.__talmudLayout = true;
    container.__processRealizedPage = processor;
  }

  const baseRealize = container.__realizePage;
  if (typeof baseRealize !== "function" || baseRealize.__talmudLayout) return;

  const wrapped = function (idx) {
    baseRealize(idx);
    const page = typeof container.__getPageElement === "function"
      ? container.__getPageElement(idx)
      : container.querySelector(`.page[data-page-index="${idx}"]`);
    if (page) applyTalmudLayoutToPage(page);
  };
  wrapped.__talmudLayout = true;
  container.__realizePage = wrapped;
}

export function wireTalmudLayoutControls(onChange) {
  const toggle = document.getElementById("talmud-layout-toggle");
  const streamsInput = document.getElementById("talmud-streams-input");
  const crownInput = document.getElementById("talmud-crown-lines-input");
  const widthInput = document.getElementById("talmud-main-width-input");
  const sideSelect = document.getElementById("talmud-side-mode-select");
  if (!toggle) return;

  toggle.checked = isTalmudLayoutEnabled();
  if (streamsInput) streamsInput.value = getTalmudStreamsText();
  if (crownInput) crownInput.value = getTalmudCrownLines();
  if (widthInput) widthInput.value = getTalmudMainWidth();
  if (sideSelect) sideSelect.value = getTalmudSideMode();

  const commit = () => onChange && onChange();
  toggle.addEventListener("change", () => {
    setTalmudLayoutEnabled(toggle.checked);
    commit();
  });
  streamsInput?.addEventListener("change", () => {
    setTalmudStreamsText(streamsInput.value);
    commit();
  });
  crownInput?.addEventListener("change", () => {
    setTalmudCrownLines(crownInput.value);
    crownInput.value = getTalmudCrownLines();
    commit();
  });
  widthInput?.addEventListener("change", () => {
    setTalmudMainWidth(widthInput.value);
    widthInput.value = getTalmudMainWidth();
    commit();
  });
  sideSelect?.addEventListener("change", () => {
    setTalmudSideMode(sideSelect.value);
    commit();
  });
}
