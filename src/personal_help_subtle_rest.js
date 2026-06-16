const STYLE_ID = "rav-help-subtle-rest-style";

function installSubtleHelpRestStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
html body .rav-help-dot:not(:hover):not(:focus-visible) {
  width: 13px !important;
  height: 13px !important;
  border-color: rgba(24,90,189,.32) !important;
  background: rgba(255,255,255,.32) !important;
  color: rgba(20,83,181,.66) !important;
  font-size: 9px !important;
  opacity: .64 !important;
  box-shadow: 0 1px 3px rgba(20,83,181,.16) !important;
  transform: translateY(-.14em) scale(.98) !important;
}

html body .rav-help-wrap {
  margin-inline: 2px !important;
}

html body .rav-help-dot:hover,
html body .rav-help-dot:focus-visible {
  opacity: 1 !important;
  background: rgba(255,255,255,.9) !important;
  color: #1453b5 !important;
  border-color: rgba(24,90,189,.58) !important;
  box-shadow: 0 4px 14px rgba(20,83,181,.38) !important;
  transform: translateY(-.15em) scale(1.32) !important;
}`;
  document.head.appendChild(style);
}

if (document.head) {
  installSubtleHelpRestStyle();
} else {
  document.addEventListener("DOMContentLoaded", installSubtleHelpRestStyle, { once: true });
}

setTimeout(installSubtleHelpRestStyle, 0);
setTimeout(installSubtleHelpRestStyle, 250);
