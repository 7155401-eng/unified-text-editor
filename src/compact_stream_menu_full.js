// Stream menu full patch.
// Creates the main “פתח תפריט זרמים” button itself, then anchors it inline
// to the real nested-notes row: #nested-notes-toggle.

const MENU_BTN = "nested-notes-open-stream-menu-btn";
const HELP_BTN = "nested-notes-short-help-btn";
const WRAP_ID = "nested-notes-stream-menu-actions-wrap";
const POPOVER_ID = "nested-notes-stream-menu-popover";
const BULK_ID = "stream-menu-bulk-actions";
const STYLE_ID = "stream-menu-actions-style";
const TOGGLE_ID = "nested-notes-toggle";

let installed = false;
const $ = id => document.getElementById(id);

const HELP_TEXT = [
  "איך מקשרים הערות לפנים — בקצרה:",
  "",
  "1. בטקסט הראשי כותבים סימן זרם, למשל @01.",
  "2. בחלון של זרם 01 כותבים את ההערות לפי הסדר.",
  "3. ה-@01 הראשון מתחבר להערה הראשונה, השני לשנייה.",
  "4. אם יש הערה בתוך הערה, כותבים בתוכה סימן אחר, למשל @02.",
  "5. אחרי שינוי לוחצים רנדר כדי לראות את התוצאה בעמודים."
].join("\n");

function manager() {
  return window.paneManager;
}

function panes() {
  const m = manager();
  return Array.isArray(m?.panes) ? m.panes : [];
}

function streamPanes() {
  return panes().filter(p => p?.streamCode);
}

function rerender() {
  try { window.__ravtextApplyPaneWidths?.(); } catch (_) {}
  try { window.__ravtextRerender?.(); } catch (_) {}
}

function setStatus(text) {
  const el = $("stream-menu-status");
  if (el) el.textContent = text || "";
}

function deleteStreams() {
  const m = manager();
  const all = panes();
  const streams = streamPanes();

  if (!m || !all.length) {
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

  streams.slice().forEach(pane => {
    try {
      if (typeof m.removePane === "function") {
        m.removePane(pane.id);
      } else {
        pane.element?.remove?.();
        m.panes = m.panes.filter(p => p !== pane);
      }
    } catch (err) {
      console.warn("[stream-menu-full] remove failed", err);
    }
  });

  try {
    m.merged = false;
    m._save?.({ immediate: true });
    m._emit?.("change");
  } catch (_) {}

  rerender();
  setStatus(`נמחקו ${streams.length} חלונות זרמים. הזרם הראשי נשאר.`);
  return true;
}

function clearAllPanes() {
  const m = manager();
  const all = panes();

  if (!m || !all.length) {
    alert("לא נמצאו חלונות לניקוי.");
    return false;
  }
  if (!confirm("אתה בטוח? פעולה זו תנקה את כל תוכן החלונות. החלונות עצמם יישארו.")) {
    return false;
  }

  let cleared = 0;
  all.forEach(pane => {
    try {
      if (pane.editor?.commands?.clearContent) {
        pane.editor.commands.clearContent(true);
      } else {
        pane.editor?.commands?.setContent?.({ type: "doc", content: [{ type: "paragraph" }] });
      }
      pane.scheduleMarkerBarUpdate?.({ immediate: true });
      cleared++;
    } catch (err) {
      console.warn("[stream-menu-full] clear failed", err);
    }
  });

  try {
    m._save?.({ immediate: true });
    m._emit?.("change");
  } catch (_) {}

  rerender();
  setStatus(`נוקה תוכן ${cleared} חלונות. החלונות נשארו.`);
  return true;
}

function run(command) {
  if (command === "delete") return deleteStreams();
  if (command === "clear") return clearAllPanes();
  if (command === "help") {
    alert(HELP_TEXT);
    return true;
  }
  return false;
}

function button(text, command, danger = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.style.cssText = [
    "min-height:31px",
    "padding:6px 10px",
    "border-radius:9px",
    `border:1px solid ${danger ? "rgba(170,40,40,.28)" : "rgba(0,0,0,.14)"}`,
    `background:${danger ? "rgba(170,40,40,.055)" : "rgba(0,0,0,.035)"}`,
    "color:inherit",
    "font:inherit",
    "font-size:12px",
    "cursor:pointer",
    "white-space:nowrap"
  ].join(";");
  b.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    run(command);
  });
  return b;
}

