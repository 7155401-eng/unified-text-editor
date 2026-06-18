const B = "nested-notes-open-stream-menu-btn";
const P = "nested-notes-stream-menu-popover";
const I = "talmud-streams-input";
const MAX = 2;
const FULL_WRAP = "nested-notes-stream-menu-actions-wrap";

let installed = false;

const groups = [
  ["חלוניות", [
    ["+ חלונית", "pane-add"],
    ["✕ הסר חלונית", "pane-remove"],
    ["✂ פצל לחלוניות", "split-to-panes"],
    ["✂ הפרד הערות", "split-special-notes"],
    ["מזג / פרק", "merge-toggle"],
    ["⤺ אחד", "merge-from-panes"]
  ]],
  ["תצוגה וכלים", [
    ["תצוגה", "tab:view"],
    ["⚙ כלים", "tools-toggle"],
    ["גלילה", "sync-toggle"],
    ["▥ זרמים לרוחב", "pane-layout-toggle"],
    ["☷ שורות", "lines-toggle"],
    ["↺ איפוס", "pane-clear-storage"]
  ]]
];

const $ = id => document.getElementById(id);
const qa = selector => Array.from(document.querySelectorAll(selector));

function txt(el) {
  return [
    el?.textContent,
    el?.value,
    el?.title,
    el?.getAttribute?.("aria-label"),
    el?.id
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function vis(el) {
  try {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  } catch (_) {
    return false;
  }
}

function mine(el) {
  return !!($(B)?.contains(el) || $(P)?.contains(el) || $(FULL_WRAP)?.contains(el));
}

function controls() {
  return qa("button,[role='button'],input[type='button'],input[type='submit'],input[type='checkbox'],input[type='radio'],select,label,summary,a[href]")
    .filter(el => vis(el) && !mine(el));
}

function anchor() {
  const textAnchor = controls().find(el => {
    const t = txt(el);
    return t.includes("הערות להערות") ||
      /הצג.*הערות.*להערות/.test(t) ||
      /תמיכה.*הערות.*להערות/.test(t);
  });
  if (textAnchor) return textAnchor;

  const picker = $("talmud-stream-picker");
  if (picker && vis(picker)) return picker;

  const add = $("talmud-add-stream-btn");
  if (add && vis(add)) return add;

  return document.querySelector(".source-stream-toolbar") ||
    document.querySelector(".panes-toolbar") ||
    null;
}

function hostForAnchor(a) {
  if (!a) return null;
  if (a.matches?.(".source-stream-toolbar,.panes-toolbar")) return a;
  return a.parentElement;
}

function msg(text) {
  const status = $("stream-menu-status");
  if (status) status.textContent = text || "";
}

function runCmd(cmd, label) {
  if (cmd.startsWith("tab:")) {
    const tab = cmd.slice(4);
    const button = document.querySelector(`.ribbon-tab[data-ribbon-tab="${tab}"]`);
    if (button) {
      button.click();
      msg(`נפתח: ${label}`);
      return true;
    }
    msg(`כרטיסיית ${label} עדיין לא זמינה`);
    return false;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.cmd = cmd;
  button.textContent = label;
  button.style.cssText = "position:fixed;right:-9999px;bottom:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(button);

  try {
    button.click();
    msg(`נשלח: ${label}`);
    return true;
  } finally {
    setTimeout(() => button.remove(), 0);
  }
}

function codes() {
  const set = new Set();
  qa(".stream[data-stream],[data-stream]").forEach(el => {
    const code = el.getAttribute("data-stream");
    if (/^\d{2}$/.test(code || "")) set.add(code);
  });
  if (!set.size) {
    for (let i = 1; i <= 10; i++) set.add(String(i).padStart(2, "0"));
  }
  return [...set].sort();
}

function selected() {
  const input = $(I);
  return input ? (input.value.match(/\d{2}/g) || []) : [];
}

function setSel(values) {
  const input = $(I);
  if (!input) return;

  input.value = values.slice(0, MAX).sort().join(",");
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  msg(input.value ? `נבחרו זרמים: ${input.value}` : "לא נבחרו זרמים");
}

function open() {
  const popover = $(P);
  return !!(popover && popover.style.display !== "none");
}

function placeBtn() {
  const button = $(B);
  if (!button) return;

  if (button.parentElement?.id === FULL_WRAP) {
    button.hidden = false;
    button.style.position = "static";
    button.style.zIndex = "auto";
    button.style.top = "auto";
    button.style.right = "auto";
    button.style.left = "auto";
    button.style.bottom = "auto";
    return;
  }

  const a = anchor();
  const host = hostForAnchor(a);

  if (!a || !host) {
    button.hidden = true;
    if (!button.isConnected) document.body.appendChild(button);
    return;
  }

  button.hidden = false;

  if (a.matches?.(".source-stream-toolbar,.panes-toolbar")) {
    if (!a.contains(button)) a.appendChild(button);
  } else if (button.parentElement !== host || button.previousElementSibling !== a) {
    a.insertAdjacentElement("afterend", button);
  }

  button.style.position = "static";
  button.style.zIndex = "auto";
  button.style.top = "auto";
  button.style.right = "auto";
  button.style.left = "auto";
  button.style.bottom = "auto";
  button.style.transform = "none";
  button.style.marginInlineStart = "6px";
  button.style.verticalAlign = "middle";
}

function button() {
  let b = $(B);
  if (!b) {
    b = document.createElement("button");
    b.id = B;
    b.type = "button";
    b.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    };
  }

  b.textContent = "פתח תפריט זרמים";
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-expanded", open() ? "true" : "false");
  b.style.cssText = [
    "position:static",
    "z-index:auto",
    "display:inline-flex",
    "align-items:center",
    "gap:5px",
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
    "pointer-events:auto"
  ].join(";");

  placeBtn();
}

function pop() {
  let p = $(P);
  if (!p) {
    p = document.createElement("div");
    p.id = P;
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
    "width:min(760px,calc(100vw - 16px))",
    "max-height:min(82vh,680px)",
    "overflow:hidden",
    "border:1px solid rgba(0,0,0,.16)",
    "border-radius:14px",
    "background:var(--rt-surface,#fff)",
    "color:var(--rt-text,#222)",
    "box-shadow:0 12px 32px rgba(0,0,0,.22)",
    "font-size:12px",
    "pointer-events:auto",
    "box-sizing:border-box"
  ].join(";");
  return p;
}

function closeBtn(text) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.style.cssText = "border:1px solid rgba(0,0,0,.14);border-radius:10px;background:rgba(0,0,0,.045);color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:7px 12px;min-height:32px";
  b.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  return b;
}

function title(text) {
  const div = document.createElement("div");
  div.textContent = text;
  div.style.cssText = "font-weight:700;font-size:12px;opacity:.78;margin:10px 0 6px";
  return div;
}

function grid() {
  const div = document.createElement("div");
  div.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px";
  return div;
}

function act(action) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = action[0];
  b.style.cssText = "display:inline-flex;align-items:center;justify-content:center;min-height:31px;padding:6px 8px;border-radius:9px;border:1px solid rgba(0,0,0,.12);background:rgba(0,0,0,.035);color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap";
  b.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    runCmd(action[1], action[0]);
    setTimeout(render, 120);
  };
  return b;
}

