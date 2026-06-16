// ברירת־מחדל בטוחה לאורחים ולחשבונות חינמיים.
//
// המטרה: אם נשמר בטעות מצב ריק/ראשוני בלבד, לא לתת לו לחסום את טעינת
// טקסט ברירת־המחדל. אם המשתמש כבר הכניס טקסט אמיתי — לא נוגעים.
//
// בנוסף: אם מסמך ריק מהשרת מחק את כל החלוניות, מחזירים חלונית ברירת־מחדל
// כדי שהאזור המרכזי לא יישאר לבן ולא־לחיץ.

const PANE_STATE_STORAGE_KEY = "ravtext.panes.state.v1";

function isPaidAccount() {
  try {
    const auth = window.__RAVTEXT_AUTH__;
    return !!(auth && auth.paid === true);
  } catch (_) {
    return false;
  }
}

function shouldApplyDefaultStarterFallback() {
  // אורח או חשבון מחובר-חינמי: כן. חשבון משלם: לא משנים התנהגות.
  return !isPaidAccount();
}

function normalizeText(text) {
  return String(text || "")
    .replace(/[“”״]/g, '"')
    .replace(/[׳’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromNode(node) {
  if (!node || typeof node !== "object") return "";
  let out = "";

  if (typeof node.text === "string") out += node.text;

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      out += extractTextFromNode(child);
    }
  }

  return out;
}

function isPristinePaneText(text) {
  const clean = normalizeText(text);
  if (!clean) return true;

  return (
    clean === 'תוכן ראשי. לחצו "טען דוגמה" או הקלידו.' ||
    clean === 'תוכן ראשי. לחצו "טען דוגמה" או הקלדו.' ||
    /^תוכן זרם \d{2}…?$/.test(clean)
  );
}

export function isPristinePaneState(state) {
  if (!state || typeof state !== "object") return true;

  // מהרגע שנשמר שינוי אמיתי אחרי התיקון — לא מתייחסים לזה כמצב ראשוני.
  if (state.userModified === true || state.manualEdit === true) return false;

  const panes = Array.isArray(state.panes) ? state.panes : [];
  if (panes.length === 0) return true;

  return panes.every((pane) => {
    const text = extractTextFromNode(pane?.content);
    return isPristinePaneText(text);
  });
}

function parseStoredPaneState(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function clearPristineStoredPaneState() {
  if (!shouldApplyDefaultStarterFallback()) return false;
  if (typeof localStorage === "undefined") return false;

  try {
    const raw = localStorage.getItem(PANE_STATE_STORAGE_KEY);
    const state = parseStoredPaneState(raw);
    if (!state || !isPristinePaneState(state)) return false;

    localStorage.removeItem(PANE_STATE_STORAGE_KEY);
    return true;
  } catch (err) {
    console.warn("[default-text-guard] failed to inspect local pane state:", err);
    return false;
  }
}

function getRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname + input.search;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

function getRequestMethod(input, init) {
  return String(init?.method || input?.method || "GET").toUpperCase();
}

function isCurrentDocumentRead(input, init) {
  if (getRequestMethod(input, init) !== "GET") return false;

  const url = getRequestUrl(input);
  if (!url) return false;

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname === "/api/documents/current";
  } catch (_) {
    return url === "/api/documents/current" || url.startsWith("/api/documents/current?");
  }
}

function scheduleEmptyEditorRecovery(loadDefault) {
  if (typeof loadDefault !== "function") return;

  const run = () => {
    if (!shouldApplyDefaultStarterFallback()) return;

    const paneManager = window.paneManager;
    if (!paneManager || typeof paneManager.count !== "function") return;

    // אם יש חלונית, גם אם היא ריקה — לא מחליפים אוטומטית.
    // זה מגן על מחיקה ידנית של המשתמש.
    if (paneManager.count() !== 0) return;

    Promise.resolve(loadDefault(paneManager)).catch((err) => {
      console.warn("[default-text-guard] failed to restore default pane:", err);
    });
  };

  // בדיקות קצרות סביב האתחול, וגם אחרי תשובת שרת שעלולה להגיע מאוחר.
  setTimeout(run, 0);
  setTimeout(run, 250);
  setTimeout(run, 900);
  setTimeout(run, 1800);
}

export function installPristineServerDocumentGuard({ onSkippedPristineDocument } = {}) {
  if (!shouldApplyDefaultStarterFallback()) return false;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return false;
  if (window.__RAVTEXT_DEFAULT_TEXT_GUARD_FETCH__) return false;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function guardedFetch(input, init) {
    const response = await originalFetch(input, init);

    if (!shouldApplyDefaultStarterFallback()) return response;
    if (!isCurrentDocumentRead(input, init)) return response;
    if (!response || !response.ok || typeof response.clone !== "function") return response;

    try {
      const clone = response.clone();
      const data = await clone.json();
      const content = data?.document?.content;

      if (!isPristinePaneState(content)) return response;

      if (typeof onSkippedPristineDocument === "function") {
        setTimeout(onSkippedPristineDocument, 0);
        setTimeout(onSkippedPristineDocument, 500);
      }

      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("x-ravtext-default-text-guard", "skipped-pristine-document");

      const cleaned = {
        ...data,
        document: data?.document ? { ...data.document, content: null } : data?.document,
        skippedPristineDocument: true,
      };

      return new Response(JSON.stringify(cleaned), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (err) {
      console.warn("[default-text-guard] failed to inspect server pane state:", err);
      return response;
    }
  };

  window.__RAVTEXT_DEFAULT_TEXT_GUARD_FETCH__ = true;
  return true;
}

export function installDefaultTextGuard({ loadDefault } = {}) {
  clearPristineStoredPaneState();

  const recover = () => scheduleEmptyEditorRecovery(loadDefault);

  installPristineServerDocumentGuard({
    onSkippedPristineDocument: recover,
  });

  scheduleEmptyEditorRecovery(loadDefault);
}
