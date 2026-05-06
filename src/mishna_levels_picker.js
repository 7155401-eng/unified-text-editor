// mishna_levels_picker.js — visual UI for Mishna Berura levels.
//
// Each level is a row of stream chips. Within each level you must have
// at least 2 streams. + add stream within level. + add level for new level.

const HIDDEN_INPUT_ID = "mishna-levels-input";
const PICKER_ID = "mishna-levels-picker";
const ADD_LEVEL_BTN_ID = "mishna-add-level-btn";

function getAvailableStreamCodes() {
  const codes = new Set();
  document.querySelectorAll(".stream[data-stream], [data-stream]").forEach(el => {
    const c = el.getAttribute("data-stream");
    if (c && /^\d{2}$/.test(c)) codes.add(c);
  });
  if (codes.size === 0) for (let i = 1; i <= 10; i++) codes.add(String(i).padStart(2, "0"));
  return Array.from(codes).sort();
}

function getCurrentLevels() {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return [];
  const text = input.value.trim();
  if (!text) return [];
  return text.split("|").map(g => g.trim().split(/[,\s]+/).filter(c => /^\d{2}$/.test(c)));
}

function setLevels(levels) {
  const input = document.getElementById(HIDDEN_INPUT_ID);
  if (!input) return;
  input.value = levels.map(arr => arr.join(",")).join(" | ");
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderPicker() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  const levels = getCurrentLevels();
  const available = getAvailableStreamCodes();

  picker.innerHTML = "";
  picker.style.cssText = "display:inline-flex;flex-direction:column;gap:6px;";

  levels.forEach((codes, levelIdx) => {
    const row = document.createElement("div");
    row.className = "mishna-level-row";
    row.style.cssText = "display:flex;align-items:center;gap:4px;";

    const label = document.createElement("span");
    label.style.cssText = "font-size:11px;color:#888;min-width:48px;";
    label.textContent = `רמה ${levelIdx + 1}:`;
    row.appendChild(label);

    codes.forEach((code, chipIdx) => {
      const chip = document.createElement("span");
      chip.className = "stream-chip stream-chip-selected";
      chip.style.cssText = `
        display:inline-flex;align-items:center;gap:4px;
        padding:2px 8px;border-radius:12px;
        background:var(--rt-accent,#2c5aa0);color:#fff;
        font-size:12px;cursor:pointer;
      `;
      const lbl = document.createElement("span");
      lbl.textContent = code;
      chip.appendChild(lbl);
      const remove = document.createElement("span");
      remove.textContent = "×";
      remove.style.cssText = "cursor:pointer;font-weight:bold;opacity:0.8;";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        // Cannot go below 2 streams per level. Remove level if would.
        if (codes.length <= 2) {
          alert("רמה חייבת להכיל לפחות 2 זרמים. אם רוצים פחות — הסר את הרמה כולה.");
          return;
        }
        const newLevels = levels.map((g, i) =>
          i === levelIdx ? g.filter(c => c !== code) : g
        );
        setLevels(newLevels);
        renderPicker();
      });
      chip.appendChild(remove);
      // Click chip to cycle codes
      chip.addEventListener("click", () => {
        const allUsedInLevel = new Set(codes);
        allUsedInLevel.delete(code);
        const candidates = available.filter(c => !allUsedInLevel.has(c));
        const curIdx = candidates.indexOf(code);
        const next = candidates[(curIdx + 1) % candidates.length];
        const newLevels = levels.map((g, i) =>
          i === levelIdx ? g.map(c => c === code ? next : c) : g
        );
        setLevels(newLevels);
        renderPicker();
      });
      row.appendChild(chip);
    });

    // + Add stream to this level
    const addStreamBtn = document.createElement("button");
    addStreamBtn.type = "button";
    addStreamBtn.className = "stream-picker-add";
    addStreamBtn.textContent = "+ זרם";
    addStreamBtn.style.cssText = "margin-inline-start:4px;font-size:11px;padding:2px 6px;";
    addStreamBtn.addEventListener("click", () => {
      const used = new Set(codes);
      const next = available.find(c => !used.has(c));
      if (!next) return;
      const newLevels = levels.map((g, i) => i === levelIdx ? [...g, next] : g);
      setLevels(newLevels);
      renderPicker();
    });
    row.appendChild(addStreamBtn);

    // Remove whole level (only if more than 1 level exists)
    if (levels.length > 1) {
      const removeLevelBtn = document.createElement("button");
      removeLevelBtn.type = "button";
      removeLevelBtn.className = "stream-picker-add";
      removeLevelBtn.textContent = "− רמה";
      removeLevelBtn.style.cssText = "margin-inline-start:4px;font-size:11px;padding:2px 6px;color:#a33;";
      removeLevelBtn.addEventListener("click", () => {
        const newLevels = levels.filter((_, i) => i !== levelIdx);
        setLevels(newLevels);
        renderPicker();
      });
      row.appendChild(removeLevelBtn);
    }

    picker.appendChild(row);
  });
}

function addLevel() {
  const levels = getCurrentLevels();
  const available = getAvailableStreamCodes();
  // Find 2 unused codes (each level needs ≥2).
  const used = new Set(levels.flat());
  const unused = available.filter(c => !used.has(c));
  if (unused.length < 2) {
    alert("אין מספיק זרמים פנויים לרמה חדשה (צריך לפחות 2).");
    return;
  }
  const newLevels = [...levels, [unused[0], unused[1]]];
  setLevels(newLevels);
  renderPicker();
}

function defaultsIfEmpty() {
  const levels = getCurrentLevels();
  if (levels.length > 0) return;
  const avail = getAvailableStreamCodes();
  if (avail.length >= 2) {
    setLevels([[avail[0], avail[1]]]);
    renderPicker();
  }
}

export function setupMishnaLevelsPicker() {
  const picker = document.getElementById(PICKER_ID);
  const addBtn = document.getElementById(ADD_LEVEL_BTN_ID);
  if (!picker || !addBtn) return;
  // Always render with at least placeholder if empty.
  defaultsIfEmpty();
  renderPicker();
  // If still empty after defaults (no streams yet), render an empty
  // placeholder chip so user sees the visual UI not a blank input area.
  if (getCurrentLevels().length === 0) {
    setLevels([["01", "02"]]);
    renderPicker();
  }
  document.getElementById(HIDDEN_INPUT_ID)?.addEventListener("change", renderPicker);
  addBtn.addEventListener("click", addLevel);
  // Recheck defaults later when streams arrive.
  setTimeout(() => { defaultsIfEmpty(); renderPicker(); }, 1500);
  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(renderPicker, 300);
  });
  const pagesContainer = document.getElementById("pages-container");
  if (pagesContainer) observer.observe(pagesContainer, { childList: true, subtree: true });
}
