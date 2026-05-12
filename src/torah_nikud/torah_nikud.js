// torah_nikud.js — main entry. Wires a "ניקוד אוטומטי" button into the
// torah-toolbar of the unified editor and opens the modal on click.

import { openTorahNikudModal as openTorahNikudModalUi } from "./torah_nikud_ui.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";
import { trimTorahOrTextForFreeUser } from "../torah_free_limit.js";

export async function openTorahNikudModal(options = {}) {
  await assertToolAllowed("torah-nikud");
  return openTorahNikudModalUi(options);
}

// Returns the active editor's selected text, or its full text if no
// selection exists. Tries Tiptap-style API first, then plain DOM.
function getSelectedOrAllText(paneManager) {
  try {
    const ed = paneManager && paneManager.getActiveEditor && paneManager.getActiveEditor();
    if (ed && ed.state && ed.state.selection) {
      const { from, to, empty } = ed.state.selection;
      if (!empty) {
        return { text: ed.state.doc.textBetween(from, to, " ", " "), editor: ed };
      }
      // Fallback to whole-doc text
      return { text: ed.state.doc.textBetween(0, ed.state.doc.content.size, " ", " "), editor: ed };
    }
  } catch (e) { /* noop */ }
  // Fallback: clipboard-style — read the body's selection
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.toString().trim()) return { text: sel.toString(), editor: null };
  } catch (e) { /* noop */ }
  return { text: "", editor: null };
}

function replaceInEditor(editor, text) {
  if (!editor || !text) return false;
  try {
    const { from, to, empty } = editor.state.selection;
    if (!empty) {
      editor.chain().focus().insertContentAt({ from, to }, text).run();
    } else {
      editor.chain().focus().insertContent(text).run();
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function wireTorahNikud(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;

  // Avoid duplicate wire
  if (toolbar.querySelector("#torah-nikud-btn")) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "ניקוד אוטומטי";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "torah-nikud-btn";
  btn.textContent = "🪶 ניקוד אוטומטי";
  btn.title = "פותח את כלי הניקוד המדוייק (AI) של RavText";
  btn.addEventListener("click", async () => {
    const { text, editor } = getSelectedOrAllText(paneManager);
    const limited = trimTorahOrTextForFreeUser(text);
    await openTorahNikudModal({
      initialText: limited.text,
      onResult: (vocalized) => {
        if (editor) replaceInEditor(editor, vocalized);
      },
    });
  });
  group.appendChild(btn);

  toolbar.appendChild(group);
}
