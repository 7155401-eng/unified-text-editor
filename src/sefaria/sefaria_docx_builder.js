// sefaria_docx_builder.js — verbatim port of sefaria_docx_builder.py.
// Builds a .docx with REAL Word footnotes, embedding sefaria_metadata.json.
// Each footnote starts with a marker (e.g. "@01 …") so the main app's
// stream parser routes it to the right stream.
//
// Uses fflate for zip creation (browser-safe, ~28KB minified).

import { zipSync, unzipSync, strToU8 } from "fflate";

// ──────────────────────────────────────────────────────────────────────
// DOCX skeleton XML templates (verbatim from Python)
// ──────────────────────────────────────────────────────────────────────
const _CT_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
  + '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
  + '  <Default Extension="xml" ContentType="application/xml"/>\n'
  + '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n'
  + '  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>\n'
  + '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n'
  + '  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>\n'
  + '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n'
  + '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n'
  + '</Types>';

const _RELS_PKG = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
  + '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n'
  + '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n'
  + '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n'
  + '</Relationships>';

const _RELS_DOC = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
  + '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n'
  + '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>\n'
  + '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>\n'
  + '</Relationships>';

const _STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
  + '  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">\n'
  + '    <w:name w:val="Normal"/>\n'
  + '    <w:rPr><w:rtl/><w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/><w:sz w:val="24"/></w:rPr>\n'
  + '  </w:style>\n'
  + '  <w:style w:type="paragraph" w:styleId="FootnoteText">\n'
  + '    <w:name w:val="footnote text"/>\n'
  + '    <w:rPr><w:rtl/><w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/><w:sz w:val="20"/></w:rPr>\n'
  + '  </w:style>\n'
  + '  <w:style w:type="character" w:styleId="FootnoteReference">\n'
  + '    <w:name w:val="footnote reference"/>\n'
  + '    <w:rPr><w:vertAlign w:val="superscript"/></w:rPr>\n'
  + '  </w:style>\n'
  + '</w:styles>';

const _SETTINGS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
  + '  <w:zoom w:percent="100"/>\n'
  + '  <w:defaultTabStop w:val="720"/>\n'
  + '  <w:characterSpacingControl w:val="doNotCompress"/>\n'
  + '  <w:footnotePr>\n'
  + '    <w:footnote w:id="-1"/>\n'
  + '    <w:footnote w:id="0"/>\n'
  + '  </w:footnotePr>\n'
  + '</w:settings>';

const _APP_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"\n'
  + '            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n'
  + '  <Application>TorahTypesetter v11.50 (Sefaria importer)</Application>\n'
  + '</Properties>';

function _xmlEscape(s) {
  if (s === null || s === undefined) return "";
  if (typeof s !== "string") s = String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _isoNow() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function _corePropsXml(title, subject) {
  const now = _isoNow();
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/" '
    + 'xmlns:dcterms="http://purl.org/dc/terms/" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${_xmlEscape(title)}</dc:title>`
    + `<dc:subject>${_xmlEscape(subject)}</dc:subject>`
    + '<dc:creator>TorahTypesetter Sefaria Importer</dc:creator>'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + '</cp:coreProperties>'
  );
}

function _makeRun(text, opts) {
  opts = opts || {};
  const rtl = opts.rtl !== false;
  const bold = !!opts.bold;
  const italic = !!opts.italic;
  const sup = !!opts.superscript;
  const rprParts = [];
  if (rtl) {
    rprParts.push('<w:rtl/>');
    rprParts.push('<w:rFonts w:ascii="David CLM" w:hAnsi="David CLM" w:cs="David CLM" w:eastAsia="David CLM"/>');
  }
  if (bold) rprParts.push('<w:b/><w:bCs/>');
  if (italic) rprParts.push('<w:i/><w:iCs/>');
  if (sup) rprParts.push('<w:vertAlign w:val="superscript"/>');
  const rpr = rprParts.length ? `<w:rPr>${rprParts.join("")}</w:rPr>` : "";
  return `<w:r>${rpr}<w:t xml:space="preserve">${_xmlEscape(text)}</w:t></w:r>`;
}

function _decodeHtmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

