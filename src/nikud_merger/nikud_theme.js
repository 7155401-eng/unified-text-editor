// nikud_theme.js
// ===============
// תרגום מלא של ui/theme_qt.py — ערכת צבעים Midnight Blue & Royal Gold,
// כולל מצב כהה ומצב בהיר.

// ═══════════════════════════════════════════════════════════════════════════
// רקעים (כהה)
// ═══════════════════════════════════════════════════════════════════════════
export const BG_DEEPEST    = "#050A18";
export const BG_PRIMARY    = "#0B1426";
export const BG_SECONDARY  = "#111D35";
export const BG_CARD       = "#162040";
export const BG_SURFACE    = "#1A2850";
export const BG_TERTIARY   = "#20305F";
export const BG_HOVER      = "#2B3F7A";
export const BG_INPUT      = "#0A1020";

// ═══════════════════════════════════════════════════════════════════════════
// זהב מלכותי
// ═══════════════════════════════════════════════════════════════════════════
export const GOLD_DEEP     = "#8B7333";
export const GOLD_PRIMARY  = "#C9A84C";
export const GOLD_LIGHT    = "#D9BC6A";
export const GOLD_BRIGHT   = "#E8C878";
export const GOLD_CREAM    = "#F5E6B8";

// ═══════════════════════════════════════════════════════════════════════════
// צבעי מבטא
// ═══════════════════════════════════════════════════════════════════════════
export const BLUE_ROYAL    = "#2E6BD6";
export const BLUE_BRIGHT   = "#4A8EF5";
export const CYAN_BRIGHT   = "#22D3EE";
export const PURPLE        = "#A78BFA";
export const PINK          = "#F472B6";
export const ROSE          = "#FB7185";
export const ORANGE_WARM   = "#FB923C";
export const AMBER         = "#FBBF24";
export const GREEN_MINT    = "#34D399";

// ═══════════════════════════════════════════════════════════════════════════
// טקסט
// ═══════════════════════════════════════════════════════════════════════════
export const TEXT_PRIMARY    = "#FFF4CC";
export const TEXT_CREAM      = "#F5EEDC";
export const TEXT_SECONDARY  = "#C9B88A";
export const TEXT_MUTED      = "#8A7944";
export const TEXT_WHITE      = "#FFFFFF";
export const TEXT_DARK       = "#0A1020";
export const TEXT_ON_DARK_BG = "#FFE8A0";

// ═══════════════════════════════════════════════════════════════════════════
// גבולות
// ═══════════════════════════════════════════════════════════════════════════
export const BORDER_SOFT    = "#1E293B";
export const BORDER_GOLD    = "#8B7333";
export const BORDER_GLOW    = "#C9A84C";

// ═══════════════════════════════════════════════════════════════════════════
// צבעי פעולה
// ═══════════════════════════════════════════════════════════════════════════
export const SUCCESS        = "#10B981";
export const ERROR          = "#DC3545";
export const WARNING        = "#F59E0B";

// ═══════════════════════════════════════════════════════════════════════════
// דיף
// ═══════════════════════════════════════════════════════════════════════════
export const DIFF_INSERTED_BG   = "#0F3A1F";
export const DIFF_INSERTED_FG   = "#6EE7B7";
export const DIFF_DELETED_BG    = "#3A1010";
export const DIFF_DELETED_FG    = "#FCA5A5";
export const DIFF_SPELLING_BG   = "#3D2F0F";
export const DIFF_SPELLING_FG   = "#FCD34D";

// ═══════════════════════════════════════════════════════════════════════════
// פונטים
// ═══════════════════════════════════════════════════════════════════════════
export const FONT_UI = "Segoe UI";
export const HEBREW_FONT_PREFERENCES = [
  "Narkisim", "Hadassah Friedlaender", "FrankRuehl",
  "Guttman Myamfix", "David", "Arial", "Segoe UI",
];
export let HEBREW_FONT = "Arial";

export function chooseHebrewFont() {
  // בדפדפן אין QFontDatabase — נחזיר קדימויות כ-CSS font-family stack
  return HEBREW_FONT_PREFERENCES.map(f => `"${f}"`).join(", ");
}

export function applyHebrewFont() {
  HEBREW_FONT = chooseHebrewFont();
}


