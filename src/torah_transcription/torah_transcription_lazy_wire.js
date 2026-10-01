// Lightweight startup wiring for the optional transcription/OCR editor.
// The full UI, CSS and processing helpers are loaded only after an allowed
// user action, so ordinary editor startup does not parse the tool implementation.

import { assertToolAllowed } from "../tool_runtime_gate.js";

let toolModulePromise = null;

function loadToolModule() {
  if (!toolModulePromise) {
    toolModulePromise = import("./torah_transcription.js").catch((error) => {
      toolModulePromise = null;
      throw error;
    });
  }
  return toolModulePromise;
}

async function openAfterGate(toolName, paneManager, opener) {
  await assertToolAllowed(toolName);
  const mod = await loadToolModule();
  return opener(mod, paneManager);
}

export function wireTorahTranscription(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;
  if (toolbar.querySelector("#tt-trigger-btn")) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "תמלול ועריכה תורנית";

  const sttBtn = document.createElement("button");
  sttBtn.id = "tt-trigger-btn";
  sttBtn.type = "button";
  sttBtn.textContent = "🎙 תמלול אודיו";
  sttBtn.title = "תמלול קובץ אודיו/וידאו דרך Gemini עם הכרעת נוסח (Apps Script)";
  sttBtn.addEventListener("click", async () => {
    await openAfterGate(
      "torah-transcription",
      paneManager,
      (mod, manager) => mod.openTranscriptionWindow(manager, { initialMode: "transcription" })
    );
  });
  group.appendChild(sttBtn);

  const ocrBtn = document.createElement("button");
  ocrBtn.id = "tt-ocr-btn";
  ocrBtn.type = "button";
  ocrBtn.textContent = "🖼 OCR (סריקת תמונה)";
  ocrBtn.title = "זיהוי טקסט בכתב יד / דפוס מתמונה דרך Gemini";
  ocrBtn.addEventListener("click", async () => {
    await openAfterGate(
      "torah-ocr",
      paneManager,
      (mod, manager) => mod.openTranscriptionWindow(manager, { initialMode: "ocr" })
    );
  });
  group.appendChild(ocrBtn);

  const lingBtn = document.createElement("button");
  lingBtn.id = "tt-linguistic-btn";
  lingBtn.type = "button";
  lingBtn.textContent = "✍ עריכה לשונית תורנית";
  lingBtn.title = "סגנון תורני (עתיק/מודרני/משולב) — מקבל טקסט מהעורך הפעיל או מההזנה";
  lingBtn.addEventListener("click", async () => {
    await openAfterGate(
      "torah-transcription",
      paneManager,
      (mod, manager) => mod.openLinguisticEditingWindow(manager)
    );
  });
  group.appendChild(lingBtn);

  toolbar.appendChild(group);
}
