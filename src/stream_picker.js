// stream_picker.js — visual UI for selecting streams (instead of text input).
// Replaces manual stream-code input with chip-based picker.
// Default: first 2 streams of the document. + button adds more.

import { findAllStreamMarks } from "./stream_mark.js";

const HIDDEN_INPUT_ID = "talmud-streams-input";
const PICKER_ID = "talmud-stream-picker";
const ADD_BTN_ID = "talmud-add-stream-btn";
const TALMUD_MAX_STREAMS = 2;

let wiredPaneManager = null;

function normalizeStreamCode(code) {
  const raw = String(code ?? "").trim();
  if (/^\d{1,3}$/.test(raw)) return raw.padStart(2, "0");
  const match = raw.match(/\d{1,3}/);
  return match ? match[0].padStart(2, "0") : null;
}

function getAvailableStreamCodes() {
  // Try to find streams in the editor, rendered output, or existing panes.
  const codes = new Set();
  document.querySelectorAll(".stream[data-stream], [data-stream]").forEach(el => {
    const c = normalizeStreamCode(el.getAttribute("data-stream"));
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });

  const panes = window.paneManager?.panes || [];
  panes.forEach(pane => {
    const c = normalizeStreamCode(pane?.streamCode);
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });

  // Fallback: 01-10
  if (codes.size === 0) for (let i = 1; i <= 10; i++) codes.add(String(i).padStart(2, "0"));
  return Array.from(codes).sort();
}

function getCurrentSelected() {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return [];
  const seen = new Set();
  const selected = [];
  for (const raw of (input.value.match(/\d{1,3}/g) || [])) {
    const code = normalizeStreamCode(raw);
    if (code && /^\d{2}$/.test(code) && !seen.has(code)) {
      seen.add(code);
      selected.push(code);
    }
  }
  return selected;
}

function setSelected(codes) {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return;
  // Hard cap at TALMUD_MAX_STREAMS (2). Any extras are truncated.
  // משה 2026-05-10: מיון עולה — קוד נמוך = ימני, גבוה = שמאלי (סדר וילנא קלאסי).
  const capped = codes
    .map(normalizeStreamCode)
    .filter(Boolean)
    .slice(0, TALMUD_MAX_STREAMS)
    .slice()
    .sort();

  input.value = capped.join(",");
  // Trigger change event so existing listeners pick up.
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    window.dispatchEvent(new CustomEvent("ravtext:stream-picker-changed", { detail: { streams: capped } }));
  } catch (_) {}
  schedulePaneSync();
}

function isVisiblePaneElement(el) {
  return !!el && el.classList?.contains("pane") && !el.hidden;
}

function refreshStreamResizers(manager) {
  const container = manager?.container || document.getElementById("panes-container");
  if (!container) return;

  const visibleStreamCount = (manager.panes || [])
    .filter(pane => pane?.streamCode && pane?.element && !pane.element.hidden)
    .length;

  container.querySelectorAll(".main-stream-resizer, .resizer").forEach(resizer => {
    if (resizer.classList.contains("main-stream-resizer")) {
      resizer.hidden = visibleStreamCount === 0;
      return;
    }

    const prev = resizer.previousElementSibling;
    const next = resizer.nextElementSibling;
    resizer.hidden = !(isVisiblePaneElement(prev) && isVisiblePaneElement(next));
  });
}

function syncSelectedStreamPanes() {
  const manager = window.paneManager;
  if (!manager || !Array.isArray(manager.panes)) return;

  const selected = new Set(getCurrentSelected());
  const streamPanes = manager.panes.filter(pane => pane?.streamCode && pane?.element);
  if (streamPanes.length === 0) return;

  const shouldFilter = selected.size > 0;
  let changed = false;

  for (const pane of streamPanes) {
    const code = normalizeStreamCode(pane.streamCode);
    const shouldShow = !shouldFilter || selected.has(code);
    if (pane.element.hidden !== !shouldShow) {
      pane.element.hidden = !shouldShow;
      pane.element.classList.toggle("stream-pane-filtered-out", !shouldShow);
      changed = true;
    }
  }

  refreshStreamResizers(manager);

  try { window.__ravtextApplyPaneWidths?.(); } catch (_) {}
  try { window.__ravtextRerender?.(); } catch (_) {}

  if (changed && shouldFilter) {
    const status = document.getElementById("status");
    if (status) status.textContent = `מוצגות חלוניות זרמים: ${Array.from(selected).sort().join(", ")}`;
  }
}

function wirePaneManagerSync() {
  const manager = window.paneManager;
  if (!manager || manager === wiredPaneManager || typeof manager.on !== "function") return;
  manager.on("change", schedulePaneSync);
  wiredPaneManager = manager;
}

function schedulePaneSync() {
  clearTimeout(schedulePaneSync._t);
  schedulePaneSync._t = setTimeout(() => {
    wirePaneManagerSync();
    syncSelectedStreamPanes();
  }, 0);
}

