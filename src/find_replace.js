// find_replace.js — Ctrl+F dialog with find / replace and per-pane scoping.
//
// Opens a fixed panel anchored under the toolbar (NOT a centered modal that
// blocks the page). Lists each open pane as a checkbox + "all" toggle.
// Buttons: Find Next · Replace · Replace All. Also supports search-only
// usage when replace field is empty.

import { defaultLabelForCode } from "./engine_bridge.js";

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
    const label = p.title || (code === "main" ? "ראשי" : defaultLabelForCode(code));
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
}

function getSelectedPanes(panel) {
  const all = panel.querySelectorAll(".fr-scope-pane");
  const selected = new Set();
  all.forEach(cb => { if (cb.checked) selected.add(cb.dataset.frPaneId); });
  return getPanesForScope().filter(p => selected.has(p.id));
}

function findInEditor(editor, query) {
  // Returns array of {from, to} positions for all occurrences of `query`.
  if (!editor || !query) return [];
  const positions = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const txt = node.text || "";
    let idx = txt.indexOf(query);
    while (idx >= 0) {
      positions.push({ from: pos + idx, to: pos + idx + query.length });
      idx = txt.indexOf(query, idx + 1);
    }
  });
  return positions;
}

let lastFindIdx = -1;
let lastFindEditor = null;

function findNext(panel) {
  const find = panel.querySelector("#fr-find").value;
  const status = panel.querySelector("#fr-status");
  if (!find) { status.textContent = "הזן טקסט לחיפוש"; return; }
  const panes = getSelectedPanes(panel);
  let total = 0;
  let landed = false;
  for (const p of panes) {
    const positions = findInEditor(p.editor, find);
    total += positions.length;
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
  status.textContent = total === 0
    ? "לא נמצאו תוצאות"
    : (landed ? `נמצא (${total} בסה"כ)` : `נמצא ${total}`);
}

function replaceOne(panel) {
  const find = panel.querySelector("#fr-find").value;
  const repl = panel.querySelector("#fr-replace").value;
  const status = panel.querySelector("#fr-status");
  if (!find) { status.textContent = "הזן טקסט לחיפוש"; return; }
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
  const status = panel.querySelector("#fr-status");
  if (!find) { status.textContent = "הזן טקסט לחיפוש"; return; }
  const panes = getSelectedPanes(panel);
  let total = 0;
  for (const p of panes) {
    let safety = 0;
    let positions;
    while ((positions = findInEditor(p.editor, find)).length > 0 && safety < 5000) {
      const target = positions[0];
      const tr = p.editor.state.tr;
      tr.insertText(repl, target.from, target.to);
      p.editor.view.dispatch(tr);
      total++; safety++;
      if (find === repl || repl.includes(find)) break; // avoid infinite loop
    }
  }
  status.textContent = `הוחלפו ${total} מופעים`;
}

export function openFindReplace() {
  const panel = ensurePanel();
  rebuildScope(panel);
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
  });
  observer.observe(document.body, { childList: true });
}
