// word_extractor.worker.js
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

self.onmessage = async (ev) => {
  const { type, id, payload } = ev.data;
  const t0 = Date.now();
  try {
    await ensureDOMParser();
    let result;

    if (type === 'scan') {
      const buf = payload.buf;
      const [titles, headerFooter, sections, styles, sources, stylesFull] = await Promise.all([
        extract_doc_titles(buf.slice(0)),
        extract_headers_footers(buf.slice(0)),
        find_sections_in_docx(buf.slice(0)),
        find_all_styles_in_docx(buf.slice(0)),
        find_all_note_sources(buf.slice(0)),
        find_all_styles_full(buf.slice(0)),
      ]);
      result = { titles, headerFooter, sections, styles, sources, stylesFull };
      // לוג פנימי — מוחזר עם התוצאה לחוט הראשי שישלח לשרת
      result._workerMs = Date.now() - t0;

    } else if (type === 'extract') {
      result = await docx_extract_simple(
        payload.buf,
        payload.simpleSelected,
        payload.options || {}
      );
      result._workerMs = Date.now() - t0;
    }

    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message || String(e), workerMs: Date.now() - t0 });
  }
};
