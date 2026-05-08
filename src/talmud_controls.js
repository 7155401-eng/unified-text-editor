// talmud_controls.js — UI wiring for Talmud-mode controls + localStorage helpers.
//
// משה 2026-05-08: הקובץ הזה הוצא מ-talmud_layout.js הישן כשהמנוע הויזואלי
// הוחלף ב-V9 (vilna_v9.js + vilna_v9_apply.js). הפונקציה הזו רק שומרת
// הגדרות ב-localStorage ומקשרת את הקונטרולים שבעורך לערכים. אין כאן
// לוגיקת פריסה — V9 הוא המנוע הויזואלי היחיד.

// משה 2026-05-08: דמו לא חוסם יותר את גפ"ת. סימני המים מטופלים
// ב-engine_bridge דרך injectDemoWatermarksIfNeeded לפני שהתוכן מגיע ל-V9.

const STORAGE_KEY       = "ravtext.talmudLayout";
const STREAMS_KEY       = "ravtext.talmudLayout.streams";
const CROWN_LINES_KEY   = "ravtext.talmudLayout.crownLines";
const MAIN_WIDTH_KEY    = "ravtext.talmudLayout.mainWidth";
const SIDE_MODE_KEY     = "ravtext.talmudLayout.sideMode";
const SIDE_GAP_KEY      = "ravtext.talmudLayout.sideGap";
const PRESERVE_BREAKS_KEY = "ravtext.talmudLayout.preserveBreaks";
const HEIGHT_SAFETY_KEY = "ravtext.talmudLayout.heightSafety";
const HEIGHT_SAFETY_REGULAR_KEY = "ravtext.layout.heightSafetyRegular";
const HEIGHT_SAFETY_PER_PAGE_KEY = "ravtext.talmudLayout.heightSafetyPerPage";
const DEFAULT_SIDE_GAP  = 12;
const DEFAULT_HEIGHT_SAFETY = 160;
const DEFAULT_HEIGHT_SAFETY_REGULAR = 6;

export function isTalmudLayoutEnabled() {
  // משה 2026-05-08: גפ"ת פתוח לכולם (גם דמו/אורחים). סימני המים שלrender
  // מוטמעים בטקסט הראשי דרך injectDemoWatermarksIfNeeded ב-engine_bridge,
  // אז גם משתמשי דמו רואים את העימוד אבל עם כתמי "DEMO" בטקסט.
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
  localStorage.setItem(CROWN_LINES_KEY, String(Math.max(0, Math.min(12, parseInt(value, 10) || 4))));
}

export function getTalmudMainWidth() {
  const n = parseFloat(localStorage.getItem(MAIN_WIDTH_KEY) || "42");
  return Number.isFinite(n) ? Math.max(20, Math.min(80, n)) : 42;
}
export function setTalmudMainWidth(value) {
  localStorage.setItem(MAIN_WIDTH_KEY, String(Math.max(20, Math.min(80, parseFloat(value) || 42))));
}

export function getTalmudSideMode() {
  const v = localStorage.getItem(SIDE_MODE_KEY) || "inner-outer";
  return ["auto", "right-left", "inner-outer"].includes(v) ? v : "inner-outer";
}
export function setTalmudSideMode(value) {
  localStorage.setItem(SIDE_MODE_KEY, value || "inner-outer");
}

export function getTalmudSideGap() {
  const n = parseFloat(localStorage.getItem(SIDE_GAP_KEY) || String(DEFAULT_SIDE_GAP));
  return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : DEFAULT_SIDE_GAP;
}
export function setTalmudSideGap(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 60) {
    localStorage.removeItem(SIDE_GAP_KEY);
    return;
  }
  localStorage.setItem(SIDE_GAP_KEY, String(n));
}

export function isTalmudPreserveBreaks() {
  const v = localStorage.getItem(PRESERVE_BREAKS_KEY);
  return v === null ? false : v === "1";
}
export function setTalmudPreserveBreaks(enabled) {
  localStorage.setItem(PRESERVE_BREAKS_KEY, enabled ? "1" : "0");
}

export function getTalmudHeightSafety() {
  const raw = localStorage.getItem(HEIGHT_SAFETY_KEY);
  if (raw === null) return DEFAULT_HEIGHT_SAFETY;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_HEIGHT_SAFETY;
  return Math.max(0, Math.min(400, n));
}
export function setTalmudHeightSafety(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || n > 400) {
    localStorage.removeItem(HEIGHT_SAFETY_KEY);
    return;
  }
  localStorage.setItem(HEIGHT_SAFETY_KEY, String(n));
}

export function getEffectiveHeightSafety() {
  if (isTalmudLayoutEnabled()) return getTalmudHeightSafety();
  const raw = localStorage.getItem(HEIGHT_SAFETY_REGULAR_KEY);
  if (raw === null) return DEFAULT_HEIGHT_SAFETY_REGULAR;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_HEIGHT_SAFETY_REGULAR;
  return Math.max(0, Math.min(400, n));
}
export function setEffectiveHeightSafety(value) {
  if (isTalmudLayoutEnabled()) return setTalmudHeightSafety(value);
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || n > 400) {
    localStorage.removeItem(HEIGHT_SAFETY_REGULAR_KEY);
    return;
  }
  localStorage.setItem(HEIGHT_SAFETY_REGULAR_KEY, String(n));
}

