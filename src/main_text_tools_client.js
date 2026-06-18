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


function syncAllScrollToggleButtons(enabled) {
  if (typeof document === "undefined") return;
  const on = !!enabled;
  const buttons = document.querySelectorAll('#sync-btn, [data-cmd="sync-toggle"]');
  buttons.forEach((button) => {
    if (!button || button.tagName !== "BUTTON") return;
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function installSyncScrollButtonStateMirror() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.__ravtextSyncAllScrollToggleButtons = syncAllScrollToggleButtons;

  const readState = () => !!window.paneManager?.syncEnabled;
  const refresh = () => syncAllScrollToggleButtons(readState());

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.('#sync-btn, [data-cmd="sync-toggle"]');
    if (!button) return;
    setTimeout(refresh, 0);
  }, true);

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
}

installSyncScrollButtonStateMirror();
