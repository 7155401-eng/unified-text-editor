import { extractOpeningSegmentForTest, getOpeningWordSettings } from "../opening_word.js";

function fontFamily(font) {
  if (font === "David") return '"David", "David Libre", "Frank Ruhl Libre", serif';
  if (font === "David Libre") return '"David Libre", "David", "Frank Ruhl Libre", serif';
  if (font === "Frank Ruhl Libre") return '"Frank Ruhl Libre", "David Libre", "David", serif';
  if (font === "Segoe UI") return '"Segoe UI", "David", "David Libre", sans-serif';
  return font || "inherit";
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function wrapLine(line, settings) {
  if (!line || line.dataset.opwApplied === "1") return false;
  const text = line.textContent || "";
  const parts = extractOpeningSegmentForTest(text, settings || {});
  if (!parts || !parts.segment?.trim() || !parts.suffix?.trim()) return false;

  // Temporary V9-safe rendering: extraction is shared with opening_word.js, but
  // the visual form stays raised until V9 measures dropped initials inside buildPages.
  // This prevents the old page-start bug and avoids moving absolute V9 lines post-render.
  const position = "raised";
  line.textContent = "";
  if (parts.prefix) line.appendChild(document.createTextNode(parts.prefix));
  const span = document.createElement("span");
  span.className = `opw-segment opw-${position}`;
  span.style.fontFamily = fontFamily(settings?.font || "David");
  span.style.fontSize = `${clampNumber(settings?.size, 200, 80, 500)}%`;
  span.style.fontWeight = settings?.weight === "normal" ? "400" : settings?.weight === "heavy" ? "900" : "700";
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
  const lines = Array.from(container.querySelectorAll('.v9-page .v9-line[data-v9-source-stream="main"][data-v9-paragraph-start="1"]'));
  let applied = 0;
  for (const line of lines) if (wrapLine(line, settings)) applied++;
  const result = { applied, eligible: lines.length, extractor: "opening_word.js", position: "raised-until-measured" };
  container.dataset.v9OpeningWords = JSON.stringify(result);
  if (typeof window !== "undefined") window.__ravtextLastV9OpeningWords = result;
  return result;
}
