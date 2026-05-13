const STORAGE_KEY = "ravtext.openingWord.v1";

const DEFAULTS = {
  enabled: false,
  target: "word",
  count: 1,
  style: "",
  font: "David",
  size: 200,
  weight: "bold",
  position: "dropped",
  dropLines: 2,
  spaceAfter: 0.3,
  scope: "all",
  skipHeadings: true,
  headingMin: 80,
};

const STREAM_DEFAULTS = {
  opwEnabled: false,
  opwTarget: "word",
  opwCount: 1,
  opwStyle: "",
  opwFont: "David",
  opwSize: 135,
  opwWeight: "bold",
  opwPosition: "dropped",
  opwDropLines: 1,
  opwSpaceAfter: 0.3,
  opwSkipOrphan: false,
  opwCenterFull: false,
};

const STREAM_OPW_OVERRIDE_KEYS = [
  "opwEnabled", "opwTarget", "opwCount", "opwStyle", "opwSize", "opwFont",
  "opwWeight", "opwPosition", "opwDropLines", "opwSpaceAfter",
  "opwSkipOrphan", "opwCenterFull",
];

function applyOpeningWordGlobalOverrides(raw = {}) {
  let overrides = {};
  try {
    overrides = JSON.parse(localStorage.getItem("ravtext.globalStreamOverrides.v1") || "{}") || {};
  } catch (_err) {
    overrides = {};
  }
  const out = { ...raw };
  for (const key of STREAM_OPW_OVERRIDE_KEYS) {
    if (overrides[key]?.enabled) out[key] = overrides[key].value;
  }
  return out;
}

const FONT_STACKS = {
  inherit: "inherit",
  David: '"David", "David Libre", "Frank Ruhl Libre", serif',
  "David Libre": '"David Libre", "David", "Frank Ruhl Libre", serif',
  "Frank Ruhl Libre": '"Frank Ruhl Libre", "David Libre", "David", serif',
  "Segoe UI": '"Segoe UI", "David", "David Libre", sans-serif',
};

const STYLE_COMMANDS = new Set(["textbf", "ravtextbf", "textit", "emph", "underline"]);
const MIN_OPENING_SUFFIX_CHARS = 18;
const MIN_OPENING_SUFFIX_WORDS = 2;
const COMBINING_MARK_RE = /[\u0591-\u05C7\u0300-\u036f]/;
let graphemeSegmenter = null;

const SKIP_LEADING_COMMANDS = new Set([
  "footnoteA", "footnoteB", "footnoteC", "footnoteD", "footnoteE", "footnoteF",
  "leavevmode", "noindent", "null", "nolinebreak", "linebreak",
  "ledsidenote", "ledrightnote", "ledleftnote", "ledinnernote", "ledouternote",
  "ledsetnormalparstuff",
]);

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeTarget(value, fallback = DEFAULTS.target) {
  if (["letter", "אות", "Letter"].includes(value)) return "letter";
  if (["words", "מילים", "NWords"].includes(value)) return "words";
  if (["word", "מילה", "Word"].includes(value)) return "word";
  return fallback;
}

function normalizeWeight(value, fallback = DEFAULTS.weight) {
  if (["normal", "רגיל", "Normal"].includes(value)) return "normal";
  if (["heavy", "כבד", "Heavy"].includes(value)) return "heavy";
  if (["bold", "מודגש", "Bold"].includes(value)) return "bold";
  return fallback;
}

function normalizePosition(value, fallback = DEFAULTS.position) {
  if (["dropped", "נפתחת", "Dropped"].includes(value)) return "dropped";
  if (["raised", "מוגבהת", "Raised"].includes(value)) return "raised";
  return fallback;
}

function normalizeScope(value) {
  if (["first", "פסקה ראשונה", "FirstParagraph"].includes(value)) return "first";
  return "all";
}

function normalizeSettings(raw = {}) {
  return {
    enabled: !!raw.enabled,
    target: normalizeTarget(raw.target),
    count: clampNumber(raw.count, DEFAULTS.count, 1, 12),
    style: raw.style || DEFAULTS.style,
    font: raw.font || DEFAULTS.font,
    size: clampNumber(raw.size, DEFAULTS.size, 80, 500),
    weight: normalizeWeight(raw.weight),
    position: normalizePosition(raw.position),
    dropLines: clampNumber(raw.dropLines, DEFAULTS.dropLines, 1, 8),
    spaceAfter: clampNumber(raw.spaceAfter, DEFAULTS.spaceAfter, 0, 4),
    scope: normalizeScope(raw.scope),
    skipHeadings: raw.skipHeadings !== false,
    headingMin: clampNumber(raw.headingMin, DEFAULTS.headingMin, 0, 500),
  };
}

