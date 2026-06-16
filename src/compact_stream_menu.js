// compact_stream_menu.js — safe, bounded compact stream selector.
//
// Loaded once by the app. It only tries a few bounded installs during startup.
// No MutationObserver, no interval, and no global DOM rewriting.

const BTN_ID = "nested-notes-open-stream-menu-btn";
const POP_ID = "nested-notes-stream-menu-popover";
const INPUT_ID = "talmud-streams-input";
const PICKER_ID = "talmud-stream-picker";
const ADD_BTN_ID = "talmud-add-stream-btn";
const MAX_STREAMS = 2;

let installStarted = false;

function textOf(el) {
  if (!el) return "";
  return [
    el.textContent || "",
    el.value || "",
    el.title || "",
    el.getAttribute?.("aria-label") || "",
    el.id || "",
    typeof el.className === "string" ? el.className : "",
  ].join(" ").replace(/\s+/g, " ").trim();
}

function findNestedNotesButton() {
  return Array.from(document.querySelectorAll("button,[role='button'],input[type='button'],input[type='submit'],label"))
    .find((el) => {
      if (!(el instanceof HTMLElement) || el.id === BTN_ID) return false;
      const t = textOf(el);
      return t.includes("הערות להערות") || /הצג.*הערות.*להערות/.test(t);
    }) || null;
}

function findAnchor() {
  return findNestedNotesButton()
    || document.getElementById(PICKER_ID)
    || document.getElementById(ADD_BTN_ID);
}

function paneAnchor() {
  return document.getElementById("panes-container")
    || document.getElementById("pane-container")
    || document.querySelector("[data-pane-container]")
    || document.querySelector(".panes-container,.pane-container,.panes-shell,.pane-layout,.pane-stack,.panes")
    || document.getElementById("pages-container");
}

function selectedCodes() {
  const input = document.getElementById(INPUT_ID);
  return input ? (input.value.match(/\d{2}/g) || []) : [];
}

function availableCodes() {
  const codes = new Set();
  document.querySelectorAll(".stream[data-stream], [data-stream]").forEach((el) => {
    const c = el.getAttribute("data-stream");
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });
  if (!codes.size) {
    for (let i = 1; i <= 10; i += 1) codes.add(String(i).padStart(2, "0"));
  }
  return Array.from(codes).sort();
}

function setSelected(codes) {
  const input = document.getElementById(INPUT_ID);
  if (!input) return false;
  input.value = codes.slice(0, MAX_STREAMS).slice().sort().join(",");
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function ensureButton() {
  const anchor = findAnchor();
  if (!(anchor instanceof HTMLElement)) return false;

  let btn = document.getElementById(BTN_ID);
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = BTN_ID;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleMenu(btn);
    });
  }

  btn.innerHTML = '<span aria-hidden="true">🌊</span><span>פתח תפריט זרמים</span>';
  btn.title = "פתח תפריט זרמים";
  btn.setAttribute("aria-label", "פתח תפריט זרמים");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.style.cssText = [
    "margin-inline-start:6px",
    "display:inline-flex",
    "align-items:center",
    "gap:5px",
    "padding:3px 9px",
    "border-radius:999px",
    "border:1px solid rgba(44,90,160,.38)",
    "background:linear-gradient(180deg,rgba(44,90,160,.12),rgba(44,90,160,.05))",
    "color:inherit",
    "font-size:12px",
    "font-weight:600",
    "line-height:1.35",
    "cursor:pointer",
    "white-space:nowrap",
    "box-shadow:0 1px 2px rgba(0,0,0,.08)",
  ].join(";");

  const nestedBtn = findNestedNotesButton();
  if (nestedBtn && btn.previousElementSibling !== nestedBtn) {
    nestedBtn.insertAdjacentElement("afterend", btn);
    return true;
  }

  const picker = document.getElementById(PICKER_ID);
  if (picker && btn.nextElementSibling !== picker) {
    picker.insertAdjacentElement("beforebegin", btn);
    return true;
  }

  if (!btn.isConnected) anchor.insertAdjacentElement("afterend", btn);
  return true;
}

function ensurePopover() {
  let pop = document.getElementById(POP_ID);
  if (pop) return pop;

  pop = document.createElement("div");
  pop.id = POP_ID;
  pop.dir = "rtl";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "תפריט זרמים");
  pop.style.cssText = [
    "position:fixed",
    "z-index:10020",
    "display:none",
    "min-width:220px",
    "max-width:min(340px,calc(100vw - 16px))",
    "max-height:min(62vh,420px)",
    "overflow:auto",
    "box-sizing:border-box",
    "padding:8px",
    "border:1px solid rgba(0,0,0,.16)",
    "border-radius:12px",
    "background:var(--rt-surface,#fff)",
    "color:var(--rt-text,#222)",
    "box-shadow:0 10px 28px rgba(0,0,0,.20)",
    "font-size:12px",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px";

  const title = document.createElement("strong");
  title.textContent = "🌊 תפריט זרמים";
  title.style.fontSize = "12px";

  const spacer = document.createElement("span");
  spacer.style.flex = "1";

  const close = document.createElement("button");
  close.type = "button";
  close.title = "סגור";
  close.textContent = "×";
  close.style.cssText = "border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:inherit;padding:0 2px";
  close.addEventListener("click", closeMenu);

  const body = document.createElement("div");
  body.className = "nested-notes-stream-menu-body";

  header.append(title, spacer, close);
  pop.append(header, body);
  document.body.appendChild(pop);
  return pop;
}

