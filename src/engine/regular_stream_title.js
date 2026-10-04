import { applyStyleToElement } from "../style_registry.js";
import {
  MAIN_STREAM_CODE,
  applyBarStyleToElement,
  getEffectiveStreamSettings,
  shouldShowStreamTitle,
} from "../original_stream_columns.js";

/**
 * Build the title row used by the regular renderer and by its measurement DOM.
 *
 * The main stream is intentionally different from commentary streams:
 * it has no implicit fallback label. An empty user title means no main title,
 * matching V9. Commentary streams may use their resolved display label.
 */
export function createRegularStreamTitle(streamCode, fallbackText = "", { main = false } = {}) {
  const code = main ? MAIN_STREAM_CODE : String(streamCode || "");
  if (!code || !shouldShowStreamTitle(code)) return null;

  const settings = getEffectiveStreamSettings(code);
  const explicit = String(settings.title || "").trim();
  const text = main ? explicit : (explicit || String(fallbackText || "").trim());
  if (!text) return null;

  const title = document.createElement("div");
  title.className = main ? "stream-title main-stream-title" : "stream-title";
  title.dataset.stream = code;
  title.textContent = text;
  applyStyleToElement(title, settings.titleStyleId);
  applyBarStyleToElement(title, settings);
  return title;
}

export function createRegularMainStreamTitle() {
  return createRegularStreamTitle(MAIN_STREAM_CODE, "", { main: true });
}
