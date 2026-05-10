// ערכת צבעים — כחול לילה + הדגשות זהב.

export const THEME = {
  bg_main:      "#0d1b2a",
  bg_card:      "#1b263b",
  bg_input:     "#243447",
  bg_header:    "#0d1b2a",
  bg_footer:    "#152238",
  bg_sidebar:   "#0a1622",
  bg_sidebar_active: "#1b263b",

  gold:         "#d4af37",
  gold_light:   "#f4d35e",
  gold_dark:    "#a88a2c",

  text_primary:   "#ffffff",
  text_secondary: "#cbd5e1",
  text_muted:     "#94a3b8",
  text_on_gold:   "#0d1b2a",

  success:     "#4ade80",
  success_bg:  "#14532d",
  danger:      "#ef4444",
  danger_dark: "#b91c1c",
  warning:     "#facc15",

  border:       "#334155",
  border_focus: "#d4af37",
};

export const FONTS = {
  title:    ["Arial", 22, "bold"],
  subtitle: ["Arial", 14],
  section:  ["Arial", 16, "bold"],
  label:    ["Arial", 14],
  input:    ["Arial", 14],
  button:   ["Arial", 15, "bold"],
  info:     ["Arial", 13],
  note:     ["Arial", 12],
  radio:    ["Arial", 14],
  tab:      ["Arial", 13, "bold"],
};

export function getTheme() {
  return THEME;
}

export function getFont(name) {
  return FONTS[name] || FONTS["label"];
}
