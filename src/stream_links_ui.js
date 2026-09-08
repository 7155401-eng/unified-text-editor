// Chooser for "notes on notes": which other streams may this stream's notes
// hang from. One small button in every stream pane header, opening a floating
// panel shaped like the existing stream popover (fixed, 460px wide, RTL, a
// "× סגור" button, Escape, and a click outside — all three close it).
//
// Default for every stream is "linked to the main text only", so an untouched
// installation renders exactly as before.
//
// Churn discipline: everything in here runs on a user action only. The one
// thing that happens automatically — hanging the button in a header — is
// guarded by a dataset flag, so it writes once per header and never again.

import {
  getStreamParents,
  setStreamParents,
  STREAM_LINKS_CHANGED_EVENT,
} from "./stream_links.js";

const PANEL_ID = "stream-links-popover";
const BUTTON_CLASS = "pane-stream-links-btn";
const HEADER_FLAG = "rtStreamLinks";      // dataset key -> data-rt-stream-links

let openForCode = null;
let dirty = false;

function $(id) {
  return document.getElementById(id);
}

// Live pane list, newest labels. Same source as src/stream_button_labels.js so
// a renamed pane shows its new name here immediately.
function streamPanes() {
  const panes = window.paneManager?.panes;
  if (!Array.isArray(panes)) return [];
  return panes
    .filter((p) => p && p.streamCode)
    .map((p) => ({
      code: String(p.streamCode),
      label: String(p.label || "").trim() || `זרם ${p.streamCode}`,
    }));
}

/* ------------------------------------------------------------------ panel */

function panel() {
  let p = $(PANEL_ID);
  if (!p) {
    p = document.createElement("div");
    p.id = PANEL_ID;
    p.dir = "rtl";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-modal", "false");
    p.setAttribute("aria-label", "קישור הערות לזרמים");
    document.body.appendChild(p);
    p.style.cssText = [
      "position:fixed",
      "z-index:10031",
      "display:none",
      "flex-direction:column",
      "width:min(460px,calc(100vw - 16px))",
      "max-height:min(70vh,420px)",
      "overflow:hidden",
      "border:1px solid rgba(0,0,0,.16)",
      "border-radius:14px",
      "background:var(--rt-surface,#fff)",
      "color:var(--rt-text,#222)",
      "box-shadow:0 12px 32px rgba(0,0,0,.22)",
      "font-size:12px",
      "box-sizing:border-box",
      "text-align:right",
    ].join(";");
  }
  return p;
}

function isOpen() {
  const p = $(PANEL_ID);
  return !!(p && p.style.display !== "none");
}

function onKey(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    closePanel();
  }
}

function onOutside(event) {
  const p = $(PANEL_ID);
  if (p && p.contains(event.target)) return;
  if (event.target && event.target.closest && event.target.closest("." + BUTTON_CLASS)) return;
  closePanel();
}

function closePanel() {
  const p = $(PANEL_ID);
  if (p) p.style.display = "none";
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("mousedown", onOutside, true);
  for (const btn of document.querySelectorAll("." + BUTTON_CLASS)) {
    // Conditional write: only touch the attribute when it is actually wrong.
    if (btn.getAttribute("aria-expanded") !== "false") btn.setAttribute("aria-expanded", "false");
  }
  openForCode = null;
  if (dirty) {
    dirty = false;
    try { window.__ravtextRerender?.(); } catch (_) {}
  }
}

function smallButton(text) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.style.cssText = [
    "font:inherit",
    "font-size:11px",
    "padding:3px 9px",
    "border-radius:8px",
    "border:1px solid rgba(0,0,0,.16)",
    "background:rgba(0,0,0,.03)",
    "color:inherit",
    "cursor:pointer",
  ].join(";");
  return b;
}

function groupBox(title) {
  const box = document.createElement("div");
  box.style.cssText = [
    "border:1px solid rgba(0,0,0,.10)",
    "border-radius:10px",
    "padding:8px 9px",
    "background:rgba(0,0,0,.02)",
    "min-width:0",
  ].join(";");
  const h = document.createElement("div");
  h.textContent = title;
  h.style.cssText = "font-weight:700;font-size:11.5px;margin-bottom:6px;opacity:.9";
  box.appendChild(h);
  return box;
}

