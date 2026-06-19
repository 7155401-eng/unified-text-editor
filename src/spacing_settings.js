import { loadTextStyles, saveTextStyles, styleOptionsHtml } from "./style_registry.js";

// ⚡ Bolt Optimization:
// Memory cache for spacing settings to prevent repetitive, expensive JSON.parse()
// and synchronous I/O operations inside layout engine tight loops.
let cachedSpacingSettings = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      cachedSpacingSettings = null;
    }
  });
}


const STORAGE_KEY = "ravtext.spacing.v1";

// Hebrew niqqud and te'amim sit above/below the base glyph as combining marks.
// Values below this can visually clip the marks in the editor/PDF preview even
// though the underlying text is still intact. Keep spacing dense, but safe.
const HEBREW_MARKS_SAFE_LINE_HEIGHT_MIN = 1.25;

const DEFAULTS = {
  editorLineHeight: 1.55,
  editorParagraphGap: 6,
  pageMainLineHeight: 1.55,
  pageMainParagraphGap: 6,
  mainStreamGap: 8,
  streamLineHeight: 1.4,
  streamGap: 4,
  streamNoteGap: 1,
  streamTitleGap: 1,
  ravtextStreamVerticalGap: 4,
  ravtextStreamHorizontalGap: 8,
  v9LineHeight: 1.55,
  v9MainGap: 8,
  noMidLineSplits: false,
  // משה 2026-05-14: מצב נוסף "לא לפצל פיסקאות (גמיש)" — לא מפצל פיסקה
  // אבל מנסה למלא רווחים בעמוד ע"י שאיבת פיסקה הבאה מהעמוד הבא אם נכנסת.
  noMidParagraphSoft: false,
  // משה 2026-05-15: הגדרה — "לא לפצל באמצע שורה". כשמופעל, חיתוכי טקסט
  // יתבצעו רק על גבול שורה שלמה (line-end). בניגוד ל-noMidLineSplits
  // שמטפל ברמת פסקה, זה מטפל אך ורק ברמת שורה.
  //
  // 2026-05-17 (v3): ברירת מחדל חוזרת ל-true (כפי שהיה במקור). הקצור
  // ל-false ב-PR #294 לא היה נכון — משה אמר במפורש "במצב 'לא לפצל
  // באמצע שורה' לפחות אין חיתוכים הנראים לעין, לכן זה יותר טוב שזה
  // מסומן כברירת מחדל". מי שרוצה זרימה חופשית של הדפדפן יכול לכבות
  // את ה-checkbox ידנית.
  preventMidLineSplit: true,
};

const FIELDS = [
  ["editorLineHeight", "עורך: גובה שורה", "number", HEBREW_MARKS_SAFE_LINE_HEIGHT_MIN, 3, 0.05],
  ["editorParagraphGap", "עורך: רווח פסקה", "number", 0, 80, 1],
  ["pageMainLineHeight", "PDF ראשי: גובה שורה", "number", HEBREW_MARKS_SAFE_LINE_HEIGHT_MIN, 3, 0.05],
  ["pageMainParagraphGap", "PDF ראשי: רווח פסקה", "number", 0, 80, 1],
  ["mainStreamGap", "PDF: ראשי-הערות", "number", 0, 80, 1],
  ["streamLineHeight", "זרמים: גובה שורה", "number", HEBREW_MARKS_SAFE_LINE_HEIGHT_MIN, 3, 0.05],
  ["streamGap", "בין זרמים", "number", 0, 80, 1],
  ["ravtextStreamVerticalGap", "רב טקסט: בין זרמים אנכית", "number", 0, 80, 1],
  ["ravtextStreamHorizontalGap", "רב טקסט: בין זרמים אופקית", "number", 0, 80, 1],
  ["streamNoteGap", "בין הערות", "number", 0, 40, 1],
  ["streamTitleGap", "כותרת-תוכן", "number", 0, 40, 1],
  ["v9LineHeight", "V9: גובה שורה", "number", HEBREW_MARKS_SAFE_LINE_HEIGHT_MIN, 3, 0.05],
  ["v9MainGap", "V9: ראשי-צד", "number", 0, 60, 1],
  ["noMidLineSplits", "לא לפצל באמצע פיסקאות (קשיח)", "checkbox", 0, 1, 1],
  ["noMidParagraphSoft", "לא לפצל פיסקאות (גמיש, ימלא רווחים)", "checkbox", 0, 1, 1],
  ["preventMidLineSplit", "לא לפצל באמצע שורה", "checkbox", 0, 1, 1],
];

export function loadSpacingSettings() {
  if (cachedSpacingSettings) return { ...cachedSpacingSettings };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    cachedSpacingSettings = normalizeSpacing({ ...DEFAULTS, ...saved });
    return { ...cachedSpacingSettings };
  } catch {
    cachedSpacingSettings = normalizeSpacing(DEFAULTS);
    return { ...cachedSpacingSettings };
  }
}

