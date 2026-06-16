// stream_picker.js — visual UI for selecting streams.
import { findAllStreamMarks } from "./stream_mark.js";

const HIDDEN_INPUT_ID = "talmud-streams-input";
const PICKER_ID = "talmud-stream-picker";
const ADD_BTN_ID = "talmud-add-stream-btn";
const TALMUD_MAX_STREAMS = 2;

const MENU_BTN_ID = "nested-notes-open-stream-menu-btn";
const MENU_POP_ID = "nested-notes-stream-menu-popover";
let menuInstalled = false;
let menuObserver = null;
let menuReposition = null;
let lastMenuBtn = null;

function streamCodesFromMarks() {
  try {
    const marks = findAllStreamMarks?.() || [];
    return marks.map((m) => String(m?.code || m?.stream || m || "").padStart(2, "0")).filter((c) => /^\d{2}$/.test(c));
  } catch (_) {
    return [];
  }
}

function getAvailableStreamCodes() {
  const codes = new Set(streamCodesFromMarks());
  document.querySelectorAll(".stream[data-stream], [data-stream]").forEach((el) => {
    const c = el.getAttribute("data-stream");
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });
  if (codes.size === 0) for (let i = 1; i <= 10; i += 1) codes.add(String(i).padStart(2, "0"));
  return Array.from(codes).sort();
}

function getCurrentSelected() {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  return input ? (input.value.match(/\d{2}/g) || []) : [];
}

function setSelected(codes) {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return;
  input.value = codes.slice(0, TALMUD_MAX_STREAMS).slice().sort().join(",");
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateAddButtonState() {
  const btn = document.getElementById(ADD_BTN_ID);
  if (!btn) return;
  const full = getCurrentSelected().length >= TALMUD_MAX_STREAMS;
  btn.style.display = full ? "none" : "";
  btn.disabled = full;
  btn.style.opacity = full ? ".45" : "";
  btn.title = full ? "ניתן לבחור עד שני זרמים" : "הוסף זרם";
}

function renderPicker() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  updateAddButtonState();
  const selected = getCurrentSelected();
  const available = getAvailableStreamCodes();
  picker.innerHTML = "";
  selected.forEach((code, idx) => {
    const chip = document.createElement("span");
    chip.className = "stream-chip stream-chip-selected";
    chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:2px 8px;margin:2px;border-radius:12px;background:var(--rt-accent,#2c5aa0);color:#fff;font-size:12px;cursor:pointer";
    const label = document.createElement("span");
    label.textContent = code;
    const remove = document.createElement("span");
    remove.textContent = "×";
    remove.style.cssText = "cursor:pointer;font-weight:bold;opacity:.8";
    remove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setSelected(selected.filter((c) => c !== code));
      renderPicker();
      renderCompactMenuBody();
    });
    chip.addEventListener("click", () => {
      const unused = available.filter((c) => !selected.includes(c) || c === code);
      const cur = unused.indexOf(code);
      const next = unused[(cur + 1) % unused.length];
      const nextSelected = [...selected];
      nextSelected[idx] = next;
      setSelected(nextSelected);
      renderPicker();
      renderCompactMenuBody();
    });
    chip.append(label, remove);
    picker.appendChild(chip);
  });
}

function addStream() {
  const selected = getCurrentSelected();
  if (selected.length >= TALMUD_MAX_STREAMS) return;
  const unused = getAvailableStreamCodes().filter((c) => !selected.includes(c));
  if (!unused.length) return;
  setSelected([...selected, unused[0]]);
  renderPicker();
}

function defaultsIfEmpty() {
  if (getCurrentSelected().length) return;
  try {
    if ((localStorage.getItem("ravtext.talmudLayout.streams") || "").match(/\d{2}/g)) return;
  } catch (_) {}
  const available = getAvailableStreamCodes();
  if (available.length >= 2) {
    setSelected([available[0], available[1]]);
    renderPicker();
  }
}

function textOf(el) {
  if (!el) return "";
  return [el.textContent || "", el.value || "", el.title || "", el.getAttribute?.("aria-label") || "", el.id || "", el.className || ""].join(" ").replace(/\s+/g, " ").trim();
}

function findNestedNotesButton() {
  return Array.from(document.querySelectorAll("button,[role='button'],input[type='button'],input[type='submit'],label")).find((el) => {
    if (!(el instanceof HTMLElement) || el.id === MENU_BTN_ID) return false;
    const t = textOf(el);
    return t.includes("הערות להערות") || /הצג.*הערות.*להערות/.test(t);
  }) || null;
}

