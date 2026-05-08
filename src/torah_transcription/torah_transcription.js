// torah_transcription — נקודת כניסה ראשית לכלי
// משתמש בעורך unified-text-editor: כפתור באזור הכלים פותח חלון תמלול,
// והתוצאה נשלפת חזרה ומוכנסת כזרם חדש בעורך.

import "./torah_transcription.css";
import { TranscriptionWindow } from "./torah_transcription_ui.js";

/**
 * מחבר כפתור "תמלול אודיו" לאזור הכלים.
 * paneManager — מנהל החלוניות של העורך (בעל getActiveEditor).
 */
export function wireTorahTranscription(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;

  // אם הכפתור כבר קיים — לא להוסיף שוב (במידה ו-wireTorahTools רץ שוב)
  if (toolbar.querySelector("#tt-trigger-btn")) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "תמלול אודיו";

  const btn = document.createElement("button");
  btn.id = "tt-trigger-btn";
  btn.type = "button";
  btn.textContent = "🎙 תמלול אודיו";
  btn.title = "תמלול קובץ אודיו/וידאו דרך Gemini עם הכרעת נוסח (Apps Script)";
  btn.addEventListener("click", () => openTranscriptionWindow(paneManager));
  group.appendChild(btn);

  toolbar.appendChild(group);
}

/**
 * פותח את חלון התמלול. ה-callback מחבר את התוצאה לעורך הפעיל.
 */
export function openTranscriptionWindow(paneManager) {
  const win = new TranscriptionWindow({
    onResult: (text, kind) => {
      const editor = paneManager && paneManager.getActiveEditor
        ? paneManager.getActiveEditor()
        : null;
      if (!editor) {
        try { window.alert("אין עורך פעיל. בחר חלונית כדי להכניס את הטקסט."); }
        catch (e) {}
        return;
      }
      // הכנסת התוצאה כפסקאות חדשות בעורך הפעיל.
      // נשתמש בהמרה פשוטה של שורות לפסקאות. שורה ריקה → פסקה ריקה.
      const lines = String(text || "").split(/\r?\n/);
      const html = lines.map((l) => {
        if (!l.trim()) return "<p></p>";
        const safe = l
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<p>${safe}</p>`;
      }).join("");
      try {
        editor.chain().focus().insertContent(html).run();
      } catch (e) {
        try { editor.chain().focus().insertContent(text).run(); }
        catch (e2) {}
      }
    },
  });
  win.open(document.body);
  return win;
}