function popover() {
  let p = $(POPOVER_ID);
  if (!p) {
    p = document.createElement("div");
    p.id = POPOVER_ID;
    p.dir = "rtl";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "תפריט זרמים");
    document.body.appendChild(p);
  }
  p.style.cssText = [
    "position:fixed",
    "z-index:10030",
    "display:none",
    "flex-direction:column",
    "width:min(460px,calc(100vw - 16px))",
    "max-height:min(82vh,560px)",
    "overflow:hidden",
    "border:1px solid rgba(0,0,0,.16)",
    "border-radius:14px",
    "background:var(--rt-surface,#fff)",
    "color:var(--rt-text,#222)",
    "box-shadow:0 12px 32px rgba(0,0,0,.22)",
    "font-size:12px",
    "box-sizing:border-box"
  ].join(";");
  return p;
}

function closeMenu() {
  const p = $(POPOVER_ID);
  if (p) p.style.display = "none";
  $(MENU_BTN)?.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("mousedown", onOutside, true);
}

function isOpen() {
  const p = $(POPOVER_ID);
  return !!(p && p.style.display !== "none");
}

function renderMenu() {
  const p = popover();
  p.innerHTML = "";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.10)";
  head.innerHTML = "<strong style='font-size:13px'>תפריט זרמים</strong><span style='flex:1'></span>";
  const x = button("× סגור", "noop");
  x.onclick = e => { e.preventDefault(); e.stopPropagation(); closeMenu(); };
  head.appendChild(x);

  const body = document.createElement("div");
  body.style.cssText = "overflow:auto;padding:10px 12px;display:grid;gap:8px";
  body.append(
    button("מחק את כל חלונות הזרמים", "delete", true),
    button("נקה את כל תוכן החלונות", "clear", true),
    button("הסבר קצר", "help"),
  );

  const hint = document.createElement("div");
  hint.id = "stream-menu-status";
  hint.textContent = "@01 בכל מקום מזוהה אוטומטית. הערה על הערה: @02 בתוך הערת @01.";
  hint.style.cssText = "border:1px solid rgba(0,0,0,.10);border-radius:10px;padding:7px 8px;background:rgba(0,0,0,.025);font-size:11px;line-height:1.45;opacity:.82";
  body.appendChild(hint);

  p.append(head, body);
}

function positionMenu() {
  const p = popover();
  const b = $(MENU_BTN);
  const r = b?.getBoundingClientRect?.();
  const pad = 8;

  p.style.display = "flex";
  p.style.visibility = "hidden";

  const h = p.offsetHeight || 260;
  const w = p.offsetWidth || 460;
  let top = r ? r.bottom + 8 : pad;
  let right = r ? innerWidth - r.right : pad;

  if (r && top + h > innerHeight - pad) top = r.top - h - 8;
  top = Math.max(pad, Math.min(innerHeight - h - pad, top));
  right = Math.max(pad, Math.min(innerWidth - w - pad, right));

  p.style.top = `${Math.round(top)}px`;
  p.style.right = `${Math.round(right)}px`;
  p.style.left = "auto";
  p.style.visibility = "visible";
}

function openMenu() {
  renderMenu();
  positionMenu();
  $(MENU_BTN)?.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
}

function toggleMenu() {
  isOpen() ? closeMenu() : openMenu();
}

function onKey(e) {
  if (e.key === "Escape") closeMenu();
}

function onOutside(e) {
  const p = $(POPOVER_ID);
  const b = $(MENU_BTN);
  if (p?.contains(e.target) || b?.contains(e.target)) return;
  closeMenu();
}

function sourceAnchor() {
  const t = $(TOGGLE_ID);
  if (!t) return null;
  return t.closest("label") ||
    t.closest(".tb-group,.settings-row,.setting-row,.control-row,.field-row,.form-row,.nested-notes-row") ||
    t.parentElement ||
    t;
}

function host(anchor) {
  if (!anchor) return null;
  return anchor.parentElement || anchor;
}

