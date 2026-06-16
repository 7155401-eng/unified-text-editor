// ברירת־מחדל בטוחה לאורחים ולחשבונות חינמיים.
//
// המטרה: אם נשמר/נטען בטעות מצב ריק או ראשוני בלבד, לא לתת לו לחסום את
// טעינת טקסט ברירת־המחדל. אם המשתמש כבר הכניס טקסט אמיתי — לא נוגעים.
//
// תיקון חי: מטפל גם במצב שבו קיימת חלונית אחת ריקה, ולא רק במצב שאין חלוניות.
// זה המצב שנראה באתר החי: העורך קיים, אבל הסטטיסטיקה נשארת 0 מילים.

const PANE_STATE_STORAGE_KEY = "ravtext.panes.state.v1";
const GUARD_VERSION = "live-pristine-pane-2026-06-16";

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

  // אם בעתיד יישמר סימון עריכה אמיתי — לא נתייחס לזה כמצב ראשוני.
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

function livePaneManagerState(paneManager) {
  if (!paneManager || typeof paneManager.serialize !== "function") return null;
  try {
    return paneManager.serialize();
  } catch (_) {
    return null;
  }
}

function shouldRecoverLivePaneManager(paneManager) {
  if (!paneManager || typeof paneManager.count !== "function") return false;

  // אין חלוניות בכלל — חייבים להחזיר עורך.
  if (paneManager.count() === 0) return true;

  // יש חלונית, אבל היא ריקה/ראשונית בלבד — זה היה החור בתיקון הקודם.
  const state = livePaneManagerState(paneManager);
  return isPristinePaneState(state);
}

function schedulePristineEditorRecovery(loadDefault) {
  if (typeof loadDefault !== "function") return;

  const run = () => {
    if (!shouldApplyDefaultStarterFallback()) return;

    const paneManager = window.paneManager;
    if (!shouldRecoverLivePaneManager(paneManager)) return;

    if (window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__) return;
    window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__ = true;

    Promise.resolve(loadDefault(paneManager))
      .then(() => {
        try {
          window.__RAVTEXT_DEFAULT_TEXT_GUARD_RESTORED__ = true;
          document.dispatchEvent(new CustomEvent("ravtext:default-text-restored", {
            detail: { version: GUARD_VERSION },
          }));
          if (typeof window.__ravtextRerender === "function") {
            setTimeout(() => window.__ravtextRerender(), 120);
          }
        } catch (_) {}
      })
      .catch((err) => {
        console.warn("[default-text-guard] failed to restore default pane:", err);
      })
      .finally(() => {
        window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__ = false;
      });
  };

  // בדיקות סביב האתחול, אחרי טעינת שרת, וגם אחרי setupDemoMode.
  setTimeout(run, 0);
  setTimeout(run, 120);
  setTimeout(run, 350);
  setTimeout(run, 900);
  setTimeout(run, 1800);
  setTimeout(run, 3500);
  setTimeout(run, 6500);
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
        setTimeout(onSkippedPristineDocument, 1500);
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
  if (typeof window !== "undefined") {
    window.__RAVTEXT_DEFAULT_TEXT_GUARD_VERSION__ = GUARD_VERSION;
  }

  clearPristineStoredPaneState();

  const recover = () => schedulePristineEditorRecovery(loadDefault);

  installPristineServerDocumentGuard({
    onSkippedPristineDocument: recover,
  });

  schedulePristineEditorRecovery(loadDefault);
}
