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
const TIDIO_PEIMOT_PUBLIC_KEY_STORAGE = "ravtext.tidio.publicKey";
const TIDIO_PEIMOT_SCRIPT_FLAG = "data-ravtext-tidio-peimot";

function readPeimotTidioPublicKey() {
  const candidates = [];

  try {
    candidates.push(window.__RAVTEXT_TIDIO_PUBLIC_KEY__);
  } catch (_) {
    /* noop */
  }

  try {
    candidates.push(import.meta.env?.VITE_TIDIO_PUBLIC_KEY);
  } catch (_) {
    /* noop */
  }

  try {
    candidates.push(localStorage.getItem(TIDIO_PEIMOT_PUBLIC_KEY_STORAGE));
  } catch (_) {
    /* noop */
  }

  for (const value of candidates) {
    const key = String(value || "").trim();
    if (key && /^[a-z0-9]+$/i.test(key)) return key;
  }

  return "";
}

export function installPeimotTidioWidget() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__ravtextPeimotTidioLoaded) return;

  const publicKey = readPeimotTidioPublicKey();
  if (!publicKey) return;

  const appendScript = () => {
    if (window.__ravtextPeimotTidioLoaded) return;
    if (document.querySelector(`script[${TIDIO_PEIMOT_SCRIPT_FLAG}]`)) return;

    const script = document.createElement("script");
    script.src = `https://code.tidio.co/${publicKey}.js`;
    script.async = true;
    script.setAttribute(TIDIO_PEIMOT_SCRIPT_FLAG, "1");
    script.setAttribute("data-widget-purpose", "peimot-phone-capture");

    window.__openPeimotTidioPhoneCapture = () => {
      try {
        window.tidioChatApi?.open?.();
      } catch (_) {
        /* noop */
      }
    };

    document.body.appendChild(script);
    window.__ravtextPeimotTidioLoaded = true;
  };

  if (document.body) appendScript();
  else document.addEventListener("DOMContentLoaded", appendScript, { once: true });
}

installPeimotTidioWidget();
