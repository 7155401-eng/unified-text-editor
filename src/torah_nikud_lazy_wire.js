// Lightweight startup wiring for the optional Torah nikud tool.
// Keep the full modal/UI/i18n graph out of the editor entry chunk until the
// user explicitly invokes the tool.

import { trimTorahOrTextForFreeUser } from "./torah_free_limit.js";

let _modulePromise = null;

function loadTorahNikudModule() {
  if (!_modulePromise) {
    _modulePromise = import("./torah_nikud/torah_nikud.js").catch((error) => {
      _modulePromise = null;
      throw error;
    });
  }
  return _modulePromise;
}

function getSelectedOrAllText(paneManager) {
  try {
    const editor = paneManager?.getActiveEditor?.();
    if (editor?.state?.selection) {
      const { from, to, empty } = editor.state.selection;
      if (!empty) {
        return {
          text: editor.state.doc.textBetween(from, to, " ", " "),
          editor,
        };
      }
      return {
        text: editor.state.doc.textBetween(0, editor.state.doc.content.size, " ", " "),
        editor,
      };
    }
  } catch (_) {}

  try {
    const selection = window.getSelection?.();
    if (selection?.toString().trim()) {
      return { text: selection.toString(), editor: null };
    }
  } catch (_) {}

  return { text: "", editor: null };
}

function replaceInEditor(editor, text) {
  if (!editor || !text) return false;
  try {
    const { from, to, empty } = editor.state.selection;
    if (!empty) editor.chain().focus().insertContentAt({ from, to }, text).run();
    else editor.chain().focus().insertContent(text).run();
    return true;
  } catch (_) {
    return false;
  }
}

export function wireTorahNikud(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return false;
  if (toolbar.querySelector("#torah-nikud-btn")) return true;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "ניקוד אוטומטי";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "torah-nikud-btn";
  btn.textContent = "🪶 ניקוד אוטומטי";
  btn.title = "פותח את כלי הניקוד המדוייק (AI) של RavText";

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");

    try {
      const { text, editor } = getSelectedOrAllText(paneManager);
      const limited = trimTorahOrTextForFreeUser(text);
      const { openTorahNikudModal } = await loadTorahNikudModule();
      await openTorahNikudModal({
        initialText: limited.text,
        onResult: (vocalized) => {
          if (editor) replaceInEditor(editor, vocalized);
        },
      });
    } catch (error) {
      console.warn("[torah-nikud] lazy load/open failed:", error);
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });

  group.appendChild(btn);
  toolbar.appendChild(group);
  return true;
}