export function getTalmudHeightSafetyPerPage() {
  return (localStorage.getItem(HEIGHT_SAFETY_PER_PAGE_KEY) || "").trim();
}
export function setTalmudHeightSafetyPerPage(value) {
  const v = (value || "").trim();
  if (!v) {
    localStorage.removeItem(HEIGHT_SAFETY_PER_PAGE_KEY);
    return;
  }
  const parts = v.split(/[,;\n]/)
    .map(p => p.trim())
    .filter(p => /^\d+\s*:\s*\d+$/.test(p))
    .map(p => p.replace(/\s+/g, ''));
  localStorage.setItem(HEIGHT_SAFETY_PER_PAGE_KEY, parts.join(','));
}

export function wireTalmudLayoutControls(onChange) {
  const toggle       = document.getElementById("talmud-layout-toggle");
  const streamsInput = document.getElementById("talmud-streams-input");
  const crownInput   = document.getElementById("talmud-crown-lines-input");
  const widthInput   = document.getElementById("talmud-main-width-input");
  const sideSelect   = document.getElementById("talmud-side-mode-select");
  const gapInput     = document.getElementById("talmud-side-gap-input");
  const breaksToggle = document.getElementById("talmud-preserve-breaks");
  const safetyInput  = document.getElementById("layout-height-safety-input")
                    || document.getElementById("talmud-height-safety-input");
  const smartToggle  = document.getElementById("layout-smart-engine-toggle")
                    || document.getElementById("talmud-smart-engine-toggle");
  const perPageInput = document.getElementById("layout-height-safety-per-page-input")
                    || document.getElementById("talmud-height-safety-per-page-input");

  if (!toggle) return;

  // משה 2026-05-08: גפ"ת פתוח לדמו/אורחים (עם סימני מים בטקסט). לא חוסמים את ה-toggle.

  toggle.checked = isTalmudLayoutEnabled();
  if (streamsInput) streamsInput.value = getTalmudStreamsText();
  if (crownInput)   crownInput.value   = getTalmudCrownLines();
  if (widthInput)   widthInput.value   = getTalmudMainWidth();
  if (sideSelect)   sideSelect.value   = getTalmudSideMode();
  if (gapInput)     gapInput.value     = getTalmudSideGap();
  if (breaksToggle) breaksToggle.checked = isTalmudPreserveBreaks();
  if (safetyInput)  safetyInput.value  = getEffectiveHeightSafety();
  if (smartToggle)  smartToggle.checked = localStorage.getItem("ravtext.talmudLayout.smartEngine") === "1";
  if (perPageInput) perPageInput.value = getTalmudHeightSafetyPerPage();

  const commit = () => onChange?.();

  toggle.addEventListener("change", () => {
    setTalmudLayoutEnabled(toggle.checked);
    if (!toggle.checked) {
      const otherAsMishna = document.getElementById("talmud-other-as-mishna");
      if (otherAsMishna && otherAsMishna.checked) {
        otherAsMishna.checked = false;
        try { localStorage.setItem("ravtext.talmud.otherAsMishna", "0"); } catch (_) {}
        try {
          if (localStorage.getItem("ravtext.mishnaWrap") === "1") {
            localStorage.setItem("ravtext.mishnaWrap", "0");
            const mwToggle = document.getElementById("mishna-wrap-toggle");
            if (mwToggle) mwToggle.checked = false;
          }
        } catch (_) {}
      }
    }
    commit();
  });
  streamsInput?.addEventListener("change", () => {
    setTalmudStreamsText(streamsInput.value);
    commit();
  });
  streamsInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); streamsInput.blur(); }
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
  gapInput?.addEventListener("change", () => {
    setTalmudSideGap(gapInput.value);
    gapInput.value = getTalmudSideGap();
    commit();
  });
  breaksToggle?.addEventListener("change", () => {
    setTalmudPreserveBreaks(breaksToggle.checked);
    commit();
  });
  safetyInput?.addEventListener("change", () => {
    setEffectiveHeightSafety(safetyInput.value);
    safetyInput.value = getEffectiveHeightSafety();
    commit();
  });
  toggle.addEventListener("change", () => {
    if (safetyInput) safetyInput.value = getEffectiveHeightSafety();
  });
  smartToggle?.addEventListener("change", () => {
    localStorage.setItem("ravtext.talmudLayout.smartEngine", smartToggle.checked ? "1" : "0");
    commit();
  });
  perPageInput?.addEventListener("change", () => {
    setTalmudHeightSafetyPerPage(perPageInput.value);
    perPageInput.value = getTalmudHeightSafetyPerPage();
    commit();
  });
}
