# -*- coding: utf-8 -*-
"""Exact-anchor patch: add a pane-scope selector to find & replace,
make replace-all one undo step per pane, and show real counts.

Every anchor is asserted to appear EXACTLY once; otherwise nothing is written.
Anchors are ASCII-only (or ASCII-anchored regexes) so no Hebrew is echoed.
"""
import io, re, sys

SRC = r"C:\Users\User\rt_work\findreplace\src\find_replace.js"
CSS = r"C:\Users\User\rt_work\findreplace\styles.css"

def once(s, anchor, what):
    n = s.count(anchor)
    if n != 1:
        sys.exit("ABORT: anchor %s appears %d times (want 1)" % (what, n))

def sub_once(s, pattern, repl, what):
    hits = pattern.findall(s)
    if len(hits) != 1:
        sys.exit("ABORT: regex %s matched %d times (want 1)" % (what, len(hits)))
    return pattern.sub(lambda m: repl, s, count=1)

s = io.open(SRC, encoding="utf-8").read()
orig_len = len(s)

# ---------------------------------------------------------------- 1. import
A = 'import { defaultLabelForCode } from "./engine_bridge.js";\n'
once(s, A, "import")
s = s.replace(A, A + 'import {\n'
                   '  primeHistoryHelper,\n'
                   '  paneDisplayName,\n'
                   '  countMatches,\n'
                   '  findMatches,\n'
                   '  replaceAllInPane,\n'
                   '} from "./find_replace_scope.js";\n')

# ------------------------------------------- 2. scope-mode row + pane picker
A = '    <div id="fr-scope" class="fr-scope">\n'
once(s, A, "scope div")
NEW_UI = (
    '    <div class="fr-row fr-mode-row" id="fr-mode-row">\n'
    '      <span>\u05d4\u05d9\u05db\u05df:</span>\n'
    '      <label class="fr-scope-toggle"><input type="radio" name="fr-scope-mode" id="fr-mode-one" value="one" checked />\u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05d0\u05d7\u05ea</label>\n'
    '      <label class="fr-scope-toggle"><input type="radio" name="fr-scope-mode" id="fr-mode-all" value="all" />\u05db\u05dc \u05d4\u05d7\u05dc\u05d5\u05e0\u05d9\u05d5\u05ea</label>\n'
    '      <label class="fr-scope-toggle"><input type="radio" name="fr-scope-mode" id="fr-mode-custom" value="custom" />\u05d1\u05d7\u05d9\u05e8\u05d4 \u05d9\u05d3\u05e0\u05d9\u05ea</label>\n'
    '    </div>\n'
    '    <label class="fr-row fr-pane-row" id="fr-pane-row">\n'
    '      <span>\u05d4\u05d7\u05dc\u05d5\u05e0\u05d9\u05ea:</span>\n'
    '      <select id="fr-pane-select"></select>\n'
    '    </label>\n'
)
s = s.replace(A, NEW_UI + A)

# ------------------------------------------------- 3. live label, not default
P = re.compile(r'    const label = p\.title \|\| \(code === "main" \? "[^"]*" : defaultLabelForCode\(code\)\);\n')
s = sub_once(
    s, P,
    '    // The name the user sees on the pane right now. p.label is kept live by\n'
    '    // the rename paths (first_note_title.js, word_extractor.js), so this is\n'
    '    // never a stale built-in name.\n'
    '    const label = (typeof p.title === "string" && p.title.trim()) || paneDisplayName(p, list.length);\n',
    "pane label")

# ------------------------------- 4. rebuild the picker whenever scope rebuilds
A = ('  scope.querySelectorAll(".fr-scope-pane").forEach(cb => {\n'
     '    cb.addEventListener("change", () => {\n'
     '      const all = scope.querySelectorAll(".fr-scope-pane");\n'
     '      const allChecked = Array.from(all).every(c => c.checked);\n'
     '      allCb.checked = allChecked;\n'
     '    });\n'
     '  });\n'
     '}\n')
once(s, A, "rebuildScope tail")
s = s.replace(A, A[:-2] + '  rebuildPanePicker(panel);\n  applyScopeMode(panel);\n}\n')

