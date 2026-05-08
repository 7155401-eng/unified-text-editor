// sefaria.js — main entry point.
// Wires two buttons into the editor's torah toolbar:
//   📖 הורד ספר            — opens sefaria_downloader_modal
//   🔍 השלם פסוקים בטקסט   — opens sefaria_live_modal
// Both can pre-fill from the active stream (Moshe's "כל כלי כפעולה על זרם").

import { openSefariaDownloader } from "./sefaria_downloader_modal.js";
import { openSefariaLive } from "./sefaria_live_modal.js";
import { t } from "./sefaria_i18n.js";

import "./sefaria_modal.css";

function _selectedTextFromEditor(paneManager) {
  try {
    const ed = paneManager && paneManager.getActiveEditor && paneManager.getActiveEditor();
    if (!ed) return "";
    const { from, to, empty } = ed.state.selection;
    if (empty) return "";
    return ed.state.doc.textBetween(from, to, " ", " ");
  } catch (_) { return ""; }
}

function _streamTextFromEditor(paneManager) {
  // If there's a selection use it; otherwise grab the active stream's text.
  try {
    const sel = _selectedTextFromEditor(paneManager);
    if (sel) return sel;
    const ed = paneManager && paneManager.getActiveEditor && paneManager.getActiveEditor();
    if (!ed) return "";
    return ed.state.doc.textContent || "";
  } catch (_) { return ""; }
}

function _insertHtmlAtCursor(paneManager, html) {
  try {
    const ed = paneManager && paneManager.getActiveEditor && paneManager.getActiveEditor();
    if (!ed) return;
    ed.chain().focus().insertContent(html).run();
  } catch (_) {}
}

// Default loader: trigger the editor's docx import flow.
// We delegate to window.RavTextLoadDocxBlob if the editor exposes one;
// otherwise fall back to download-only behavior.
async function _defaultLoadDocxIntoEditor(blob, filename) {
  // Try the optional global hook first (editor wires it during boot).
  if (typeof window.RavTextLoadDocxBlob === "function") {
    return window.RavTextLoadDocxBlob(blob, filename);
  }
  if (typeof window.ravtextLoadDocxBlob === "function") {
    return window.ravtextLoadDocxBlob(blob, filename);
  }
  // Last-resort: download as before.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename || "sefaria.docx";
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (_) {} }, 200);
}

export function wireSefariaTools(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;

  // Add a single Sefaria-tools group at the end of the existing torah
  // toolbar (do NOT replaceChildren — the existing torah_tools.js owns
  // the rest of the bar and we must not touch its content).
  let group = toolbar.querySelector(".sef-tool-group");
  if (group) group.remove();
  group = document.createElement("span");
  group.className = "tb-group sef-tool-group";
  group.dataset.title = "ספריא";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "sef-tool-btn";
  downloadBtn.textContent = t("tool_download_book");
  downloadBtn.title = t("tool_download_book");
  downloadBtn.addEventListener("click", () => {
    openSefariaDownloader({
      loadDocxIntoEditor: _defaultLoadDocxIntoEditor,
    });
  });

  const completeBtn = document.createElement("button");
  completeBtn.type = "button";
  completeBtn.className = "sef-tool-btn";
  completeBtn.textContent = t("tool_complete_verses");
  completeBtn.title = t("tool_complete_verses");
  completeBtn.addEventListener("click", () => {
    const prefill = _streamTextFromEditor(paneManager);
    openSefariaLive({
      prefillText: prefill,
      onAccept: html => _insertHtmlAtCursor(paneManager, html),
      isVip: false,  // wired to license/quota in the main editor harness
    });
  });

  group.append(downloadBtn, completeBtn);
  toolbar.appendChild(group);
}

// Re-exports so other code (tests, debug consoles) can poke individual
// pieces without going through the toolbar wiring.
export { openSefariaDownloader, openSefariaLive };
