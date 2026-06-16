import "./first_note_title.js";

// Feature gate for nested footnotes ("הערה על הערה").
//
// Activated by:
//   • URL param `?nested=1`          — turns the feature on for THIS visit
//                                     AND persists to localStorage so
//                                     subsequent loads keep it on.
//   • URL param `?nested=0`          — turns it off and clears the flag.
//   • localStorage `ravtext.nestedNotes=1` — the persisted state.
//
// Why same-domain URL gate: `https://app.ravtext.com/?nested=1&k=...`
// gives the user a shareable link that opts them in. On the same domain,
// the render preflight succeeds (it gates on origin, not on the feature).
//
// When the gate is OFF:
//   • engine_bridge.js skips the expandNestedInNote pass — `@XX` markers
//     embedded in stream-pane note text stay as literal characters,
//     identical to the pre-feature behavior. Backwards-compatible.
//   • The beginner hint banner is hidden.
// When the gate is ON:
//   • Embedded markers are pulled as children; renderer shows them inline.
//   • The hint banner appears (until dismissed).

const STORAGE_KEY = "ravtext.nestedNotes";

let _cached = null;

export function isNestedNotesEnabled() {
  if (_cached !== null) return _cached;
  if (typeof window === "undefined") return false;
  // URL param wins for this load and writes to storage so subsequent
  // navigation within the same session keeps the choice.
  try {
    const params = new URLSearchParams(window.location.search || "");
    const v = params.get("nested");
    if (v === "1" || v === "true") {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch (_) {}
      _cached = true;
      return true;
    }
    if (v === "0" || v === "false") {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      _cached = false;
      return false;
    }
  } catch (_) {}
  try {
    _cached = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (_) {
    _cached = false;
  }
  return _cached;
}

// For tests: drop the cache so a fresh check re-reads URL + localStorage.
export function _resetNestedNotesGateCache() {
  _cached = null;
}

const STREAM_MENU_BUTTON_ID = "nested-notes-open-stream-menu-btn";
const STREAM_MENU_POPOVER_ID = "nested-notes-stream-menu-popover";
const STREAM_PICKER_ID = "talmud-stream-picker";
const STREAM_ADD_BUTTON_ID = "talmud-add-stream-btn";

let _streamMenuInstalled = false;
let _streamMenuObserver = null;
let _streamMenuReturnSlot = null;
let _streamMenuResizeHandler = null;

function textOf(el) {
  if (!el) return "";
  return [
    el.textContent || "",
    el.value || "",
    el.title || "",
    el.getAttribute?.("aria-label") || "",
  ].join(" ").replace(/\s+/g, " ").trim();
}

function findNestedNotesButton() {
  const candidates = Array.from(document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"));
  return candidates.find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.id === STREAM_MENU_BUTTON_ID) return false;
    return textOf(el).includes("הצג הערות להערות");
  }) || null;
}

function styleStreamMenuButton(btn) {
  btn.type = "button";
  btn.id = STREAM_MENU_BUTTON_ID;
  btn.className = "nested-notes-stream-menu-button";
  btn.textContent = "זרמים";
  btn.title = "פתח תפריט זרמים";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.style.cssText = [
    "margin-inline-start:6px",
    "padding:3px 8px",
    "border-radius:999px",
    "border:1px solid rgba(44,90,160,.35)",
    "background:rgba(44,90,160,.08)",
    "color:inherit",
    "font-size:12px",
    "line-height:1.4",
    "cursor:pointer",
    "white-space:nowrap",
  ].join(";");
}

function ensureStreamMenuButton(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  let btn = document.getElementById(STREAM_MENU_BUTTON_ID);
  if (!btn) {
    btn = document.createElement("button");
    styleStreamMenuButton(btn);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleStreamMenu(btn);
    });
  }
  if (btn.previousElementSibling !== target) {
    target.insertAdjacentElement("afterend", btn);
  }
  return true;
}

function ensureStreamMenuPopover() {
  let popover = document.getElementById(STREAM_MENU_POPOVER_ID);
  if (popover) return popover;

  popover = document.createElement("div");
  popover.id = STREAM_MENU_POPOVER_ID;
  popover.className = "nested-notes-stream-menu-popover";
  popover.dir = "rtl";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "תפריט זרמים");
  popover.style.cssText = [
    "position:fixed",
    "z-index:10020",
    "display:none",
    "min-width:220px",
    "max-width:min(360px,calc(100vw - 16px))",
    "max-height:min(70vh,520px)",
    "overflow:auto",
    "box-sizing:border-box",
    "padding:10px",
    "border:1px solid rgba(0,0,0,.18)",
    "border-radius:12px",
    "background:var(--rt-surface,#fff)",
    "color:var(--rt-text,#222)",
    "box-shadow:0 12px 34px rgba(0,0,0,.22)",
    "font-size:13px",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
  const title = document.createElement("strong");
  title.textContent = "תפריט זרמים";
  title.style.cssText = "font-size:13px;";
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.title = "סגור";
  close.style.cssText = "border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:inherit;";
  close.addEventListener("click", closeStreamMenu);
  header.append(title, spacer, close);

  const body = document.createElement("div");
  body.className = "nested-notes-stream-menu-body";

  popover.append(header, body);
  document.body.appendChild(popover);
  return popover;
}

function findPaneAnchor() {
  return document.getElementById("panes-container")
    || document.getElementById("pane-container")
    || document.querySelector("[data-pane-container]")
    || document.querySelector(".panes-container, .pane-container, .panes-shell, .pane-layout, .pane-stack, .panes");
}

