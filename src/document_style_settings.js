import { applyStyleToElement, loadTextStyles, resolveTextStyle, styleOptionsHtml } from "./style_registry.js";

const STORAGE_KEY = "ravtext.documentStyles.v1";

const DEFAULTS = {
  mainStyleId: "",
};

let _documentStyleCacheRaw = null;
let _documentStyleCacheSnapshot = null;

function readDocumentStyleStorageRaw() {
  try {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function parseDocumentStyleSnapshot(raw) {
  try {
    return Object.freeze({ ...DEFAULTS, ...(JSON.parse(raw || "{}") || {}) });
  } catch {
    return Object.freeze({ ...DEFAULTS });
  }
}

export function loadDocumentStyleSettings() {
  const raw = readDocumentStyleStorageRaw();
  if (!_documentStyleCacheSnapshot || raw !== _documentStyleCacheRaw) {
    _documentStyleCacheRaw = raw;
    _documentStyleCacheSnapshot = parseDocumentStyleSnapshot(raw);
  }
  // Keep the historical mutable-copy return contract.
  return { ..._documentStyleCacheSnapshot };
}

export function saveDocumentStyleSettings(settings) {
  const next = { ...DEFAULTS, ...(settings || {}) };
  const raw = JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY, raw);
  _documentStyleCacheRaw = raw;
  _documentStyleCacheSnapshot = Object.freeze({ ...next });
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
    <span class="stream-label-static">סגנון טקסט ראשי (מסונכרן עם „זרם ראשי" ברשימת הזרמים):</span>
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
