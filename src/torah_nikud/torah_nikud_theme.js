// theme.py port — verbatim color palette + fonts (Arial sizes).
// Original is a dict; here we expose it as a frozen object.

export const THEME = Object.freeze({
  bg_main:      "#0d1b2a",
  bg_card:      "#1b263b",
  bg_input:     "#243447",
  bg_header:    "#0d1b2a",
  bg_footer:    "#152238",
  bg_sidebar:   "#0a1622",

  gold:         "#d4af37",
  gold_light:   "#f4d35e",
  gold_dark:    "#a88a2c",

  text_primary:   "#ffffff",
  text_secondary: "#cbd5e1",
  text_muted:     "#94a3b8",
  text_on_gold:   "#0d1b2a",

  success:     "#4ade80",
  danger:      "#ef4444",
  danger_dark: "#b91c1c",
  warning:     "#facc15",
  warning_bg:  "#3a2410",

  border:       "#334155",
  border_focus: "#d4af37",
});

export const FONTS = Object.freeze({
  title:      ["Arial", 22, "bold"],
  section:    ["Arial", 16, "bold"],
  label:      ["Arial", 14, ""],
  input:      ["Arial", 14, ""],
  button:     ["Arial", 15, "bold"],
  info:       ["Arial", 13, ""],
  note:       ["Arial", 12, ""],
  radio:      ["Arial", 14, ""],
  warn_big:   ["Arial", 16, "bold"],
});

export function getTheme() {
  return THEME;
}

export function getFont(name) {
  return FONTS[name] || FONTS.label;
}