function positionStreamMenu(popover, button) {
  popover.style.display = "block";
  popover.style.visibility = "hidden";

  const pad = 8;
  const paneAnchor = findPaneAnchor();
  const paneRect = paneAnchor?.getBoundingClientRect?.();
  const buttonRect = button?.getBoundingClientRect?.();

  let top;
  let right;

  if (paneRect && paneRect.width > 0 && paneRect.height > 0) {
    top = paneRect.top + pad;
    right = Math.max(pad, window.innerWidth - paneRect.right + pad);
  } else if (buttonRect) {
    top = buttonRect.bottom + 6;
    right = Math.max(pad, window.innerWidth - buttonRect.right);
  } else {
    top = pad;
    right = pad;
  }

  const height = popover.offsetHeight || 260;
  const width = popover.offsetWidth || 260;

  if (top + height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - height - pad);
  if (right + width > window.innerWidth - pad) right = Math.max(pad, window.innerWidth - width - pad);

  popover.style.top = `${Math.round(top)}px`;
  popover.style.right = `${Math.round(right)}px`;
  popover.style.left = "auto";
  popover.style.visibility = "visible";
}

function moveStreamControlsInto(body) {
  body.innerHTML = "";

  const picker = document.getElementById(STREAM_PICKER_ID);
  const addButton = document.getElementById(STREAM_ADD_BUTTON_ID);

  if (!picker && !addButton) {
    const empty = document.createElement("div");
    empty.textContent = "תפריט הזרמים עדיין לא נטען במסך הזה.";
    empty.style.cssText = "opacity:.75;";
    body.appendChild(empty);
    return;
  }

  if (!_streamMenuReturnSlot) {
    const first = picker || addButton;
    _streamMenuReturnSlot = {
      marker: document.createComment("stream menu return slot"),
      nodes: [picker, addButton].filter(Boolean),
    };
    first.parentNode?.insertBefore(_streamMenuReturnSlot.marker, first);
  }

  const hint = document.createElement("div");
  hint.textContent = "בחר זרמים, או הוסף זרם דרך הכפתור +.";
  hint.style.cssText = "margin-bottom:8px;opacity:.7;font-size:12px;";
  body.appendChild(hint);

  if (picker) {
    picker.style.display = "";
    body.appendChild(picker);
  }

  if (addButton) {
    addButton.style.display = "";
    addButton.style.marginTop = "8px";
    body.appendChild(addButton);
  }
}

function restoreStreamControls() {
  const slot = _streamMenuReturnSlot;
  if (!slot?.marker?.parentNode) {
    _streamMenuReturnSlot = null;
    return;
  }

  for (const node of slot.nodes || []) {
    if (node?.parentNode) {
      slot.marker.parentNode.insertBefore(node, slot.marker);
    }
  }
  slot.marker.remove();
  _streamMenuReturnSlot = null;
}

function closeStreamMenu() {
  const popover = document.getElementById(STREAM_MENU_POPOVER_ID);
  if (popover) {
    popover.style.display = "none";
    const body = popover.querySelector(".nested-notes-stream-menu-body");
    if (body) body.innerHTML = "";
  }
  restoreStreamControls();

  const btn = document.getElementById(STREAM_MENU_BUTTON_ID);
  if (btn) btn.setAttribute("aria-expanded", "false");

  document.removeEventListener("keydown", onStreamMenuKeydown, true);
  document.removeEventListener("click", onOutsideStreamMenuClick, true);
  if (_streamMenuResizeHandler) {
    window.removeEventListener("resize", _streamMenuResizeHandler);
    window.removeEventListener("scroll", _streamMenuResizeHandler, true);
    _streamMenuResizeHandler = null;
  }
}

function onStreamMenuKeydown(ev) {
  if (ev.key === "Escape") closeStreamMenu();
}

function onOutsideStreamMenuClick(ev) {
  const popover = document.getElementById(STREAM_MENU_POPOVER_ID);
  const btn = document.getElementById(STREAM_MENU_BUTTON_ID);
  const target = ev.target;
  if (popover?.contains(target) || btn?.contains(target)) return;
  closeStreamMenu();
}

function openStreamMenu(button) {
  const popover = ensureStreamMenuPopover();
  const body = popover.querySelector(".nested-notes-stream-menu-body");
  if (body) moveStreamControlsInto(body);
  positionStreamMenu(popover, button);

  button?.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onStreamMenuKeydown, true);
  setTimeout(() => document.addEventListener("click", onOutsideStreamMenuClick, true), 0);

  _streamMenuResizeHandler = () => {
    const btn = document.getElementById(STREAM_MENU_BUTTON_ID);
    const pop = document.getElementById(STREAM_MENU_POPOVER_ID);
    if (pop && pop.style.display !== "none") positionStreamMenu(pop, btn);
  };
  window.addEventListener("resize", _streamMenuResizeHandler);
  window.addEventListener("scroll", _streamMenuResizeHandler, true);
}

function toggleStreamMenu(button) {
  const popover = document.getElementById(STREAM_MENU_POPOVER_ID);
  if (popover && popover.style.display !== "none") {
    closeStreamMenu();
    return;
  }
  openStreamMenu(button);
}

function syncStreamMenuButton() {
  if (typeof document === "undefined") return;
  const target = findNestedNotesButton();
  if (target) ensureStreamMenuButton(target);
}

function installStreamMenuButtonNearNestedNotesButton() {
  if (_streamMenuInstalled || typeof document === "undefined") return;
  _streamMenuInstalled = true;

  const run = () => {
    syncStreamMenuButton();

    if (!_streamMenuObserver && document.body) {
      _streamMenuObserver = new MutationObserver(() => syncStreamMenuButton());
      _streamMenuObserver.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  setTimeout(syncStreamMenuButton, 300);
  setTimeout(syncStreamMenuButton, 1200);
}

installStreamMenuButtonNearNestedNotesButton();
