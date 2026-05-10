// בוט יוצר קריקטורות חרדיות — entry point לעורך הראשי.
//
// תרגום JS מלא של haredi_caricature_bot (Python+PyQt6) — שומר על:
//  - ההנחיות הסודיות יושבות אך ורק על Apps Script (לעולם לא בלקוח).
//  - "ללא נשים/בנות/דמויות נשיות" — נאכף בשרת, ההנחיה לא יוצאת ללקוח.
//  - "Warm not cynical" — נאכף בשרת.
//  - הסגנונות + הסצנות + יחסי המימדים — verbatim (presets.py).
//
// הקובץ הזה רק חושף את הפונקציה openCaricatureBot, ש-main.js יקרא לה
// כשהמשתמש לוחץ על "צור איור AI" בסרגל "עריכה תורנית".

import "./caricature.css";
import { openCaricatureWindow } from "./caricature_ui.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";
import { hasCurrentAppLicense } from "../current_license.js";

let _windowInstance = null;

/**
 * פותח את חלון הקריקטורות.
 * @param {object} opts
 * @param {boolean} [opts.licensed]            האם המשתמש בעל רישיון
 * @param {(img: {dataUrl:string, alt:string}) => void} [opts.onInsertImage]
 *        callback להכנסת התמונה לעורך הראשי
 * @param {string} [opts.initialScene]         טקסט פתיחה (טקסט נבחר מהעורך)
 */
export async function openCaricatureBot(opts = {}) {
  await assertToolAllowed("haredi-caricature");
  if (_windowInstance && _windowInstance.overlay && _windowInstance.overlay.parentNode) {
    _windowInstance.close();
  }
  const windowOpts = {
    ...opts,
    licensed: opts.licensed != null ? !!opts.licensed : hasCurrentAppLicense(),
  };
  _windowInstance = openCaricatureWindow(windowOpts);

  // Pre-fill initial scene if provided (e.g. from selected text)
  if (opts.initialScene) {
    const scene = String(opts.initialScene).trim();
    if (scene) {
      const tryFill = (attempts = 0) => {
        try {
          _windowInstance._lastSceneText = scene;
          _windowInstance._postToScene({ type: "hc-quill-set", text: scene });
        } catch (e) {}
        if (attempts < 20) {
          // iframe may not be ready yet; retry briefly
          setTimeout(() => {
            try {
              const cw = _windowInstance.sceneIframe &&
                         _windowInstance.sceneIframe.contentWindow;
              if (!cw || typeof cw.setText !== "function") {
                tryFill(attempts + 1);
              }
            } catch (e) { tryFill(attempts + 1); }
          }, 100);
        }
      };
      tryFill();
    }
  }

  return _windowInstance;
}

export { setGasUrl } from "./caricature_gas.js";

// משה 2026-05-10: wire — מוסיף כפתור "צור איור AI" לסרגל "תורני".
export function wireCaricatureBot(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;
  if (toolbar.querySelector("#hc-trigger-btn")) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "קריקטורה AI";

  const btn = document.createElement("button");
  btn.id = "hc-trigger-btn";
  btn.type = "button";
  btn.textContent = "🎭 צור איור AI";
  btn.title = "פתיחת חלון יצירת קריקטורה חרדית — Imagen דרך Apps Script";
  btn.addEventListener("click", async () => {
    await assertToolAllowed("haredi-caricature");
    // מנסים לקחת טקסט נבחר מהעורך הפעיל בתור scene
    let initialScene = "";
    try {
      const editor = paneManager && paneManager.getActiveEditor
        ? paneManager.getActiveEditor() : null;
      if (editor && editor.state && editor.state.selection) {
        const { from, to } = editor.state.selection;
        initialScene = editor.state.doc.textBetween(from, to, " ").trim();
      }
    } catch (_) { /* */ }
    await openCaricatureBot({
      initialScene,
      onInsertImage: (img) => {
        try {
          const editor = paneManager && paneManager.getActiveEditor
            ? paneManager.getActiveEditor() : null;
          if (!editor) return;
          editor.chain().focus().setImage({ src: img.dataUrl, alt: img.alt || "" }).run();
        } catch (e) { console.warn("[caricature] insert image failed:", e); }
      },
    });
  });
  group.appendChild(btn);
  toolbar.appendChild(group);
}