// Walk an HTML fragment (parsed via DOMParser) and convert to <w:r> runs.
function _walkHtml(node, rtl, bold, italic, sup, out) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      // Text node
      const text = String(child.nodeValue || "").replace(/ /g, " ");
      if (text) out.push(_makeRun(text, { rtl, bold, italic, superscript: sup }));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const name = (child.nodeName || "").toLowerCase();
    if (name === "img") continue;
    if (name === "br") { out.push('<w:r><w:br/></w:r>'); continue; }
    if (name === "b" || name === "strong") { _walkHtml(child, rtl, true, italic, sup, out); continue; }
    if (name === "i" || name === "em") { _walkHtml(child, rtl, bold, true, sup, out); continue; }
    if (name === "sup") { _walkHtml(child, rtl, bold, italic, true, out); continue; }
    _walkHtml(child, rtl, bold, italic, sup, out);
  }
}

function _makeRunsFromHtml(htmlText, rtl) {
  if (htmlText === null || htmlText === undefined) return "";
  let s = String(htmlText);
  if (!s) return "";
  if (s.indexOf("<") === -1 && s.indexOf("&") === -1) {
    return _makeRun(s, { rtl });
  }
  // Decode entities (mirror BS4 unescape)
  if (s.indexOf("&lt;") !== -1 || s.indexOf("&gt;") !== -1 || s.indexOf("&amp;") !== -1) {
    s = _decodeHtmlEntities(s);
  }
  if (s.indexOf("<") === -1) return _makeRun(s, { rtl });
  let dom;
  try {
    dom = new DOMParser().parseFromString("<root>" + s + "</root>", "text/html");
  } catch (_) {
    return _makeRun(s, { rtl });
  }
  const root = dom.body && dom.body.firstChild ? dom.body.firstChild : dom.body || dom;
  const out = [];
  _walkHtml(root, rtl !== false, false, false, false, out);
  if (!out.length) return _makeRun(s, { rtl });
  return out.join("");
}

function _makeFootnoteRef(footnoteId) {
  return (
    '<w:r>'
    + '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
    + `<w:footnoteReference w:id="${footnoteId}"/>`
    + '</w:r>'
  );
}

function _makeParagraph(runsXml, rtl) {
  const ppr = (rtl !== false) ? '<w:pPr><w:bidi/></w:pPr>' : "";
  return `<w:p>${ppr}${runsXml}</w:p>`;
}

function _makeFootnote(footnoteId, marker, text, rtl) {
  const ppr = (rtl !== false)
    ? '<w:pPr><w:pStyle w:val="FootnoteText"/><w:bidi/></w:pPr>'
    : '<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>';
  let body =
    '<w:r>'
    + '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
    + '<w:footnoteRef/>'
    + '</w:r>';
  body += _makeRun(` ${marker} `, { rtl });
  body += _makeRunsFromHtml(text, rtl);
  return `<w:footnote w:id="${footnoteId}"><w:p>${ppr}${body}</w:p></w:footnote>`;
}

