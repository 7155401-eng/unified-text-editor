const STYLE_ID = "rav-help-subtle-rest-style";

function installSubtleHelpRestStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
html body .rav-help-dot:not(:hover):not(:focus-visible) {
  width: 11px !important;
  height: 11px !important;
  border-color: rgba(24,90,189,.18) !important;
  background: rgba(255,255,255,.16) !important;
  color: rgba(20,83,181,.42) !important;
  font-size: 8px !important;
  opacity: .38 !important;
  box-shadow: none !important;
  transform: translateY(-.12em) scale(.86) !important;
}

html body .rav-help-wrap {
  margin-inline: 1px !important;
}

html body .rav-help-dot:hover,
html body .rav-help-dot:focus-visible {
  opacity: 1 !important;
  background: rgba(255,255,255,.86) !important;
  color: #1453b5 !important;
  border-color: rgba(24,90,189,.55) !important;
  box-shadow: 0 4px 14px rgba(20,83,181,.38) !important;
  transform: translateY(-.15em) scale(1.34) !important;
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
