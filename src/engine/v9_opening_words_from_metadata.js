import { getOpeningWordSettings } from "../opening_word.js";

function fontFamily(font) {
  if (font === "David") return '"David", "David Libre", "Frank Ruhl Libre", serif';
  if (font === "David Libre") return '"David Libre", "David", "Frank Ruhl Libre", serif';
  if (font === "Frank Ruhl Libre") return '"Frank Ruhl Libre", "David Libre", "David", serif';
  return font || "inherit";
}

function splitFirstWords(text, count) {
  const s = String(text || "");
  const m = s.match(/^(\s*)(\S+(?:\s+\S+){0,11})([\s\S]*)$/);
  if (!m) return null;
  const words = m[2].split(/\s+/).filter(Boolean);
  const take = Math.max(1, Math.min(Number(count) || 1, words.length));
  const segment = words.slice(0, take).join(" ");
  const suffixStart = m[1].length + m[2].indexOf(segment) + segment.length;
  return { prefix: m[1], segment, suffix: s.slice(suffixStart) };
}

function wrapLine(line, settings) {
  if (!line || line.dataset.opwApplied === "1") return false;
  const text = line.textContent || "";
  const parts = splitFirstWords(text, settings?.target === "words" ? settings.count : 1);
  if (!parts || !parts.segment.trim() || !parts.suffix.trim()) return false;

  line.textContent = "";
  if (parts.prefix) line.appendChild(document.createTextNode(parts.prefix));
  const span = document.createElement("span");
  span.className = "opw-segment opw-raised";
  span.style.fontFamily = fontFamily(settings?.font || "David");
  span.style.fontSize = `${Math.max(80, Math.min(500, Number(settings?.size) || 200))}%`;
  span.style.fontWeight = settings?.weight === "normal" ? "400" : settings?.weight === "heavy" ? "900" : "700";
  span.style.marginLeft = `${Math.max(0, Math.min(4, Number(settings?.spaceAfter) || 0.3))}em`;
  span.textContent = parts.segment;
  line.appendChild(span);
  line.appendChild(document.createTextNode(parts.suffix));
  line.classList.add("opw-host");
  line.dataset.opwApplied = "1";
  line.dataset.v9OpeningWordFromMetadata = "1";
  return true;
}

export function applyV9OpeningWordsFromMetadata(container) {
  const settings = getOpeningWordSettings();
  if (!settings?.enabled) return { applied: 0, reason: "disabled" };
  const lines = Array.from(container.querySelectorAll('.v9-page .v9-line[data-v9-source-stream="main"][data-v9-paragraph-start="1"]'));
  let applied = 0;
  for (const line of lines) if (wrapLine(line, settings)) applied++;
  const result = { applied, eligible: lines.length };
  container.dataset.v9OpeningWords = JSON.stringify(result);
  if (typeof window !== "undefined") window.__ravtextLastV9OpeningWords = result;
  return result;
}
