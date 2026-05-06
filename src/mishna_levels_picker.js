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
    row.draggable = true;
    row.dataset.levelIdx = String(levelIdx);

    // Drag handle — small ⋮⋮ icon, subtle but visible
    const handle = document.createElement("span");
    handle.className = "mishna-level-drag-handle";
    handle.textContent = "⋮⋮";
    handle.title = "גרור להעברת הרמה למעלה/למטה";
    handle.style.cssText = "cursor:grab;color:#bbb;font-size:14px;letter-spacing:-2px;user-select:none;padding:0 4px;";
    handle.addEventListener("mousedown", () => { handle.style.cursor = "grabbing"; });
    handle.addEventListener("mouseup", () => { handle.style.cursor = "grab"; });
    row.appendChild(handle);

    const label = document.createElement("span");
    label.style.cssText = "font-size:11px;color:#888;min-width:48px;";
    label.textContent = `רמה ${levelIdx + 1}:`;
    row.appendChild(label);

    // Drag-and-drop event handlers (HTML5 native).
    // v33: also use a window-level state for reliability — dataTransfer can
    // be flaky across browsers/elements, so we keep the from-index in a
    // local variable as backup.
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(levelIdx));
      window.__mishnaLevelsDragFromIdx = levelIdx;
      row.style.opacity = "0.5";
    });
    row.addEventListener("dragend", () => {
      row.style.opacity = "";
      window.__mishnaLevelsDragFromIdx = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      row.style.borderTop = "2px solid var(--rt-accent, #2c5aa0)";
    });
    row.addEventListener("dragleave", () => { row.style.borderTop = ""; });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.style.borderTop = "";
      // Read from dataTransfer first, fallback to window var.
      let fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(fromIdx)) fromIdx = window.__mishnaLevelsDragFromIdx;
      const toIdx = levelIdx;
      if (typeof fromIdx !== "number" || isNaN(fromIdx) || fromIdx === toIdx) return;
      // Read CURRENT levels from input (not stale closure).
      const cur = getCurrentLevels();
      const newLevels = cur.slice();
      const [moved] = newLevels.splice(fromIdx, 1);
      newLevels.splice(toIdx, 0, moved);
      setLevels(newLevels);
      renderPicker();
    });

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

    // Styled × to delete the whole level. Always visible; disabled when
    // it would leave 0 levels (must keep at least 1).
    const removeLevelX = document.createElement("button");
    removeLevelX.type = "button";
    removeLevelX.className = "mishna-level-remove-x";
    removeLevelX.textContent = "×";
    removeLevelX.title = "מחק רמה";
    const isLast = levels.length <= 1;
    removeLevelX.style.cssText =
      "margin-inline-start:6px;width:22px;height:22px;border-radius:50%;" +
      "border:1px solid " + (isLast ? "#ddd" : "#d99") + ";" +
      "background:" + (isLast ? "#f8f8f8" : "#fff5f5") + ";" +
      "color:" + (isLast ? "#bbb" : "#a33") + ";" +
      "font-size:14px;font-weight:bold;line-height:1;padding:0;" +
      "cursor:" + (isLast ? "not-allowed" : "pointer") + ";" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "transition:background 0.15s, transform 0.1s;";
    if (!isLast) {
      removeLevelX.addEventListener("mouseenter", () => {
        removeLevelX.style.background = "#ffe5e5";
        removeLevelX.style.transform = "scale(1.1)";
      });
      removeLevelX.addEventListener("mouseleave", () => {
        removeLevelX.style.background = "#fff5f5";
        removeLevelX.style.transform = "scale(1)";
      });
      removeLevelX.addEventListener("click", () => {
        const newLevels = levels.filter((_, i) => i !== levelIdx);
        setLevels(newLevels);
        renderPicker();
      });
    } else {
      removeLevelX.disabled = true;
    }
    row.appendChild(removeLevelX);

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
