const PAGE_SETTINGS_KEY = "ravtext.pageSettings.v1";
const OUTPUT_BACKGROUND_KEY = "ravtext.output.includeBackground";

const DEFAULT_MARGINS = {
  top: 22,
  right: 24,
  bottom: 18,
  left: 24,
};

let runtimeMargins = null;
let runtimeOutputBackground = null;

function storageDisabled() {
  return typeof window !== "undefined" && window.__RAVTEXT_STORAGE_DISABLED__ === true;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (storageDisabled()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("[page-settings] save failed:", err);
  }
}

function clampPx(value, fallback) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(90, Math.round(n)));
}

export function getPageMargins() {
  if (runtimeMargins) return { ...runtimeMargins };
  const saved = readJson(PAGE_SETTINGS_KEY, {});
  return {
    top: clampPx(saved.top, DEFAULT_MARGINS.top),
    right: clampPx(saved.right, DEFAULT_MARGINS.right),
    bottom: clampPx(saved.bottom, DEFAULT_MARGINS.bottom),
    left: clampPx(saved.left, DEFAULT_MARGINS.left),
  };
}

export function setPageMargins(next) {
  const current = getPageMargins();
  runtimeMargins = {
    top: clampPx(next.top, current.top),
    right: clampPx(next.right, current.right),
    bottom: clampPx(next.bottom, current.bottom),
    left: clampPx(next.left, current.left),
  };
  writeJson(PAGE_SETTINGS_KEY, runtimeMargins);
  applyPageSettings();
  return { ...runtimeMargins };
}

export function applyPageSettings(pagesContainer = null) {
  const margins = getPageMargins();
  const root = document.documentElement;
  root.style.setProperty("--ravtext-page-margin-top", `${margins.top}px`);
  root.style.setProperty("--ravtext-page-margin-right", `${margins.right}px`);
  root.style.setProperty("--ravtext-page-margin-bottom", `${margins.bottom}px`);
  root.style.setProperty("--ravtext-page-margin-left", `${margins.left}px`);
  root.style.setProperty("--ravtext-page-pack-safety", "6px");
  pagesContainer?.style.setProperty("--ravtext-page-margin-top", `${margins.top}px`);
  pagesContainer?.style.setProperty("--ravtext-page-margin-right", `${margins.right}px`);
  pagesContainer?.style.setProperty("--ravtext-page-margin-bottom", `${margins.bottom}px`);
  pagesContainer?.style.setProperty("--ravtext-page-margin-left", `${margins.left}px`);
}

export function isOutputBackgroundEnabled() {
  if (runtimeOutputBackground !== null) return runtimeOutputBackground;
  try {
    return localStorage.getItem(OUTPUT_BACKGROUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOutputBackgroundEnabled(enabled) {
  runtimeOutputBackground = !!enabled;
  if (!storageDisabled()) {
    try {
      localStorage.setItem(OUTPUT_BACKGROUND_KEY, runtimeOutputBackground ? "1" : "0");
    } catch (err) {
      console.warn("[page-settings] output background save failed:", err);
    }
  }
  return runtimeOutputBackground;
}

function makeMarginInput(id, labelText, value, onCommit) {
  const label = document.createElement("label");
  label.className = "page-margin-input";
  label.htmlFor = id;
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.id = id;
  input.type = "number";
  input.min = "0";
  input.max = "90";
  input.step = "1";
  input.value = String(value);
  const commit = () => onCommit(input);
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    input.blur();
  });
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

export function wirePageSettingsControls(onChange) {
  const toolbar = document.querySelector(".source-bottom-toolbar");
  if (!toolbar || document.getElementById("page-margin-top")) return;
  const margins = getPageMargins();
  const group = document.createElement("span");
  group.className = "page-margin-settings";

  const title = document.createElement("span");
  title.className = "stream-label-static";
  title.textContent = "שוליים:";
  group.appendChild(title);

  const commit = () => {
    const applied = setPageMargins({
      top: document.getElementById("page-margin-top")?.value,
      right: document.getElementById("page-margin-right")?.value,
      bottom: document.getElementById("page-margin-bottom")?.value,
      left: document.getElementById("page-margin-left")?.value,
    });
    document.getElementById("page-margin-top").value = applied.top;
    document.getElementById("page-margin-right").value = applied.right;
    document.getElementById("page-margin-bottom").value = applied.bottom;
    document.getElementById("page-margin-left").value = applied.left;
    onChange?.();
  };

  group.appendChild(makeMarginInput("page-margin-top", "עליון", margins.top, commit));
  group.appendChild(makeMarginInput("page-margin-right", "ימין", margins.right, commit));
  group.appendChild(makeMarginInput("page-margin-bottom", "תחתון", margins.bottom, commit));
  group.appendChild(makeMarginInput("page-margin-left", "שמאל", margins.left, commit));
  toolbar.appendChild(group);
}

export function wireOutputBackgroundControl() {
  const toolbar = document.getElementById("pdf-toolbar");
  if (!toolbar || document.getElementById("pdf-output-background")) return;
  const label = document.createElement("label");
  label.className = "pdf-output-background-toggle";
  label.title = "כברירת מחדל יצוא והדפסה יוצאים בלי צבעי רקע";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = "pdf-output-background";
  input.checked = isOutputBackgroundEnabled();
  input.addEventListener("change", () => setOutputBackgroundEnabled(input.checked));
  label.appendChild(input);
  label.appendChild(document.createTextNode("רקע ביצוא"));
  toolbar.appendChild(label);
}
