// torah_transcription — נקודת כניסה ראשית לכלי
// משתמש בעורך unified-text-editor: כפתור באזור הכלים פותח חלון תמלול,
// והתוצאה נשלפת חזרה ומוכנסת כזרם חדש בעורך.

import "./torah_transcription.css";
import { TranscriptionWindow } from "./torah_transcription_ui.js";

/**
 * משה 2026-05-10: שלושה כפתורים נפרדים — תמלול אודיו (STT), OCR (סריקת תמונה),
 * ועריכה לשונית תורנית (כניסה ישירה לשלב הסגנון התורני).
 * paneManager — מנהל החלוניות של העורך (בעל getActiveEditor).
 */
export function wireTorahTranscription(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;

  // אם הקבוצה כבר קיימת — לא להוסיף שוב
  if (toolbar.querySelector("#tt-trigger-btn")) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "תמלול ועריכה תורנית";

  // 1) תמלול אודיו (STT)
  const sttBtn = document.createElement("button");
  sttBtn.id = "tt-trigger-btn";
  sttBtn.type = "button";
  sttBtn.textContent = "🎙 תמלול אודיו";
  sttBtn.title = "תמלול קובץ אודיו/וידאו דרך Gemini עם הכרעת נוסח (Apps Script)";
  sttBtn.addEventListener("click", () =>
    openTranscriptionWindow(paneManager, { initialMode: "transcription" })
  );
  group.appendChild(sttBtn);

  // 2) OCR (סריקת תמונה / כתב יד / דפוס)
  const ocrBtn = document.createElement("button");
  ocrBtn.id = "tt-ocr-btn";
  ocrBtn.type = "button";
  ocrBtn.textContent = "🖼 OCR (סריקת תמונה)";
  ocrBtn.title = "זיהוי טקסט בכתב יד / דפוס מתמונה דרך Gemini";
  ocrBtn.addEventListener("click", () =>
    openTranscriptionWindow(paneManager, { initialMode: "ocr" })
  );
  group.appendChild(ocrBtn);

  // 3) עריכה לשונית תורנית (השלב האחרון בלבד — בלי תמלול)
  const lingBtn = document.createElement("button");
  lingBtn.id = "tt-linguistic-btn";
  lingBtn.type = "button";
  lingBtn.textContent = "✍ עריכה לשונית תורנית";
  lingBtn.title = "סגנון תורני (עתיק/מודרני/משולב) — מקבל טקסט מהעורך הפעיל או מההזנה";
  lingBtn.addEventListener("click", () => openLinguisticEditingWindow(paneManager));
  group.appendChild(lingBtn);

  toolbar.appendChild(group);
}

/**
 * פותח את חלון התמלול עם אפשרות לבחור מצב ראשוני.
 * opts: { initialMode?: "transcription"|"ocr", jumpToStep?: string, initialText?: string }
 */
export function openTranscriptionWindow(paneManager, opts = {}) {
  const win = new TranscriptionWindow({
    initialMode: opts.initialMode || null,
    jumpToStep: opts.jumpToStep || null,
    initialText: opts.initialText || "",
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

/**
 * משה 2026-05-10: עריכה לשונית תורנית — חלון נקי עם שלב הסגנון התורני בלבד.
 * לוקח טקסט מהעורך הפעיל (אם יש) או פותח חלון להזנה ידנית.
 */
export function openLinguisticEditingWindow(paneManager) {
  // ניסיון לקחת טקסט נבחר / טקסט שלם מהעורך
  let initialText = "";
  try {
    const editor = paneManager && paneManager.getActiveEditor
      ? paneManager.getActiveEditor() : null;
    if (editor) {
      const sel = editor.state.selection;
      if (sel && sel.from !== sel.to) {
        initialText = editor.state.doc.textBetween(sel.from, sel.to, "\n").trim();
      }
      if (!initialText) {
        initialText = editor.getText ? (editor.getText() || "").trim() : "";
      }
    }
  } catch (_) { /* */ }

  if (!initialText) {
    initialText = window.prompt(
      "הדבק את הטקסט לעריכה לשונית תורנית:",
      ""
    ) || "";
    if (!initialText.trim()) return null;
  }

  return openTranscriptionWindow(paneManager, {
    initialText,
    jumpToStep: "torah_style",
  });
}
