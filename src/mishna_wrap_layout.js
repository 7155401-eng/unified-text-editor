const STORAGE_KEY = "ravtext.mishnaWrap";
const LEVELS_KEY = "ravtext.mishnaWrap.levels";
import { applyFloatFlowLevel, originalOrder, streamTextLength, widthForFlowFloat } from "./flow_layout.js";
import { getEffectiveStreamSettings } from "./original_stream_columns.js";

export function isMishnaWrapEnabled() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setMishnaWrapEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

export function getMishnaLevelsText() {
  return localStorage.getItem(LEVELS_KEY) || "";
}

export function setMishnaLevelsText(value) {
  localStorage.setItem(LEVELS_KEY, value || "");
}

function normalizeCode(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(n).padStart(2, "0");
}

function parseMishnaLevels() {
  return getMishnaLevelsText()
    .split(/[|\n;]+/)
    .map((level) => (level.match(/\d{1,3}/g) || []).map(normalizeCode).filter(Boolean))
    .map((level) => Array.from(new Set(level)))
    .filter((level) => level.length >= 2);
}

function defaultMishnaLevels(streams) {
  const codes = streams.map(codeForStream).filter(Boolean);
  return codes.length >= 2 ? [Array.from(new Set(codes))] : [];
}

function resetStream(streamEl) {
  streamEl.classList.remove("mishna-float", "mishna-flow", "mishna-right", "mishna-left");
  streamEl.removeAttribute("data-mishna-role");
  streamEl.style.float = "";
  streamEl.style.width = "";
  streamEl.style.margin = "";
  streamEl.style.clear = "";
}

function unwrapLevels(streamsWrap) {
  const levelEls = Array.from(streamsWrap.querySelectorAll(":scope > .mishna-level"));
  for (const levelEl of levelEls) {
    const streams = Array.from(levelEl.querySelectorAll(":scope > .stream"));
    for (const stream of streams) streamsWrap.insertBefore(stream, levelEl);
    levelEl.remove();
  }
}

function codeForStream(streamEl) {
  return streamEl.getAttribute("data-stream") || "";
}

function settingsForStream(streamEl) {
  const code = codeForStream(streamEl);
  return getEffectiveStreamSettings(code);
}

function pageNumberFor(streamsWrap) {
  const pageEl = streamsWrap.closest(".page");
  const idx = parseInt(pageEl?.dataset.pageIndex || "0", 10);
  return Number.isFinite(idx) ? idx + 1 : 1;
}

// צוות האתר 2026-05-07: cache של החלטות צד מהשרת. אם הוא ריק או חסר ערך
// לזרם מסוים, fallback לחישוב המקומי המקורי — לא שובר שום דבר.
let _serverSideCache = null;

async function preflightMishnaSides(streams, streamsWrap) {
  try {
    const { getNonceHeader } = await import("./render_preflight.js");
    const pageNumber = pageNumberFor(streamsWrap);
    const streamData = streams.map((s) => ({
      code: codeForStream(s),
      sidePreference: settingsForStream(s).mishnaSide || "auto",
    }));
    const res = await fetch("/api/mishna/decide", {
      method: "POST",
      headers: { "content-type": "application/json", ...getNonceHeader() },
      body: JSON.stringify({
        pageNumber,
        streams: streamData,
        rawLevelsText: getMishnaLevelsText(),
      }),
    });
    if (!res.ok) { _serverSideCache = null; return; }
    const data = await res.json();
    if (!Array.isArray(data?.assignments)) { _serverSideCache = null; return; }
    _serverSideCache = new Map();
    for (const a of data.assignments) {
      if (a?.code && (a.side === "right" || a.side === "left")) {
        _serverSideCache.set(a.code, a.side);
      }
    }
  } catch {
    _serverSideCache = null;
  }
}

function sideForStream(streamEl, idx, streamsWrap) {
  // נסה ראשית את הקאש מהשרת
  if (_serverSideCache) {
    const code = codeForStream(streamEl);
    const fromServer = _serverSideCache.get(code);
    if (fromServer === "right" || fromServer === "left") return fromServer;
  }
  // Fallback: לוגיקה מקומית מקורית (זהה לחלוטין למה שהיה לפני המיגרציה)
  const side = settingsForStream(streamEl).mishnaSide || "auto";
  if (side === "right" || side === "left") return side;
  const pageNo = pageNumberFor(streamsWrap);
  if (side === "outer") return pageNo % 2 === 1 ? "left" : "right";
  if (side === "inner") return pageNo % 2 === 1 ? "right" : "left";
  return idx % 2 === 0 ? "right" : "left";
}

function widthForStream(streamEl, levelCount) {
  const width = Number(settingsForStream(streamEl).mishnaWidth || 0);
  if (Number.isFinite(width) && width > 0) return `${Math.max(10, Math.min(95, width))}%`;
  return widthForFlowFloat(levelCount);
}

