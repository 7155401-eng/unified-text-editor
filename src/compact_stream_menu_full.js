// Supplemental stream-menu actions: bulk delete/clear, short help, and stable inline buttons.
// The stream-menu controls are anchored only to the real nested-notes checkbox row:
// #nested-notes-toggle. No text scan and no floating fallback.

const STREAM_MENU_BUTTON_ID = "nested-notes-open-stream-menu-btn";
const SHORT_HELP_BUTTON_ID = "nested-notes-short-help-btn";
const STREAM_ACTIONS_WRAP_ID = "nested-notes-stream-menu-actions-wrap";
const STREAM_POPOVER_ID = "nested-notes-stream-menu-popover";
const BULK_ACTIONS_ID = "stream-menu-bulk-actions";
const STYLE_ID = "stream-menu-actions-style";
const NESTED_NOTES_TOGGLE_ID = "nested-notes-toggle";

const HELP_TEXT = [
  "איך מקשרים הערות לפנים — בקצרה:",
  "",
  "1. במקום שבו צריך הערה כותבים בטקסט הראשי סימן זרם, למשל @01.",
  "2. בחלון של זרם 01 כותבים את ההערות לפי הסדר.",
  "3. ה-@01 הראשון בטקסט הראשי מתחבר להערה הראשונה בזרם 01.",
  "4. ה-@01 השני מתחבר להערה השנייה, וכן הלאה.",
  "5. אם יש הערה בתוך הערה, כותבים בתוכה סימן אחר, למשל @02. גם הוא מתחבר לפי הסדר שבו הסימנים מופיעים במסמך.",
  "6. אחרי שינוי לוחצים רנדר כדי לראות את התוצאה בעמודים."
].join("\n");

let installed = false;

const $ = id => document.getElementById(id);

function paneManager() {
  return typeof window !== "undefined" ? window.paneManager : null;
}

function requestRender() {
  try { window.__ravtextApplyPaneWidths?.(); } catch (_) {}
  try { window.__ravtextRerender?.(); } catch (_) {}
}

function setStatus(text) {
  const el = $("stream-menu-status");
  if (el) el.textContent = text || "";
}

function allPanes(manager) {
  return Array.isArray(manager?.panes) ? manager.panes : [];
}

function streamPanes(manager) {
  return allPanes(manager).filter(pane => pane?.streamCode);
}

function deleteStreamPanes() {
  const manager = paneManager();
  const streams = streamPanes(manager);

  if (!manager || !allPanes(manager).length) {
    alert("לא נמצאו חלונות זרמים.");
    return false;
  }
  if (!streams.length) {
    alert("אין כרגע חלונות זרמים למחיקה.");
    return false;
  }
  if (!confirm("אתה בטוח? פעולה זו תמחק את כל חלונות הזרמים ותשאיר רק את הזרם הראשי.")) {
    return false;
  }

  for (const pane of streams.slice()) {
    try {
      if (typeof manager.removePane === "function") {
        manager.removePane(pane.id);
      } else {
        pane.element?.remove?.();
        manager.panes = manager.panes.filter(p => p !== pane);
      }
    } catch (err) {
      console.warn("[stream-menu-full] remove stream pane failed", err);
    }
  }

  try {
    manager.merged = false;
    manager._save?.({ immediate: true });
    manager._emit?.("change");
  } catch (_) {}

  requestRender();
  setStatus(`נמחקו ${streams.length} חלונות זרמים. הזרם הראשי נשאר.`);
  return true;
}

function clearAllPaneContent() {
  const manager = paneManager();
  const panes = allPanes(manager);

  if (!manager || !panes.length) {
    alert("לא נמצאו חלונות לניקוי.");
    return false;
  }
  if (!confirm("אתה בטוח? פעולה זו תנקה את כל תוכן החלונות. החלונות עצמם יישארו.")) {
    return false;
  }

  let cleared = 0;
  for (const pane of panes) {
    try {
      if (pane.editor?.commands?.clearContent) {
        pane.editor.commands.clearContent(true);
      } else {
        pane.editor?.commands?.setContent?.({
          type: "doc",
          content: [{ type: "paragraph" }]
        });
      }
      pane.scheduleMarkerBarUpdate?.({ immediate: true });
      cleared++;
    } catch (err) {
      console.warn("[stream-menu-full] clear pane failed", err);
    }
  }

  try {
    manager._save?.({ immediate: true });
    manager._emit?.("change");
  } catch (_) {}

  requestRender();
  setStatus(`נוקה תוכן ${cleared} חלונות. החלונות נשארו.`);
  return true;
}