// ═══════════════════════════════════════════════════════════════════════════
// מצב עיצוב — כהה (ברירת מחדל) / בהיר
// v11.63 — initial mode follows the global RavText theme preference.
// ═══════════════════════════════════════════════════════════════════════════
function readGlobalThemePref() {
  // משה 2026-05-08: עוקב אחר ערכת הנושא של האתר.
  // קודם DOM (body.light-theme) — מקור האמת בזמן ריצה.
  // fallback ל-localStorage. ברירת המחדל בעורך הראשי = light, אז גם כאן.
  try {
    if (typeof document !== "undefined" && document.body) {
      if (document.body.classList.contains("light-theme")) return "light";
      if (document.body.classList.contains("dark-theme")) return "dark";
    }
    const v = (localStorage.getItem("ravtext.theme") || "").trim().toLowerCase();
    return v === "dark" ? "dark" : "light";
  } catch (_) {
    return "light";
  }
}

let _currentMode = readGlobalThemePref();

export function currentMode() { return _currentMode; }

export function setMode(mode) {
  if (mode === "dark" || mode === "light") {
    _currentMode = mode;
    try { localStorage.setItem("ravtext.theme", mode); } catch (_) {}
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// צבעי מצב בהיר — קרם + זהב חם
// ═══════════════════════════════════════════════════════════════════════════
export const LIGHT_BG_PRIMARY    = "#FAF6EC";
export const LIGHT_BG_SECONDARY  = "#F2EBD8";
export const LIGHT_BG_CARD       = "#FFFCF2";
export const LIGHT_BG_DEEPEST    = "#E8DEC1";
export const LIGHT_BG_INPUT      = "#FFFFFF";
export const LIGHT_BG_HOVER      = "#EFE4C5";
export const LIGHT_TEXT_PRIMARY  = "#2A1F0A";
export const LIGHT_TEXT_CREAM    = "#3F2E10";
export const LIGHT_TEXT_MUTED    = "#7A6536";
export const LIGHT_GOLD_DEEP     = "#9C7C2E";
export const LIGHT_GOLD_PRIMARY  = "#B8932E";
export const LIGHT_GOLD_BRIGHT   = "#D4AF3E";
export const LIGHT_BORDER_GOLD   = "#B8932E";
export const LIGHT_BORDER_SOFT   = "#D9CFB3";


export function palette() {
  if (_currentMode === "light") {
    return {
      bg_primary:    LIGHT_BG_PRIMARY,
      bg_deepest:    LIGHT_BG_DEEPEST,
      bg_secondary:  LIGHT_BG_SECONDARY,
      bg_card:       LIGHT_BG_CARD,
      bg_input:      LIGHT_BG_INPUT,
      text_primary:  LIGHT_TEXT_PRIMARY,
      text_cream:    LIGHT_TEXT_CREAM,
      text_muted:    LIGHT_TEXT_MUTED,
      text_secondary: LIGHT_TEXT_MUTED,
      title:         LIGHT_GOLD_DEEP,
      subtitle:      LIGHT_GOLD_PRIMARY,
      accent_gold:   LIGHT_GOLD_PRIMARY,
      accent_amber:  "#C18B1F",
      accent_blue:   "#3B6FCB",
      accent_green:  "#2EAB66",
      accent_purple: "#7B5CCC",
      border_gold:   LIGHT_BORDER_GOLD,
    };
  }
  return {
    bg_primary:    BG_PRIMARY,
    bg_deepest:    BG_DEEPEST,
    bg_secondary:  BG_SECONDARY,
    bg_card:       BG_CARD,
    bg_input:      BG_INPUT,
    text_primary:  TEXT_PRIMARY,
    text_cream:    TEXT_CREAM,
    text_muted:    TEXT_MUTED,
    text_secondary: TEXT_SECONDARY,
    title:         GOLD_PRIMARY,
    subtitle:      GOLD_DEEP,
    accent_gold:   GOLD_PRIMARY,
    accent_amber:  AMBER,
    accent_blue:   BLUE_BRIGHT,
    accent_green:  GREEN_MINT,
    accent_purple: PURPLE,
    border_gold:   BORDER_GOLD,
  };
}
