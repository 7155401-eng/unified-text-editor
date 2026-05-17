// first_note_title_cache_guard.js
// שומר את כותרות הזרמים שנגזרות מ"הערה ראשונה ככותרת" גם כאשר
// engine_bridge מחזיר תוכן מה-cache ולא מריץ מחדש את applyFirstNoteAsTitle.
//
// התיקון אינו משנה את מנגנון הייבוא ואינו משנה את נתוני הזרם. הוא רק מוודא
// ש-window.__STREAM_LABELS__[code] לא יידרס לברירת מחדל כאשר firstNoteAsTitle
// פעיל ואין כותרת ידנית.

const GUARD_FLAG = "__RAVTEXT_FIRST_NOTE_TITLE_LABEL_GUARD__";
const PROXY_FLAG = "__ravtextFirstNoteTitleLabelsProxy";

function stripDisplayNum(value) {
  return String(value || "").trim().replace(/^\[\d+\]\s*/, "");
}

function firstNoteTitleForStream(code) {
  if (typeof window === "undefined") return "";
  const settings = window.__STREAM_SETTINGS__?.[code] || {};
  if (!settings.firstNoteAsTitle) return "";
  if (String(settings.title || "").trim()) return "";

  const pane = window.paneManager?.panes?.find?.((p) => String(p.streamCode || "") === String(code));
  if (!pane?.editor) return "";

  const sym = pane.symbol || `@${code}`;
  const text = pane.editor.state?.doc?.textContent || pane.editor.getText?.() || "";
  if (!text) return "";

  let first = text;
  if (sym && text.includes(sym)) {
    const parts = text.split(sym);
    first = parts.length > 1 ? parts[1] : text;
  }

  return stripDisplayNum(first);
}

function proxyLabelsObject(labels) {
  if (!labels || typeof labels !== "object") labels = {};
  if (labels[PROXY_FLAG]) return labels;

  const proxy = new Proxy(labels, {
    set(target, prop, value) {
      const code = String(prop);
      const title = /^\d{1,3}$/.test(code) ? firstNoteTitleForStream(code) : "";
      target[prop] = title || value;
      return true;
    },
  });

  try {
    Object.defineProperty(proxy, PROXY_FLAG, {
      value: true,
      enumerable: false,
      configurable: false,
    });
  } catch (_) {}

  return proxy;
}

function installFirstNoteTitleLabelGuard() {
  if (typeof window === "undefined") return;
  if (window[GUARD_FLAG]) return;
  window[GUARD_FLAG] = true;

  let currentLabels = proxyLabelsObject(window.__STREAM_LABELS__ || {});

  try {
    Object.defineProperty(window, "__STREAM_LABELS__", {
      configurable: true,
      get() {
        return currentLabels;
      },
      set(value) {
        currentLabels = proxyLabelsObject(value || {});
      },
    });
  } catch (_) {
    // אם דפדפן/כלי בדיקה לא מאפשר defineProperty, לפחות נחליף את האובייקט
    // הנוכחי לפרוקסי. זה מספיק למסלול הרגיל של האפליקציה.
    window.__STREAM_LABELS__ = currentLabels;
  }

  // הפעלה מיידית כדי שגם labels שכבר קיימים יקבלו תיקון אם צריך.
  try {
    for (const p of window.paneManager?.panes || []) {
      if (!p?.streamCode) continue;
      const code = String(p.streamCode);
      const title = firstNoteTitleForStream(code);
      if (title) currentLabels[code] = title;
    }
  } catch (_) {}
}

installFirstNoteTitleLabelGuard();
