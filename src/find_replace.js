// find_replace.js — Ctrl+F dialog with find / replace and per-pane scoping.
//
// Opens a fixed panel anchored under the toolbar (NOT a centered modal that
// blocks the page). Lists each open pane as a checkbox + "all" toggle.
// Buttons: Find Next · Replace · Replace All. Also supports search-only
// usage when replace field is empty.

import { defaultLabelForCode } from "./engine_bridge.js";
import {
  paneDisplayName,
  countMatches,
  findMatches,
  replaceAllInPane,
} from "./find_replace_scope.js";

function getPaneManager() {
  return (typeof window !== "undefined") ? window.paneManager : null;
}

const PANEL_ID = "find-replace-panel";

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "find-replace-panel";
  panel.dir = "rtl";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="fr-header">
      <strong>חיפוש והחלפה</strong>
      <button type="button" id="fr-close" class="fr-close-btn" title="סגור">×</button>
    </div>
    <label class="fr-row">
      <span>חיפוש:</span>
      <input type="text" id="fr-find" />
    </label>
    <label class="fr-row">
      <span>החלפה:</span>
      <input type="text" id="fr-replace" placeholder="(ריק = רק חיפוש)" />
    </label>
    <div class="fr-row fr-mode-row" id="fr-mode-row">
      <span>היכן:</span>
      <label class="fr-scope-toggle"><input type="radio" name="fr-scope-mode" id="fr-mode-one" value="one" checked />חלונית אחת</label>
      <label class="fr-scope-toggle"><input type="radio" name="fr-scope-mode" id="fr-mode-all" value="all" />כל החלוניות</label>
      <label class="fr-scope-toggle"><input type="radio" name="fr-scope-mode" id="fr-mode-custom" value="custom" />בחירה ידנית</label>
    </div>
    <label class="fr-row fr-pane-row" id="fr-pane-row">
      <span>החלונית:</span>
      <select id="fr-pane-select"></select>
    </label>
    <div id="fr-scope" class="fr-scope">
      <span class="fr-scope-hint">חפש בזרמים:</span>
    </div>
    <div class="fr-buttons">
      <button type="button" id="fr-find-next" class="ribbon-btn">חיפוש הבא</button>
      <button type="button" id="fr-replace-one" class="ribbon-btn">החלף</button>
      <button type="button" id="fr-replace-all" class="ribbon-btn">החלף הכל</button>
    </div>
    <div id="fr-status" class="fr-status"></div>
  `;
  // Anchor below toolbar bar — read its bottom dynamically.
  panel.style.top = (document.querySelector(".main-ribbon-toolbar")?.getBoundingClientRect().bottom || 60) + 6 + "px";
  document.body.appendChild(panel);
  return panel;
}

function getPanesForScope() {
  // Return [{ id, label, editor, paneEl }] for each open pane.
  const list = [];
  const pm = getPaneManager();
  if (!pm?.panes) return list;
  for (const p of pm.panes) {
    const editor = p.editor;
    if (!editor) continue;
    const code = p.streamCode || p.id || "main";
    // The name the user sees on the pane right now. p.label is kept live by
    // the rename paths (first_note_title.js, word_extractor.js), so this is
    // never a stale built-in name.
    const label = (typeof p.title === "string" && p.title.trim()) || paneDisplayName(p, list.length);
    list.push({ id: code, label, editor, paneEl: p.element });
  }
  return list;
}

function rebuildScope(panel) {
  const scope = panel.querySelector("#fr-scope");
  if (!scope) return;
  scope.innerHTML = "<span class='fr-scope-hint'>חפש בזרמים:</span>";
  const panes = getPanesForScope();
  // "All" toggle
  const allLbl = document.createElement("label");
  allLbl.className = "fr-scope-toggle";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.id = "fr-scope-all";
  allCb.checked = true;
  allLbl.appendChild(allCb);
  allLbl.appendChild(document.createTextNode("הכל"));
  scope.appendChild(allLbl);
  // Per-pane checkboxes
  for (const p of panes) {
    const lbl = document.createElement("label");
    lbl.className = "fr-scope-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.frPaneId = p.id;
    cb.checked = true;
    cb.className = "fr-scope-pane";
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(p.label));
    scope.appendChild(lbl);
  }
  allCb.addEventListener("change", () => {
    scope.querySelectorAll(".fr-scope-pane").forEach(cb => { cb.checked = allCb.checked; });
  });
  scope.querySelectorAll(".fr-scope-pane").forEach(cb => {
    cb.addEventListener("change", () => {
      const all = scope.querySelectorAll(".fr-scope-pane");
      const allChecked = Array.from(all).every(c => c.checked);
      allCb.checked = allChecked;
    });
  });
  rebuildPanePicker(panel);
  applyScopeMode(panel);
}

function scopeModeOf(panel) {
  return panel.querySelector("input[name='fr-scope-mode']:checked")?.value || "all";
}

// Fill the pane dropdown with the CURRENT user-given names, read fresh from
// window.paneManager every single time, so a rename shows up immediately.
function rebuildPanePicker(panel) {
  const sel = panel.querySelector("#fr-pane-select");
  if (!sel) return;
  const panes = getPanesForScope();
  const pm = getPaneManager();
  const active = pm?.activePane;
  const activeId = active ? (active.streamCode || active.id || "main") : null;
  const keep = sel.value;
  sel.innerHTML = "";
  for (const p of panes) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  if (panes.some(p => p.id === keep)) sel.value = keep;
  else if (activeId && panes.some(p => p.id === activeId)) sel.value = activeId;
  else if (panes.length) sel.value = panes[0].id;
}

function applyScopeMode(panel) {
  const mode = scopeModeOf(panel);
  const paneRow = panel.querySelector("#fr-pane-row");
  const scope = panel.querySelector("#fr-scope");
  if (paneRow) paneRow.hidden = (mode !== "one");
  if (scope) scope.hidden = (mode !== "custom");
}

function setStatus(panel, text, isError) {
  const status = panel.querySelector("#fr-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("fr-status-error", !!isError);
}

function foundPhrase(n) {
  return n === 1 ? "נמצא מופע אחד" : `נמצאו ${n} מופעים`;
}
function replacedPhrase(n) {
  return n === 1 ? "הוחלף מופע אחד" : `הוחלפו ${n} מופעים`;
}
function inPanesPhrase(n) {
  return n === 1 ? " בחלונית אחת" : ` ב-${n} חלוניות`;
}

// Error text: what happened, then what to do about it.
const MSG_NO_QUERY = "לא הוקלד טקסט לחיפוש. הקלד את הטקסט בשדה החיפוש ולחץ שוב.";
function noPaneMessage(mode) {
  return mode === "custom"
    ? "לא סומנה אף חלונית. סמן לפחות חלונית אחת ברשימת הבחירה הידנית."
    : "החלונית שנבחרה כבר לא פתוחה. בחר חלונית אחרת מהרשימה.";
}
function noMatchMessage(mode) {
  return mode === "all"
    ? "לא נמצא אף מופע באף חלונית. בדוק את האיות ואת הרווחים, ונסה שוב."
    : "לא נמצא אף מופע בחלונית הזאת. בדוק את האיות, או עבור לכל החלוניות כדי לחפש בכולן.";
}

// Live match count while typing, for the pane(s) currently in scope.
function updateMatchCount(panel) {
  const find = panel.querySelector("#fr-find")?.value || "";
  if (!find) { setStatus(panel, "", false); return; }
  const mode = scopeModeOf(panel);
  const panes = getSelectedPanes(panel);
  if (!panes.length) { setStatus(panel, noPaneMessage(mode), true); return; }
  let total = 0;
  let hitPanes = 0;
  for (const p of panes) {
    const n = countMatches(p.editor, find);
    total += n;
    if (n > 0) hitPanes++;
  }
  if (total === 0) { setStatus(panel, noMatchMessage(mode), true); return; }
  setStatus(panel, foundPhrase(total) + (panes.length > 1 ? inPanesPhrase(hitPanes) : ""), false);
}

function getSelectedPanes(panel) {
  const panes = getPanesForScope();
  const mode = scopeModeOf(panel);
  if (mode === "all") return panes;
  if (mode === "one") {
    const wanted = panel.querySelector("#fr-pane-select")?.value;
    const hit = panes.find(p => String(p.id) === String(wanted));
    return hit ? [hit] : [];
  }
  // "custom" keeps the original per-pane checkbox behaviour, unchanged.
  const all = panel.querySelectorAll(".fr-scope-pane");
  const selected = new Set();
  all.forEach(cb => { if (cb.checked) selected.add(cb.dataset.frPaneId); });
  return panes.filter(p => selected.has(p.id));
}

function findInEditor(editor, query) {
  // Returns array of {from, to} positions for all occurrences of `query`.
  // Scans whole text blocks, so a word split in two by formatting is still
  // found, and the same letters are never counted twice.
  if (!editor?.state?.doc || !query) return [];
  return findMatches(editor.state.doc, query);
}

let lastFindIdx = -1;
let lastFindEditor = null;

function findNext(panel) {
  const find = panel.querySelector("#fr-find").value;
  const mode = scopeModeOf(panel);
  if (!find) { setStatus(panel, MSG_NO_QUERY, true); return; }
  const panes = getSelectedPanes(panel);
  if (!panes.length) { setStatus(panel, noPaneMessage(mode), true); return; }
  let total = 0;
  let hitPanes = 0;
  let landed = false;
  for (const p of panes) {
    const positions = findInEditor(p.editor, find);
    total += positions.length;
    if (positions.length > 0) hitPanes++;
    if (landed || positions.length === 0) continue;
    let nextIdx = 0;
    if (lastFindEditor === p.editor && lastFindIdx >= 0) {
      nextIdx = (lastFindIdx + 1) % positions.length;
    }
    const target = positions[nextIdx];
    p.editor.commands.focus();
    p.editor.commands.setTextSelection({ from: target.from, to: target.to });
    p.paneEl?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    lastFindEditor = p.editor;
    lastFindIdx = nextIdx;
    landed = true;
  }
  if (total === 0) { setStatus(panel, noMatchMessage(mode), true); return; }
  setStatus(panel, foundPhrase(total) + (panes.length > 1 ? inPanesPhrase(hitPanes) : ""), false);
}

function replaceOne(panel) {
  const find = panel.querySelector("#fr-find").value;
  const repl = panel.querySelector("#fr-replace").value;
  const status = panel.querySelector("#fr-status");
  if (!find) { setStatus(panel, MSG_NO_QUERY, true); return; }
  const panes = getSelectedPanes(panel);
  for (const p of panes) {
    const positions = findInEditor(p.editor, find);
    if (positions.length === 0) continue;
    // Replace last-found if matches, else first.
    const target = (lastFindEditor === p.editor && lastFindIdx >= 0 && lastFindIdx < positions.length)
      ? positions[lastFindIdx] : positions[0];
    const tr = p.editor.state.tr;
    tr.insertText(repl, target.from, target.to);
    p.editor.view.dispatch(tr);
    status.textContent = "הוחלף 1";
    return;
  }
  status.textContent = "לא נמצא להחלפה";
}

function replaceAll(panel) {
  const find = panel.querySelector("#fr-find").value;
  const repl = panel.querySelector("#fr-replace").value;
  const mode = scopeModeOf(panel);
  if (!find) { setStatus(panel, MSG_NO_QUERY, true); return; }
  const panes = getSelectedPanes(panel);
  if (!panes.length) { setStatus(panel, noPaneMessage(mode), true); return; }
  let total = 0;
  let touched = 0;
  for (const p of panes) {
    // One transaction per pane => one undo step per pane.
    const n = replaceAllInPane(p.editor, find, repl);
    total += n;
    if (n > 0) touched++;
  }
  lastFindIdx = -1;
  lastFindEditor = null;
  if (total === 0) { setStatus(panel, noMatchMessage(mode), true); return; }
  setStatus(panel, replacedPhrase(total) + (panes.length > 1 ? inPanesPhrase(touched) : "")
    + ". ביטול אחד (Ctrl+Z) מחזיר כל חלונית לקדמותה.", false);
}

export function openFindReplace() {
  const panel = ensurePanel();
  rebuildScope(panel);
  updateMatchCount(panel);
  panel.hidden = false;
  panel.querySelector("#fr-find")?.focus();
  panel.querySelector("#fr-find")?.select();
}

export function closeFindReplace() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.hidden = true;
}

export function setupFindReplace() {
  // Ctrl+F → open. Esc → close (when panel focused).
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      openFindReplace();
      return;
    }
    if (e.key === "Escape") {
      const panel = document.getElementById(PANEL_ID);
      if (panel && !panel.hidden) {
        closeFindReplace();
        e.preventDefault();
      }
    }
  });
  // Wire panel buttons after first open.
  const observer = new MutationObserver(() => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.dataset.wired === "1") return;
    panel.dataset.wired = "1";
    panel.querySelector("#fr-close")?.addEventListener("click", closeFindReplace);
    panel.querySelector("#fr-find-next")?.addEventListener("click", () => findNext(panel));
    panel.querySelector("#fr-replace-one")?.addEventListener("click", () => replaceOne(panel));
    panel.querySelector("#fr-replace-all")?.addEventListener("click", () => replaceAll(panel));
    panel.querySelector("#fr-find")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); findNext(panel); }
    });
    // Scope controls: switching mode re-counts straight away.
    panel.querySelectorAll("input[name='fr-scope-mode']").forEach(r => {
      r.addEventListener("change", () => { applyScopeMode(panel); updateMatchCount(panel); });
    });
    const paneSel = panel.querySelector("#fr-pane-select");
    // Re-read the names right before the list drops open, so a pane renamed
    // while the panel was sitting there still shows its current name.
    paneSel?.addEventListener("mousedown", () => rebuildPanePicker(panel));
    paneSel?.addEventListener("change", () => updateMatchCount(panel));
    panel.querySelector("#fr-scope")?.addEventListener("change", () => updateMatchCount(panel));
    let countTimer = null;
    panel.querySelector("#fr-find")?.addEventListener("input", () => {
      clearTimeout(countTimer);
      countTimer = setTimeout(() => updateMatchCount(panel), 200);
    });
  });
  observer.observe(document.body, { childList: true });
}
