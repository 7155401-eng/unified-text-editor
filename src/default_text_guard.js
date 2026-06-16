// Safe starter text fallback.
//
// This guard is intentionally small and idempotent:
// - no MutationObserver
// - no repeated recovery series after the first install
// - no large static sample imports here
// - never overwrites non-pristine user content

const PANE_STATE_STORAGE_KEY = "ravtext.panes.state.v1";
const GUARD_VERSION = "safe-static-starter-2026-06-16-1";

let recoveryScheduled = false;
let recoveryRun = null;
let recoveryRunQueued = false;
let recoveryAttempted = false;

function normalizeText(text) {
  return String(text || "")
    .replace(/[“”״]/g, '"')
    .replace(/[׳’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromNode(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";

  let out = "";
  if (typeof node.text === "string") out += node.text;
  if (typeof node.html === "string") out += node.html.replace(/<[^>]*>/g, " ");

  if (Array.isArray(node.content)) {
    for (const child of node.content) out += extractTextFromNode(child);
  }

  return out;
}

function isPristinePaneText(text) {
  const clean = normalizeText(text);
  if (!clean) return true;

  if (clean.includes("טען דוגמה")) return true;
  if (/^תוכן זרם \d{2}…?$/.test(clean)) return true;
  if (/^תוכן ראשי\.?\s/.test(clean) && clean.includes("טען דוגמה")) return true;

  return false;
}

export function isPristinePaneState(state) {
  if (!state || typeof state !== "object") return true;

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

  if (paneManager.count() === 0) return true;

  const state = livePaneManagerState(paneManager);
  return isPristinePaneState(state);
}

function markRestored(source) {
  try {
    window.__RAVTEXT_DEFAULT_TEXT_GUARD_RESTORED__ = true;
    window.__RAVTEXT_DEFAULT_TEXT_GUARD_RESTORED_SOURCE__ = source || "startup";
    document.dispatchEvent(new CustomEvent("ravtext:default-text-restored", {
      detail: { version: GUARD_VERSION, source },
    }));
  } catch (_) {}
}

function rerenderSoon() {
  try {
    if (typeof window.__ravtextRerender === "function") {
      setTimeout(() => window.__ravtextRerender(), 80);
      setTimeout(() => window.__ravtextRerender(), 350);
    }
  } catch (_) {}
}

function attemptRecovery(loadDefault, source = "startup") {
  if (recoveryAttempted || window.__RAVTEXT_DEFAULT_TEXT_GUARD_RESTORED__) return;

  const paneManager = window.paneManager;
  if (!shouldRecoverLivePaneManager(paneManager)) return;

  if (window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__) return;
  window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__ = true;
  recoveryAttempted = true;

  Promise.resolve(loadDefault(paneManager))
    .then(() => {
      markRestored(source);
      rerenderSoon();
    })
    .catch((err) => {
      console.warn("[default-text-guard] failed to restore default pane:", err);
      // Allow one later retry only when the first failure happened before the app was fully ready.
      setTimeout(() => {
        window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__ = false;
        if (!window.__RAVTEXT_DEFAULT_TEXT_GUARD_RESTORED__) {
          recoveryAttempted = false;
          const pm = window.paneManager;
          if (shouldRecoverLivePaneManager(pm)) attemptRecovery(loadDefault, "retry");
        }
      }, 1200);
    })
    .finally(() => {
      window.__RAVTEXT_DEFAULT_TEXT_GUARD_LOADING__ = false;
    });
}

function queueRecoveryRun() {
  if (typeof recoveryRun !== "function" || recoveryRunQueued) return;
  recoveryRunQueued = true;
  setTimeout(() => {
    recoveryRunQueued = false;
    recoveryRun();
  }, 0);
}

function schedulePristineEditorRecovery(loadDefault) {
  if (typeof loadDefault !== "function") return;

  if (recoveryScheduled) {
    queueRecoveryRun();
    return;
  }

  recoveryScheduled = true;
  recoveryRun = () => attemptRecovery(loadDefault, "startup");

  // A bounded boot window: no interval and no recursive timer series.
  [0, 120, 350, 900, 1800, 3500, 6500].forEach((ms) => {
    setTimeout(recoveryRun, ms);
  });

  document.addEventListener("ravtext:startup-check-default-text", recoveryRun);
}

export function installPristineServerDocumentGuard({ onSkippedPristineDocument } = {}) {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return false;
  if (window.__RAVTEXT_DEFAULT_TEXT_GUARD_FETCH__) return false;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function guardedFetch(input, init) {
    const response = await originalFetch(input, init);

    if (!isCurrentDocumentRead(input, init)) return response;
    if (!response || !response.ok || typeof response.clone !== "function") return response;

    try {
      const clone = response.clone();
      const data = await clone.json();
      const content = data?.document?.content;

      if (!isPristinePaneState(content)) return response;

      if (typeof onSkippedPristineDocument === "function") {
        setTimeout(onSkippedPristineDocument, 0);
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
