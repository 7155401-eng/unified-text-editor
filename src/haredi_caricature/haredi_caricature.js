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

let _windowInstance = null;

/**
 * פותח את חלון הקריקטורות.
 * @param {object} opts
 * @param {boolean} [opts.licensed]            האם המשתמש בעל רישיון
 * @param {(img: {dataUrl:string, alt:string}) => void} [opts.onInsertImage]
 *        callback להכנסת התמונה לעורך הראשי
 * @param {string} [opts.initialScene]         טקסט פתיחה (טקסט נבחר מהעורך)
 */
export function openCaricatureBot(opts = {}) {
  if (_windowInstance && _windowInstance.overlay && _windowInstance.overlay.parentNode) {
    _windowInstance.close();
  }
  _windowInstance = openCaricatureWindow(opts);

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