# ----------------------------------------- 5. scope helpers + status wording
A = 'function getSelectedPanes(panel) {\n' \
    '  const all = panel.querySelectorAll(".fr-scope-pane");\n' \
    '  const selected = new Set();\n' \
    '  all.forEach(cb => { if (cb.checked) selected.add(cb.dataset.frPaneId); });\n' \
    '  return getPanesForScope().filter(p => selected.has(p.id));\n' \
    '}\n'
once(s, A, "getSelectedPanes")
NEW = (
    'function scopeModeOf(panel) {\n'
    '  return panel.querySelector("input[name=\'fr-scope-mode\']:checked")?.value || "all";\n'
    '}\n'
    '\n'
    '// Fill the pane dropdown with the CURRENT user-given names, read fresh from\n'
    '// window.paneManager every single time, so a rename shows up immediately.\n'
    'function rebuildPanePicker(panel) {\n'
    '  const sel = panel.querySelector("#fr-pane-select");\n'
    '  if (!sel) return;\n'
    '  const panes = getPanesForScope();\n'
    '  const pm = getPaneManager();\n'
    '  const active = pm?.activePane;\n'
    '  const activeId = active ? (active.streamCode || active.id || "main") : null;\n'
    '  const keep = sel.value;\n'
    '  sel.innerHTML = "";\n'
    '  for (const p of panes) {\n'
    '    const opt = document.createElement("option");\n'
    '    opt.value = p.id;\n'
    '    opt.textContent = p.label;\n'
    '    sel.appendChild(opt);\n'
    '  }\n'
    '  if (panes.some(p => p.id === keep)) sel.value = keep;\n'
    '  else if (activeId && panes.some(p => p.id === activeId)) sel.value = activeId;\n'
    '  else if (panes.length) sel.value = panes[0].id;\n'
    '}\n'
    '\n'
    'function applyScopeMode(panel) {\n'
    '  const mode = scopeModeOf(panel);\n'
    '  const paneRow = panel.querySelector("#fr-pane-row");\n'
    '  const scope = panel.querySelector("#fr-scope");\n'
    '  if (paneRow) paneRow.hidden = (mode !== "one");\n'
    '  if (scope) scope.hidden = (mode !== "custom");\n'
    '}\n'
    '\n'
    'function setStatus(panel, text, isError) {\n'
    '  const status = panel.querySelector("#fr-status");\n'
    '  if (!status) return;\n'
    '  status.textContent = text;\n'
    '  status.classList.toggle("fr-status-error", !!isError);\n'
    '}\n'
    '\n'
    'function foundPhrase(n) {\n'
    '  return n === 1 ? "\u05e0\u05de\u05e6\u05d0 \u05de\u05d5\u05e4\u05e2 \u05d0\u05d7\u05d3" : `\u05e0\u05de\u05e6\u05d0\u05d5 ${n} \u05de\u05d5\u05e4\u05e2\u05d9\u05dd`;\n'
    '}\n'
    'function replacedPhrase(n) {\n'
    '  return n === 1 ? "\u05d4\u05d5\u05d7\u05dc\u05e3 \u05de\u05d5\u05e4\u05e2 \u05d0\u05d7\u05d3" : `\u05d4\u05d5\u05d7\u05dc\u05e4\u05d5 ${n} \u05de\u05d5\u05e4\u05e2\u05d9\u05dd`;\n'
    '}\n'
    'function inPanesPhrase(n) {\n'
    '  return n === 1 ? " \u05d1\u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05d0\u05d7\u05ea" : ` \u05d1-${n} \u05d7\u05dc\u05d5\u05e0\u05d9\u05d5\u05ea`;\n'
    '}\n'
    '\n'
    '// Error text: what happened, then what to do about it.\n'
    'const MSG_NO_QUERY = "\u05dc\u05d0 \u05d4\u05d5\u05e7\u05dc\u05d3 \u05d8\u05e7\u05e1\u05d8 \u05dc\u05d7\u05d9\u05e4\u05d5\u05e9. \u05d4\u05e7\u05dc\u05d3 \u05d0\u05ea \u05d4\u05d8\u05e7\u05e1\u05d8 \u05d1\u05e9\u05d3\u05d4 \u05d4\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d5\u05dc\u05d7\u05e5 \u05e9\u05d5\u05d1.";\n'
    'function noPaneMessage(mode) {\n'
    '  return mode === "custom"\n'
    '    ? "\u05dc\u05d0 \u05e1\u05d5\u05de\u05e0\u05d4 \u05d0\u05e3 \u05d7\u05dc\u05d5\u05e0\u05d9\u05ea. \u05e1\u05de\u05df \u05dc\u05e4\u05d7\u05d5\u05ea \u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05d0\u05d7\u05ea \u05d1\u05e8\u05e9\u05d9\u05de\u05ea \u05d4\u05d1\u05d7\u05d9\u05e8\u05d4 \u05d4\u05d9\u05d3\u05e0\u05d9\u05ea."\n'
    '    : "\u05d4\u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05e9\u05e0\u05d1\u05d7\u05e8\u05d4 \u05db\u05d1\u05e8 \u05dc\u05d0 \u05e4\u05ea\u05d5\u05d7\u05d4. \u05d1\u05d7\u05e8 \u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05d0\u05d7\u05e8\u05ea \u05de\u05d4\u05e8\u05e9\u05d9\u05de\u05d4.";\n'
    '}\n'
    'function noMatchMessage(mode) {\n'
    '  return mode === "all"\n'
    '    ? "\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0 \u05d0\u05e3 \u05de\u05d5\u05e4\u05e2 \u05d1\u05d0\u05e3 \u05d7\u05dc\u05d5\u05e0\u05d9\u05ea. \u05d1\u05d3\u05d5\u05e7 \u05d0\u05ea \u05d4\u05d0\u05d9\u05d5\u05ea \u05d5\u05d0\u05ea \u05d4\u05e8\u05d5\u05d5\u05d7\u05d9\u05dd, \u05d5\u05e0\u05e1\u05d4 \u05e9\u05d5\u05d1."\n'
    '    : "\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0 \u05d0\u05e3 \u05de\u05d5\u05e4\u05e2 \u05d1\u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05d4\u05d6\u05d0\u05ea. \u05d1\u05d3\u05d5\u05e7 \u05d0\u05ea \u05d4\u05d0\u05d9\u05d5\u05ea, \u05d0\u05d5 \u05e2\u05d1\u05d5\u05e8 \u05dc\u05db\u05dc \u05d4\u05d7\u05dc\u05d5\u05e0\u05d9\u05d5\u05ea \u05db\u05d3\u05d9 \u05dc\u05d7\u05e4\u05e9 \u05d1\u05db\u05d5\u05dc\u05df.";\n'
    '}\n'
    '\n'
    '// Live match count while typing, for the pane(s) currently in scope.\n'
    'function updateMatchCount(panel) {\n'
    '  const find = panel.querySelector("#fr-find")?.value || "";\n'
    '  if (!find) { setStatus(panel, "", false); return; }\n'
    '  const mode = scopeModeOf(panel);\n'
    '  const panes = getSelectedPanes(panel);\n'
    '  if (!panes.length) { setStatus(panel, noPaneMessage(mode), true); return; }\n'
    '  let total = 0;\n'
    '  let hitPanes = 0;\n'
    '  for (const p of panes) {\n'
    '    const n = countMatches(p.editor, find);\n'
    '    total += n;\n'
    '    if (n > 0) hitPanes++;\n'
    '  }\n'
    '  if (total === 0) { setStatus(panel, noMatchMessage(mode), true); return; }\n'
    '  setStatus(panel, foundPhrase(total) + (panes.length > 1 ? inPanesPhrase(hitPanes) : ""), false);\n'
    '}\n'
    '\n'
    'function getSelectedPanes(panel) {\n'
    '  const panes = getPanesForScope();\n'
    '  const mode = scopeModeOf(panel);\n'
    '  if (mode === "all") return panes;\n'
    '  if (mode === "one") {\n'
    '    const wanted = panel.querySelector("#fr-pane-select")?.value;\n'
    '    const hit = panes.find(p => String(p.id) === String(wanted));\n'
    '    return hit ? [hit] : [];\n'
    '  }\n'
    '  // "custom" keeps the original per-pane checkbox behaviour, unchanged.\n'
    '  const all = panel.querySelectorAll(".fr-scope-pane");\n'
    '  const selected = new Set();\n'
    '  all.forEach(cb => { if (cb.checked) selected.add(cb.dataset.frPaneId); });\n'
    '  return panes.filter(p => selected.has(p.id));\n'
    '}\n'
)
s = s.replace(A, NEW)