// Builds the panel contents for one stream. Called only when the user opens
// the chooser, so it always shows the state as it is right now.
function renderPanel(code, label) {
  const p = panel();
  p.innerHTML = "";

  const head = document.createElement("div");
  head.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(0,0,0,.10)";
  const title = document.createElement("strong");
  title.style.cssText = "font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  title.textContent = `הערות של ${label} — לאן הן מתחברות`;
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  const closeBtn = smallButton("× סגור");
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closePanel();
  });
  head.append(title, spacer, closeBtn);

  // Two labelled groups, side by side — wider than tall, no dead scrollbar.
  const body = document.createElement("div");
  body.style.cssText =
    "padding:10px 12px;display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:start;overflow:auto";

  const fixed = groupBox("תמיד");
  const fixedLine = document.createElement("div");
  fixedLine.textContent = "הטקסט הראשי";
  fixedLine.style.cssText = "font-size:12px;padding:3px 2px";
  const fixedNote = document.createElement("div");
  fixedNote.textContent = "החיבור לראשי קבוע ואי אפשר לבטל אותו.";
  fixedNote.style.cssText = "font-size:10.5px;line-height:1.45;opacity:.7;margin-top:4px";
  fixed.append(fixedLine, fixedNote);

  const others = groupBox("וגם בתוך הערות של");
  const parents = getStreamParents(code);
  const list = streamPanes().filter((s) => s.code !== code);

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "אין עדיין חלונית זרם אחרת לבחור ממנה.";
    empty.style.cssText = "font-size:11px;opacity:.7;line-height:1.5";
    others.appendChild(empty);
  } else {
    for (const item of list) {
      const row = document.createElement("label");
      row.style.cssText =
        "display:flex;align-items:center;gap:7px;padding:3px 2px;cursor:pointer;font-size:12px";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = item.code;
      box.checked = parents.indexOf(item.code) !== -1;
      box.style.cssText = "margin:0;flex:none";
      const chip = document.createElement("span");
      chip.textContent = item.code;
      chip.style.cssText =
        "flex:none;font-size:10px;padding:1px 5px;border-radius:6px;background:rgba(0,0,0,.08);opacity:.75";
      const name = document.createElement("span");
      name.textContent = item.label;   // the pane's CURRENT name, never a default
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      box.addEventListener("change", () => {
        const checked = Array.from(others.querySelectorAll("input[type=checkbox]"))
          .filter((c) => c.checked)
          .map((c) => c.value);
        setStreamParents(code, checked);   // persisted immediately
        dirty = true;
        updateHint();
      });
      row.append(box, chip, name);
      others.appendChild(row);
    }
  }

  body.append(fixed, others);

  const hint = document.createElement("div");
  hint.id = "stream-links-hint";
  hint.style.cssText =
    "margin:0 12px 10px;border:1px solid rgba(0,0,0,.10);border-radius:10px;padding:7px 8px;" +
    "background:rgba(0,0,0,.025);font-size:10.5px;line-height:1.45;opacity:.85";
  p.append(head, body, hint);
  updateHint();
}

// Single line telling the user, in plain words, what is set right now.
function updateHint() {
  const hint = $("stream-links-hint");
  if (!hint || !openForCode) return;
  const parents = getStreamParents(openForCode);
  const byCode = new Map(streamPanes().map((s) => [s.code, s.label]));
  const text = parents.length === 0
    ? "כרגע: מקושר לטקסט הראשי בלבד. סימן של הזרם הזה בתוך הערה של זרם אחר יישאר טקסט רגיל."
    : "כרגע: לראשי, וגם בתוך הערות של " + parents.map((c) => byCode.get(c) || c).join(", ") + ".";
  if (hint.textContent !== text) hint.textContent = text;   // conditional write
}

function positionPanel(anchorEl) {
  const p = panel();
  const r = anchorEl?.getBoundingClientRect?.();
  const pad = 8;

  p.style.display = "flex";
  p.style.visibility = "hidden";

  const h = p.offsetHeight || 230;
  const w = p.offsetWidth || 460;
  let top = r ? r.bottom + 8 : pad;
  let right = r ? window.innerWidth - r.right : pad;

  if (r && top + h > window.innerHeight - pad) top = r.top - h - 8;
  top = Math.max(pad, Math.min(window.innerHeight - h - pad, top));
  right = Math.max(pad, Math.min(window.innerWidth - w - pad, right));

  p.style.top = `${Math.round(top)}px`;
  p.style.right = `${Math.round(right)}px`;
  p.style.left = "auto";
  p.style.visibility = "visible";
}

