const STORAGE_KEY = "ravtext.mishnaWrap";
const LEVELS_KEY = "ravtext.mishnaWrap.levels";
import { applyFloatFlowLevel, originalOrder, streamTextLength, widthForFlowFloat } from "./flow_layout.js";

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

// צוות האתר 2026-05-07: parsing+default-level decisions moved to server.
// Local stub returns null; the real values come from /api/mishna/decide via
// _mishnaPlanCache below.

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
  return (typeof window !== "undefined" && window.__STREAM_SETTINGS__ && window.__STREAM_SETTINGS__[code]) || {};
}

function pageNumberFor(streamsWrap) {
  const pageEl = streamsWrap.closest(".page");
  const idx = parseInt(pageEl?.dataset.pageIndex || "0", 10);
  return Number.isFinite(idx) ? idx + 1 : 1;
}

// צוות האתר 2026-05-07: עברו לשרת. הקריאות הסינכרוניות קוראות מתוך הקאש
// שאומלא ע"י preflightMishnaPlan לפני התחלת הפריסה.
let _mishnaPlanCache = null;

async function preflightMishnaPlan(streams, pageNumber) {
  const streamData = streams.map((s) => ({
    code: codeForStream(s),
    sidePreference: settingsForStream(s).mishnaSide || "auto",
    explicitWidth: settingsForStream(s).mishnaWidth || 0,
  }));
  const res = await fetch("/api/mishna/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageNumber,
      streams: streamData,
      rawLevelsText: getMishnaLevelsText(),
    }),
  });
  if (!res.ok) throw new Error(`mishna decide failed: HTTP ${res.status}`);
  _mishnaPlanCache = await res.json();
}

function sideForStream(streamEl, idx) {
  const code = codeForStream(streamEl);
  const a = _mishnaPlanCache?.assignments?.find((x) => x.code === code);
  return a?.side || (idx % 2 === 0 ? "right" : "left");
}

function widthForStream(streamEl) {
  const code = codeForStream(streamEl);
  const a = _mishnaPlanCache?.assignments?.find((x) => x.code === code);
  return a?.width || "50%";
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

export async function applyMishnaWrapToPage(pageEl) {
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

  // צוות האתר 2026-05-07: pre-fetch all mishna decisions for this page (one round-trip).
  try {
    await preflightMishnaPlan(streams, pageNumberFor(streamsWrap));
  } catch (e) {
    console.warn("[mishna-wrap] preflight failed:", e);
    return;
  }

  const effectiveLevels = _mishnaPlanCache?.levels || [];
  if (effectiveLevels.length === 0) {
    streams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((stream) => streamsWrap.appendChild(stream));
    return;
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