function _buildDocumentXml(items, opts) {
  opts = opts || {};
  const rtl = opts.rtl !== false;
  const docTitle = opts.doc_title;
  const docSubtitle = opts.doc_subtitle;
  let body = "";
  if (docTitle) body += _makeParagraph(_makeRun(docTitle, { rtl, bold: true }), rtl);
  if (docSubtitle) body += _makeParagraph(_makeRun(docSubtitle, { rtl }), rtl);
  for (const item of items) {
    const mainText = (item && item.main_text) || "";
    const refs = (item && item.stream_refs) || [];
    const positioned = [];
    const trailing = [];
    for (const r of refs) {
      // r is [sidx, fn_id] or [sidx, fn_id, pos]
      if (r.length >= 3 && r[2] !== null && r[2] !== undefined) {
        positioned.push([Math.floor(Number(r[2])), r[1]]);
      } else {
        trailing.push(r[1]);
      }
    }
    positioned.sort((a, b) => a[0] - b[0]);
    let runs = "";
    let cursor = 0;
    const n = mainText.length;
    for (const [pos, fnId] of positioned) {
      const p = Math.max(cursor, Math.min(pos, n));
      if (p > cursor) runs += _makeRunsFromHtml(mainText.slice(cursor, p), rtl);
      runs += _makeFootnoteRef(fnId);
      cursor = p;
    }
    if (cursor < n) runs += _makeRunsFromHtml(mainText.slice(cursor), rtl);
    else if (positioned.length === 0) runs += _makeRunsFromHtml(mainText, rtl);
    for (const fnId of trailing) runs += _makeFootnoteRef(fnId);
    body += _makeParagraph(runs, rtl);
  }
  body += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:bidi/></w:sectPr>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body>`
    + '</w:document>'
  );
}

function _buildFootnotesXml(footnotes, rtl) {
  let body =
    '<w:footnote w:type="separator" w:id="-1">'
    + '<w:p><w:r><w:separator/></w:r></w:p>'
    + '</w:footnote>'
    + '<w:footnote w:type="continuationSeparator" w:id="0">'
    + '<w:p><w:r><w:continuationSeparator/></w:r></w:p>'
    + '</w:footnote>';
  for (const [fnId, marker, text] of footnotes) {
    body += _makeFootnote(fnId, marker, text, rtl);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + body
    + '</w:footnotes>'
  );
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────
//
// units: [{ main_text, commentary: { stream_idx: str | str[] | {text,pos}[] } }]
// streamsMeta: [{ marker, title, ... }]
// docTitle: string
//
// Returns: { bytes: Uint8Array, filename: string }  — caller saves blob.
export function buildDocxBytes(units, streamsMeta, docTitle) {
  docTitle = docTitle || "Sefaria Import";

  let nextFnId = 1;
  const allFootnotes = [];
  const enrichedUnits = [];
  for (const unit of units) {
    const refs = [];
    const commentary = (unit && unit.commentary) || {};
    for (const sidxRaw of Object.keys(commentary)) {
      const sidx = parseInt(sidxRaw, 10);
      if (!Number.isFinite(sidx)) continue;
      if (sidx >= streamsMeta.length) continue;
      const commVal = commentary[sidxRaw];
      if (commVal === null || commVal === undefined) continue;
      const items = Array.isArray(commVal) ? commVal : [commVal];
      const marker = streamsMeta[sidx].marker;
      for (const entry of items) {
        let commText = "";
        let pos = null;
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          commText = entry.text || "";
          pos = (entry.pos === undefined || entry.pos === null) ? null : entry.pos;
        } else {
          commText = entry;
          pos = null;
        }
        if (!commText || !String(commText).trim()) continue;
        allFootnotes.push([nextFnId, marker, commText]);
        refs.push([sidx, nextFnId, pos]);
        nextFnId++;
      }
    }
    enrichedUnits.push({ main_text: (unit && unit.main_text) || "", stream_refs: refs });
  }

  const documentXml = _buildDocumentXml(enrichedUnits, {
    rtl: true,
    doc_title: docTitle,
    doc_subtitle: "מתוך מאגר ספריא",
  });
  const footnotesXml = _buildFootnotesXml(allFootnotes, true);
  const coreXml = _corePropsXml(docTitle, "Sefaria Importer");

  const metadataPayload = {
    version: "11.50",
    generated_at: _isoNow(),
    doc_title: docTitle,
    streams: streamsMeta,
  };
  const metadataJson = JSON.stringify(metadataPayload, null, 2);

  const files = {
    "[Content_Types].xml": strToU8(_CT_XML),
    "_rels/.rels": strToU8(_RELS_PKG),
    "word/_rels/document.xml.rels": strToU8(_RELS_DOC),
    "word/document.xml": strToU8(documentXml),
    "word/footnotes.xml": strToU8(footnotesXml),
    "word/styles.xml": strToU8(_STYLES_XML),
    "word/settings.xml": strToU8(_SETTINGS_XML),
    "docProps/core.xml": strToU8(coreXml),
    "docProps/app.xml": strToU8(_APP_XML),
    "sefaria_metadata.json": strToU8(metadataJson),
  };
  const bytes = zipSync(files);

  // Filename mirrors Python: "{book}_{ts}.docx" — caller can override
  const ts = Math.floor(Date.now() / 1000);
  const safe = String(docTitle || "Sefaria_Import").replace(/[^a-zA-Z0-9א-ת_-]/g, "_");
  const filename = `${safe}_${ts}.docx`;
  return { bytes, filename };
}

// Read the embedded sefaria_metadata.json from a docx (browser File/Blob).
// Resolves to the parsed object, or null on failure.
export async function readMetadata(fileOrBlob) {
  try {
    const ab = await fileOrBlob.arrayBuffer();
    const u8 = new Uint8Array(ab);
    const z = unzipSync(u8, { filter: f => f.name === "sefaria_metadata.json" });
    if (!z["sefaria_metadata.json"]) return null;
    const text = new TextDecoder("utf-8").decode(z["sefaria_metadata.json"]);
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// Convenience: build + trigger browser download.
export function buildAndDownloadDocx(units, streamsMeta, docTitle, customFilename) {
  const { bytes, filename } = buildDocxBytes(units, streamsMeta, docTitle);
  const fname = customFilename || filename;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 200);
  return { filename: fname, blob };
}
