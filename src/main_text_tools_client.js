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


const COMPACT_STREAM_MENU_POPOVER_ID = "nested-notes-stream-menu-popover";
const COMPACT_SYNC_BUTTON_LABEL = "גלילה";

function updateCompactStreamMenuSyncButton() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const popover = document.getElementById(COMPACT_STREAM_MENU_POPOVER_ID);
  if (!popover) return;

  const enabled = !!window.paneManager?.syncEnabled;
  const buttons = Array.from(popover.querySelectorAll("button"));
  buttons.forEach((button) => {
    if ((button.textContent || "").trim() !== COMPACT_SYNC_BUTTON_LABEL) return;
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");

    if (enabled) {
      button.style.borderColor = "var(--rt-accent,#2c5aa0)";
      button.style.background = "var(--rt-accent,#2c5aa0)";
      button.style.color = "#fff";
    } else {
      button.style.borderColor = "rgba(0,0,0,.12)";
      button.style.background = "rgba(0,0,0,.035)";
      button.style.color = "inherit";
    }
  });
}

function installCompactStreamMenuSyncButtonState() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const refresh = () => setTimeout(updateCompactStreamMenuSyncButton, 0);

  document.addEventListener("click", (event) => {
    const target = event.target?.closest?.("button");
    if (!target) return;
    const inCompactMenu = target.closest?.(`#${COMPACT_STREAM_MENU_POPOVER_ID}`);
    const isCompactMenuOpener = target.id === "nested-notes-open-stream-menu-btn";
    if (!inCompactMenu && !isCompactMenuOpener) return;
    refresh();
    setTimeout(updateCompactStreamMenuSyncButton, 140);
  }, true);

  const startObserver = () => {
    if (!document.body) return;
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
  };

  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  [100, 500, 1500, 3000].forEach((ms) => setTimeout(updateCompactStreamMenuSyncButton, ms));
}

installCompactStreamMenuSyncButtonState();
