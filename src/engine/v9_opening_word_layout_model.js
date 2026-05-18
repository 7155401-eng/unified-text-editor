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

function measureOpeningTextWidthPx(text, fontSizePx, style) {
  const sample = String(text || "").replace(/\s+/g, " ").trim();
  if (!sample) return 0;
  const size = Number(fontSizePx) > 0 ? Number(fontSizePx) : 16;
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.direction = "rtl";
        ctx.font = `${style?.fontWeight || "700"} ${size}px ${style?.fontFamily || "serif"}`;
        const width = ctx.measureText(sample).width;
        if (Number.isFinite(width) && width > 0) return Math.ceil(width * 1.08);
      }
    } catch (_) {
      // fallback below
    }
  }
  return estimateTextWidthPx(sample, size);
}

function toPx(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function keepOpeningLineUnjustified(el) {
  if (!el) return;
  if (el.classList) {
    el.classList.remove("justify");
    el.classList.remove("center");
  }
  el.style.textAlign = "start";
  el.style.textAlignLast = "auto";
  el.style.whiteSpace = "nowrap";
  el.dataset.v9OpeningWordUnjustified = "1";
}

function scheduleOpeningWindowIndent(lineEl, model) {
  if (!lineEl || !model || model.position !== "dropped") return;
  const reserveWidthPx = Math.round(Number(model.metrics?.reserveWidthPx) || 0);
  const windowLineCount = Math.max(1, Math.round(Number(model.flow?.windowLineCount) || Number(model.metrics?.dropLines) || 1));
  if (reserveWidthPx <= 0 || windowLineCount <= 1) return;

  const apply = () => {
    const pageEl = lineEl.parentElement;
    if (!pageEl || !pageEl.querySelectorAll) return;

    const hostTop = toPx(lineEl.style.top);
    const hostWidth = toPx(lineEl.style.width);
    const lineHeight = toPx(lineEl.style.lineHeight) || toPx(lineEl.style.height);
    if (hostWidth <= reserveWidthPx + 24 || lineHeight <= 0) return;

    const hostRole = lineEl.dataset.v9Role || "";
    const hostBoxId = lineEl.dataset.v9BoxId || "";
    const windowBottom = hostTop + lineHeight * windowLineCount + 0.5;
    let adjusted = 0;

    for (const el of Array.from(pageEl.querySelectorAll(".v9-line"))) {
      if (el === lineEl || el.dataset.v9OpeningWindowAdjusted === "1") continue;
      if (hostRole && el.dataset.v9Role !== hostRole) continue;
      if (hostBoxId && el.dataset.v9BoxId !== hostBoxId) continue;

      const top = toPx(el.style.top);
      if (top <= hostTop + 0.5 || top >= windowBottom) continue;

      const currentWidth = toPx(el.style.width);
      const targetWidth = Math.max(24, currentWidth - reserveWidthPx);
      if (currentWidth <= targetWidth + 1 || currentWidth <= hostWidth - reserveWidthPx + 2) continue;

      el.style.width = `${targetWidth}px`;
      keepOpeningLineUnjustified(el);
      el.dataset.v9OpeningWindowAdjusted = "1";
      el.dataset.v9OpeningWindowReservePx = String(reserveWidthPx);
      adjusted += 1;
    }

    lineEl.dataset.v9OpeningWindowAdjustedLines = String(adjusted);
  };

  if (typeof queueMicrotask === "function") queueMicrotask(apply);
  else setTimeout(apply, 0);
}

export function buildV9OpeningWordLayoutModel(text, rawSettings, options = {}) {
  const settings = normalizeSettingsForV9(rawSettings);
  const continuesFromPrevious = !!(
    options.continuesFromPrevious ||
    options.isPageSplitContinuation
  );

  if (!settings.enabled) return null;
  if (options.isParagraphStart === false) return null;
  if (options.isOriginalParagraphStart === false) return null;
  if (continuesFromPrevious) return null;

  const parts = extractOpeningSegmentForTest(String(text || ""), settings);
  if (!parts || !parts.segment?.trim() || !parts.suffix?.trim()) return null;

  const position = normalizePosition(settings, parts);
  const baseFontSize = Number(options.baseFontSize) || 0;
  const baseLineHeight = Number(options.baseLineHeight) || (baseFontSize > 0 ? baseFontSize * 1.55 : 0);
  const fontSizePx = baseFontSize > 0 ? (baseFontSize * settings.size) / 100 : null;
  const effectiveOpeningFontSize = fontSizePx || baseFontSize || 16;
  const style = {
    fontFamily: fontFamily(settings.font),
    fontSizePx,
    fontSizePercent: settings.size,
    fontWeight: normalizeWeight(settings.weight),
    dropLines: settings.dropLines,
    spaceAfterEm: settings.spaceAfter,
  };
  const openingWordWidthPx = measureOpeningTextWidthPx(parts.segment, effectiveOpeningFontSize, style);
  const spaceAfterPx = Math.max(0, effectiveOpeningFontSize * settings.spaceAfter * 0.5);
  const dropLines = Math.max(1, settings.dropLines);
  const windowLineCount = position === "dropped" ? dropLines : 1;
  const openingWordHeightPx = position === "dropped"
    ? Math.max(baseLineHeight * dropLines, effectiveOpeningFontSize * 1.05)
    : Math.max(baseLineHeight, effectiveOpeningFontSize * 1.05);
  const reserveWidthPx = Math.ceil(openingWordWidthPx + spaceAfterPx);
  const remainingText = String(parts.suffix || "").replace(/^\s+/, "");

  return {
    source: "opening_word.js:v9-measured",
    parts,
    settings,
    position,
    paragraphStart: true,
    isOriginalParagraphStart: options.isOriginalParagraphStart !== false,
    sourceParagraphId: options.sourceParagraphId || options.paragraphSourceId || null,
    continuesFromPrevious,
    isPageSplitContinuation: false,
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
    style,
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
  span.style.display = "inline-block";
  span.style.verticalAlign = position === "dropped" ? "top" : "baseline";
  span.style.marginLeft = `${style.spaceAfterEm}em`;
  span.style.setProperty("--opw-drop-lines", String(style.dropLines));
  span.style.setProperty("--opw-space-after", `${style.spaceAfterEm}em`);
  span.textContent = parts.segment;
  lineEl.appendChild(span);
  const suffix = firstLineText || model.flow?.firstLineText || parts.suffix || "";
  if (suffix) lineEl.appendChild(document.createTextNode(suffix));
  lineEl.classList.add("opw-host");
  keepOpeningLineUnjustified(lineEl);
  lineEl.dataset.opwApplied = "1";
  lineEl.dataset.v9OpeningWordSource = "opening_word.js:v9-measured";
  lineEl.dataset.v9OpeningWordPosition = position;
  lineEl.dataset.v9OpeningWordWidthPx = String(Math.round(Number(model.metrics?.openingWordWidthPx) || 0));
  lineEl.dataset.v9OpeningWordReservePx = String(Math.round(Number(model.metrics?.reserveWidthPx) || 0));
  scheduleOpeningWindowIndent(lineEl, model);
  return true;
}