function render() {
  const p = pop();
  p.innerHTML = "";

  const head = document.createElement("div");
  head.style.cssText = "flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.10);background:var(--rt-surface,#fff)";
  head.innerHTML = "<strong style='font-size:13px'>תפריט זרמים</strong><span style='flex:1'></span>";
  head.appendChild(closeBtn("× סגור"));

  const body = document.createElement("div");
  body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:10px 12px 12px;scrollbar-gutter:stable";
  body.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
  body.addEventListener("touchmove", event => event.stopPropagation(), { passive: true });

  groups.forEach(group => {
    body.appendChild(title(group[0]));
    const gr = grid();
    group[1].forEach(action => gr.appendChild(act(action)));
    body.appendChild(gr);
  });

  body.appendChild(title("זרמים"));
  const input = $(I);
  const hint = document.createElement("div");
  hint.textContent = input ? `בחר עד ${MAX} זרמים להצגה בחלוניות.` : "בקר הזרמים עדיין לא נטען במסך הזה.";
  hint.style.cssText = "opacity:.72;margin:0 0 8px;font-size:11px";
  body.appendChild(hint);

  if (input) {
    const cur = selected();
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px";
    codes().forEach(code => {
      const on = cur.includes(code);
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = on ? `✓ ${code}` : code;
      x.style.cssText = [
        "min-width:38px",
        "padding:5px 9px",
        "border-radius:999px",
        "border:1px solid rgba(0,0,0,.12)",
        on ? "background:var(--rt-accent,#2c5aa0);color:#fff" : "background:rgba(0,0,0,.035);color:inherit",
        "font:inherit",
        "font-size:12px",
        "cursor:pointer"
      ].join(";");
      x.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        setSel(on ? cur.filter(value => value !== code) : (cur.length >= MAX ? [...cur.slice(1), code] : [...cur, code]));
        render();
      };
      wrap.appendChild(x);
    });
    body.appendChild(wrap);
  }

  body.appendChild(title("זיהוי וקיצורים"));
  const help = document.createElement("div");
  help.textContent = "@01 בכל מקום מזוהה אוטומטית • Tab בתוך @NN לקפיצה • הערה על הערה: @02 בתוך הערת @01";
  help.style.cssText = "border:1px solid rgba(0,0,0,.10);border-radius:10px;padding:7px 8px;background:rgba(0,0,0,.025);font-size:11px;line-height:1.45;opacity:.82";
  body.appendChild(help);

  const status = document.createElement("div");
  status.id = "stream-menu-status";
  status.style.cssText = "margin-top:9px;opacity:.74;font-size:11px;min-height:1.4em";
  body.appendChild(status);

  const foot = document.createElement("div");
  foot.style.cssText = "flex:0 0 auto;display:flex;justify-content:flex-start;padding:9px 12px;border-top:1px solid rgba(0,0,0,.10);background:var(--rt-surface,#fff)";
  foot.appendChild(closeBtn("סגור תפריט"));

  p.append(head, body, foot);
}

