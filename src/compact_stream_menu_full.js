// compact_stream_menu_full.js — overrides the compact stream button with the full stable menu.
const BTN_ID = "nested-notes-open-stream-menu-btn";
const POP_ID = "nested-notes-stream-menu-popover";
const INPUT_ID = "talmud-streams-input";
const MAX_STREAMS = 2;

const GROUPS = [
  ["חלוניות", [
    ["+ חלונית", [/^\+?\s*חלונית\s*$/, /הוסף.*חלונית/, /חלונית.*חדשה/, /add.*pane/i, /new.*pane/i]],
    ["✕ הסר חלונית", [/הסר.*חלונית/, /מחק.*חלונית/, /remove.*pane/i, /delete.*pane/i]],
    ["✂ פצל לחלוניות", [/פצל.*חלוניות/, /פצל.*חלונית/, /split.*pane/i]],
    ["✂ הפרד הערות", [/הפרד.*הערות/, /separate.*notes/i]],
    ["🔗 מזג / פרק", [/מזג.*פרק/, /פרק.*מזג/, /מזג/, /פרק/, /merge/i, /unlink/i]],
    ["⤺ אחד", [/חלונית אחת/, /^\s*אחד\s*$/, /single/i]],
  ]],
  ["תצוגה וכלים", [
    ["תצוגה", [/^\s*תצוגה\s*$/, /view/i]],
    ["⚙ כלים", [/^\s*כלים\s*$/, /tools/i]],
    ["🔗 גלילה", [/גלילה/, /scroll/i]],
    ["▥ זרמים לרוחב", [/זרמים.*לרוחב/, /לרוחב.*זרמים/, /horizontal.*streams/i]],
    ["☷ שורות", [/שורות/, /lines/i]],
    ["↺ איפוס", [/איפוס/, /אפס/, /reset/i]],
  ]],
];

function textOf(el) {
  if (!el) return "";
  return [el.textContent || "", el.value || "", el.title || "", el.getAttribute?.("aria-label") || "", el.id || ""]
    .join(" ").replace(/\s+/g, " ").trim();
}

function visible(el) {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  try {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch (_) {
    return true;
  }
}

function inMenu(el) {
  return !!(document.getElementById(POP_ID)?.contains(el) || document.getElementById(BTN_ID)?.contains(el));
}

function candidates() {
  return Array.from(document.querySelectorAll("button,[role='button'],input[type='button'],input[type='submit'],input[type='checkbox'],label,a[href],summary"))
    .filter((el) => el instanceof HTMLElement && !inMenu(el) && visible(el));
}

function findControl(patterns) {
  return candidates().find((el) => {
    const t = textOf(el);
    return t && patterns.some((p) => p.test(t));
  }) || null;
}

function selectedCodes() {
  const input = document.getElementById(INPUT_ID);
  return input ? (input.value.match(/\d{2}/g) || []) : [];
}

function availableCodes() {
  const codes = new Set();
  document.querySelectorAll(".stream[data-stream],[data-stream]").forEach((el) => {
    const c = el.getAttribute("data-stream");
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });
  if (!codes.size) for (let i = 1; i <= 10; i += 1) codes.add(String(i).padStart(2, "0"));
  return Array.from(codes).sort();
}

function setSelected(codes) {
  const input = document.getElementById(INPUT_ID);
  if (!input) return;
  input.value = codes.slice(0, MAX_STREAMS).sort().join(",");
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickOriginal(el) {
  if (!el) return;
  const target = el instanceof HTMLLabelElement && el.control ? el.control : el;
  target.click?.();
  target.dispatchEvent?.(new Event("input", { bubbles: true }));
  target.dispatchEvent?.(new Event("change", { bubbles: true }));
}

function ensurePopover() {
  let pop = document.getElementById(POP_ID);
  if (!pop) {
    pop = document.createElement("div");
    pop.id = POP_ID;
    pop.dir = "rtl";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "תפריט זרמים");
    document.body.appendChild(pop);
  }
  pop.style.cssText = [
    "position:fixed",
    "z-index:10030",
    "display:none",
    "min-width:320px",
    "max-width:min(440px,calc(100vw - 16px))",
    "max-height:min(74vh,580px)",
    "overflow:auto",
    "box-sizing:border-box",
    "padding:10px",
    "border:1px solid rgba(0,0,0,.16)",
    "border-radius:12px",
    "background:var(--rt-surface,#fff)",
    "color:var(--rt-text,#222)",
    "box-shadow:0 10px 28px rgba(0,0,0,.20)",
    "font-size:12px",
  ].join(";");
  return pop;
}

function section(title) {
  const d = document.createElement("div");
  d.textContent = title;
  d.style.cssText = "font-weight:700;font-size:11px;opacity:.78;margin:9px 0 5px";
  return d;
}

function actionButton(label, patterns) {
  const original = findControl(patterns);
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.disabled = !original;
  b.title = original ? label : `${label} — לא נמצא כרגע במסך`;
  b.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "gap:4px",
    "min-height:28px",
    "padding:5px 8px",
    "border-radius:9px",
    "border:1px solid rgba(0,0,0,.12)",
    original ? "background:rgba(0,0,0,.035);color:inherit;cursor:pointer" : "background:rgba(0,0,0,.025);color:rgba(120,120,120,.65);cursor:not-allowed",
    "font:inherit",
    "font-size:12px",
  ].join(";");
  if (original) b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    clickOriginal(original);
    setTimeout(render, 80);
  });
  return b;
}

