import { applyStyleToElement, loadTextStyles, resolveTextStyle, styleOptionsHtml } from "./style_registry.js";

const STORAGE_KEY = "ravtext.documentStyles.v1";

const DEFAULTS = {
  mainStyleId: "",
};

// ⚡ Bolt Optimization:
// Memory cache for document style settings.
// What: Caches raw string and parsed object to prevent expensive JSON.parse() calls.
// Why: loadDocumentStyleSettings is called frequently during rendering loops.
// Impact: Eliminates synchronous I/O and GC pressure.
let cachedRaw = null;
let cachedSettings = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      cachedRaw = null;
      cachedSettings = null;
    }
  });
}

export function loadDocumentStyleSettings() {
  // If cache is populated, return a clone to prevent mutation without synchronous I/O.
  if (cachedSettings) {
    return { ...cachedSettings };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cachedSettings = { ...DEFAULTS, ...parsed };
    cachedRaw = raw;
    return { ...cachedSettings };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveDocumentStyleSettings(settings) {
  const next = { ...DEFAULTS, ...(settings || {}) };
  const raw = JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedSettings = { ...next };
  return next;
}

export function getMainTextStyle() {
  const id = loadDocumentStyleSettings().mainStyleId;
  return id ? resolveTextStyle(id) : null;
}

export function applyMainTextStyleToElement(el) {
  if (!el) return false;
  return applyStyleToElement(el, loadDocumentStyleSettings().mainStyleId);
}

export function wireDocumentStyleControls({ pagesContainer, rerender } = {}) {
  ensurePanel();
  const panel = document.getElementById("document-style-panel");
  if (!panel || panel.dataset.bound === "1") return;
  panel.dataset.bound = "1";

  panel.innerHTML = `
    <span class="stream-label-static">הגדרות כלליות - סגנונות מסמך:</span>
    <label class="stream-col-input">
      <span>טקסט ראשי:</span>
      <select id="document-main-style-select"></select>
    </label>
    <button type="button" id="document-main-style-clear">ללא סגנון</button>
  `;

  const render = () => {
    const select = panel.querySelector("#document-main-style-select");
    if (!select) return;
    const current = loadDocumentStyleSettings().mainStyleId || "";
    select.innerHTML = styleOptionsHtml(current);
    select.value = current;
  };

  panel.querySelector("#document-main-style-select")?.addEventListener("change", (ev) => {
    const value = ev.target.value;
    if (value === "__add-custom__") {
      const gallery = document.getElementById("styles-gallery-select");
      if (gallery) {
        gallery.value = "__add-custom__";
        gallery.dispatchEvent(new Event("change", { bubbles: true }));
      }
      render();
      return;
    }
    const styles = loadTextStyles();
    saveDocumentStyleSettings({
      ...loadDocumentStyleSettings(),
      mainStyleId: styles.some(s => s.id === value || s.name === value) ? value : "",
    });
    pagesContainer?.querySelectorAll?.(".page-main").forEach(applyMainTextStyleToElement);
    rerender?.();
  });

  panel.querySelector("#document-main-style-clear")?.addEventListener("click", () => {
    saveDocumentStyleSettings({ ...loadDocumentStyleSettings(), mainStyleId: "" });
    render();
    rerender?.();
  });

  window.addEventListener("ravtext:styles-changed", render);
  render();
}

function ensurePanel() {
  if (document.getElementById("document-style-panel")) return;
  const anchor =
    document.getElementById("spacing-settings-panel") ||
    document.getElementById("stream-columns-panel");
  if (!anchor) return;
  const panel = document.createElement("div");
  panel.id = "document-style-panel";
  panel.className = "toolbar document-style-toolbar ribbon-panel";
  panel.dataset.ribbonTab = "layout";
  if ((localStorage.getItem("ravtext.ribbonTab") || "home") !== "layout") {
    panel.classList.add("ribbon-hidden");
  }
  panel.dir = "rtl";
  anchor.insertAdjacentElement("afterend", panel);
}
