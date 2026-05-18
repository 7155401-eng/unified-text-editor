import { extractOpeningSegmentForTest, getOpeningWordSettings } from "../opening_word.js";

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeWeight(value) {
  if (value === "normal") return "400";
  if (value === "heavy") return "900";
  return "700";
}

function fontFamily(font) {
  if (font === "David") return '"David", "David Libre", "Frank Ruhl Libre", serif';
  if (font === "David Libre") return '"David Libre", "David", "Frank Ruhl Libre", serif';
  if (font === "Frank Ruhl Libre") return '"Frank Ruhl Libre", "David Libre", "David", serif';
  if (font === "Segoe UI") return '"Segoe UI", "David", "David Libre", sans-serif';
  return font || "inherit";
}

function normalizeSettingsForV9(raw) {
  const settings = raw || getOpeningWordSettings();
  return {
    enabled: !!settings.enabled,
    target: settings.target || "word",
    count: clampNumber(settings.count, 1, 1, 12),
    style: settings.style || "",
    font: settings.font || "David",
    size: clampNumber(settings.size, 200, 80, 500),
    weight: settings.weight || "bold",
    position: settings.position || "dropped",
    dropLines: clampNumber(settings.dropLines, 2, 1, 8),
    spaceAfter: clampNumber(settings.spaceAfter, 0.3, 0, 4),
    scope: settings.scope || "all",
    skipHeadings: settings.skipHeadings !== false,
    headingMin: clampNumber(settings.headingMin, 80, 0, 500),
  };
}

function normalizePosition(settings, parts) {
  const suffix = String(parts?.suffix || "").replace(/\s+/g, " ").trim();
  const suffixWords = suffix ? suffix.split(/\s+/).length : 0;
  const suffixChars = suffix.length;
  if (settings.position !== "dropped") return "raised";
  if (suffixWords < 2 || suffixChars < 18) return "raised";
  return "dropped";
}

function estimateTextWidthPx(text, fontSizePx) {
  const sample = String(text || "").replace(/\s+/g, " ").trim();
  if (!sample) return 0;
  const size = Number(fontSizePx) > 0 ? Number(fontSizePx) : 16;
  return Math.ceil(sample.length * Math.max(7, size * 0.56));
}

export function buildV9OpeningWordLayoutModel(text, rawSettings, options = {}) {
  const settings = normalizeSettingsForV9(rawSettings);
  if (!settings.enabled) return null;
  if (options.isParagraphStart === false) return null;
  if (options.continuesFromPrevious) return null;

  const parts = extractOpeningSegmentForTest(String(text || ""), settings);
  if (!parts || !parts.segment?.trim() || !parts.suffix?.trim()) return null;

  const position = normalizePosition(settings, parts);
  const baseFontSize = Number(options.baseFontSize) || 0;
  const baseLineHeight = Number(options.baseLineHeight) || (baseFontSize > 0 ? baseFontSize * 1.55 : 0);
  const fontSizePx = baseFontSize > 0 ? (baseFontSize * settings.size) / 100 : null;
  const effectiveOpeningFontSize = fontSizePx || baseFontSize || 16;
  const openingWordWidthPx = estimateTextWidthPx(parts.segment, effectiveOpeningFontSize);
  const spaceAfterPx = Math.max(0, effectiveOpeningFontSize * settings.spaceAfter * 0.5);
  const dropLines = Math.max(1, settings.dropLines);
  const windowLineCount = position === "dropped" ? dropLines : 1;
  const openingWordHeightPx = position === "dropped"
    ? Math.max(baseLineHeight * dropLines, effectiveOpeningFontSize * 1.05)
    : Math.max(baseLineHeight, effectiveOpeningFontSize * 1.05);
  const reserveWidthPx = Math.ceil(openingWordWidthPx + spaceAfterPx);
  const remainingText = String(parts.suffix || "").replace(/^\s+/, "");

  return {
    source: "opening_word.js",
    parts,
    settings,
    position,
    paragraphStart: true,
    continuesFromPrevious: false,
    metrics: {
      openingFontSizePx: fontSizePx,
      openingLineHeightPx: openingWordHeightPx,
      openingWordWidthPx,
      openingWordHeightPx,
      reserveWidthPx,
      dropLines,
      spaceAfterPx,
    },
    flow: {
      firstLineText: remainingText,
      remainingText,
      firstLineWidthReductionPx: reserveWidthPx,
      windowLineCount,
      windowWidthPx: reserveWidthPx,
    },
    style: {
      fontFamily: fontFamily(settings.font),
      fontSizePx,
      fontSizePercent: settings.size,
      fontWeight: normalizeWeight(settings.weight),
      dropLines,
      spaceAfterEm: settings.spaceAfter,
    },
  };
}

export function applyV9OpeningWordModelToLineElement(lineEl, model, firstLineText = "") {
  if (!lineEl || !model || lineEl.dataset.opwApplied === "1") return false;
  const { parts, style, position } = model;
  lineEl.textContent = "";
  if (parts.prefix) lineEl.appendChild(document.createTextNode(parts.prefix));
  const span = document.createElement("span");
  span.className = `opw-segment opw-${position}`;
  span.style.fontFamily = style.fontFamily;
  span.style.fontSize = `${style.fontSizePercent}%`;
  span.style.fontWeight = style.fontWeight;
  if (position === "raised") span.style.marginLeft = `${style.spaceAfterEm}em`;
  span.style.setProperty("--opw-drop-lines", String(style.dropLines));
  span.style.setProperty("--opw-space-after", `${style.spaceAfterEm}em`);
  span.textContent = parts.segment;
  lineEl.appendChild(span);
  const suffix = firstLineText || model.flow?.firstLineText || parts.suffix || "";
  if (suffix) lineEl.appendChild(document.createTextNode(suffix));
  lineEl.classList.add("opw-host");
  lineEl.dataset.opwApplied = "1";
  lineEl.dataset.v9OpeningWordSource = "opening_word.js";
  lineEl.dataset.v9OpeningWordPosition = position;
  return true;
}