function positionMenu(pop, btn) {
  pop.style.display = "block";
  pop.style.visibility = "hidden";

  const pad = 8;
  const pane = paneAnchor()?.getBoundingClientRect?.();
  const button = btn?.getBoundingClientRect?.();

  let top = pad;
  let right = pad;

  if (pane && pane.width > 0 && pane.height > 0) {
    top = pane.top + pad;
    right = Math.max(pad, window.innerWidth - pane.right + pad);
  } else if (button) {
    top = button.bottom + 6;
    right = Math.max(pad, window.innerWidth - button.right);
  }

  const h = pop.offsetHeight || 260;
  const w = pop.offsetWidth || 280;

  if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
  if (right + w > window.innerWidth - pad) right = Math.max(pad, window.innerWidth - w - pad);

  pop.style.top = `${Math.round(top)}px`;
  pop.style.right = `${Math.round(right)}px`;
  pop.style.left = "auto";
  pop.style.visibility = "visible";
}

function toggleCode(code) {
  const cur = selectedCodes();
  if (cur.includes(code)) {
    setSelected(cur.filter((c) => c !== code));
  } else if (cur.length >= MAX_STREAMS) {
    setSelected([...cur.slice(1), code]);
  } else {
    setSelected([...cur, code]);
  }
  renderBody();
}

function renderBody() {
  const pop = document.getElementById(POP_ID);
  if (!pop || pop.style.display === "none") return;

  const body = pop.querySelector(".nested-notes-stream-menu-body");
  if (!body) return;

  const cur = selectedCodes();
  const codes = availableCodes();
  body.innerHTML = "";

  const hint = document.createElement("div");
  hint.textContent = `בחר עד ${MAX_STREAMS} זרמים להצגה בחלוניות.`;
  hint.style.cssText = "opacity:.72;margin:0 0 8px;font-size:11px";

  const chips = document.createElement("div");
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px";

  codes.forEach((code) => {
    const selected = cur.includes(code);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = selected ? `✓ ${code}` : code;
    chip.title = selected ? `הסר זרם ${code}` : `בחר זרם ${code}`;
    chip.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "min-width:34px",
      "padding:4px 8px",
      "border-radius:999px",
      "border:1px solid rgba(0,0,0,.12)",
      selected ? "background:var(--rt-accent,#2c5aa0);color:#fff" : "background:rgba(0,0,0,.035);color:inherit",
      "font:inherit",
      "font-size:12px",
      "cursor:pointer",
    ].join(";");
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleCode(code);
    });
    chips.appendChild(chip);
  });

  const current = document.createElement("div");
  current.textContent = cur.length ? `נבחרו: ${cur.join(", ")}` : "לא נבחרו זרמים";
  current.style.cssText = "border-top:1px solid rgba(0,0,0,.10);padding-top:7px;opacity:.72;font-size:11px";

  body.append(hint, chips, current);
}

function openMenu(btn) {
  const pop = ensurePopover();
  renderBody();
  positionMenu(pop, btn);
  btn?.setAttribute("aria-expanded", "true");

  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("click", onOutside, true), 0);
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true);
}

function closeMenu() {
  const pop = document.getElementById(POP_ID);
  if (pop) pop.style.display = "none";

  document.getElementById(BTN_ID)?.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("click", onOutside, true);
  window.removeEventListener("resize", onReposition);
  window.removeEventListener("scroll", onReposition, true);
}

function toggleMenu(btn) {
  const pop = document.getElementById(POP_ID);
  if (pop && pop.style.display !== "none") closeMenu();
  else openMenu(btn);
}

function onKey(ev) {
  if (ev.key === "Escape") closeMenu();
}

function onOutside(ev) {
  const pop = document.getElementById(POP_ID);
  const btn = document.getElementById(BTN_ID);
  if (pop?.contains(ev.target) || btn?.contains(ev.target)) return;
  closeMenu();
}

function onReposition() {
  const pop = document.getElementById(POP_ID);
  const btn = document.getElementById(BTN_ID);
  if (pop && pop.style.display !== "none") positionMenu(pop, btn);
}

export function installCompactStreamMenuButton() {
  if (installStarted || typeof document === "undefined") return;
  installStarted = true;

  const run = () => ensureButton();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  [0, 300, 1000, 2500, 5000].forEach((ms) => setTimeout(run, ms));
}

installCompactStreamMenuButton();
