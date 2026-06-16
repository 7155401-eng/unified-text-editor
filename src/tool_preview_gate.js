import "./personal_help_assistant.js";

const PUBLIC_TOOLS = new Set([
  "nikud-merger",
  "word-extractor",
  "torah-transcription",
  "torah-nikud",
  "haredi-caricature",
  "text-compare-pro",
  "sefaria-downloader",
  "sefaria-live",
]);

function isAdmin() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__;
  return !!(auth && auth.admin === true);
}

export function isToolPreviewAllowed(toolName) {
  if (PUBLIC_TOOLS.has(toolName)) return true;
  return isAdmin();
}

export function revealToolButtons() {
  if (typeof document === "undefined") return;
  const admin = isAdmin();
  const buttons = document.querySelectorAll("[data-tool-preview]");
  buttons.forEach((btn) => {
    const tool = btn.getAttribute("data-tool-preview");
    if (admin || PUBLIC_TOOLS.has(tool)) {
      btn.hidden = false;
    }
  });
}
