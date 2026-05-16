// word_extractor.js — main entry point for the standalone JS Word extractor.
// משלב את החלקים: dialog (UI), engine (port מ-word_extractor.py),
// streams (מיפוי A/B/C/D), i18n (מחרוזות).
//
// API ציבורי:
//   - openWordExtractor(paneManager, onLoaded)
//   - setupWordExtractor(paneManager, onLoaded)
//   - re-export של engine + streams לשימוש מתקדם.

import { openWordExtractor as openWordExtractorDialog, closeModal as closeWordExtractorModal } from "./word_extractor_dialog.js";
import * as engine from "./word_extractor_engine.js";
import * as streams from "./word_extractor_streams.js";
import * as i18n from "./word_extractor_i18n.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";

let _paneManagerRef = null;
let _onLoadedRef = null;

function ensureOverwriteStylesCheckboxVisible() {
  const modal = document.getElementById("word-extractor-modal");
  if (!modal || modal.querySelector(".we-overwrite-styles")) return;

  const importStyles = modal.querySelector(".we-import-styles");
  if (!importStyles) return;

  const importStylesLabel = importStyles.closest("label");
  if (!importStylesLabel || !importStylesLabel.parentElement) return;

  const label = document.createElement("label");
  label.style.cssText = "display:block; padding:3px 0;";
  label.innerHTML = `
          <input type="checkbox" class="we-overwrite-styles" checked>
          דרוס סגנונות קיימים
        `;
  importStylesLabel.insertAdjacentElement("afterend", label);
}

function openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded) {
  const result = openWordExtractorDialog(paneManager, onLoaded);
  // הדיאלוג נבנה סינכרונית, אבל נשאיר גם דחייה קצרה למקרה שה-UI נטען בשלבים.
  ensureOverwriteStylesCheckboxVisible();
  setTimeout(ensureOverwriteStylesCheckboxVisible, 0);
  return result;
}

export function setupWordExtractor(paneManager, onLoaded) {
  _paneManagerRef = paneManager || null;
  _onLoadedRef = onLoaded || null;
}

export async function openImport() {
  await assertToolAllowed("word-extractor");
  return openWordExtractorDialogWithOverwriteStyles(_paneManagerRef, _onLoadedRef);
}

export async function openWordExtractor(paneManager, onLoaded) {
  await assertToolAllowed("word-extractor");
  return openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded);
}

export {
  closeWordExtractorModal,
  engine,
  streams,
  i18n,
};
