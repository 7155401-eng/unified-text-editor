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
      // Fallback below.
    }
  }

  return estimateTextWidthPx(sample, size);
}

function openingLineIsBlockedByParagraphMetadata(el) {
  if (!el || !el.dataset) return false;
  return el.dataset.v9Continuation === "1" ||
    el.dataset.v9ParagraphStart === "0" ||
    el.dataset.continuedFromPrev === "1" ||
    el.dataset.cont === "1" ||
    el.dataset.v9OpeningWordAllowed === "false";
}

function keepOpeningLineStable(el, lineHeightPx = 0) {
  if (!el) return;

  // The opening word may use a different font and size, but it must never
  // change the row pitch of the Talmud/V9 stream. The analytical layout already
  // placed every line by base line-height, so the DOM host is locked back to
  // that same row box after the opening word is inserted.
  el.style.marginTop = "0px";
  el.style.marginBottom = "0px";
  el.style.boxSizing = "border-box";
  el.style.overflow = "visible";

  if (lineHeightPx > 0) {
    const px = `${lineHeightPx}px`;
    el.style.lineHeight = px;
    el.style.height = px;
    el.style.minHeight = px;
    el.style.maxHeight = px;
  }

  el.dataset.v9OpeningWordLineStable = "1";
}

function renderOriginalLineWithoutOpeningWord(lineEl, model, firstLineText = "") {
  if (!lineEl || !model) return false;
  const parts = model.parts || {};
  const suffix = firstLineText || model.flow?.firstLineText || parts.suffix || "";
  lineEl.textContent = `${parts.prefix || ""}${parts.segment || ""}${suffix || ""}`;
  lineEl.classList?.remove("opw-host");
  delete lineEl.dataset.opwApplied;
  lineEl.dataset.v9OpeningWordBlocked = "paragraph-continuation";
  return false;
}

function getBaseLineHeightForOpeningSpan(span, model) {
  const style = model?.style || {};
  return Number(style.baseLineHeightPx) ||
    Number(model?.metrics?.baseLineHeightPx) ||
    Number.parseFloat(span?.parentElement?.style?.lineHeight || "0") ||
    0;
}

function getOpeningGlyphLineHeightPx(model, windowHeightPx, baseLineHeightPx) {
  const style = model?.style || {};
  const openingFontSizePx = Number(style.fontSizePx) || Number(model?.metrics?.openingFontSizePx) || 0;
  if (openingFontSizePx <= 0) return baseLineHeightPx;
  if (windowHeightPx > 0) {
    return Math.min(windowHeightPx, Math.max(openingFontSizePx, baseLineHeightPx));
  }
  return Math.max(openingFontSizePx, baseLineHeightPx);
}

function stabilizeRaisedSpan(span, model) {
  if (!span || !model || model.position === "dropped") return;
  const baseLineHeightPx = getBaseLineHeightForOpeningSpan(span, model);
  if (baseLineHeightPx <= 0) return;

  // Raised opening words stay inline, but their larger font must not enlarge the
  // parent row. Let the glyph overflow visually while the row keeps the stream
  // line-height.
  const px = `${baseLineHeightPx}px`;
  span.style.lineHeight = px;
  span.style.height = px;
  span.style.maxHeight = px;
  span.style.overflow = "visible";
  span.style.contain = "paint";
  span.dataset.opwInlineMetricsStable = "1";
}