function paneAnchor() {
  return document.getElementById("panes-container")
    || document.getElementById("pane-container")
    || document.querySelector("[data-pane-container]")
    || document.querySelector(".panes-container,.pane-container,.panes-shell,.pane-layout,.pane-stack,.panes")
    || document.getElementById("pages-container");
}

function ensureMenuButton() {
  const target = findNestedNotesButton();
  const fallback = document.getElementById(ADD_BTN_ID) || document.getElementById(PICKER_ID);
  const anchor = target || fallback;
  if (!(anchor instanceof HTMLElement)) return false;
  let btn = document.getElementById(MENU_BTN_ID);
  if (!btn) {
    btn = document.createElement("button");
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleCompactMenu(btn);
    });
  }
  btn.type = "button";
  btn.id = MENU_BTN_ID;
  btn.innerHTML = '<span aria-hidden="true">🌊</span><span>פתח תפריט זרמים</span>';
  btn.title = "פתח תפריט זרמים";
  btn.setAttribute("aria-label", "פתח תפריט זרמים");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.style.cssText = "margin-inline-start:6px;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid rgba(44,90,160,.38);background:linear-gradient(180deg,rgba(44,90,160,.12),rgba(44,90,160,.05));color:inherit;font-size:12px;font-weight:600;line-height:1.35;cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08)";
  if (target && btn.previousElementSibling !== target) target.insertAdjacentElement("afterend", btn);
  else if (!target && fallback && btn.nextElementSibling !== fallback) fallback.insertAdjacentElement("beforebegin", btn);
  return true;
}

function ensurePopover() {
  let pop = document.getElementById(MENU_POP_ID);
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = MENU_POP_ID;
  pop.dir = "rtl";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "תפריט זרמים");
  pop.style.cssText = "position:fixed;z-index:10020;display:none;min-width:220px;max-width:min(340px,calc(100vw - 16px));max-height:min(62vh,420px);overflow:auto;box-sizing:border-box;padding:8px;border:1px solid rgba(0,0,0,.16);border-radius:12px;background:var(--rt-surface,#fff);color:var(--rt-text,#222);box-shadow:0 10px 28px rgba(0,0,0,.20);font-size:12px";
  pop.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><strong style="font-size:12px">🌊 תפריט זרמים</strong><span style="flex:1"></span><button type="button" title="סגור" style="border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:inherit;padding:0 2px">×</button></div><div class="nested-notes-stream-menu-body"></div>';
  pop.querySelector("button")?.addEventListener("click", closeCompactMenu);
  document.body.appendChild(pop);
  return pop;
}

function positionMenu(pop, btn) {
  pop.style.display = "block";
  pop.style.visibility = "hidden";
  const pad = 8;
  const pr = paneAnchor()?.getBoundingClientRect?.();
  const br = btn?.getBoundingClientRect?.();
  let top = pad;
  let right = pad;
  if (pr && pr.width > 0 && pr.height > 0) {
    top = pr.top + pad;
    right = Math.max(pad, window.innerWidth - pr.right + pad);
  } else if (br) {
    top = br.bottom + 6;
    right = Math.max(pad, window.innerWidth - br.right);
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

function chipForMenu(code, selected) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = selected ? `✓ ${code}` : code;
  btn.title = selected ? `הסר זרם ${code}` : `בחר זרם ${code}`;
  btn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;min-width:34px;padding:4px 8px;border-radius:999px;border:1px solid rgba(0,0,0,.12);${selected ? "background:var(--rt-accent,#2c5aa0);color:#fff" : "background:rgba(0,0,0,.035);color:inherit"};font:inherit;font-size:12px;cursor:pointer`;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const cur = getCurrentSelected();
    if (cur.includes(code)) setSelected(cur.filter((c) => c !== code));
    else setSelected(cur.length >= TALMUD_MAX_STREAMS ? [...cur.slice(1), code] : [...cur, code]);
    renderPicker();
    updateAddButtonState();
    renderCompactMenuBody();
  });
  return btn;
}

function renderCompactMenuBody() {
  const body = document.querySelector(`#${MENU_POP_ID} .nested-notes-stream-menu-body`);
  if (!body) return;
  const selected = getCurrentSelected();
  const available = getAvailableStreamCodes();
  body.innerHTML = "";
  const hint = document.createElement("div");
  hint.textContent = `בחר עד ${TALMUD_MAX_STREAMS} זרמים להצגה בחלוניות.`;
  hint.style.cssText = "opacity:.72;margin:0 0 8px;font-size:11px";
  const chips = document.createElement("div");
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px";
  available.forEach((code) => chips.appendChild(chipForMenu(code, selected.includes(code))));
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;align-items:center;border-top:1px solid rgba(0,0,0,.10);padding-top:7px";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "+ הוסף זרם";
  add.disabled = selected.length >= TALMUD_MAX_STREAMS;
  add.style.cssText = `border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:5px 8px;background:rgba(0,0,0,.035);color:inherit;font:inherit;font-size:12px;${add.disabled ? "opacity:.45" : "cursor:pointer"}`;
  add.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    addStream();
    updateAddButtonState();
    renderCompactMenuBody();
  });
  const current = document.createElement("span");
  current.textContent = selected.length ? `נבחרו: ${selected.join(", ")}` : "לא נבחרו זרמים";
  current.style.cssText = "opacity:.72;font-size:11px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  actions.append(add, current);
  body.append(hint, chips, actions);
}