export function normalizeStreamOpeningWordSettings(raw = {}) {
  return {
    ...raw,
    opwEnabled: !!raw.opwEnabled,
    opwTarget: normalizeTarget(raw.opwTarget, STREAM_DEFAULTS.opwTarget),
    opwCount: clampNumber(raw.opwCount, STREAM_DEFAULTS.opwCount, 1, 12),
    opwStyle: raw.opwStyle || STREAM_DEFAULTS.opwStyle,
    opwFont: raw.opwFont || STREAM_DEFAULTS.opwFont,
    opwSize: clampNumber(raw.opwSize, STREAM_DEFAULTS.opwSize, 80, 500),
    opwWeight: normalizeWeight(raw.opwWeight, STREAM_DEFAULTS.opwWeight),
    opwPosition: normalizePosition(raw.opwPosition, STREAM_DEFAULTS.opwPosition),
    opwDropLines: clampNumber(raw.opwDropLines, STREAM_DEFAULTS.opwDropLines, 1, 8),
    opwSpaceAfter: clampNumber(raw.opwSpaceAfter, STREAM_DEFAULTS.opwSpaceAfter, 0, 4),
    opwSkipOrphan: !!raw.opwSkipOrphan,
    opwCenterFull: !!raw.opwCenterFull,
    mishnaWidth: clampNumber(raw.mishnaWidth, 0, 0, 95),
    mishnaSide: ["auto", "right", "left", "outer", "inner"].includes(raw.mishnaSide) ? raw.mishnaSide : "auto",
  };
}

function streamToOpeningSettings(raw = {}) {
  const normalized = normalizeStreamOpeningWordSettings(raw);
  return {
    enabled: normalized.opwEnabled,
    target: normalized.opwTarget,
    count: normalized.opwCount,
    style: normalized.opwStyle,
    font: normalized.opwFont,
    size: normalized.opwSize,
    weight: normalized.opwWeight,
    position: normalized.opwPosition,
    dropLines: normalized.opwDropLines,
    spaceAfter: normalized.opwSpaceAfter,
    scope: "all",
    skipHeadings: false,
    headingMin: 80,
    centerFull: normalized.opwCenterFull,
    skipOrphan: normalized.opwSkipOrphan,
  };
}

export function getOpeningWordSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch (_err) {
    return normalizeSettings();
  }
}

function saveOpeningWordSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}

function getValue(id) {
  return document.getElementById(id);
}

function setControlValue(control, value) {
  if (!control) return;
  if (control.type === "checkbox") {
    control.checked = !!value;
  } else {
    control.value = String(value);
  }
}

function readControlValue(control, fallback) {
  if (!control) return fallback;
  return control.type === "checkbox" ? control.checked : control.value;
}

export function wireOpeningWordControls(onChange) {
  const root = getValue("opening-word-controls");
  if (!root) return;

  const controls = {
    enabled: getValue("opw-enabled"),
    target: getValue("opw-target"),
    count: getValue("opw-count"),
    style: getValue("opw-style"),
    font: getValue("opw-font"),
    size: getValue("opw-size"),
    weight: getValue("opw-weight"),
    position: getValue("opw-position"),
    dropLines: getValue("opw-drop-lines"),
    spaceAfter: getValue("opw-space-after"),
    scope: getValue("opw-scope"),
    skipHeadings: getValue("opw-skip-headings"),
    headingMin: getValue("opw-heading-min"),
  };

  const initial = getOpeningWordSettings();
  setControlValue(controls.enabled, initial.enabled);
  setControlValue(controls.target, initial.target);
  setControlValue(controls.count, initial.count);
  setControlValue(controls.style, initial.style);
  setControlValue(controls.font, initial.font);
  setControlValue(controls.size, initial.size);
  setControlValue(controls.weight, initial.weight);
  setControlValue(controls.position, initial.position);
  setControlValue(controls.dropLines, initial.dropLines);
  setControlValue(controls.spaceAfter, initial.spaceAfter);
  setControlValue(controls.scope, initial.scope);
  setControlValue(controls.skipHeadings, initial.skipHeadings);
  setControlValue(controls.headingMin, initial.headingMin);

  const commit = () => {
    saveOpeningWordSettings({
      enabled: readControlValue(controls.enabled, initial.enabled),
      target: readControlValue(controls.target, initial.target),
      count: readControlValue(controls.count, initial.count),
      style: readControlValue(controls.style, initial.style),
      font: readControlValue(controls.font, initial.font),
      size: readControlValue(controls.size, initial.size),
      weight: readControlValue(controls.weight, initial.weight),
      position: readControlValue(controls.position, initial.position),
      dropLines: readControlValue(controls.dropLines, initial.dropLines),
      spaceAfter: readControlValue(controls.spaceAfter, initial.spaceAfter),
      scope: readControlValue(controls.scope, initial.scope),
      skipHeadings: readControlValue(controls.skipHeadings, initial.skipHeadings),
      headingMin: readControlValue(controls.headingMin, initial.headingMin),
    });
    onChange && onChange();
  };

  Object.values(controls).forEach((el) => {
    if (el) el.addEventListener("change", commit);
  });
}

