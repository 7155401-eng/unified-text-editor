// compact_stream_menu.js — safe, bounded compact stream selector.
// No MutationObserver, no document-wide click capture, no overlay, and no unrelated action buttons.

const BTN_ID = "nested-notes-open-stream-menu-btn";
const POP_ID = "nested-notes-stream-menu-popover";
const INPUT_ID = "talmud-streams-input";
const PICKER_ID = "talmud-stream-picker";
const ADD_BTN_ID = "talmud-add-stream-btn";
const MAX_STREAMS = 2;

let installStarted = false;
let fallbackMode = false;

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

function isVisibleElement(el) {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  try {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch (_) {
    return true;
  }
}

function findNestedNotesButton() {
  return Array.from(document.querySelectorAll("button,[role='button'],input[type='button'],input[type='submit'],label"))
    .find((el) => {
      if (!(el instanceof HTMLElement) || el.id === BTN_ID || !isVisibleElement(el)) return false;
      const t = textOf(el);
      return t.includes("הערות להערות")
        || /הצג.*הערות.*להערות/.test(t)
        || /תמיכה.*הערות.*להערות/.test(t);
    }) || null;
}

function findAnchor() {
  return findNestedNotesButton()
    || document.getElementById(PICKER_ID)
    || document.getElementById(ADD_BTN_ID)
    || document.getElementById(INPUT_ID);
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

function isMenuOpen() {
  const pop = document.getElementById(POP_ID);
  return !!(pop && pop.style.display !== "none");
}

function styleButton(btn) {
  btn.innerHTML = '<span aria-hidden="true">🌊</span><span>פתח תפריט זרמים</span>';
  btn.title = "פתח תפריט זרמים";
  btn.setAttribute("aria-label", "פתח תפריט זרמים");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", isMenuOpen() ? "true" : "false");

  const base = [
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
  ];

  if (fallbackMode) {
    base.push(
      "position:fixed",
      "top:92px",
      "right:12px",
      "z-index:10010"
    );
  } else {
    base.push("position:static");
  }

  btn.style.cssText = base.join(";");
}

function ensureButton() {
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

  if (btn.isConnected && isMenuOpen()) {
    styleButton(btn);
    return true;
  }

  const anchor = findAnchor();
  fallbackMode = !(anchor instanceof HTMLElement);

  if (anchor instanceof HTMLElement) {
    if (findNestedNotesButton() && btn.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement("afterend", btn);
    } else if (document.getElementById(PICKER_ID) && btn.nextElementSibling !== document.getElementById(PICKER_ID)) {
      document.getElementById(PICKER_ID).insertAdjacentElement("beforebegin", btn);
    } else if (!btn.isConnected) {
      anchor.insertAdjacentElement("afterend", btn);
    }
  } else if (!btn.isConnected) {
    document.body.appendChild(btn);
  }

  styleButton(btn);
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
    "min-width:260px",
    "max-width:min(360px,calc(100vw - 16px))",
    "max-height:min(62vh,420px)",
    "overflow:auto",
    "box-sizing:border-box",
    "padding:9px",
    "border:1px solid rgba(0,0,0,.16)",
    "border-radius:12px",
    "background:var(--rt-surface,#fff)",
    "color:var(--rt-text,#222)",
    "box-shadow:0 10px 28px rgba(0,0,0,.20)",
    "font-size:12px",
  ].join(";");
  document.body.appendChild(pop);
  return pop;
}

function renderBody() {
  const pop = ensurePopover();
  pop.innerHTML = "";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:7px";

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

  header.append(title, spacer, close);

  const body = document.createElement("div");

  const hint = document.createElement("div");
  hint.textContent = `בחר עד ${MAX_STREAMS} זרמים להצגה בחלוניות.`;
  hint.style.cssText = "opacity:.72;margin:0 0 8px;font-size:11px";

  const input = document.getElementById(INPUT_ID);
  if (!input) {
    const missing = document.createElement("div");
    missing.textContent = "בקר הזרמים עדיין לא נטען במסך הזה.";
    missing.style.cssText = "border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:7px 8px;background:rgba(0,0,0,.025);opacity:.75";
    body.append(hint, missing);
    pop.append(header, body);
    return;
  }

  const cur = selectedCodes();
  const chips = document.createElement("div");
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px";

  availableCodes().forEach((code) => {
    const on = cur.includes(code);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = on ? `✓ ${code}` : code;
    chip.title = on ? `הסר זרם ${code}` : `בחר זרם ${code}`;
    chip.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "min-width:34px",
      "padding:4px 8px",
      "border-radius:999px",
      "border:1px solid rgba(0,0,0,.12)",
      on ? "background:var(--rt-accent,#2c5aa0);color:#fff" : "background:rgba(0,0,0,.035);color:inherit",
      "font:inherit",
      "font-size:12px",
      "cursor:pointer",
    ].join(";");
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const next = cur.includes(code)
        ? cur.filter((c) => c !== code)
        : (cur.length >= MAX_STREAMS ? [...cur.slice(1), code] : [...cur, code]);
      setSelected(next);
      renderBody();
    });
    chips.appendChild(chip);
  });

  const current = document.createElement("div");
  current.textContent = cur.length ? `נבחרו: ${cur.join(", ")}` : "לא נבחרו זרמים";
  current.style.cssText = "border-top:1px solid rgba(0,0,0,.10);padding-top:7px;opacity:.72;font-size:11px";

  body.append(hint, chips, current);
  pop.append(header, body);
}

function positionMenu(pop, btn) {
  pop.style.display = "block";
  pop.style.visibility = "hidden";

  const pad = 8;
  const button = btn?.getBoundingClientRect?.();

  let top = pad;
  let right = pad;

  if (button && button.width > 0 && button.height > 0) {
    top = button.bottom + 8;
    right = window.innerWidth - button.right;
  }

  const h = pop.offsetHeight || 260;
  const w = pop.offsetWidth || 280;

  if (button && top + h > window.innerHeight - pad) {
    top = button.top - h - 8;
  }

  top = Math.max(pad, Math.min(Math.max(pad, window.innerHeight - h - pad), top));
  right = Math.max(pad, Math.min(Math.max(pad, window.innerWidth - w - pad), right));

  pop.style.top = `${Math.round(top)}px`;
  pop.style.right = `${Math.round(right)}px`;
  pop.style.left = "auto";
  pop.style.visibility = "visible";
}

function openMenu(btn) {
  renderBody();
  const pop = ensurePopover();
  positionMenu(pop, btn);
  btn?.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true);
}

function closeMenu() {
  const pop = document.getElementById(POP_ID);
  if (pop) pop.style.display = "none";
  document.getElementById(BTN_ID)?.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onReposition);
  window.removeEventListener("scroll", onReposition, true);
}

function toggleMenu(btn) {
  const pop = document.getElementById(POP_ID);
  if (pop && pop.style.display !== "none") {
    closeMenu();
  } else {
    openMenu(btn);
  }
}

function onKey(ev) {
  if (ev.key === "Escape") closeMenu();
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
