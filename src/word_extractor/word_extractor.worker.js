// word_extractor.worker.js
// Runs the heavy DOCX XML work off the browser main thread.
// mammoth stays on the main thread because it depends on document APIs.
//
// 2026-05-31: ההנחה הקודמת ("DOMParser זמין ב-Chrome 87+") שגויה — DOMParser
// אינו זמין ב-Web Worker בכרום (ReferenceError). ensureDOMParser טוען shim
// pure-JS פעם אחת לפני שכל אחת מפונקציות ה-engine רצה.

import {
  find_all_note_sources,
  extract_doc_titles,
  extract_headers_footers,
  find_sections_in_docx,
  find_all_styles_in_docx,
  docx_extract_simple,
  find_all_styles_full,
  ensureDOMParser,
} from "./word_extractor_engine.js";

function sendProgress(id, { progress = null, message = "", indeterminate = false } = {}) {
  self.postMessage({ type: "progress", id, progress, message, indeterminate });
}

self.onmessage = async (ev) => {
  const { type, id, payload } = ev.data;
  const t0 = Date.now();

  try {
    sendProgress(id, { message: "מכין את מנוע הייבוא...", indeterminate: true });
    await ensureDOMParser();
    let result = null;

    if (type === "scan") {
      const buf = payload.buf;
      const jobs = [
        ["כותרות", () => extract_doc_titles(buf.slice(0))],
        ["כותרות עליונות ותחתונות", () => extract_headers_footers(buf.slice(0))],
        ["מקטעים", () => find_sections_in_docx(buf.slice(0))],
        ["סגנונות", () => find_all_styles_in_docx(buf.slice(0))],
        ["מקורות הערות", () => find_all_note_sources(buf.slice(0))],
        ["קטלוג סגנונות מלא", () => find_all_styles_full(buf.slice(0))],
      ];
      let completed = 0;
      sendProgress(id, { progress: 5, message: "סורק את המסמך..." });
      const tracked = jobs.map(([label, run]) => Promise.resolve()
        .then(run)
        .then(value => {
          completed += 1;
          const progress = 5 + Math.round((completed / jobs.length) * 90);
          sendProgress(id, {
            progress,
            message: `סורק את המסמך... ${completed}/${jobs.length} — ${label}`,
          });
          return value;
        }));
      const [titles, headerFooter, sections, styles, sources, stylesFull] = await Promise.all(tracked);

      result = { titles, headerFooter, sections, styles, sources, stylesFull };
      result._workerMs = Date.now() - t0;
    } else if (type === "extract") {
      sendProgress(id, { message: "מחלץ את הטקסט וההערות...", indeterminate: true });
      result = await docx_extract_simple(
        payload.buf,
        payload.simpleSelected,
        payload.options || {}
      );
      result._workerMs = Date.now() - t0;
    } else {
      throw new Error(`Unknown worker message type: ${type}`);
    }

    sendProgress(id, { progress: 100, message: "מסיים..." });
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({
      id,
      ok: false,
      error: e?.message || String(e),
      workerMs: Date.now() - t0,
    });
  }
};