function openPanel(pane, anchorEl) {
  const code = String(pane.streamCode || "");
  if (!code) return;
  openForCode = code;
  dirty = false;
  renderPanel(code, String(pane.label || "").trim() || `זרם ${code}`);
  positionPanel(anchorEl);
  if (anchorEl.getAttribute("aria-expanded") !== "true") anchorEl.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
}

/* --------------------------------------------- what the header button says */

// משה 08/09/2026: הכפתור אמר „קישור” בלבד, ולא היה אפשר לדעת לאן החלונית
// מחוברת בלי לפתוח תפריט. עכשיו הוא אומר את המצב בעצמו, וכך רואים את כל
// מפת הקישורים במבט אחד על הכותרות.
function linkSummary(code) {
  let parents = [];
  try {
    parents = getStreamParents(String(code)) || [];
  } catch (_) {
    parents = [];
  }
  if (!parents.length) return "\u2b05 לראשי בלבד";
  if (parents.length === 1) {
    const one = streamPanes().find((p) => String(p.code) === String(parents[0]));
    return "\u2b05 " + (one ? one.label : "זרם " + parents[0]);
  }
  return "\u2b05 " + parents.length + " זרמים";
}

// כתיבה מותנית בלבד: נוגעים בדף רק כשהכיתוב באמת השתנה.
export function refreshStreamLinkSummaries() {
  let changed = 0;
  for (const btn of document.querySelectorAll("." + BUTTON_CLASS)) {
    const code = btn.dataset.streamLinksFor;
    if (!code) continue;
    const text = linkSummary(code);
    if (btn.textContent !== text) {
      btn.textContent = text;
      changed += 1;
    }
  }
  return changed;
}

if (typeof window !== "undefined") {
  window.__ravtextRefreshStreamLinkSummaries = refreshStreamLinkSummaries;
  const bump = () => {
    try {
      refreshStreamLinkSummaries();
    } catch (_) {}
  };
  window.addEventListener(STREAM_LINKS_CHANGED_EVENT, bump);
  document.addEventListener("input", (event) => {
    if (event.target?.closest?.(".pane-header")) bump();
  }, true);
  let tries = 0;
  const attach = () => {
    tries += 1;
    bump();
    const mgr = window.paneManager;
    if (mgr && typeof mgr.on === "function") {
      mgr.on("change", bump);
      return;
    }
    if (tries < 40) setTimeout(attach, 150);
  };
  attach();
}

/* ------------------------------------------------------- header button */

export function attachStreamLinksButton(pane, header) {
  if (!pane || !pane.streamCode || !header) return false;
  if (header.dataset[HEADER_FLAG] === "1") return false;   // already there
  if (header.querySelector("." + BUTTON_CLASS)) {
    header.dataset[HEADER_FLAG] = "1";
    return false;
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pane-marker-toggle " + BUTTON_CLASS;
  btn.textContent = linkSummary(pane.streamCode);
  btn.dataset.streamLinksFor = String(pane.streamCode);
  btn.title = "בחר לאילו זרמים ההערות של החלונית הזאת מתחברות";
  btn.setAttribute("aria-label", btn.title);
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isOpen() && openForCode === String(pane.streamCode)) closePanel();
    else {
      if (isOpen()) closePanel();
      openPanel(pane, btn);
    }
  });
  // Keep the drag-to-reorder handle from stealing the click.
  btn.addEventListener("mousedown", (event) => event.stopPropagation());
  btn.draggable = false;

  const close = header.querySelector(".pane-close");
  if (close) header.insertBefore(btn, close);
  else header.appendChild(btn);

  header.dataset[HEADER_FLAG] = "1";
  return true;
}

export function installStreamLinksUI(paneManager) {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;

  // Called by pane_manager.js once per stream pane, right after its header is
  // built. Anything mounted later is covered automatically.
  window.__ravtextStreamLinksHeaderHook = (pane, header) => {
    try { attachStreamLinksButton(pane, header); } catch (_) {}
  };

  // Panes that already exist when this module loads.
  let added = 0;
  const panes = paneManager?.panes || window.paneManager?.panes || [];
  for (const pane of panes) {
    if (!pane || !pane.streamCode) continue;
    const header = pane._header || pane.element?.querySelector?.(".pane-header");
    if (header && attachStreamLinksButton(pane, header)) added++;
  }

  // Another tab changed the links -> refresh the open panel's hint only.
  window.addEventListener(STREAM_LINKS_CHANGED_EVENT, () => {
    if (isOpen()) updateHint();
  });

  return added;
}
