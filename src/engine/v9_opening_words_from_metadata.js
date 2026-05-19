import { extractOpeningSegmentForTest, getOpeningWordSettings } from "../opening_word.js";

function fontFamily(font) {
  if (font === "David") return '"David", "David Libre", "Frank Ruhl Libre", serif';
  if (font === "David Libre") return '"David Libre", "David", "Frank Ruhl Libre", serif';
  if (font === "Frank Ruhl Libre") return '"Frank Ruhl Libre", "David Libre", serif';
  if (font === "Segoe UI") return '"Segoe UI", "David", "David Libre", sans-serif';
  return font || "inherit";
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function numberOrZero(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function stylePx(el, prop) {
  if (!el || !el.style) return 0;
  return numberOrZero(el.style[prop] || el.style.getPropertyValue(prop) || "0");
}

function pageSortIndex(el) {
  const page = el?.closest?.(".page");
  return numberOrZero(page?.dataset?.pageIndex || page?.dataset?.page || 0);
}

function lineSortKey(el) {
  return pageSortIndex(el) * 100000 + stylePx(el, "top") * 100 + stylePx(el, "left");
}

function isMainLine(line) {
  const role = String(line?.dataset?.v9Role || "").toLowerCase();
  const boxId = String(line?.dataset?.v9BoxId || "").toLowerCase();
  return role.includes("main") || boxId === "main";
}

function sameParagraph(a, b) {
  if (!a || !b) return false;

  const aStream = a.dataset?.v9SourceStream || a.dataset?.v9BoxId || "";
  const bStream = b.dataset?.v9SourceStream || b.dataset?.v9BoxId || "";
  if (aStream && bStream && aStream !== bStream) return false;

  const aId = a.dataset?.v9ParagraphId || "";
  const bId = b.dataset?.v9ParagraphId || "";
  if (aId || bId) return !!aId && aId === bId;

  // Some V9 pages have no paragraph id on later fragments. In that case the
  // vertical opening-window limit is the fallback guard.
  return true;
}

function dropLineCount(opw) {
  const cssValue = opw?.style?.getPropertyValue("--opw-drop-lines");
  const value = numberOrZero(cssValue || opw?.dataset?.opwDropLines || 0);
  return Math.max(1, Math.round(value || 1));
}

function reserveWidthFor(host, opw) {
  const values = [
    host?.dataset?.v9OpeningWordReservePx,
    host?.dataset?.v9OpeningWordWidthPx,
    opw?.dataset?.opwReserveWidthPx,
    opw?.style?.getPropertyValue("--opw-reserve-width"),
  ];
  for (const value of values) {
    const n = numberOrZero(value);
    if (n > 0) return n;
  }
  return 0;
}

function isContinuationOpeningHost(line) {
  return (
    line?.dataset?.v9ParagraphStart === "0" ||
    line?.dataset?.v9Continuation === "1" ||
    line?.dataset?.v9ContinuedFromPrev === "1" ||
    line?.dataset?.continuedFromPrev === "1"
  );
}

function removeOpeningMarkup(line, reason) {
  if (!line?.querySelector?.(".opw-segment, .opw, .opening-word")) return false;
  const text = line.textContent || "";
  line.textContent = text;
  line.classList?.remove("opw-host");
  delete line.dataset.opwApplied;
  line.dataset.v9OpeningWordBlockedAfterMetadata = reason;
  return true;
}

function blockContinuationOpeningWords(container) {
  let blocked = 0;
  container.querySelectorAll(".v9-line.opw-host[data-opw-applied='1']").forEach((line) => {
    if (isContinuationOpeningHost(line) && removeOpeningMarkup(line, "continuation")) blocked += 1;
  });
  return blocked;
}

function applyDroppedOpeningWindowIndents(container) {
  const lines = Array.from(container.querySelectorAll(".v9-page .v9-line, .v9-line"))
    .filter(isMainLine)
    .sort((a, b) => lineSortKey(a) - lineSortKey(b));
  const indexByLine = new Map(lines.map((line, index) => [line, index]));
  let adjusted = 0;

  for (const host of lines) {
    if (host.dataset.v9OpeningWordPosition !== "dropped") continue;
    if (isContinuationOpeningHost(host)) continue;

    const opw = host.querySelector(".opw-dropped");
    if (!opw) continue;

    const reserve = reserveWidthFor(host, opw);
    const dropLines = dropLineCount(opw);
    const lineHeight = stylePx(host, "line-height") || stylePx(host, "lineHeight") || stylePx(host, "height");
    if (reserve <= 0 || dropLines <= 1 || lineHeight <= 0) continue;

    const hostPage = pageSortIndex(host);
    const hostTop = stylePx(host, "top");
    const windowBottom = hostTop + lineHeight * dropLines + 0.75;
    const startIndex = indexByLine.get(host);
    if (typeof startIndex !== "number") continue;

    let followers = 0;
    for (let i = startIndex + 1; i < lines.length && followers < dropLines - 1; i++) {
      const line = lines[i];
      if (pageSortIndex(line) !== hostPage) break;
      if (!sameParagraph(host, line)) break;

      const top = stylePx(line, "top");
      if (top <= hostTop + 0.5) continue;
      if (top >= windowBottom) break;

      const originalWidth =
        numberOrZero(line.dataset.v9PreOpeningWindowWidth) ||
        stylePx(line, "width") ||
        numberOrZero(line.getBoundingClientRect?.().width);
      if (originalWidth <= 0) continue;

      const nextWidth = Math.max(24, originalWidth - reserve);
      if (nextWidth >= originalWidth - 0.5) continue;

      if (!line.dataset.v9PreOpeningWindowWidth) {
        line.dataset.v9PreOpeningWindowWidth = String(Math.round(originalWidth * 100) / 100);
      }

      // V9 lines are position:absolute. For RTL, the opening window is on the
      // right side, so keeping left fixed and reducing width creates the needed
      // visual indent at the line's right edge.
      line.style.width = `${Math.round(nextWidth * 100) / 100}px`;
      line.dataset.v9OpeningWindowFollow = "1";
      line.dataset.v9OpeningWindowReservePx = String(Math.round(reserve));
      line.dataset.v9OpeningWindowHost = host.dataset.v9ParagraphId || host.textContent?.slice(0, 16) || "unknown";
      followers += 1;
      adjusted += 1;
    }

    host.dataset.v9OpeningWindowFollowers = String(followers);
  }

  return adjusted;
}

function wrapLine(line, settings) {
  if (!line || line.dataset.opwApplied === "1") return false;
  const text = line.textContent || "";
  const parts = extractOpeningSegmentForTest(text, settings || {});
  if (!parts || !parts.segment?.trim() || !parts.suffix?.trim()) return false;

  const position = "raised";
  line.textContent = "";
  if (parts.prefix) line.appendChild(document.createTextNode(parts.prefix));

  const span = document.createElement("span");
  span.className = `opw-segment opw-${position}`;
  span.style.fontFamily = fontFamily(settings?.font || "David");
  span.style.fontSize = `${clampNumber(settings?.size, 200, 80, 500)}%`;
  span.style.fontWeight =
    settings?.weight === "normal" ? "400" : settings?.weight === "heavy" ? "900" : "700";
  span.style.marginLeft = `${clampNumber(settings?.spaceAfter, 0.3, 0, 4)}em`;
  span.style.setProperty("--opw-drop-lines", String(clampNumber(settings?.dropLines, 2, 1, 8)));
  span.style.setProperty("--opw-space-after", `${clampNumber(settings?.spaceAfter, 0.3, 0, 4)}em`);
  span.textContent = parts.segment;

  line.appendChild(span);
  line.appendChild(document.createTextNode(parts.suffix));
  line.classList.add("opw-host");
  line.dataset.opwApplied = "1";
  line.dataset.v9OpeningWordFromMetadata = "1";
  line.dataset.v9OpeningWordExtractor = "opening_word.js";
  line.dataset.v9OpeningWordPosition = "raised-until-measured";
  return true;
}

export function applyV9OpeningWordsFromMetadata(container) {
  const settings = getOpeningWordSettings();
  if (!settings?.enabled) return { applied: 0, reason: "disabled" };

  const blocked = blockContinuationOpeningWords(container);
  const lines = Array.from(container.querySelectorAll('.v9-page .v9-line[data-v9-source-stream="main"][data-v9-paragraph-start="1"]'));
  let applied = 0;
  for (const line of lines) if (wrapLine(line, settings)) applied += 1;

  const windowAdjusted = applyDroppedOpeningWindowIndents(container);
  const result = {
    applied,
    eligible: lines.length,
    blockedContinuations: blocked,
    windowAdjusted,
    extractor: "opening_word.js",
    position: "raised-until-measured",
  };
  container.dataset.v9OpeningWords = JSON.stringify(result);
  if (typeof window !== "undefined") window.__ravtextLastV9OpeningWords = result;
  return result;
}