function runCommand(command) {
  if (command === "delete-stream-panes") return deleteStreamPanes();
  if (command === "clear-all-pane-content") return clearAllPaneContent();
  if (command === "short-help") {
    alert(HELP_TEXT);
    return true;
  }
  return false;
}

function actionButton(text, command, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.style.cssText = [
    "min-height:31px",
    "padding:6px 8px",
    "border-radius:9px",
    `border:1px solid ${danger ? "rgba(170,40,40,.28)" : "rgba(0,0,0,.12)"}`,
    `background:${danger ? "rgba(170,40,40,.055)" : "rgba(0,0,0,.035)"}`,
    "color:inherit",
    "font:inherit",
    "font-size:12px",
    "cursor:pointer",
    "white-space:nowrap"
  ].join(";");
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    runCommand(command);
  });
  return button;
}

function patchPopover() {
  const popover = $(STREAM_POPOVER_ID);
  if (!popover || popover.style.display === "none") return;

  const body = popover.children[1] || popover;
  if (body.querySelector(`#${BULK_ACTIONS_ID}`)) return;

  const box = document.createElement("div");
  box.id = BULK_ACTIONS_ID;
  box.dir = "rtl";
  box.style.cssText = [
    "border:1px solid rgba(170,40,40,.18)",
    "border-radius:10px",
    "background:rgba(170,40,40,.025)",
    "padding:8px",
    "margin:0 0 10px"
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "פעולות ניקוי";
  title.style.cssText = "font-weight:700;font-size:12px;margin:0 0 6px;opacity:.82";

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px";
  grid.append(
    actionButton("מחק את כל חלונות הזרמים", "delete-stream-panes", true),
    actionButton("נקה את כל תוכן החלונות", "clear-all-pane-content", true)
  );

  box.append(title, grid);
  body.prepend(box);
}

function nestedNotesToggle() {
  return $(NESTED_NOTES_TOGGLE_ID);
}

function nestedNotesAnchor() {
  const toggle = nestedNotesToggle();
  if (!toggle) return null;

  return toggle.closest("label") ||
    toggle.closest(".tb-group,.settings-row,.setting-row,.control-row,.field-row,.form-row,.nested-notes-row") ||
    toggle.parentElement ||
    toggle;
}

function inlineHost(anchor) {
  if (!anchor) return null;
  if (anchor.matches?.(".source-stream-toolbar,.panes-toolbar")) return anchor;
  return anchor.parentElement || anchor;
}

function ensureStyle() {
  if ($(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${STREAM_ACTIONS_WRAP_ID} {
      display:inline-flex;
      align-items:center;
      gap:6px;
      margin-inline-start:8px;
      vertical-align:middle;
      position:static !important;
      z-index:auto !important;
      pointer-events:auto !important;
      white-space:nowrap;
    }
    #${STREAM_ACTIONS_WRAP_ID} #${STREAM_MENU_BUTTON_ID},
    #${STREAM_ACTIONS_WRAP_ID} #${SHORT_HELP_BUTTON_ID} {
      position:static !important;
      right:auto !important;
      left:auto !important;
      top:auto !important;
      bottom:auto !important;
      transform:none !important;
      margin:0 !important;
      vertical-align:middle !important;
      z-index:auto !important;
      pointer-events:auto !important;
    }
  `;
  document.head.appendChild(style);
}

function resetInlineButton(button) {
  button.hidden = false;
  button.style.position = "static";
  button.style.zIndex = "auto";
  button.style.top = "auto";
  button.style.right = "auto";
  button.style.left = "auto";
  button.style.bottom = "auto";
  button.style.transform = "none";
  button.style.margin = "0";
  button.style.pointerEvents = "auto";
}

function shortHelpButton() {
  let button = $(SHORT_HELP_BUTTON_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = SHORT_HELP_BUTTON_ID;
    button.type = "button";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      runCommand("short-help");
    });
  }

  button.textContent = "הסבר קצר";
  button.title = "הסבר קצר על קישור ההערות לפנים";
  button.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "gap:5px",
    "min-height:28px",
    "padding:4px 10px",
    "border-radius:999px",
    "border:1px solid rgba(44,90,160,.38)",
    "background:linear-gradient(180deg,rgba(44,90,160,.13),rgba(44,90,160,.06))",
    "color:inherit",
    "font:inherit",
    "font-size:12px",
    "font-weight:600",
    "line-height:1.35",
    "cursor:pointer",
    "white-space:nowrap",
    "box-shadow:0 1px 3px rgba(0,0,0,.12)",
    "pointer-events:auto",
    "position:static",
    "z-index:auto"
  ].join(";");

  return button;
}

function placeWrapAfterAnchor(wrap, anchor) {
  const host = inlineHost(anchor);
  if (!anchor || !host) return false;

  if (anchor.matches?.(".source-stream-toolbar,.panes-toolbar")) {
    if (!anchor.contains(wrap)) anchor.appendChild(wrap);
    return true;
  }

  // The source row is the #nested-notes-toggle row. Put the controls directly after
  // the label/row that contains the checkbox, so it stays on the same visual line.
  if (wrap.parentElement !== host || wrap.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement("afterend", wrap);
  }
  return true;
}

function hideUntilSourceRowExists(wrap, mainButton) {
  wrap.hidden = true;
  mainButton.hidden = true;
  if (!wrap.isConnected) document.body.appendChild(wrap);
  if (!wrap.contains(mainButton)) wrap.prepend(mainButton);
}

function alignStreamMenuButton() {
  ensureStyle();

  const mainButton = $(STREAM_MENU_BUTTON_ID);
  if (!mainButton) return;

  let wrap = $(STREAM_ACTIONS_WRAP_ID);
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.id = STREAM_ACTIONS_WRAP_ID;
    wrap.dir = "rtl";
  }

  const anchor = nestedNotesAnchor();
  if (!anchor) {
    hideUntilSourceRowExists(wrap, mainButton);
    return;
  }

  const placed = placeWrapAfterAnchor(wrap, anchor);
  if (!placed) {
    hideUntilSourceRowExists(wrap, mainButton);
    return;
  }

  wrap.hidden = false;
  wrap.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:6px",
    "margin-inline-start:8px",
    "vertical-align:middle",
    "position:static",
    "z-index:auto",
    "pointer-events:auto",
    "white-space:nowrap"
  ].join(";");

  if (!wrap.contains(mainButton)) wrap.prepend(mainButton);
  resetInlineButton(mainButton);

  const help = shortHelpButton();
  if (!wrap.contains(help)) wrap.appendChild(help);
  resetInlineButton(help);

  mainButton.setAttribute("aria-describedby", SHORT_HELP_BUTTON_ID);
}

function toolbarButton(id, text, command) {
  let button = $(id);
  if (!button) {
    button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      runCommand(command);
    });
  }

  button.textContent = text;
  button.style.cssText = [
    "min-height:28px",
    "padding:4px 9px",
    "border-radius:8px",
    "border:1px solid rgba(0,0,0,.14)",
    "background:rgba(0,0,0,.035)",
    "color:inherit",
    "font:inherit",
    "font-size:12px",
    "cursor:pointer",
    "white-space:nowrap"
  ].join(";");

  return button;
}

function addViewToolbarButtons() {
  const toolbar = document.querySelector(".panes-toolbar");
  if (!toolbar) return;

  const deleteButton = toolbarButton(
    "pane-delete-streams-btn",
    "מחק את כל חלונות הזרמים",
    "delete-stream-panes"
  );
  const clearButton = toolbarButton(
    "pane-clear-all-content-btn",
    "נקה את כל תוכן החלונות",
    "clear-all-pane-content"
  );

  if (!toolbar.contains(deleteButton)) toolbar.appendChild(deleteButton);
  if (!toolbar.contains(clearButton)) toolbar.appendChild(clearButton);
}

function applyPatch() {
  alignStreamMenuButton();
  addViewToolbarButtons();
  patchPopover();
}

export function installCompactStreamMenuFullPatch() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const start = () => {
    applyPatch();

    const observer = new MutationObserver(() => {
      clearTimeout(observer._timer);
      observer._timer = setTimeout(applyPatch, 60);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  [0, 100, 250, 600, 1200, 2500, 5000].forEach(ms => setTimeout(applyPatch, ms));
  window.addEventListener("resize", applyPatch);
  window.addEventListener("scroll", applyPatch, true);
}

installCompactStreamMenuFullPatch();
