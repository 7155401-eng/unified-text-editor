// Comparator tool — מנוע וורד (Word DOCX engine)
// Verbatim port of comparator_tool.py docx_find_streams / docx_extract /
// extract_word_with_html_formatting / extract_paragraph_html.
// Python: zipfile + xml.etree.ElementTree → JS: JSZip + DOMParser.

// JSZip is loaded as a script tag (window.JSZip) before this module loads.
// Same convention as the Python: <script src="vendor/jszip.min.js"></script>.

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ─── helpers ───
function _qNS(tag) { return `*|${tag}`; }

// equivalent of Python's _dplain(el): join all <w:t> text nodes
function _dplain(el) {
  if (!el) return '';
  const texts = el.getElementsByTagNameNS(WNS, 't');
  let out = '';
  for (let i = 0; i < texts.length; i++) {
    out += texts[i].textContent || '';
  }
  return out;
}

// equivalent of Python's _dnotes(fp, xf, tag): build dict {id → plain_text}
async function _dnotes(zip, xfPath, tag) {
  const notes = {};
  try {
    const file = zip.file(xfPath);
    if (!file) return notes;
    const xmlText = await file.async('string');
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const nodes = doc.getElementsByTagNameNS(WNS, tag);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const nid = n.getAttributeNS(WNS, 'id');
      if (nid === null || nid === undefined) continue;
      const idNum = parseInt(nid, 10);
      if (!Number.isFinite(idNum) || idNum <= 0) continue;
      notes[nid] = _dplain(n);
    }
  } catch (_) { /* swallow like Python's try/except */ }
  return notes;
}

// ─── docx_find_streams ───
// Returns the list of "streams" (footnote / endnote / comment groups,
// keyed by @NN markers found in their text). Verbatim from Python.
export async function docx_find_streams(file) {
  const zip = await _readDocxZip(file);
  const streams = [];

  async function _scan(xfPath, tag, src, heb) {
    try {
      const f = zip.file(xfPath);
      if (!f) return;
      const xmlText = await f.async('string');
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      const all = doc.getElementsByTagNameNS(WNS, tag);
      // Python filters: id > (-1 if tag=='comment' else 0)
      // → comments accept id ≥ 0; footnotes/endnotes only id > 0
      const minId = tag === 'comment' ? -1 : 0;
      const allN = [];
      for (let i = 0; i < all.length; i++) {
        const n = all[i];
        const nidRaw = n.getAttributeNS(WNS, 'id');
        const nid = parseInt(nidRaw === null ? (tag === 'comment' ? '-1' : '0') : nidRaw, 10);
        if (Number.isFinite(nid) && nid > minId) allN.push(n);
      }
      const mk = {}; // marker → count
      let um = 0;
      for (const n of allN) {
        const txt = _dplain(n);
        const m = /@(\d+)/.exec(txt);
        if (m) mk[m[1]] = (mk[m[1]] || 0) + 1;
        else um += 1;
      }
      const sortedKeys = Object.keys(mk).sort();
      for (const m of sortedKeys) {
        streams.push({
          id: `${src}_@${m}`,
          source: src,
          marker: m,
          label: `${heb} @${m}`,
          count: mk[m]
        });
      }
      if (um) {
        streams.push({
          id: `${src}_none`,
          source: src,
          marker: null,
          label: `${heb} ללא סימון (${um})`,
          count: um
        });
      }
    } catch (_) { /* swallow like Python */ }
  }

  await _scan('word/footnotes.xml', 'footnote', 'footnote', 'שוליים');
  await _scan('word/endnotes.xml', 'endnote', 'endnote', 'סיום');
  await _scan('word/comments.xml', 'comment', 'comment', 'בלון');

  // v11.52 — load external linked documents from cache (PR #20 integration).
  // In the Python version this reads "last_external_links.json" from the
  // script directory. In the browser we look in localStorage under the same
  // key — the main app can populate it when the user adds an external link.
  try {
    const raw = localStorage.getItem('ravtext.comparator.lastExternalLinks');
    if (raw) {
      const extLinks = JSON.parse(raw) || [];
      for (const el of extLinks) {
        try {
          streams.push({
            id: el.id,
            source: 'external',
            marker: el.target_marker || null,
            label: el.label || el.title || 'קישור חיצוני',
            count: el.count || 0,
            external_file: el.external_file,
            external_marker: el.external_marker,
            target_marker: el.target_marker,
          });
        } catch (_) { continue; }
      }
    }
  } catch (_) {}

  return streams;
}

