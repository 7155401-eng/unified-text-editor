const STORAGE_KEY = "ravtext.mishnaWrap";
const LEVELS_KEY = "ravtext.mishnaWrap.levels";

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

function streamTextLength(streamEl) {
  const clone = streamEl.cloneNode(true);
  clone.querySelector(".stream-title")?.remove();
  return (clone.textContent || "").trim().length;
}

function resetStream(streamEl) {
  streamEl.classList.remove("mishna-float", "mishna-flow");
  streamEl.removeAttribute("data-mishna-role");
  streamEl.style.float = "";
  streamEl.style.width = "";
  streamEl.style.margin = "";
  streamEl.style.clear = "";
}

function originalOrder(streamEl, idx) {
  if (!streamEl.dataset.originalOrder) {
    streamEl.dataset.originalOrder = String(idx);
  }
  return parseInt(streamEl.dataset.originalOrder, 10) || 0;
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

function layoutLevel(streamsWrap, levelStreams, levelIndex) {
  if (levelStreams.length === 0) return;

  const levelEl = document.createElement("div");
  levelEl.className = "mishna-level";
  levelEl.dataset.level = String(levelIndex + 1);

  const measured = levelStreams
    .map((stream) => ({ stream, len: streamTextLength(stream) }))
    .sort((a, b) => b.len - a.len);
  const mainFlow = measured[0].stream;
  const floats = measured
    .slice(1)
    .sort((a, b) => originalOrder(a.stream, 0) - originalOrder(b.stream, 0))
    .map((item) => item.stream);

  for (const stream of floats) levelEl.appendChild(stream);
  levelEl.appendChild(mainFlow);

  floats.forEach((stream, idx) => {
    stream.classList.add("mishna-float");
    stream.dataset.mishnaRole = "float";
    stream.style.float = idx % 2 === 0 ? "right" : "left";
    stream.style.width = "46%";
  });
  mainFlow.classList.add("mishna-flow");
  mainFlow.dataset.mishnaRole = "flow";
  streamsWrap.appendChild(levelEl);
}

export function applyMishnaWrapToPage(pageEl) {
  const streamsWrap = pageEl && pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  unwrapLevels(streamsWrap);
  const streams = Array.from(streamsWrap.querySelectorAll(":scope > .stream"));
  streams.forEach((stream, idx) => {
    originalOrder(stream, idx);
    resetStream(stream);
  });

  if (!isMishnaWrapEnabled() || streams.length < 2) {
    pageEl.classList.remove("mishna-wrap-page");
    streams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((stream) => streamsWrap.appendChild(stream));
    return;
  }

  const levels = parseMishnaLevels();
  if (levels.length === 0) {
    pageEl.classList.remove("mishna-wrap-page");
    streams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((stream) => streamsWrap.appendChild(stream));
    return;
  }

  pageEl.classList.add("mishna-wrap-page");

  const byCode = new Map(streams.map((stream) => [codeForStream(stream), stream]));
  const used = new Set();
  levels.forEach((codes, levelIndex) => {
    const levelStreams = codes.map((code) => byCode.get(code)).filter(Boolean);
    levelStreams.forEach((stream) => used.add(stream));
    layoutLevel(streamsWrap, levelStreams, levelIndex);
  });

  streams
    .filter((stream) => !used.has(stream))
    .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
    .forEach((stream) => streamsWrap.appendChild(stream));
}

export function applyMishnaWrapToPages(container) {
  container.querySelectorAll(".page").forEach((page) => applyMishnaWrapToPage(page));

  const baseRealize = container.__realizePage;
  if (typeof baseRealize !== "function" || baseRealize.__mishnaWrapped) return;

  const wrapped = function (idx) {
    baseRealize(idx);
    const page = container.querySelector(`.page[data-page-index="${idx}"]`);
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