export function saveSpacingSettings(settings) {
  const next = normalizeSpacing(settings);
  cachedSpacingSettings = { ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function applySpacingSettings(settings = loadSpacingSettings(), pagesContainer = null) {
  const s = normalizeSpacing(settings);
  const vars = {
    "--ravtext-editor-line-height": String(s.editorLineHeight),
    "--ravtext-editor-paragraph-gap": `${s.editorParagraphGap}px`,
    "--ravtext-page-main-line-height": String(s.pageMainLineHeight),
    "--ravtext-page-main-paragraph-gap": `${s.pageMainParagraphGap}px`,
    "--ravtext-page-main-stream-gap": `${s.mainStreamGap}px`,
    "--ravtext-page-stream-line-height": String(s.streamLineHeight),
    "--ravtext-page-stream-gap": `${s.streamGap}px`,
    "--ravtext-stream-vertical-gap": `${s.ravtextStreamVerticalGap}px`,
    "--ravtext-stream-horizontal-gap": `${s.ravtextStreamHorizontalGap}px`,
    "--ravtext-editor-stream-vertical-gap": `${s.ravtextStreamVerticalGap}px`,
    "--ravtext-editor-stream-horizontal-gap": `${s.ravtextStreamHorizontalGap}px`,
    "--ravtext-page-stream-note-gap": `${s.streamNoteGap}px`,
    "--ravtext-page-stream-title-gap": `${s.streamTitleGap}px`,
    "--ravtext-v9-line-height": String(s.v9LineHeight),
    "--ravtext-v9-main-gap": `${s.v9MainGap}px`,
  };
  for (const [name, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(name, value);
    pagesContainer?.style.setProperty(name, value);
  }
}

export function wireSpacingControls({ pagesContainer, rerender }) {
  ensurePanel();
  const panel = document.getElementById("spacing-settings-panel");
  if (!panel || panel.dataset.bound === "1") return;
  panel.dataset.bound = "1";

  panel.innerHTML = `
    <span class="stream-label-static">הגדרות כלליות - רווחים:</span>
    ${FIELDS.map(([key, label, type, min, max, step]) => `
      <label class="stream-col-input spacing-input">
        <span>${label}:</span>
        <input data-spacing-key="${key}" type="${type}" min="${min}" max="${max}" step="${step}">
      </label>
    `).join("")}
    <label class="stream-col-input spacing-style-link">
      <span>סגנון:</span>
      <select id="spacing-style-select">${styleOptionsHtml("")}</select>
    </label>
    <button type="button" id="spacing-load-style">טען מהסגנון</button>
    <button type="button" id="spacing-save-style">שמור לסגנון</button>
  `;

  const render = () => {
    const s = loadSpacingSettings();
    for (const [key] of FIELDS) {
      const input = panel.querySelector(`[data-spacing-key="${key}"]`);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = !!s[key];
      else input.value = s[key];
    }
    const styleSelect = panel.querySelector("#spacing-style-select");
    if (styleSelect) styleSelect.innerHTML = styleOptionsHtml(styleSelect.value || "");
  };

  const commit = () => {
    const current = loadSpacingSettings();
    for (const [key] of FIELDS) {
      const input = panel.querySelector(`[data-spacing-key="${key}"]`);
      if (!input) continue;
      if (input.type === "checkbox") {
        current[key] = !!input.checked;
        continue;
      }
      const n = Number(input.value);
      if (Number.isFinite(n)) current[key] = n;
    }
    const next = saveSpacingSettings(current);
    applySpacingSettings(next, pagesContainer);
    rerender?.();
  };

  panel.addEventListener("change", (ev) => {
    if (ev.target?.matches?.("[data-spacing-key]")) commit();
  });

  panel.querySelector("#spacing-load-style")?.addEventListener("click", () => {
    const style = selectedStyle(panel);
    if (!style) return;
    const current = loadSpacingSettings();
    if (style.lineHeight) {
      current.editorLineHeight = style.lineHeight;
      current.pageMainLineHeight = style.lineHeight;
      current.streamLineHeight = style.lineHeight;
      current.v9LineHeight = style.lineHeight;
    }
    if (style.marginBottom != null) {
      current.editorParagraphGap = style.marginBottom;
      current.pageMainParagraphGap = style.marginBottom;
      current.streamNoteGap = Math.max(0, Math.min(40, style.marginBottom));
    }
    const next = saveSpacingSettings(current);
    applySpacingSettings(next, pagesContainer);
    render();
    rerender?.();
  });

  panel.querySelector("#spacing-save-style")?.addEventListener("click", () => {
    const select = panel.querySelector("#spacing-style-select");
    const id = select?.value;
    if (!id || id === "__add-custom__") return;
    const styles = loadTextStyles();
    const idx = styles.findIndex(s => s.id === id || s.name === id);
    if (idx < 0) return;
    const spacing = loadSpacingSettings();
    styles[idx] = {
      ...styles[idx],
      lineHeight: spacing.pageMainLineHeight,
      marginBottom: spacing.pageMainParagraphGap,
    };
    saveTextStyles(styles);
    render();
    rerender?.();
  });

  window.addEventListener("ravtext:styles-changed", render);
  render();
  applySpacingSettings(loadSpacingSettings(), pagesContainer);
}

function normalizeSpacing(settings) {
  const out = { ...DEFAULTS, ...(settings || {}) };
  for (const [key, , , min, max] of FIELDS) {
    if (typeof DEFAULTS[key] === "boolean") {
      out[key] = !!out[key];
      continue;
    }
    const n = Number(out[key]);
    out[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : DEFAULTS[key];
  }
  return out;
}

function selectedStyle(panel) {
  const value = panel.querySelector("#spacing-style-select")?.value;
  if (!value || value === "__add-custom__") return null;
  return loadTextStyles().find(s => s.id === value || s.name === value) || null;
}

function ensurePanel() {
  if (document.getElementById("spacing-settings-panel")) return;
  const anchor = document.getElementById("stream-columns-panel");
  if (!anchor) return;
  const panel = document.createElement("div");
  panel.id = "spacing-settings-panel";
  panel.className = "toolbar spacing-toolbar ribbon-panel";
  panel.dataset.ribbonTab = "layout";
  if ((localStorage.getItem("ravtext.ribbonTab") || "home") !== "layout") {
    panel.classList.add("ribbon-hidden");
  }
  panel.dir = "rtl";
  anchor.insertAdjacentElement("beforebegin", panel);
}
