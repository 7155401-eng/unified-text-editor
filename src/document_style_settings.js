import {
  applyStyleToElement,
  loadTextStyles,
  resolveTextStyle,
  styleOptionsHtml,
} from "./style_registry.js";

const STORAGE_KEY = "ravtext.documentStyles.v1";

const DEFAULTS = {
  mainStyleId: "",
};

// ⚡ Bolt Optimization:
// Memory cache for document style settings.
// What: Caches the parsed result of localStorage to prevent expensive JSON.parse() calls.
// Why: loadDocumentStyleSettings is called frequently during rendering and UI updates.
// Impact: Reduces loadDocumentStyleSettings execution time significantly.
let cachedDocStyleSettings = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cachedDocStyleSettings = null;
    }
  });
}

export function loadDocumentStyleSettings() {
  if (cachedDocStyleSettings) {
    return { ...cachedDocStyleSettings };
  }
  try {
    cachedDocStyleSettings = {
      ...DEFAULTS,
      ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}),
    };
    return { ...cachedDocStyleSettings };
  } catch {
    cachedDocStyleSettings = { ...DEFAULTS };
    return { ...cachedDocStyleSettings };
  }
}

export function saveDocumentStyleSettings(settings) {
  const next = { ...DEFAULTS, ...(settings || {}) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  cachedDocStyleSettings = next;
  return { ...next };
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

  panel
    .querySelector("#document-main-style-select")
    ?.addEventListener("change", (ev) => {
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
        mainStyleId: styles.some((s) => s.id === value || s.name === value)
          ? value
          : "",
      });
      pagesContainer
        ?.querySelectorAll?.(".page-main")
        .forEach(applyMainTextStyleToElement);
      rerender?.();
    });

  panel
    .querySelector("#document-main-style-clear")
    ?.addEventListener("click", () => {
      saveDocumentStyleSettings({
        ...loadDocumentStyleSettings(),
        mainStyleId: "",
      });
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
