// word_extractor.js — main entry point for the standalone JS Word extractor.
// משלב את החלקים: dialog (UI), engine (port מ-word_extractor.py),
// streams (מיפוי A/B/C/D), i18n (מחרוזות).
//
// API ציבורי:
//   - openWordExtractor(paneManager, onLoaded)
//   - setupWordExtractor(paneManager, onLoaded)
//   - re-export של engine + streams לשימוש מתקדם.

import { openWordExtractor, closeModal as closeWordExtractorModal } from "./word_extractor_dialog.js";
import * as engine from "./word_extractor_engine.js";
import * as streams from "./word_extractor_streams.js";
import * as i18n from "./word_extractor_i18n.js";

let _paneManagerRef = null;
let _onLoadedRef = null;

export function setupWordExtractor(paneManager, onLoaded) {
  _paneManagerRef = paneManager || null;
  _onLoadedRef = onLoaded || null;
}

export function openImport() {
  return openWordExtractor(_paneManagerRef, _onLoadedRef);
}

export {
  openWordExtractor,
  closeWordExtractorModal,
  engine,
  streams,
  i18n,
};