function stabilizeDroppedSpan(span, model) {
  if (!span || !model || model.position !== "dropped") return;

  const style = model.style || {};
  const baseLineHeightPx = getBaseLineHeightForOpeningSpan(span, model);
  const dropLines = Math.max(1, Math.round(Number(style.dropLines) || Number(model.metrics?.dropLines) || 1));
  const windowHeightPx = baseLineHeightPx > 0 ? baseLineHeightPx * dropLines : 0;
  const glyphLineHeightPx = getOpeningGlyphLineHeightPx(model, windowHeightPx, baseLineHeightPx);
  const openingWidthPx = Math.ceil(Number(model.metrics?.openingWordWidthPx) || 0);
  const spaceAfter = `${style.spaceAfterEm ?? 0.3}em`;

  span.style.float = "right";
  span.style.display = "block";
  span.style.marginRight = "0";
  span.style.marginLeft = spaceAfter;
  span.style.marginBottom = "0";
  span.style.padding = "0";
  span.style.shapeMargin = spaceAfter;
  span.style.verticalAlign = "top";
  span.style.whiteSpace = "nowrap";
  span.style.overflow = "visible";
  span.style.boxSizing = "border-box";
  span.style.contain = "paint";

  if (openingWidthPx > 0) {
    span.style.width = `${openingWidthPx}px`;
  }

  if (baseLineHeightPx > 0) {
    span.style.setProperty("--opw-base-line-height", `${baseLineHeightPx}px`);
  }
  if (glyphLineHeightPx > 0) {
    span.style.lineHeight = `${glyphLineHeightPx}px`;
  }
  if (windowHeightPx > 0) {
    const px = `${windowHeightPx}px`;
    span.style.height = px;
    span.style.minHeight = px;
    span.style.maxHeight = px;
  }

  span.dataset.opwWindowStable = "1";
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
  const dropLines = Math.max(1, settings.dropLines);

  const style = {
    fontFamily: fontFamily(settings.font),
    fontSizePx,
    fontSizePercent: settings.size,
    fontWeight: normalizeWeight(settings.weight),
    dropLines,
    spaceAfterEm: settings.spaceAfter,
    baseLineHeightPx: baseLineHeight,
  };

  const openingWordWidthPx = measureOpeningTextWidthPx(parts.segment, effectiveOpeningFontSize, style);
  const spaceAfterPx = Math.max(0, effectiveOpeningFontSize * settings.spaceAfter * 0.5);
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
      baseLineHeightPx: baseLineHeight,
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
  if (openingLineIsBlockedByParagraphMetadata(lineEl)) {
    return renderOriginalLineWithoutOpeningWord(lineEl, model, firstLineText);
  }

  const stableLineHeightPx = Number.parseFloat(lineEl.style.lineHeight || "0") ||
    Number(model.metrics?.baseLineHeightPx) ||
    0;
  keepOpeningLineStable(lineEl, stableLineHeightPx);

  const { parts, style, position } = model;
  lineEl.textContent = "";

  if (parts.prefix) {
    lineEl.appendChild(document.createTextNode(parts.prefix));
  }

  const span = document.createElement("span");
  span.className = `opw-segment opw-${position}`;
  span.style.fontFamily = style.fontFamily;
  span.style.fontSize = `${style.fontSizePercent}%`;
  span.style.fontWeight = style.fontWeight;
  span.style.display = "inline-block";
  span.style.direction = "rtl";
  span.style.verticalAlign = position === "dropped" ? "top" : "baseline";
  span.style.marginLeft = `${style.spaceAfterEm}em`;
  span.style.setProperty("--opw-drop-lines", String(style.dropLines));
  span.style.setProperty("--opw-space-after", `${style.spaceAfterEm}em`);
  span.textContent = parts.segment;
  lineEl.appendChild(span);

  stabilizeDroppedSpan(span, model);
  stabilizeRaisedSpan(span, model);

  const suffix = firstLineText || model.flow?.firstLineText || parts.suffix || "";
  if (suffix) {
    lineEl.appendChild(document.createTextNode(suffix));
  }

  lineEl.classList.add("opw-host");
  keepOpeningLineStable(lineEl, stableLineHeightPx);
  lineEl.dataset.opwApplied = "1";
  lineEl.dataset.v9OpeningWordSource = "opening_word.js:v9-measured";
  lineEl.dataset.v9OpeningWordPosition = position;
  lineEl.dataset.v9OpeningWordWidthPx = String(Math.round(Number(model.metrics?.openingWordWidthPx) || 0));
  lineEl.dataset.v9OpeningWordReservePx = String(Math.round(Number(model.metrics?.reserveWidthPx) || 0));
  lineEl.dataset.v9OpeningWindowHandledBy = "v9-strip-geometry";

  // The old DOM post-processor shrank rendered lines after the page was built.
  // In RTL that can create a left-side visual indent or double-apply the window.
  // The correct V9 window is the analytic strip window produced before rendering:
  // only lines from the same source paragraph, on this same page, receive the
  // reduced width, and the opening-word host line itself remains full-width.
  return true;
}
