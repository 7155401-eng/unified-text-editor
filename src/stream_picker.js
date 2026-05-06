// stream_picker.js — visual UI for selecting streams (instead of text input).
// Replaces manual stream-code input with chip-based picker.
// Default: first 2 streams of the document. + button adds more.

import { findAllStreamMarks } from "./stream_mark.js";

const HIDDEN_INPUT_ID = "talmud-streams-input";
const PICKER_ID = "talmud-stream-picker";
const ADD_BTN_ID = "talmud-add-stream-btn";

function getAvailableStreamCodes() {
  // Try to find streams in the editor or rendered output.
  const codes = new Set();
  document.querySelectorAll(".stream[data-stream], [data-stream]").forEach(el => {
    const c = el.getAttribute("data-stream");
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });
  // Fallback: 01-10
  if (codes.size === 0) for (let i = 1; i <= 10; i++) codes.add(String(i).padStart(2, "0"));
  return Array.from(codes).sort();
}

function getCurrentSelected() {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return [];
  return (input.value.match(/\d{2}/g) || []);
}

function setSelected(codes) {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return;
  input.value = codes.join(",");
  // Trigger change event so existing listeners pick up.
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderPicker() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
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

const TALMUD_MAX_STREAMS = 2;

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
  if (selected.length >= TALMUD_MAX_STREAMS) {
    btn.disabled = true;
    btn.style.opacity = "0.4";
    btn.title = "גפ\"ת מוגבל ל-2 זרמים. לחץ × על אחד מהקיימים כדי להחליף.";
  } else {
    btn.disabled = false;
    btn.style.opacity = "";
    btn.title = "הוסף זרם";
  }
}

function defaultsIfEmpty() {
  const selected = getCurrentSelected();
  if (selected.length > 0) return;
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
  // Initial render
  renderPicker();
  updateAddButtonState();
  // Re-render when input changes externally
  document.getElementById(HIDDEN_INPUT_ID)?.addEventListener("change", () => {
    renderPicker();
    updateAddButtonState();
  });
  addBtn.addEventListener("click", () => {
    addStream();
    updateAddButtonState();
  });
  // After render, fill defaults if empty
  setTimeout(defaultsIfEmpty, 1500);
  // Re-render whenever pages re-render (new stream codes available)
  const observer = new MutationObserver(() => {
    // Debounce
    clearTimeout(observer._t);
    observer._t = setTimeout(renderPicker, 300);
  });
  const pagesContainer = document.getElementById("pages-container");
  if (pagesContainer) observer.observe(pagesContainer, { childList: true, subtree: true });
}