function ensureStyle() {
  if ($(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    #${WRAP_ID}{
      display:inline-flex;
      align-items:center;
      gap:6px;
      margin-inline-start:8px;
      vertical-align:middle;
      position:static!important;
      z-index:auto!important;
      pointer-events:auto!important;
      white-space:nowrap;
    }
    #${WRAP_ID} #${MENU_BTN},
    #${WRAP_ID} #${HELP_BTN}{
      position:static!important;
      inset:auto!important;
      transform:none!important;
      margin:0!important;
      z-index:auto!important;
      pointer-events:auto!important;
      vertical-align:middle!important;
    }
  `;
  document.head.appendChild(s);
}

function inlineStyle(el) {
  el.hidden = false;
  el.style.position = "static";
  el.style.zIndex = "auto";
  el.style.top = "auto";
  el.style.right = "auto";
  el.style.left = "auto";
  el.style.bottom = "auto";
  el.style.transform = "none";
  el.style.margin = "0";
  el.style.pointerEvents = "auto";
}

function mainButton() {
  let b = $(MENU_BTN);
  if (!b) {
    b = document.createElement("button");
    b.id = MENU_BTN;
    b.type = "button";
    b.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });
  }
  b.textContent = "פתח תפריט זרמים";
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-expanded", isOpen() ? "true" : "false");
  b.style.cssText = [
    "display:inline-flex",
    "align-items:center",
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
  return b;
}

function helpButton() {
  let b = $(HELP_BTN);
  if (!b) {
    b = document.createElement("button");
    b.id = HELP_BTN;
    b.type = "button";
    b.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      run("help");
    });
  }
  b.textContent = "הסבר קצר";
  b.title = "הסבר קצר על קישור ההערות לפנים";
  b.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "min-height:28px",
    "padding:4px 10px",
    "border-radius:999px",
    "border:1px solid rgba(44,90,160,.38)",
    "background:linear-gradient(180deg,rgba(44,90,160,.13),rgba(44,90,160,.06))",
    "color:inherit",
    "font:inherit",
    "font-size:12px",
    "font-weight:600",
    "cursor:pointer",
    "white-space:nowrap",
    "box-shadow:0 1px 3px rgba(0,0,0,.12)",
    "position:static",
    "z-index:auto"
  ].join(";");
  return b;
}

function alignButtons() {
  ensureStyle();

  const anchor = sourceAnchor();
  const mb = mainButton();
  let wrap = $(WRAP_ID);
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.id = WRAP_ID;
    wrap.dir = "rtl";
  }

  if (!anchor) {
    wrap.hidden = true;
    mb.hidden = true;
    if (!wrap.isConnected) document.body.appendChild(wrap);
    if (!wrap.contains(mb)) wrap.prepend(mb);
    return;
  }

  const h = host(anchor);
  if (!h) return;

  if (wrap.parentElement !== h || wrap.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement("afterend", wrap);
  }

  wrap.hidden = false;
  wrap.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin-inline-start:8px;vertical-align:middle;position:static;z-index:auto;pointer-events:auto;white-space:nowrap";

  if (!wrap.contains(mb)) wrap.prepend(mb);
  inlineStyle(mb);

  const hb = helpButton();
  if (!wrap.contains(hb)) wrap.appendChild(hb);
  inlineStyle(hb);

  mb.setAttribute("aria-describedby", HELP_BTN);
}

function toolbarButton(id, text, command) {
  let b = $(id);
  if (!b) {
    b = document.createElement("button");
    b.id = id;
    b.type = "button";
    b.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      run(command);
    });
  }
  b.textContent = text;
  b.style.cssText = "min-height:28px;padding:4px 9px;border-radius:8px;border:1px solid rgba(0,0,0,.14);background:rgba(0,0,0,.035);color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap";
  return b;
}

function addToolbarButtons() {
  const toolbar = document.querySelector(".panes-toolbar");
  if (!toolbar) return;

  const del = toolbarButton("pane-delete-streams-btn", "מחק את כל חלונות הזרמים", "delete");
  const clear = toolbarButton("pane-clear-all-content-btn", "נקה את כל תוכן החלונות", "clear");

  if (!toolbar.contains(del)) toolbar.appendChild(del);
  if (!toolbar.contains(clear)) toolbar.appendChild(clear);
}

function applyPatch() {
  alignButtons();
  addToolbarButtons();
  if (isOpen()) positionMenu();
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
    observer.observe(document.body, { childList: true, subtree: true });
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
