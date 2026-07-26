// torah_transcription — נקודת כניסה ראשית לכלי
// משתמש בעורך unified-text-editor: כפתור באזור הכלים פותח חלון תמלול,
// והתוצאה נשלפת חזרה ומוכנסת כזרם חדש בעורך.

import "./torah_transcription.css";
import { TranscriptionWindow } from "./torah_transcription_ui.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";
import { openTorahLinguisticEditor } from "./torah_linguistic_editing.js";

const ELEVENLABS_AUDIO_VIDEO_EXTS = new Set([
  ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac",
  ".mp4", ".mov", ".avi", ".mkv", ".webm",
]);

function _ttSuffixLower(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i).toLowerCase() : "";
}

function _ttIsAudioOrVideo(name) {
  return ELEVENLABS_AUDIO_VIDEO_EXTS.has(_ttSuffixLower(name));
}

function _ttElevenLabsRuns(win) {
  const cardVisible = !!(win && win.elevenCard && win.elevenCard.style.display !== "none");
  const stateRuns = parseInt((win && win.appState && win.appState.elevenlabs_runs) || 0, 10) || 0;
  if (!cardVisible) return stateRuns;
  const sliderRuns = parseInt((win && win.elevenRunsSlider && win.elevenRunsSlider.value) || 0, 10) || 0;
  return Math.max(1, sliderRuns || stateRuns || 1);
}

function _ttElevenLabsKey(win) {
  return String(
    (win && win.elevenlabsEntry && win.elevenlabsEntry.value) ||
    (win && win.appState && win.appState.elevenlabs_api_key) ||
    ""
  ).trim();
}

function _ttElevenLabsGuardMessage(win) {
  try {
    if (!win || !win.appState) return "";
    const isTranscriptionMode = win.modeTrans ? !!win.modeTrans.checked : win.appState.mode === "transcription";
    if (!isTranscriptionMode) return "";

    const filename = win.appState.file_name || win.appState.file_path || "";
    if (!_ttIsAudioOrVideo(filename)) return "";

    const runs = _ttElevenLabsRuns(win);
    if (runs <= 0 || _ttElevenLabsKey(win)) return "";

    return (
      "השירות הנוסף של ElevenLabs הופעל לעדי נוסח, אבל לא הוזן מפתח ElevenLabs.\n\n" +
      "חזור לשלב 'חשבון' והזן מפתח ElevenLabs, או חזור לשלב ההגדרות והסר את השירות הנוסף.\n\n" +
      "התמלול הרגיל דרך Gemini ימשיך לעבוד בלי מפתח ElevenLabs."
    );
  } catch (e) {
    return "";
  }
}

function installElevenLabsKeyGuard() {
  const proto = TranscriptionWindow && TranscriptionWindow.prototype;
  if (!proto || proto.__ravtextElevenLabsKeyGuardInstalled) return;

  Object.defineProperty(proto, "__ravtextElevenLabsKeyGuardInstalled", {
    value: true,
    configurable: false,
  });

  const originalValidateStep = proto._validateStep;
  if (typeof originalValidateStep === "function") {
    proto._validateStep = function _validateStepWithElevenLabsGuard(idx, ...args) {
      const err = originalValidateStep.call(this, idx, ...args);
      if (err) return err;
      if (idx === 2) return _ttElevenLabsGuardMessage(this) || "";
      return "";
    };
  }

  const originalOnRun = proto._onRun;
  if (typeof originalOnRun === "function") {
    proto._onRun = function _onRunWithElevenLabsGuard(...args) {
      const err = _ttElevenLabsGuardMessage(this);
      if (err) {
        try { window.alert("חסר מפתח ElevenLabs\n\n" + err); }
        catch (e) {}
        return;
      }
      return originalOnRun.apply(this, args);
    };
  }

  const originalRefreshRunSummary = proto._refreshRunSummary;
  if (typeof originalRefreshRunSummary === "function") {
    proto._refreshRunSummary = function _refreshRunSummaryWithElevenLabsGuard(...args) {
      const result = originalRefreshRunSummary.apply(this, args);
      try {
        const s = this.appState || {};
        const runs = parseInt(s.elevenlabs_runs, 10) || 0;
        if (
          this.summaryLabel &&
          s.mode === "transcription" &&
          runs > 0 &&
          _ttIsAudioOrVideo(s.file_name || s.file_path || "") &&
          !String(this.summaryLabel.textContent || "").includes("ElevenLabs")
        ) {
          this.summaryLabel.textContent += `\n• עדי ElevenLabs: ${runs} (דורש מפתח ElevenLabs בשלב חשבון)`;
        }
      } catch (e) {}
      return result;
    };
  }
}

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
  sttBtn.addEventListener("click", async () => {
    await assertToolAllowed("torah-transcription");
    await openTranscriptionWindow(paneManager, { initialMode: "transcription" });
  });
  group.appendChild(sttBtn);

  // 2) OCR (סריקת תמונה / כתב יד / דפוס)
  const ocrBtn = document.createElement("button");
  ocrBtn.id = "tt-ocr-btn";
  ocrBtn.type = "button";
  ocrBtn.textContent = "🖼 OCR (סריקת תמונה)";
  ocrBtn.title = "זיהוי טקסט בכתב יד / דפוס מתמונה דרך Gemini";
  ocrBtn.addEventListener("click", async () => {
    await assertToolAllowed("torah-transcription");
    await openTranscriptionWindow(paneManager, { initialMode: "ocr" });
  });
  group.appendChild(ocrBtn);

  // 3) עריכה לשונית תורנית (השלב האחרון בלבד — בלי תמלול)
  const lingBtn = document.createElement("button");
  lingBtn.id = "tt-linguistic-btn";
  lingBtn.type = "button";
  lingBtn.textContent = "✍ עריכה לשונית תורנית";
  lingBtn.title = "סגנון תורני (עתיק/מודרני/משולב) — מקבל טקסט מהעורך הפעיל או מההזנה";
  lingBtn.addEventListener("click", async () => {
    await assertToolAllowed("torah-transcription");
    await openLinguisticEditingWindow(paneManager);
  });
  group.appendChild(lingBtn);

  toolbar.appendChild(group);
}

/**
 * פותח את חלון התמלול עם אפשרות לבחור מצב ראשוני.
 * opts: { initialMode?: "transcription"|"ocr", jumpToStep?: string, initialText?: string }
 */
export async function openTranscriptionWindow(paneManager, opts = {}) {
  await assertToolAllowed("torah-transcription");
  installElevenLabsKeyGuard();
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
export async function openLinguisticEditingWindow(paneManager) {
  await assertToolAllowed("torah-transcription");
  return openTorahLinguisticEditor({ paneManager });
}
