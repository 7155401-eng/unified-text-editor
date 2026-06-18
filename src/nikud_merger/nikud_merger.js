// nikud_merger.js
// ===============
// נקודת כניסה לכלי nikud_merger בתוך העורך.
//   • openNikudMerger(opts) — פותח את החלון כ-modal
//   • wireNikudMergerButton(paneManager) — מוסיף כפתור "מיזוג ניקוד" ב-toolbar

import "./nikud_merger.css";
import { MainView } from "./nikud_ui.js";
import * as theme from "./nikud_theme.js";
import * as i18n from "./nikud_i18n.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";
import { openToolStartupOverlay } from "../tool_startup_overlay.js";

let _activeMainView = null;
let _activeBackdrop = null;

/**
 * פתיחת חלון מיזוג ניקוד כ-modal.
 *
 * @param {object} opts
 *   - cleanText: string — טקסט מקור בלי ניקוד (אם קיים)
 *   - vocalizedText: string — טקסט מנוקד התחלתי (אם קיים)
 *   - onAcceptResult: (text:string) => void — קריאה כשמשתמש לוחץ "קבל הכל"
 *
 * @returns MainView — אובייקט המסך, אפשר לסגור עם .destroy()
 */
export async function openNikudMerger(opts = {}) {
  if (_activeBackdrop) return _activeMainView;  // כבר פתוח

  const loader = openToolStartupOverlay({
    title: "מיזוג ניקוד",
    message: "פותח חלון ומכין את הכלי…",
  });

  try {
    await Promise.resolve(); // let the loading UI paint before permission work starts
    loader.set(24, "בודק הרשאה…");
    await assertToolAllowed("nikud-merger");

    loader.set(62, "בונה את חלון המיזוג…");

    // החלת פונט עברי על האפליקציה הזו
    theme.applyHebrewFont();

    const backdrop = document.createElement("div");
    backdrop.className = "nikud-modal-backdrop";

    const main = new MainView();
    _activeMainView = main;
    _activeBackdrop = backdrop;

    // אם הוזרמו נתונים / מנוקד — נטען לתיבות
    if (opts.cleanText || opts.vocalizedText) {
      const state = main.merger.getState();
      state.clean_text = opts.cleanText || state.clean_text || "";
      if (opts.vocalizedText !== undefined) {
        state.vocalized_sources = [
          { name: i18n.isRtl() ? "מקור 1" : "Source 1", text: opts.vocalizedText },
        ];
      }
      main.merger.setState(state);
    }

    // סגירה
    main.on("close", () => {
      closeNikudMerger();
    });

    // קליק מחוץ לחלון = סגירה
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) closeNikudMerger();
    });

    backdrop.appendChild(main.root);
    document.body.appendChild(backdrop);

    loader.set(100, "מוכן.");

    // פוקוס לקיצורי מקלדת
    setTimeout(() => { try { main.root.focus(); } catch (_) {} }, 50);

    return main;
  } catch (err) {
    closeNikudMerger();
    throw err;
  } finally {
    loader.close();
  }
}


export function closeNikudMerger() {
  if (_activeMainView) {
    try { _activeMainView.destroy(); } catch (_) {}
    _activeMainView = null;
  }
  if (_activeBackdrop) {
    _activeBackdrop.remove();
    _activeBackdrop = null;
  }
}


/**
 * חיבור כפתור "מיזוג ניקוד" לסרגל הכלים של העורך.
 * קריאה אחת ב-startup; מחפש את toolbar.torah-toolbar (או .insert-toolbar
 * כ-fallback) ומוסיף כפתור עם אייקון 🧙 שפותח את החלון.
 *
 * @param {object} paneManager — מנהל החלוניות של העורך הראשי. מותר להעביר null.
 */
export function wireNikudMergerButton(paneManager) {
  // מטה 2026-05-08: יעד ראשי = סרגל "סקירה". fallback ל-tab "תורני" / "הוספה".
  const reviewToolbar = document.querySelector(".review-toolbar");
  const torahToolbar  = document.querySelector(".torah-toolbar");
  const insertToolbar = document.querySelector(".insert-toolbar");
  const target = reviewToolbar || torahToolbar || insertToolbar;
  if (!target) return;

  // אם כפתור כבר קיים, אל תוסיף שוב
  if (document.getElementById("btn-nikud-merger")) return;

  const sep = document.createElement("span");
  sep.className = "sep";

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "מיזוג ניקוד";

  const btn = document.createElement("button");
  btn.id = "btn-nikud-merger";
  btn.type = "button";
  btn.title = "פתח חלון מיזוג ניקוד — מיזוג טקסט מקור עם מקור מנוקד";
  btn.textContent = "📜 מיזוג ניקוד";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");

    // ננסה לאסוף את הטקסט הנבחר מהעורך הפעיל כטקסט מקור ראשוני
    let cleanText = "";
    try {
      const ed = paneManager && paneManager.getActiveEditor && paneManager.getActiveEditor();
      if (ed && ed.state && ed.state.selection) {
        const { from, to } = ed.state.selection;
        if (from !== to) {
          cleanText = ed.state.doc.textBetween(from, to, "\n");
        }
      }
    } catch (_) { /** ignore — open empty */ }

    try {
      await openNikudMerger({ cleanText });
    } catch (err) {
      console.warn("[nikud-merger] blocked:", err);
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });
  group.appendChild(btn);

  target.appendChild(sep);
  target.appendChild(group);
}
