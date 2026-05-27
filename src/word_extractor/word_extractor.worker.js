// word_extractor.worker.js
// רץ ב-Web Worker — DOMParser זמין (Chrome 87+, Firefox, Safari 14.1+).
// mammoth משתמש ב-document.createElement → נשאר בחוט הראשי.
// כל שאר הפעולות (JSZip + DOMParser דרך engine) — בטוחות כאן.

import {
  find_all_note_sources,
  extract_doc_titles,
  extract_headers_footers,
  find_sections_in_docx,
  find_all_styles_in_docx,
  docx_extract_simple,
  find_all_styles_full,
} from "./word_extractor_engine.js";

self.onmessage = async (ev) => {
  const { type, id, payload } = ev.data;
  try {
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

    } else if (type === 'extract') {
      result = await docx_extract_simple(
        payload.buf,
        payload.simpleSelected,
        payload.options || {}
      );
    }

    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
};