function pos() {
  const p = pop();
  const b = $(B);
  const rect = b?.getBoundingClientRect?.();
  const pad = 8;

  p.style.display = "flex";
  p.style.visibility = "hidden";

  const h = p.offsetHeight || 520;
  const w = p.offsetWidth || 720;
  let top = rect ? rect.bottom + 8 : pad;
  let right = rect ? innerWidth - rect.right : pad;

  if (rect && top + h > innerHeight - pad) top = rect.top - h - 8;

  top = Math.max(pad, Math.min(innerHeight - h - pad, top));
  right = Math.max(pad, Math.min(innerWidth - w - pad, right));

  p.style.top = `${Math.round(top)}px`;
  p.style.right = `${Math.round(right)}px`;
  p.style.left = "auto";
  p.style.visibility = "visible";
}

function show() {
  placeBtn();
  render();
  pos();
  $(B)?.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", key, true);
  addEventListener("resize", repos);
}

function close() {
  const p = $(P);
  if (p) p.style.display = "none";
  $(B)?.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", key, true);
  removeEventListener("resize", repos);
}

function toggle() {
  open() ? close() : show();
}

function key(event) {
  if (event.key === "Escape") close();
}

function repos() {
  placeBtn();
  if (open()) pos();
}

export function installCompactStreamMenuButton() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const run = () => button();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  [0, 300, 1000, 2500, 5000].forEach(ms => setTimeout(run, ms));
  addEventListener("resize", placeBtn);
  addEventListener("scroll", placeBtn, true);
}

installCompactStreamMenuButton();
