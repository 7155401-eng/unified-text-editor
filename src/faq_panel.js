// faq_panel.js — חלון "שאלות נפוצות".
//
// ★ משה: "להוסיף לאייקונים למעלה שאלות נפוצות".
//
// מאיפה התוכן: מטקסטי העזרה שכבר קיימים באתר (personal_help_manual_copy.js) —
// אותם הסברים בדיוק שמופיעים כשמרחפים מעל כפתור. לא נכתב כאן שום הסבר חדש,
// כדי שלא ייווצרו שני נוסחים שסותרים זה את זה.
//
// הכול רץ על פעולה של המשתמש בלבד: החלון נבנה בלחיצה הראשונה ונשאר בזיכרון.
// אין כאן טיימר, אין מעקב אחרי הדף, ואין כתיבה אוטומטית לשום מקום.

import { HELP } from "./personal_help_manual_copy.js";

const PANEL_ID = "rt-faq-panel";
const STYLE_ID = "rt-faq-panel-style";

let panel = null;
let searchInput = null;
let listEl = null;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
    #${PANEL_ID} {
      position: fixed;
      inset-block-start: 64px;
      /* ⚠️ נמדד בבדיקה: עם inset-inline-start הדף בעברית דוחף את החלון
         שמאלה עד x=-90, וכפתור הסגירה יוצא מהמסך. לכן מרכוז פיזי, שאינו
         תלוי בכיוון הכתיבה. */
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147482500;
      width: min(560px, 92vw);
      max-height: min(72vh, 680px);
      display: none;
      flex-direction: column;
      background: #fff;
      color: #1f2937;
      border: 1px solid rgba(0,0,0,.14);
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(15,23,42,.24);
      direction: rtl;
      text-align: right;
      font: 13px/1.6 "Segoe UI", system-ui, sans-serif;
      overflow: hidden;
    }
    #${PANEL_ID}.is-open { display: flex; }
    #${PANEL_ID} .rt-faq-head {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,.08);
    }
    #${PANEL_ID} .rt-faq-title { font-weight: 700; font-size: 15px; }
    #${PANEL_ID} .rt-faq-spacer { flex: 1; }
    #${PANEL_ID} .rt-faq-close {
      border: 0; background: rgba(0,0,0,.06); border-radius: 8px;
      padding: 5px 12px; cursor: pointer; font: inherit;
    }
    #${PANEL_ID} .rt-faq-close:hover { background: rgba(0,0,0,.12); }
    #${PANEL_ID} .rt-faq-search {
      margin: 10px 14px 4px; padding: 8px 12px; font: inherit;
      border: 1px solid rgba(0,0,0,.16); border-radius: 8px; width: calc(100% - 28px);
      box-sizing: border-box;
    }
    #${PANEL_ID} .rt-faq-count { padding: 2px 14px 8px; font-size: 11.5px; opacity: .65; }
    #${PANEL_ID} .rt-faq-list { overflow: auto; padding: 0 14px 14px; }
    #${PANEL_ID} .rt-faq-item {
      padding: 9px 0; border-bottom: 1px solid rgba(0,0,0,.06);
    }
    #${PANEL_ID} .rt-faq-item:last-child { border-bottom: 0; }
    #${PANEL_ID} .rt-faq-q { font-weight: 700; margin-bottom: 2px; }
    #${PANEL_ID} .rt-faq-a { opacity: .88; }
    #${PANEL_ID} .rt-faq-empty { padding: 18px 0; opacity: .7; text-align: center; }
    body[data-theme="dark"] #${PANEL_ID} {
      background: #23232a; color: #e9e9ee; border-color: rgba(255,255,255,.14);
    }
    body[data-theme="dark"] #${PANEL_ID} .rt-faq-search {
      background: #2d2d35; color: #e9e9ee; border-color: rgba(255,255,255,.18);
    }
  `;
  document.head.appendChild(st);
}

// שאלה + תשובה לכל ערך עזרה. השאלה נבנית משם הפריט, התשובה היא ההסבר
// שכבר כתוב באתר — מילה במילה.
function entries() {
  const out = [];
  const seen = new Set();
  for (const key of Object.keys(HELP || {})) {
    const pair = HELP[key];
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const name = String(pair[0] || "").trim();
    const text = String(pair[1] || "").trim();
    if (!name || !text || seen.has(name)) continue;
    seen.add(name);
    out.push({ q: `מה עושה "${name}"?`, a: text, hay: (name + " " + text).toLowerCase() });
  }
  out.sort((a, b) => a.q.localeCompare(b.q, "he"));
  return out;
}

let allEntries = null;

function render(filter) {
  if (!listEl) return;
  const q = String(filter || "").trim().toLowerCase();
  const rows = q ? allEntries.filter(e => e.hay.includes(q)) : allEntries;
  listEl.textContent = "";
  const count = panel.querySelector(".rt-faq-count");
  if (count) {
    count.textContent = q
      ? `${rows.length} מתוך ${allEntries.length} שאלות`
      : `${allEntries.length} שאלות`;
  }
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "rt-faq-empty";
    empty.textContent = "לא מצאנו שאלה שמתאימה. נסו מילה אחרת.";
    listEl.appendChild(empty);
    return;
  }
  for (const e of rows) {
    const item = document.createElement("div");
    item.className = "rt-faq-item";
    const qEl = document.createElement("div");
    qEl.className = "rt-faq-q";
    qEl.textContent = e.q;
    const aEl = document.createElement("div");
    aEl.className = "rt-faq-a";
    aEl.textContent = e.a;
    item.append(qEl, aEl);
    listEl.appendChild(item);
  }
}

function onKey(ev) {
  if (ev.key === "Escape") closeFaqPanel();
}

function onOutside(ev) {
  if (!panel || !panel.classList.contains("is-open")) return;
  if (panel.contains(ev.target)) return;
  if (ev.target.closest && ev.target.closest("#rt-prem-icon-faq")) return;
  closeFaqPanel();
}

function build() {
  injectStyles();
  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.setAttribute("dir", "rtl");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "שאלות נפוצות");

  const head = document.createElement("div");
  head.className = "rt-faq-head";
  const title = document.createElement("span");
  title.className = "rt-faq-title";
  title.textContent = "שאלות נפוצות";
  const spacer = document.createElement("span");
  spacer.className = "rt-faq-spacer";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "rt-faq-close";
  close.textContent = "× סגור";
  close.addEventListener("click", closeFaqPanel);
  head.append(title, spacer, close);

  searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "rt-faq-search";
  searchInput.placeholder = "חפשו כאן — למשל: רינדור, זרם, ייצוא";
  searchInput.setAttribute("aria-label", "חיפוש בשאלות נפוצות");
  searchInput.addEventListener("input", () => render(searchInput.value));

  const count = document.createElement("div");
  count.className = "rt-faq-count";

  listEl = document.createElement("div");
  listEl.className = "rt-faq-list";

  panel.append(head, searchInput, count, listEl);
  document.body.appendChild(panel);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onOutside, true);
}

export function openFaqPanel() {
  if (!panel) build();
  if (!allEntries) allEntries = entries();
  render(searchInput ? searchInput.value : "");
  panel.classList.add("is-open");
  try { searchInput.focus(); } catch (_) {}
}

export function closeFaqPanel() {
  if (panel) panel.classList.remove("is-open");
}

export function isFaqPanelOpen() {
  return !!(panel && panel.classList.contains("is-open"));
}
