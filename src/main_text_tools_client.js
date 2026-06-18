const ENDPOINT = "/api/main-text-tools";
const SYNC_SCROLL_KEY = "ravtext.syncScrollEnabled";

async function postMainTextTool(action, payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(`Main text tool failed: HTTP ${res.status}`);
  return res.json();
}

export function splitMarkersOnServer(rawText) {
  return postMainTextTool("split_markers", { rawText });
}

export function mergeBackOnServer(mainText, streams) {
  return postMainTextTool("merge_back", { mainText, streams });
}

export function inlineMergeOnServer(mainText, panes) {
  return postMainTextTool("inline_merge", { mainText, panes });
}

export function inlineSplitOnServer(mainText, panes) {
  return postMainTextTool("inline_split", { mainText, panes });
}

export async function loadSyncScrollEnabledFromServer() {
  try {
    const res = await fetch("/api/settings", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return false;
    const body = await res.json();
    return String(body?.settings?.[SYNC_SCROLL_KEY] || "") === "1";
  } catch (_) {
    return false;
  }
}

export async function saveSyncScrollEnabledToServer(enabled) {
  try {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SYNC_SCROLL_KEY]: enabled ? "1" : "0",
        },
      }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

const PEIMOT_TIDIO_SCRIPT_SRC = "//code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js";
const PEIMOT_TIDIO_SCRIPT_FLAG = "data-ravtext-peimot-tidio";

export function installPeimotTidioWidget() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__ravtextPeimotTidioLoaded) return;

  const appendScript = () => {
    if (window.__ravtextPeimotTidioLoaded) return;
    if (document.querySelector(`script[${PEIMOT_TIDIO_SCRIPT_FLAG}]`)) return;

    const script = document.createElement("script");
    script.src = PEIMOT_TIDIO_SCRIPT_SRC;
    script.async = true;
    script.setAttribute(PEIMOT_TIDIO_SCRIPT_FLAG, "1");
    script.setAttribute("data-widget-purpose", "peimot-phone-capture");

    document.body.appendChild(script);
    window.__ravtextPeimotTidioLoaded = true;
  };

  if (document.body) appendScript();
  else document.addEventListener("DOMContentLoaded", appendScript, { once: true });
}

installPeimotTidioWidget();


const SYNC_TOGGLE_SELECTOR = '#sync-btn, [data-cmd="sync-toggle"], [data-action="sync-toggle"], [data-sync-scroll-toggle], .sync-scroll-toggle, .streams-sync-toggle';

function isSyncScrollToggleButton(button) {
  if (!button || button.tagName !== "BUTTON") return false;
  if (button.matches?.(SYNC_TOGGLE_SELECTOR)) return true;
  const text = (button.textContent || "").replace(/\s+/g, " ").trim();
  const title = (button.getAttribute("title") || "").trim();
  const label = (button.getAttribute("aria-label") || "").trim();
  const probe = `${text} ${title} ${label}`;
  return /\bגלילה\b/.test(probe) || /sync\s*scroll/i.test(probe);
}

function getAllSyncScrollToggleButtons() {
  if (typeof document === "undefined") return [];
  const buttons = new Set(document.querySelectorAll(SYNC_TOGGLE_SELECTOR));
  document.querySelectorAll("button").forEach((button) => {
    if (isSyncScrollToggleButton(button)) buttons.add(button);
  });
  return Array.from(buttons).filter(isSyncScrollToggleButton);
}

function syncAllScrollToggleButtons(enabled) {
  if (typeof document === "undefined") return;
  const on = !!enabled;
  getAllSyncScrollToggleButtons().forEach((button) => {
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function installSyncEnabledPropertyMirror() {
  const manager = window.paneManager;
  if (!manager || manager.__ravtextSyncEnabledMirrorInstalled) return false;

  let current = !!manager.syncEnabled;
  try {
    Object.defineProperty(manager, "syncEnabled", {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(value) {
        current = !!value;
        syncAllScrollToggleButtons(current);
      },
    });
    manager.syncEnabled = current;
    manager.__ravtextSyncEnabledMirrorInstalled = true;
    return true;
  } catch (_) {
    return false;
  }
}

function installSyncScrollButtonStateMirror() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.__ravtextSyncAllScrollToggleButtons = syncAllScrollToggleButtons;

  const readState = () => !!window.paneManager?.syncEnabled;
  const refresh = () => {
    installSyncEnabledPropertyMirror();
    syncAllScrollToggleButtons(readState());
  };

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!isSyncScrollToggleButton(button)) return;
    setTimeout(refresh, 0);
    setTimeout(refresh, 50);
  }, true);

  window.addEventListener("ravtext:sync-scroll-changed", refresh);

  const observer = new MutationObserver(refresh);
  const startObserver = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
  };

  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  setTimeout(refresh, 100);
  setTimeout(refresh, 500);
  setTimeout(refresh, 1500);
  setTimeout(refresh, 3000);
}

installSyncScrollButtonStateMirror();