// ─── docx_extract ───
// Returns { main, streams: [[sym, joined_notes_text], ...] }
// Verbatim port of Python docx_extract().
export async function docx_extract(file, selected) {
  const zip = await _readDocxZip(file);
  const fn_d = await _dnotes(zip, 'word/footnotes.xml', 'footnote');
  const en_d = await _dnotes(zip, 'word/endnotes.xml', 'endnote');
  const cm_d = await _dnotes(zip, 'word/comments.xml', 'comment');

  const fn_m = {}, en_m = {}, cm_m = {};
  let fn_n = null, en_n = null, cm_n = null;
  const sn = {};

  for (const item of selected) {
    const st = item[0];
    const sym = item[1];
    sn[sym] = [];
    const src = st.source;
    const mk = st.marker;
    if (src === 'footnote') {
      if (mk) fn_m[mk] = sym; else fn_n = sym;
    } else if (src === 'endnote') {
      if (mk) en_m[mk] = sym; else en_n = sym;
    } else if (src === 'comment') {
      if (mk) cm_m[mk] = sym; else cm_n = sym;
    }
  }

  function _res(txt, m2s, nsym) {
    const m = /@(\d+)/.exec(txt);
    if (m && (m[1] in m2s)) {
      // strip leading "...@N : ?:?\s*"
      const safe = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^.*?@' + safe + '\\s*:?\\s*');
      return [m2s[m[1]], txt.replace(re, '').trim()];
    } else if (nsym && !m) {
      return [nsym, txt.trim()];
    }
    return [null, txt.trim()];
  }

  const parts = [];
  let mainErr = null;
  try {
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('word/document.xml not found');
    const xmlText = await docFile.async('string');
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const paras = doc.getElementsByTagNameNS(WNS, 'p');

    for (let pi = 0; pi < paras.length; pi++) {
      const para = paras[pi];
      const pt = [];
      // walk descendants in document order (Python's element.iter())
      const walker = document.createTreeWalker(
        para,
        NodeFilter.SHOW_ELEMENT,
        null
      );
      // Custom walk because TreeWalker on a foreign document may not work in all browsers
      const stack = [para];
      const visit = (node) => {
        if (node.namespaceURI === WNS) {
          const local = node.localName;
          if (local === 't') {
            if (node.textContent) pt.push(node.textContent);
          } else if (local === 'footnoteReference') {
            const fid = node.getAttributeNS(WNS, 'id');
            if (fid in fn_d) {
              const r = _res(fn_d[fid], fn_m, fn_n);
              const s = r[0], c = r[1];
              if (s) { pt.push(s); sn[s].push(`${s}${c}`); }
            }
          } else if (local === 'endnoteReference') {
            const eid = node.getAttributeNS(WNS, 'id');
            if (eid in en_d) {
              const r = _res(en_d[eid], en_m, en_n);
              const s = r[0], c = r[1];
              if (s) { pt.push(s); sn[s].push(`${s}${c}`); }
            }
          } else if (local === 'commentReference') {
            const cid = node.getAttributeNS(WNS, 'id');
            if (cid in cm_d) {
              const r = _res(cm_d[cid], cm_m, cm_n);
              const s = r[0], c = r[1];
              if (s) { pt.push(s); sn[s].push(`${s}${c}`); }
            }
          }
        }
        // descend
        for (let i = 0; i < node.childNodes.length; i++) {
          const ch = node.childNodes[i];
          if (ch.nodeType === 1) visit(ch);
        }
      };
      // walk only the children of the paragraph (Python's iter() includes self,
      // but `<w:p>` itself has no `t`/`footnoteReference` etc. local name we care about)
      for (let i = 0; i < para.childNodes.length; i++) {
        const ch = para.childNodes[i];
        if (ch.nodeType === 1) visit(ch);
      }
      const line = pt.join('').trim();
      if (line) parts.push(line);
    }
  } catch (e) {
    mainErr = e;
  }

  if (mainErr) {
    return { main: `שגיאה: ${mainErr && mainErr.message ? mainErr.message : mainErr}`, streams: [] };
  }

  let main = parts.join('\n');
  for (const item of selected) {
    const st = item[0];
    const sym = item[1];
    if (st.source === 'inline' && st.marker) {
      const safe = String(st.marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      main = main.replace(new RegExp('@' + safe, 'g'), sym);
    }
  }

  const streamsOut = [];
  for (const s of Object.keys(sn)) {
    if (sn[s].length) streamsOut.push([s, sn[s].join('\n')]);
  }
  return { main: main, streams: streamsOut };
}

// ─── extract_word_with_html_formatting / extract_paragraph_html ───
// Verbatim port — converts <w:p> element tree to HTML keeping <b>/<i>/<u>.
export function extract_paragraph_html(paraElement) {
  let html = '';
  const runs = paraElement.getElementsByTagNameNS(WNS, 'r');
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const rPr = run.getElementsByTagNameNS(WNS, 'rPr')[0] || null;
    const isBold = !!(rPr && rPr.getElementsByTagNameNS(WNS, 'b').length > 0);
    const isItalic = !!(rPr && rPr.getElementsByTagNameNS(WNS, 'i').length > 0);
    const isUnder = !!(rPr && rPr.getElementsByTagNameNS(WNS, 'u').length > 0);

    const textParts = [];
    const ts = run.getElementsByTagNameNS(WNS, 't');
    for (let j = 0; j < ts.length; j++) {
      if (ts[j].textContent) textParts.push(ts[j].textContent);
    }
    let text = textParts.join('');
    if (text) {
      if (isBold) text = `<b>${text}</b>`;
      if (isItalic) text = `<i>${text}</i>`;
      if (isUnder) text = `<u>${text}</u>`;
      html += text;
    }
  }
  return html;
}