function renderPicker() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  // משה 2026-05-10: עדכון מצב הכפתור בכל renderPicker — ערך הקלט נטען מ-localStorage
  // אחרי setupStreamPicker (talmud_controls מאוחר יותר), בלי dispatch של change.
  // כל קריאה ל-renderPicker עכשיו תעדכן גם את הכפתור.
  updateAddButtonState();
  const selected = getCurrentSelected();
  const available = getAvailableStreamCodes();

  picker.innerHTML = "";
  // Render selected as chips
  selected.forEach((code, idx) => {
    const chip = document.createElement("span");
    chip.className = "stream-chip stream-chip-selected";
    chip.style.cssText = `
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; margin: 2px; border-radius: 12px;
      background: var(--rt-accent, #2c5aa0); color: #fff;
      font-size: 12px; cursor: pointer;
    `;
    const label = document.createElement("span");
    label.textContent = code;
    chip.appendChild(label);
    const remove = document.createElement("span");
    remove.textContent = "×";
    remove.style.cssText = "cursor: pointer; font-weight: bold; opacity: 0.8;";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      const newSel = selected.filter(c => c !== code);
      setSelected(newSel);
      renderPicker();
    });
    chip.appendChild(remove);

    // Click chip → cycle through unused codes
    chip.addEventListener("click", () => {
      const unused = available.filter(c => !selected.includes(c) || c === code);
      if (unused.length === 0) return;
      const curIdx = unused.indexOf(code);
      const nextCode = unused[(curIdx + 1) % unused.length];
      const newSel = [...selected];
      newSel[idx] = nextCode;
      setSelected(newSel);
      renderPicker();
    });

    picker.appendChild(chip);
  });
}

function addStream() {
  const selected = getCurrentSelected();
  if (selected.length >= TALMUD_MAX_STREAMS) {
    // Talmud (גפ"ת) is hard-capped at 2 streams.
    return;
  }
  const available = getAvailableStreamCodes();
  const unused = available.filter(c => !selected.includes(c));
  if (unused.length === 0) return;
  const newSel = [...selected, unused[0]];
  setSelected(newSel);
  renderPicker();
}

function updateAddButtonState() {
  const btn = document.getElementById(ADD_BTN_ID);
  if (!btn) return;
  const selected = getCurrentSelected();
  // משה 2026-05-10: בגפ"ת תמיד בדיוק 2 זרמים, אז הכפתור "+" מיותר. מסתירים
  // אותו לחלוטין כשיש 2. אם פחות מ-2 (ברירת מחדל ממילא ממלאת ל-2), הוא נראה.
  if (selected.length >= TALMUD_MAX_STREAMS) {
    btn.style.display = "none";
  } else {
    btn.style.display = "";
    btn.disabled = false;
    btn.style.opacity = "";
    btn.title = "הוסף זרם";
  }
}

function defaultsIfEmpty() {
  // משה 2026-05-13: בדיקה כפולה — גם getCurrentSelected (שדה ה-input) וגם localStorage.
  // אם talmud_controls עדיין לא טען את הערך לשדה, ה-localStorage כבר יכיל אותו,
  // ואנחנו לא רוצים לדרוס. זה פותר את הבאג של בחירה שחוזרת לברירת מחדל אחרי רענון.
  const selected = getCurrentSelected();
  if (selected.length > 0) return;
  try {
    const stored = localStorage.getItem("ravtext.talmudLayout.streams") || "";
    if (stored.match(/\d{2}/g)) return;
  } catch (_) {}
  const avail = getAvailableStreamCodes();
  if (avail.length >= 2) {
    setSelected([avail[0], avail[1]]);
    renderPicker();
  }
}

export function setupStreamPicker() {
  const picker = document.getElementById(PICKER_ID);
  const addBtn = document.getElementById(ADD_BTN_ID);
  if (!picker || !addBtn) return;

  const renderAndSync = () => {
    renderPicker();
    updateAddButtonState();
    schedulePaneSync();
  };

  // Initial render
  renderAndSync();

  // משה 2026-05-10: רנדור נוסף אחרי 100ms לתפוס מצב שערך הקלט נטען מ-localStorage
  // ע"י talmud_controls שרץ אחרי setupStreamPicker.
  setTimeout(renderAndSync, 100);
  setTimeout(renderAndSync, 500);
  setTimeout(renderAndSync, 1200);

  // Re-render when input changes externally
  document.getElementById(HIDDEN_INPUT_ID)?.addEventListener("change", renderAndSync);
  document.getElementById(HIDDEN_INPUT_ID)?.addEventListener("input", schedulePaneSync);

  addBtn.addEventListener("click", () => {
    addStream();
    updateAddButtonState();
    schedulePaneSync();
  });

  // After render, fill defaults if empty
  setTimeout(() => {
    defaultsIfEmpty();
    schedulePaneSync();
  }, 1500);

  // Re-render whenever pages re-render (new stream codes available)
  const observer = new MutationObserver(() => {
    // Debounce
    clearTimeout(observer._t);
    observer._t = setTimeout(renderAndSync, 300);
  });
  const pagesContainer = document.getElementById("pages-container");
  if (pagesContainer) observer.observe(pagesContainer, { childList: true, subtree: true });
}