function openCompactMenu(btn) {
  lastMenuBtn = btn || lastMenuBtn;
  const pop = ensurePopover();
  renderCompactMenuBody();
  positionMenu(pop, btn);
  btn?.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onMenuKey, true);
  setTimeout(() => document.addEventListener("click", onMenuOutside, true), 0);
  menuReposition = () => {
    const p = document.getElementById(MENU_POP_ID);
    if (p && p.style.display !== "none") positionMenu(p, document.getElementById(MENU_BTN_ID) || lastMenuBtn);
  };
  window.addEventListener("resize", menuReposition);
  window.addEventListener("scroll", menuReposition, true);
}

function closeCompactMenu() {
  const pop = document.getElementById(MENU_POP_ID);
  if (pop) pop.style.display = "none";
  document.getElementById(MENU_BTN_ID)?.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onMenuKey, true);
  document.removeEventListener("click", onMenuOutside, true);
  if (menuReposition) {
    window.removeEventListener("resize", menuReposition);
    window.removeEventListener("scroll", menuReposition, true);
    menuReposition = null;
  }
}

function toggleCompactMenu(btn) {
  const pop = document.getElementById(MENU_POP_ID);
  if (pop && pop.style.display !== "none") closeCompactMenu();
  else openCompactMenu(btn);
}

function onMenuKey(ev) {
  if (ev.key === "Escape") closeCompactMenu();
}

function onMenuOutside(ev) {
  const pop = document.getElementById(MENU_POP_ID);
  const btn = document.getElementById(MENU_BTN_ID);
  if (pop?.contains(ev.target) || btn?.contains(ev.target)) return;
  closeCompactMenu();
}

function installCompactStreamMenuButton() {
  if (menuInstalled || typeof document === "undefined") return;
  menuInstalled = true;
  const run = () => {
    ensureMenuButton();
    if (!menuObserver && document.body) {
      menuObserver = new MutationObserver(() => ensureMenuButton());
      menuObserver.observe(document.body, { childList: true, subtree: true });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  setTimeout(ensureMenuButton, 300);
  setTimeout(ensureMenuButton, 1200);
}

export function setupStreamPicker() {
  const picker = document.getElementById(PICKER_ID);
  const addBtn = document.getElementById(ADD_BTN_ID);
  installCompactStreamMenuButton();
  if (!picker || !addBtn) return;
  renderPicker();
  updateAddButtonState();
  setTimeout(() => { renderPicker(); updateAddButtonState(); }, 100);
  setTimeout(() => { renderPicker(); updateAddButtonState(); }, 500);
  document.getElementById(HIDDEN_INPUT_ID)?.addEventListener("change", () => {
    renderPicker();
    updateAddButtonState();
    renderCompactMenuBody();
  });
  addBtn.addEventListener("click", () => {
    addStream();
    updateAddButtonState();
    renderCompactMenuBody();
  });
  setTimeout(defaultsIfEmpty, 1500);
  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(renderPicker, 300);
  });
  const pagesContainer = document.getElementById("pages-container");
  if (pagesContainer) observer.observe(pagesContainer, { childList: true, subtree: true });
}

installCompactStreamMenuButton();