function findBalancedClose(text, openPos) {
  let depth = 1;
  let pos = openPos + 1;
  while (pos < text.length && depth > 0) {
    if (text[pos] === "\\" && pos + 1 < text.length) {
      pos += 2;
      continue;
    }
    if (text[pos] === "{") depth += 1;
    else if (text[pos] === "}") depth -= 1;
    if (depth === 0) return pos;
    pos += 1;
  }
  return -1;
}

function advanceBracketArg(text, pos) {
  let cur = pos + 1;
  while (cur < text.length && text[cur] !== "]") cur += 1;
  return cur < text.length ? cur + 1 : text.length;
}

function advanceOverAtom(text, pos) {
  if (pos >= text.length) return pos;
  const ch = text[pos];
  if (ch === "\\") {
    let cur = pos + 1;
    if (cur < text.length && /[A-Za-z]/.test(text[cur])) {
      while (cur < text.length && /[A-Za-z]/.test(text[cur])) cur += 1;
      if (text[cur] === "*") cur += 1;
    } else {
      cur += 1;
    }
    while (cur < text.length && (text[cur] === "[" || text[cur] === "{")) {
      if (text[cur] === "[") {
        cur = advanceBracketArg(text, cur);
      } else {
        const close = findBalancedClose(text, cur);
        cur = close >= 0 ? close + 1 : text.length;
      }
    }
    return cur;
  }
  if (ch === "{") {
    const close = findBalancedClose(text, pos);
    return close >= 0 ? close + 1 : text.length;
  }
  return pos + 1;
}

function nextGraphemeEnd(text, pos) {
  if (
    typeof Intl !== "undefined" &&
    typeof Intl.Segmenter === "function"
  ) {
    graphemeSegmenter ||= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const next = graphemeSegmenter.segment(text.slice(pos))[Symbol.iterator]().next();
    if (!next.done && next.value?.segment) {
      return pos + next.value.segment.length;
    }
  }
  let end = pos + 1;
  while (end < text.length && COMBINING_MARK_RE.test(text[end])) end += 1;
  return end;
}

function isWordStopChar(ch) {
  return !ch || /\s/.test(ch) || ch === "\\" || ch === "{" || ch === "}";
}

function readWord(text, pos) {
  if (pos >= text.length) return pos;
  if (text[pos] === "\\" || text[pos] === "{") return advanceOverAtom(text, pos);
  while (pos < text.length) {
    const c = text[pos];
    if (isWordStopChar(c)) break;
    pos = nextGraphemeEnd(text, pos);
  }
  return pos;
}

function skipLeadingControls(text) {
  let pos = 0;
  while (true) {
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
    if (pos >= text.length || text[pos] !== "\\") break;
    let cur = pos + 1;
    while (cur < text.length && /[A-Za-z]/.test(text[cur])) cur += 1;
    const name = text.slice(pos + 1, cur);
    if (!SKIP_LEADING_COMMANDS.has(name)) break;
    if (text[cur] === "[") cur = advanceBracketArg(text, cur);
    if (text[cur] === "{") {
      const close = findBalancedClose(text, cur);
      cur = close >= 0 ? close + 1 : text.length;
    }
    pos = cur;
  }
  return pos;
}