# ------------------------------ 6. findInEditor delegates to the fixed scanner
A = ('function findInEditor(editor, query) {\n'
     '  // Returns array of {from, to} positions for all occurrences of `query`.\n'
     '  if (!editor || !query) return [];\n'
     '  const positions = [];\n'
     '  editor.state.doc.descendants((node, pos) => {\n'
     '    if (!node.isText) return;\n'
     '    const txt = node.text || "";\n'
     '    let idx = txt.indexOf(query);\n'
     '    while (idx >= 0) {\n'
     '      positions.push({ from: pos + idx, to: pos + idx + query.length });\n'
     '      idx = txt.indexOf(query, idx + 1);\n'
     '    }\n'
     '  });\n'
     '  return positions;\n'
     '}\n')
once(s, A, "findInEditor")
s = s.replace(A,
    'function findInEditor(editor, query) {\n'
    '  // Returns array of {from, to} positions for all occurrences of `query`.\n'
    '  // Scans whole text blocks, so a word split in two by formatting is still\n'
    '  // found, and the same letters are never counted twice.\n'
    '  if (!editor?.state?.doc || !query) return [];\n'
    '  return findMatches(editor.state.doc, query);\n'
    '}\n')

# --------------------------------------------------- 7. findNext status text
P = re.compile(r'function findNext\(panel\) \{.*?\n\}\n', re.S)
s = sub_once(s, P,
    'function findNext(panel) {\n'
    '  const find = panel.querySelector("#fr-find").value;\n'
    '  const mode = scopeModeOf(panel);\n'
    '  if (!find) { setStatus(panel, MSG_NO_QUERY, true); return; }\n'
    '  const panes = getSelectedPanes(panel);\n'
    '  if (!panes.length) { setStatus(panel, noPaneMessage(mode), true); return; }\n'
    '  let total = 0;\n'
    '  let hitPanes = 0;\n'
    '  let landed = false;\n'
    '  for (const p of panes) {\n'
    '    const positions = findInEditor(p.editor, find);\n'
    '    total += positions.length;\n'
    '    if (positions.length > 0) hitPanes++;\n'
    '    if (landed || positions.length === 0) continue;\n'
    '    let nextIdx = 0;\n'
    '    if (lastFindEditor === p.editor && lastFindIdx >= 0) {\n'
    '      nextIdx = (lastFindIdx + 1) % positions.length;\n'
    '    }\n'
    '    const target = positions[nextIdx];\n'
    '    p.editor.commands.focus();\n'
    '    p.editor.commands.setTextSelection({ from: target.from, to: target.to });\n'
    '    p.paneEl?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });\n'
    '    lastFindEditor = p.editor;\n'
    '    lastFindIdx = nextIdx;\n'
    '    landed = true;\n'
    '  }\n'
    '  if (total === 0) { setStatus(panel, noMatchMessage(mode), true); return; }\n'
    '  setStatus(panel, foundPhrase(total) + (panes.length > 1 ? inPanesPhrase(hitPanes) : ""), false);\n'
    '}\n',
    "findNext")