function renderActions(parent) {
  GROUPS.forEach(([title, actions]) => {
    parent.appendChild(section(title));
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-bottom:4px";
    actions.forEach(([label, patterns]) => grid.appendChild(actionButton(label, patterns)));
    parent.appendChild(grid);
  });
}

function renderStreams(parent) {
  parent.appendChild(section("זרמים"));
  const cur = selectedCodes();
  const chips = document.createElement("div");
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px";
  availableCodes().forEach((code) => {
    const on = cur.includes(code);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = on ? `✓ ${code}` : code;
    chip.style.cssText = [
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
      const next = cur.includes(code) ? cur.filter((c) => c !== code) : (cur.length >= MAX_STREAMS ? [...cur.slice(1), code] : [...cur, code]);
      setSelected(next);
      render();
    });
    chips.appendChild(chip);
  });
  const current = document.createElement("div");
  current.textContent = cur.length ? `נבחרו: ${cur.join(", ")}` : "לא נבחרו זרמים";
  current.style.cssText = "border-top:1px solid rgba(0,0,0,.10);padding-top:7px;opacity:.72;font-size:11px";
  parent.append(chips, current);
}

function renderHelp(parent) {
  parent.appendChild(section("זיהוי וקיצורים"));
  const help = document.createElement("div");
  help.textContent = "@01 בכל מקום מזוהה אוטומטית • Tab בתוך @NN לקפיצה • הערה על הערה: @02 בתוך הערת @01";
  help.style.cssText = "border:1px solid rgba(0,0,0,.10);border-radius:9px;padding:7px 8px;background:rgba(0,0,0,.025);font-size:11px;line-height:1.5;opacity:.82";
  parent.appendChild(help);
}

function render() {
  const pop = ensurePopover();
  pop.innerHTML = "";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px";
  const title = document.createElement("strong");
  title.textContent = "🌊 תפריט זרמים";
  const space = document.createElement("span");
  space.style.flex = "1";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.title = "סגור";
  close.style.cssText = "border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:inherit;padding:0 2px";
  close.addEventListener("click", closeMenu);
  const body = document.createElement("div");
  header.append(title, space, close);
  pop.append(header, body);
  renderActions(body);
  renderStreams(body);
  renderHelp(body);
}

function position(btn) {
  const pop = ensurePopover();
  pop.style.display = "block";
  pop.style.visibility = "hidden";
  const pad = 8;
  const r = btn?.getBoundingClientRect?.();
  const h = pop.offsetHeight || 420;
  const w = pop.offsetWidth || 340;
  let top = r ? r.bottom + 8 : pad;
  let right = r ? window.innerWidth - r.right : pad;
  if (r && top + h > window.innerHeight - pad) top = r.top - h - 8;
  top = Math.max(pad, Math.min(Math.max(pad, window.innerHeight - h - pad), top));
  right = Math.max(pad, Math.min(Math.max(pad, window.innerWidth - w - pad), right));
  pop.style.top = `${Math.round(top)}px`;
  pop.style.right = `${Math.round(right)}px`;
  pop.style.left = "auto";
  pop.style.visibility = "visible";
}

function openMenu(btn) {
  render();
  position(btn);
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

function onKey(ev) {
  if (ev.key === "Escape") closeMenu();
}

function onReposition() {
  const pop = document.getElementById(POP_ID);
  const btn = document.getElementById(BTN_ID);
  if (pop && pop.style.display !== "none") position(btn);
}

document.addEventListener("click", (ev) => {
  const btn = ev.target?.closest?.(`#${BTN_ID}`);
  if (!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  const pop = document.getElementById(POP_ID);
  if (pop && pop.style.display !== "none") closeMenu();
  else openMenu(btn);
}, true);