function extractOpeningSegment(text, settings, options = {}) {
  const content = String(text || "");
  if (options.skipLeadingControls) {
    const prefixEnd = skipLeadingControls(content);
    const extracted = extractOpeningSegment(content.slice(prefixEnd), settings, {
      ...options,
      skipLeadingControls: false,
    });
    if (!extracted) return null;
    return {
      prefix: content.slice(0, prefixEnd) + extracted.prefix,
      segment: extracted.segment,
      suffix: extracted.suffix,
    };
  }

  let pos = 0;
  while (pos < content.length && /\s/.test(content[pos])) pos += 1;
  if (pos >= content.length) return null;
  const prefix = content.slice(0, pos);
  const start = pos;

  const styleMatch = content.slice(pos).match(/^\\([A-Za-z]+)\{/);
  if (styleMatch && STYLE_COMMANDS.has(styleMatch[1])) {
    const cmd = styleMatch[1];
    const innerStart = pos + styleMatch[0].length;
    const close = findBalancedClose(content, innerStart - 1);
    if (close >= 0) {
      const inner = content.slice(innerStart, close);
      const after = content.slice(close + 1);
      const innerExtracted = extractOpeningSegment(inner, settings, {
        ...options,
        skipLeadingControls: false,
      });
      if (innerExtracted) {
        const wrappedSegment = `\\${cmd}{${innerExtracted.segment}}`;
        const styledSuffix = innerExtracted.suffix.trim()
          ? `\\${cmd}{${innerExtracted.suffix}}${after}`
          : after;
        return {
          prefix: prefix + innerExtracted.prefix,
          segment: wrappedSegment,
          suffix: styledSuffix,
        };
      }
    }
  }

  if (settings.target === "letter") {
    const nChars = Math.max(1, settings.count);
    let cur = pos;
    while (cur < content.length) {
      if (content[cur] === "\\") {
        cur = advanceOverAtom(content, cur);
        continue;
      }
      if (content[cur] === "{") {
        cur += 1;
        continue;
      }
      break;
    }
    if (cur >= content.length) return null;
    const segStart = cur;
    let taken = 0;
    while (taken < nChars && cur < content.length) {
      if (content[cur] === "\\") {
        cur = advanceOverAtom(content, cur);
        continue;
      }
      if (content[cur] === "{" || content[cur] === "}") {
        cur += 1;
        continue;
      }
      if (/\s/.test(content[cur])) break;
      cur = nextGraphemeEnd(content, cur);
      taken += 1;
    }
    if (taken === 0) return null;
    while (cur < content.length && !isWordStopChar(content[cur])) {
      cur = nextGraphemeEnd(content, cur);
    }
    return {
      prefix: content.slice(0, segStart),
      segment: content.slice(segStart, cur),
      suffix: content.slice(cur),
    };
  }

  const nWords = settings.target === "words" ? Math.max(1, settings.count) : 1;
  let taken = 0;
  while (pos < content.length && taken < nWords) {
    const next = readWord(content, pos);
    if (next <= pos) break;
    pos = next;
    taken += 1;
    if (taken < nWords) {
      while (pos < content.length && /\s/.test(content[pos])) pos += 1;
    }
  }
  if (pos <= start) return null;
  return {
    prefix,
    segment: content.slice(start, pos),
    suffix: content.slice(pos),
  };
}

function plainLength(text) {
  return String(text || "")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .length;
}

function plainWordCount(text) {
  const plain = String(text || "")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? plain.split(/\s+/).length : 0;
}

function isOrphanText(text) {
  return plainLength(text) < 80;
}

function fontFamily(font) {
  return FONT_STACKS[font] || font || "inherit";
}

function applySpanStyle(span, settings, effectivePosition) {
  span.className = `opw-segment opw-${effectivePosition}`;
  span.style.fontFamily = fontFamily(settings.font);
  span.style.fontSize = `${settings.size}%`;
  span.style.fontWeight =
    settings.weight === "normal" ? "400" : settings.weight === "heavy" ? "900" : "700";
  span.style.marginLeft = effectivePosition === "raised" ? `${settings.spaceAfter}em` : "";
  span.style.setProperty("--opw-drop-lines", String(settings.dropLines));
  span.style.setProperty("--opw-space-after", `${settings.spaceAfter}em`);
}

function setWrappedText(el, parts, settings, options = {}) {
  const fullText = parts.prefix + parts.segment + parts.suffix;
  const len = plainLength(fullText);
  if (options.skipOrphan && isOrphanText(fullText)) return false;

  const shortFallback = (settings.skipHeadings && len < settings.headingMin) || options._forceRaised;
  const effectivePosition = settings.position === "dropped" && !shortFallback ? "dropped" : "raised";

  el.textContent = "";
  if (parts.prefix) el.appendChild(document.createTextNode(parts.prefix));
  const span = document.createElement("span");
  applySpanStyle(span, settings, effectivePosition);
  span.textContent = parts.segment;
  el.appendChild(span);
  if (parts.suffix) el.appendChild(document.createTextNode(parts.suffix));
  if (options.centerFull && effectivePosition === "raised") {
    el.classList.add("opw-center-full");
  }
  el.classList.add("opw-host");
  el.dataset.opwApplied = "1";
  return true;
}

function isHeadingElement(el) {
  return /^H[1-6]$/i.test(el.tagName || "");
}

function applyToTextElement(el, settings, options = {}) {
  if (!el || el.dataset.opwApplied === "1") return false;
  if (options.skipHeadingElements && isHeadingElement(el)) return false;
  const text = el.textContent || "";
  if (!text.trim()) return false;
  const prefixMatch = options.skipDisplayNumber ? text.match(/^\s*\[\d+\]\s*/) : null;
  const displayPrefix = prefixMatch ? prefixMatch[0] : "";
  const coreText = displayPrefix ? text.slice(displayPrefix.length) : text;
  const parts = extractOpeningSegment(coreText, settings, {
    skipLeadingControls: !!options.skipLeadingControls,
  });
  if (!parts) return false;
  // משה 2026-05-06: גם אם הסיומת קצרה מדי לחלון מדויק, להשאיר מילת פתיח
  // (במצב raised — בלי float-window). לא לבטל לגמרי.
  const tooShortSuffix =
    plainLength(parts.suffix) < MIN_OPENING_SUFFIX_CHARS ||
    plainWordCount(parts.suffix) < MIN_OPENING_SUFFIX_WORDS;
  if (tooShortSuffix) {
    options = { ...options, _forceRaised: true };
  }
  parts.prefix = displayPrefix + parts.prefix;
  return setWrappedText(el, parts, settings, options);
}

function applyMainOpeningWords(pageEl, settings) {
  // משה 2026-05-13: תמיכה ב-V9 - עמודי v9-page עם שורות v9-line
  if (pageEl.classList.contains('v9-page')) {
    // מצא את כל שורות הראשי (ללא stream-color)
    const mainLines = Array.from(pageEl.querySelectorAll('.v9-line:not([class*="stream-color"])'));
    if (mainLines.length === 0) return;
    
    // מילת פתיח רק על השורה הראשונה
    const firstLine = mainLines[0];
    const text = firstLine.textContent || '';
    const parts = extractOpeningSegment(text, settings, { skipLeadingControls: true });
    if (!parts) return;
    
    // בדיקת אורך הסיומת
    const tooShortSuffix =
      plainLength(parts.suffix) < MIN_OPENING_SUFFIX_CHARS ||
      plainWordCount(parts.suffix) < MIN_OPENING_SUFFIX_WORDS;
    const effectivePosition = tooShortSuffix ? 'raised' : settings.position;
    
    // החלפת תוכן השורה עם span מעוצב
    firstLine.innerHTML = '';
    if (parts.prefix) {
      const prefixSpan = document.createElement('span');
      prefixSpan.textContent = parts.prefix;
      firstLine.appendChild(prefixSpan);
    }
    const segmentSpan = document.createElement('span');
    applySpanStyle(segmentSpan, settings, effectivePosition);
    segmentSpan.textContent = parts.segment;
    firstLine.appendChild(segmentSpan);
    if (parts.suffix) {
      const suffixSpan = document.createElement('span');
      suffixSpan.textContent = parts.suffix;
      firstLine.appendChild(suffixSpan);
    }
    return;
  }
  
  // v33-engine fix: only consider DIRECT paragraphs of .page-main, not
  // nested ones (e.g. inside body-portion that we moved INTO mainEl).
  // Without this filter, opening-word lands on a body's first note instead
  // of the actual main paragraph (talmud mode opening-word bug).
  const allParas = Array.from(pageEl.querySelectorAll(".page-main p, .page-main h1, .page-main h2, .page-main h3, .page-main h4, .page-main h5, .page-main h6"));
  const paragraphs = allParas.filter(p => {
    // Exclude paragraphs nested inside a stream/body container.
    return !p.closest(".stream, .talmud-body-portion, .talmud-body-expanded, .talmud-crown-portion") ||
           p.closest(".page-main") === p.parentElement?.closest(".page-main");
  }).filter(p => {
    // Final stricter check: parent must be the .page-main itself, not a nested float.
    let cur = p.parentElement;
    while (cur && cur !== pageEl) {
      if (cur.classList?.contains("page-main")) return true;
      if (cur.classList?.contains("stream") ||
          cur.classList?.contains("talmud-body-portion") ||
          cur.classList?.contains("talmud-body-expanded") ||
          cur.classList?.contains("talmud-crown-portion")) return false;
      cur = cur.parentElement;
    }
    return true;
  });
  // v33: skip paragraphs that are continuations from a previous page
  // (renderer marks these with data-continued-from-prev="1"). Applying
  // opening-word to them causes visual displacement.
  const eligible = paragraphs.filter(p => p.dataset.continuedFromPrev !== "1");
  // Diagnostic console log for debugging.
  if (typeof console !== "undefined" && console.debug) {
    console.debug(`[opening_word] page${pageEl.dataset.pageIndex || "?"}: ${paragraphs.length} paragraphs, ${eligible.length} eligible after continuation-filter`);
  }
  if (settings.scope === "all") {
    for (const p of eligible) {
      applyToTextElement(p, settings, {
        skipHeadingElements: true,
        skipLeadingControls: true,
      });
    }
    return;
  }
  for (const p of eligible) {
    if (applyToTextElement(p, settings, {
      skipHeadingElements: true,
      skipLeadingControls: true,
    })) break;
  }
}

function applyStreamOpeningWords(pageEl, streamSettings) {
  pageEl.querySelectorAll(".stream[data-stream]").forEach((streamEl) => {
    // משה 2026-05-13: הסרת הדילוג על .talmud-layout כי V9 לא משתמש בזה
    const code = streamEl.getAttribute("data-stream");
    const raw = applyOpeningWordGlobalOverrides(streamSettings[code]);
    if (!raw || !raw.opwEnabled) return;
    const settings = streamToOpeningSettings(raw);
    const noteTargets = streamEl.querySelectorAll(".note-part, .note:not(.note-inline)");
    noteTargets.forEach((noteEl) => {
      if (noteEl.dataset.cont === "1") return;
      applyToTextElement(noteEl, settings, {
        skipDisplayNumber: true,
        skipOrphan: settings.skipOrphan,
        centerFull: settings.centerFull,
      });
    });
  });
}

export function applyOpeningWordsToPage(pageEl, mainSettings, streamSettings) {
  if (!pageEl || pageEl.classList.contains("page-placeholder")) return;

  const globalSettings = mainSettings || getOpeningWordSettings();
  const streams = streamSettings || (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};

  if (globalSettings.enabled) applyMainOpeningWords(pageEl, globalSettings);
  applyStreamOpeningWords(pageEl, streams);
}

export function applyOpeningWordsToPages(container) {
  const mainSettings = getOpeningWordSettings();
  const streamSettings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};
  const hasStreamOpening = Object.values(streamSettings)
    .some((settings) => applyOpeningWordGlobalOverrides(settings)?.opwEnabled);
  if (!mainSettings.enabled && !hasStreamOpening) return;

  container.querySelectorAll(".page:not(.page-placeholder)").forEach((page) => {
    applyOpeningWordsToPage(page, mainSettings, streamSettings);
  });

  const prevProcessor = container.__processRealizedPage;
  if (!prevProcessor || !prevProcessor.__openingWordWrapped) {
    const processor = function (page, idx) {
      if (typeof prevProcessor === "function") prevProcessor(page, idx);
      applyOpeningWordsToPage(page, mainSettings, streamSettings);
    };
    processor.__openingWordWrapped = true;
    container.__processRealizedPage = processor;
  }

  const baseRealize = container.__realizePage;
  if (typeof baseRealize !== "function" || baseRealize.__openingWordWrapped) return;

  const wrapped = function (idx) {
    baseRealize(idx);
    const page = typeof container.__getPageElement === "function"
      ? container.__getPageElement(idx)
      : container.querySelector(`.page[data-page-index="${idx}"]`);
    if (page) applyOpeningWordsToPage(page, mainSettings, streamSettings);
  };
  wrapped.__openingWordWrapped = true;
  container.__realizePage = wrapped;
}

export function extractOpeningSegmentForTest(text, rawSettings = {}) {
  return extractOpeningSegment(text, normalizeSettings(rawSettings));
}