# ----------------------------------------------- 8. replaceAll: one undo step
P = re.compile(r'function replaceAll\(panel\) \{.*?\n\}\n', re.S)
s = sub_once(s, P,
    'function replaceAll(panel) {\n'
    '  const find = panel.querySelector("#fr-find").value;\n'
    '  const repl = panel.querySelector("#fr-replace").value;\n'
    '  const mode = scopeModeOf(panel);\n'
    '  if (!find) { setStatus(panel, MSG_NO_QUERY, true); return; }\n'
    '  const panes = getSelectedPanes(panel);\n'
    '  if (!panes.length) { setStatus(panel, noPaneMessage(mode), true); return; }\n'
    '  let total = 0;\n'
    '  let touched = 0;\n'
    '  for (const p of panes) {\n'
    '    // One transaction per pane => one undo step per pane.\n'
    '    const n = replaceAllInPane(p.editor, find, repl);\n'
    '    total += n;\n'
    '    if (n > 0) touched++;\n'
    '  }\n'
    '  lastFindIdx = -1;\n'
    '  lastFindEditor = null;\n'
    '  if (total === 0) { setStatus(panel, noMatchMessage(mode), true); return; }\n'
    '  setStatus(panel, replacedPhrase(total) + (panes.length > 1 ? inPanesPhrase(touched) : "")\n'
    '    + "\u002e \u05d1\u05d9\u05d8\u05d5\u05dc \u05d0\u05d7\u05d3 (Ctrl+Z) \u05de\u05d7\u05d6\u05d9\u05e8 \u05db\u05dc \u05d7\u05dc\u05d5\u05e0\u05d9\u05ea \u05dc\u05e7\u05d3\u05de\u05d5\u05ea\u05d4.", false);\n'
    '}\n',
    "replaceAll")