export async function extract_word_with_html_formatting(zip, xmlPath) {
  try {
    const f = zip.file(xmlPath);
    if (!f) return '';
    const xmlText = await f.async('string');
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const htmlParts = [];
    const paras = doc.getElementsByTagNameNS(WNS, 'p');
    for (let i = 0; i < paras.length; i++) {
      const ph = extract_paragraph_html(paras[i]);
      if (ph.trim()) htmlParts.push(ph);
    }
    const result = htmlParts.join('\n');
    console.log(`[DEBUG] HTML conversion produced ${result.length} characters`);
    return result;
  } catch (e) {
    console.log(`[ERROR] Failed to convert Word XML to HTML: ${e}`);
    return '';
  }
}

// ─── DOCX zip reader ───
async function _readDocxZip(file) {
  // file may be a File/Blob (browser) or an ArrayBuffer.
  if (!window.JSZip) throw new Error('JSZip is not loaded');
  let buf;
  if (file instanceof ArrayBuffer) buf = file;
  else if (file && typeof file.arrayBuffer === 'function') buf = await file.arrayBuffer();
  else if (file && file.byteLength !== undefined) buf = file;
  else throw new Error('docx_extract: unsupported file type');
  return await window.JSZip.loadAsync(buf);
}

// ─── Word export (HTML for .doc files Word can open) ───
// Verbatim port of Api.export_word — wraps main_html + fns_html into
// the special MSO HTML that Word recognises as a .doc file with footnotes.
export function buildWordExportHtml(mainHtml, fnsHtml) {
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>Export</title>
<style>
body{font-family:'David','Arial',sans-serif;direction:rtl;}
p.MsoNormal{margin:0cm;font-size:12.0pt;font-family:"David",sans-serif;}
p.MsoFootnoteText{margin:0cm;font-size:10.0pt;font-family:"David",sans-serif;}
div.Section1{page:Section1;direction:rtl;}
@page Section1{size:21.0cm 29.7cm;margin:72.0pt 72.0pt 72.0pt 72.0pt;}
</style>
</head><body><div class=Section1><p class=MsoNormal dir=RTL><span lang=HE>${mainHtml}</span></p>
<br clear=all style='mso-special-character:line-break;page-break-before:always'>
<div style='mso-element:footnote-list'>
<div style='mso-element:footnote-separator' id=ftnsep><p class=MsoNormal><span style='mso-special-character:footnote-separator'></span></p></div>
<div style='mso-element:footnote-continuation-separator' id=ftncnsep><p class=MsoNormal><span style='mso-special-character:footnote-continuation-separator'></span></p></div>
${fnsHtml}</div></div></body></html>`;
}

// Force-download a Blob with a given filename (browser equivalent of Python
// open(path, 'w').write(﻿ + doc) followed by webview save dialog).
export function downloadDocFile(filename, htmlContent) {
  const text = '﻿' + htmlContent;
  const blob = new Blob([text], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
