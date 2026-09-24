const ENDPOINT = "/api/main-text-tools";
const SYNC_SCROLL_KEY = "ravtext.syncScrollEnabled";

// ★ נמצא בבדיקה, 24/09/2026: כשהשרת לא ענה, המשתמש קיבל על המסך את השורה
// "Main text tool failed: HTTP 404" — באנגלית, עם קוד שגיאה, בלי לומר מה קרה
// ובלי לומר מה לעשות עכשיו. כל הכלים של הטקסט הראשי (פיצול סימנים, איחוד
// חזרה, הוספת הערה לזרם) עוברים דרך הפונקציה הזאת, ולכן ההודעה מתוקנת כאן —
// במקום אחד — וכל הכלים מרוויחים.
// הפרטים הטכניים לא אובדים: הם נשמרים על השגיאה עצמה ונרשמים ליומן המפתחים.
function humanServerMessage(status) {
  if (status === 0) {
    return "אין כרגע חיבור לשרת של רב טקסט. הפעולה לא בוצעה ושום דבר לא השתנה — בדוק את החיבור לאינטרנט ונסה שוב.";
  }
  if (status === 401 || status === 403) {
    return "צריך להתחבר מחדש כדי לבצע את הפעולה הזו. התחבר ונסה שוב — מה שכתבת נשאר.";
  }
  if (status === 404) {
    return "הכלי הזה אינו זמין כרגע בשרת. הפעולה לא בוצעה ושום דבר לא השתנה — נסה שוב בעוד רגע.";
  }
  if (status === 413) {
    return "הטקסט גדול מדי לפעולה הזו. הפעולה לא בוצעה ושום דבר לא השתנה — נסה לחלק אותו לחלקים קטנים יותר ולבצע שוב.";
  }
  if (status === 429) {
    return "נשלחו יותר מדי בקשות ברצף. הפעולה לא בוצעה ושום דבר לא השתנה — חכה כמה שניות ונסה שוב.";
  }
  if (status >= 500) {
    return "השרת נתקל בתקלה זמנית. הפעולה לא בוצעה ושום דבר לא השתנה — נסה שוב בעוד רגע.";
  }
  return "הפעולה לא הושלמה. שום דבר לא השתנה — נסה שוב.";
}

function serverError(status, detail) {
  const err = new Error(humanServerMessage(status));
  err.name = "RavTextServerError";
  err.status = status;
  err.technical = detail || `main-text-tools HTTP ${status}`;
  if (typeof console !== "undefined") {
    console.warn("[main-text-tools]", err.technical);
  }
  return err;
}

async function postMainTextTool(action, payload) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (networkErr) {
    throw serverError(0, `${action}: ${networkErr?.message || networkErr}`);
  }
  if (!res.ok) throw serverError(res.status, `${action}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (parseErr) {
    // תשובה שאינה JSON — למשל דף שגיאה של שרת ביניים.
    throw serverError(502, `${action}: bad JSON (${parseErr?.message || parseErr})`);
  }
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

// משה 06/09/2026 (הערות 10 ו-11): הוספת הערת שוליים לזרם מחושבת בשרת.
// כאן נשארת רק השליחה — מה שרץ בדפדפן לא יודע איך ההערה משובצת ואיך
// המספור מסתדר, ולכן אי אפשר להעתיק את השיטה מתוך הדפדפן.
export function addNoteToStreamOnServer({ mainText, streamText, code, noteText, caretIndex }) {
  return postMainTextTool("add_note_to_stream", {
    mainText,
    streamText,
    code,
    noteText,
    caretIndex,
  });
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