# --------------------------------------- 9. replaceOne: same empty-query text
A = '  if (!find) { status.textContent = "\u05d4\u05d6\u05df \u05d8\u05e7\u05e1\u05d8 \u05dc\u05d7\u05d9\u05e4\u05d5\u05e9"; return; }\n'
once(s, A, "replaceOne empty guard")
s = s.replace(A, '  if (!find) { setStatus(panel, MSG_NO_QUERY, true); return; }\n')

# ------------------------------------------------------------ 10. open + wire
A = ('export function openFindReplace() {\n'
     '  const panel = ensurePanel();\n'
     '  rebuildScope(panel);\n')
once(s, A, "openFindReplace")
s = s.replace(A, A + '  updateMatchCount(panel);\n')

A = ('    panel.querySelector("#fr-find")?.addEventListener("keydown", (e) => {\n'
     '      if (e.key === "Enter") { e.preventDefault(); findNext(panel); }\n'
     '    });\n')
once(s, A, "find keydown wiring")
s = s.replace(A, A +
    '    // Scope controls: switching mode re-counts straight away.\n'
    '    panel.querySelectorAll("input[name=\'fr-scope-mode\']").forEach(r => {\n'
    '      r.addEventListener("change", () => { applyScopeMode(panel); updateMatchCount(panel); });\n'
    '    });\n'
    '    const paneSel = panel.querySelector("#fr-pane-select");\n'
    '    // Re-read the names right before the list drops open, so a pane renamed\n'
    '    // while the panel was sitting there still shows its current name.\n'
    '    paneSel?.addEventListener("mousedown", () => rebuildPanePicker(panel));\n'
    '    paneSel?.addEventListener("change", () => updateMatchCount(panel));\n'
    '    panel.querySelector("#fr-scope")?.addEventListener("change", () => updateMatchCount(panel));\n'
    '    let countTimer = null;\n'
    '    panel.querySelector("#fr-find")?.addEventListener("input", () => {\n'
    '      clearTimeout(countTimer);\n'
    '      countTimer = setTimeout(() => updateMatchCount(panel), 200);\n'
    '    });\n')

A = 'export function setupFindReplace() {\n'
once(s, A, "setupFindReplace")
s = s.replace(A, A + '  primeHistoryHelper();\n')

io.open(SRC, "w", encoding="utf-8", newline="\r\n").write(s)
print("find_replace.js: %d -> %d chars" % (orig_len, len(s)))

# ----------------------------------------------------------------- 11. styles
c = io.open(CSS, encoding="utf-8").read()
css_len = len(c)
A = ('.find-replace-panel .fr-status {\n'
     '  font-size: 11px;\n'
     '  color: #888;\n'
     '  min-height: 16px;\n'
     '}\n')
once(c, A, "fr-status css")
c = c.replace(A, A +
    '.find-replace-panel .fr-mode-row {\n'
    '  flex-wrap: wrap;\n'
    '  font-size: 12px;\n'
    '}\n'
    '.find-replace-panel .fr-pane-row select {\n'
    '  flex: 1;\n'
    '  padding: 4px 6px;\n'
    '  font: inherit;\n'
    '  direction: rtl;\n'
    '}\n'
    '.find-replace-panel .fr-pane-row[hidden],\n'
    '.find-replace-panel .fr-scope[hidden] {\n'
    '  display: none;\n'
    '}\n'
    '.find-replace-panel .fr-status-error {\n'
    '  color: #a33;\n'
    '}\n')
io.open(CSS, "w", encoding="utf-8", newline="\r\n").write(c)
print("styles.css: %d -> %d chars" % (css_len, len(c)))