function layoutLevel(streamsWrap, levelStreams, levelIndex) {
  if (levelStreams.length === 0) return;

  const levelEl = document.createElement("div");
  levelEl.className = "mishna-level";
  levelEl.dataset.level = String(levelIndex + 1);

  applyFloatFlowLevel({
    container: levelEl,
    streams: levelStreams,
    streamsWrap,
    sideForStream,
    floatClass: "mishna-float",
    flowClass: "mishna-flow",
    rightClass: "mishna-right",
    leftClass: "mishna-left",
    roleDataset: "mishnaRole",
    widthForStream,
  });
  streamsWrap.appendChild(levelEl);
}

export async function applyMishnaWrapToPage(pageEl, options = {}) {
  const streamsWrap = pageEl && pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  unwrapLevels(streamsWrap);
  const streams = Array.from(streamsWrap.querySelectorAll(":scope > .stream"));
  streams.forEach((stream, idx) => {
    originalOrder(stream, idx);
    resetStream(stream);
  });

  if (!isMishnaWrapEnabled()) {
    pageEl.classList.remove("mishna-wrap-page");
    streams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((stream) => streamsWrap.appendChild(stream));
    return;
  }

  pageEl.classList.add("mishna-wrap-page");

  if (streams.length < 2) {
    streams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((stream) => streamsWrap.appendChild(stream));
    return;
  }

  const levels = parseMishnaLevels();
  const effectiveLevels = levels.length ? levels : defaultMishnaLevels(streams);
  if (effectiveLevels.length === 0) {
    streams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((stream) => streamsWrap.appendChild(stream));
    return;
  }

  // צוות האתר 2026-05-07: pre-fetch להחלטות צד. אם השרת זמין → cache ימולא.
  // אם לא — fallback לחישוב המקומי המקורי. הרוחב נשאר מקומי בכל מקרה.
  if (!options.skipServerDecision) {
    await preflightMishnaSides(streams, streamsWrap);
  } else {
    _serverSideCache = null;
  }

  const byCode = new Map(streams.map((stream) => [codeForStream(stream), stream]));
  const used = new Set();
  effectiveLevels.forEach((codes, levelIndex) => {
    const levelStreams = codes.map((code) => byCode.get(code)).filter(Boolean);
    levelStreams.forEach((stream) => used.add(stream));
    layoutLevel(streamsWrap, levelStreams, levelIndex);
  });

  streams
    .filter((stream) => !used.has(stream))
    .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
    .forEach((stream) => streamsWrap.appendChild(stream));
}

export async function applyMishnaWrapToPages(container) {
  // Defensive cleanup (משה 2026-05-07): כשהמשתמש מכבה משנ"ב או גפ"ת
  // (שאוטו-מפעיל משנ"ב), עמודים שכבר רנדרו עם משנ"ב יכולים להישאר
  // עם המבנה — קלאס .mishna-wrap-page, .mishna-level wrappers וכו'.
  // הקריאה לפר-עמוד מנקה את זה (unwrapLevels + resetStream + סדר טבעי)
  // גם כשהמצב כבוי. אז אנחנו מריצים אותה במקרה כבוי כדי לוודא ניקוי.
  if (!isMishnaWrapEnabled()) {
    const dirtyPages = Array.from(
      container.querySelectorAll(".page.mishna-wrap-page, .page:has(.mishna-level)")
    );
    for (const page of dirtyPages) {
      await applyMishnaWrapToPage(page);
    }
    return;
  }
  if (typeof container.__realizePage === "function") {
    const total = Number(container.__pageCount || 0);
    for (let i = 0; i < total; i++) {
      container.__realizePage(i);
    }
  }
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"));
  for (const page of pages) {
    await applyMishnaWrapToPage(page);
  }

  const prevProcessor = container.__processRealizedPage;
  if (!prevProcessor || !prevProcessor.__mishnaWrapped) {
    const processor = function (page, idx) {
      if (typeof prevProcessor === "function") prevProcessor(page, idx);
      applyMishnaWrapToPage(page);
    };
    processor.__mishnaWrapped = true;
    container.__processRealizedPage = processor;
  }

  const baseRealize = container.__realizePage;
  if (typeof baseRealize !== "function" || baseRealize.__mishnaWrapped) return;

  const wrapped = function (idx) {
    baseRealize(idx);
    const page = typeof container.__getPageElement === "function"
      ? container.__getPageElement(idx)
      : container.querySelector(`.page[data-page-index="${idx}"]`);
    if (page) applyMishnaWrapToPage(page);
  };
  wrapped.__mishnaWrapped = true;
  container.__realizePage = wrapped;
}

export function wireMishnaWrapToggle(onChange) {
  const toggle = document.getElementById("mishna-wrap-toggle");
  const levelsInput = document.getElementById("mishna-levels-input");
  if (!toggle) return;

  toggle.checked = isMishnaWrapEnabled();
  if (levelsInput) levelsInput.value = getMishnaLevelsText();

  toggle.addEventListener("change", () => {
    setMishnaWrapEnabled(toggle.checked);
    onChange && onChange();
  });

  levelsInput?.addEventListener("change", () => {
    setMishnaLevelsText(levelsInput.value);
    onChange && onChange();
  });

  levelsInput?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    levelsInput.blur();
  });
}
