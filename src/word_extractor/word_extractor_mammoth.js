// word_extractor_mammoth.js — מעטפת mammoth.js לחילוץ HTML מעוצב מ-DOCX.
// משה 2026-05-09: עוטף mammoth.js כך שהוא ימיר את הגוף ל-HTML עם bold/italic/headings/lists/tables,
// אך במקום שיכניס סמני footnotes/endnotes/comments משלו, מחליפים אותם בסמלי הזרמים שלנו (@01, @02 וכו').
// הזרמים עצמם ממשיכים להישלף דרך docx_extract_simple — מודול זה נוגע רק לגוף.

import mammoth from "mammoth/mammoth.browser.js";
import JSZip from "jszip";

// =====================================================================
// extractBodyHtmlWithSymbols
//   arrayBuffer — buffer של הקובץ
//   selected — אותו array שעובר ל-docx_extract_simple
//   options — { styleMap?: string[] }
// מחזיר: { html: string, warnings: any[] }
// =====================================================================
export async function extractBodyHtmlWithSymbols(arrayBuffer, selected, options = {}) {
  const buf = sliceBuffer(arrayBuffer);
  const zip = await JSZip.loadAsync(buf);

  // 1) קריאת מילוני ההערות (תוכן footnote.xml/endnote.xml/comments.xml)
  const fn_d = await readNotesPlain(zip, "word/footnotes.xml", "footnote");
  const en_d = await readNotesPlain(zip, "word/endnotes.xml", "endnote");
  const cm_d = await readNotesPlain(zip, "word/comments.xml", "comment");

  // 2) בניית מיפויי סמלים — בדיוק לפי הלוגיקה של docx_extract_simple
  const fn_m = {}, en_m = {}, cm_m = {};
  let fn_n = null, en_n = null, cm_n = null;
  for (const it of selected || []) {
    const sym = it.symbol;
    const src = it.source, mk = it.marker;
    if (src === "footnote") { if (mk) fn_m[mk] = sym; else fn_n = sym; }
    else if (src === "endnote") { if (mk) en_m[mk] = sym; else en_n = sym; }
    else if (src === "comment") { if (mk) cm_m[mk] = sym; else cm_n = sym; }
  }

  function resolve(noteText, m2s, nsym) {
    const m = noteText.match(/@(\d+)/);
    if (m && m[1] in m2s) return m2s[m[1]];
    if (nsym && !m) return nsym;
    return null;
  }

  // 3) קריאת document.xml והחלפת footnoteReference/endnoteReference/commentReference בסמלים
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("document.xml not found in DOCX");
  let docXml = await docFile.async("string");

  docXml = replaceNoteReferenceRuns(docXml, "footnoteReference", fn_d, fn_m, fn_n);
  docXml = replaceNoteReferenceRuns(docXml, "endnoteReference", en_d, en_m, en_n);
  docXml = replaceNoteReferenceRuns(docXml, "commentReference", cm_d, cm_m, cm_n);

  // משה 2026-05-09: שלב 5 — צבעים וגדלים מ-document.xml.
  // לפני שmammoth מעבד, אנחנו מקיפים runs עם w:color/w:sz/w:rFonts בסימני placeholder
  // שיחזרו כטקסט אחרי mammoth, ואותם נמיר ל-<span style>.
  // משה 2026-05-10: עוטף <w:ins>/<w:del> בסימני placeholder שיחזרו כטקסט אחרי mammoth
  // ויהפכו ל-<ins>/<del> ב-post-processing.
  docXml = prepareDocXmlForMammoth(docXml);

  zip.file("word/document.xml", docXml);

  // 4) ייצור buffer חדש למאמות'
  const newBuf = await zip.generateAsync({ type: "arraybuffer" });

  // 5) המרה ל-HTML עם styleMap עברית/אנגלית — ברירת מחדל כותרות, ציטוט, רשימות.
  // משה 2026-05-09: אם הקורא העביר styleMap דינמי, נשלב אותו עם ה-default (קבועים + דינמיים).
  const styleMap = [...defaultStyleMap(), ...((options.styleMap) || [])];
  // משה 2026-05-09: תמונות — ממירים ל-data URI inline (TipTap Image עם allowBase64).
  const convertImage = mammoth.images.imgElement(function (image) {
    return image.read("base64").then(function (data) {
      return { src: "data:" + (image.contentType || "image/png") + ";base64," + data };
    });
  });
  const result = await mammoth.convertToHtml(
    { arrayBuffer: newBuf },
    {
      styleMap,
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: false,
      convertImage,
    }
  );

  // 6) ניקוי כל section של footnotes/endnotes ש-mammoth מצרף בסוף (אמורים להיות ריקים, אבל ליתר ביטחון)
  let html = result.value || "";
  html = html.replace(/<ol>[\s\S]*?id="footnote-\d+"[\s\S]*?<\/ol>/gi, "");
  html = html.replace(/<ol>[\s\S]*?id="endnote-\d+"[\s\S]*?<\/ol>/gi, "");
  // הסרת לוויינים: <sup><a href="#footnote-N" id="footnote-ref-N">[N]</a></sup>
  html = html.replace(/<sup>\s*<a[^>]*href="#footnote-\d+"[^>]*>[^<]*<\/a>\s*<\/sup>/gi, "");
  html = html.replace(/<sup>\s*<a[^>]*href="#endnote-\d+"[^>]*>[^<]*<\/a>\s*<\/sup>/gi, "");

  // משה 2026-05-09: שלב 5 — המרת ה-placeholders של צבע/גודל ל-<span style>.
  html = postProcessMammothHtml(html);

  return { html, warnings: result.messages || [] };
}

// =====================================================================
// משה 2026-05-10: extractNotesHtmlMap — מריצה mammoth על מסמך סינתטי
// שבונים מהערות (footnotes/endnotes/comments). מחזירה מפת id → HTML מלא
// עם bold/italic/lists/tables/images — בדיוק כמו הגוף הראשי.
//
// מחזיר:
//   { footnotes: { "1": "<p>...</p>", "2": "..." }, endnotes: {...}, comments: {...} }
// =====================================================================
export async function extractNotesHtmlMap(arrayBuffer, options = {}) {
  const result = { footnotes: {}, endnotes: {}, comments: {} };
  const zip = await JSZip.loadAsync(arrayBuffer);

  // אוספים את כל ההערות מהקבצים השונים
  const all = []; // [{ type, id, innerXml }, ...]
  const sources = [
    { type: "footnotes", file: "word/footnotes.xml", tag: "footnote" },
    { type: "endnotes",  file: "word/endnotes.xml",  tag: "endnote" },
    { type: "comments",  file: "word/comments.xml",  tag: "comment" },
  ];
  for (const src of sources) {
    const f = zip.file(src.file);
    if (!f) continue;
    const xml = await f.async("string");
    // <w:footnote ... w:id="N" ... > ... </w:footnote>
    // (גם self-closing נדיר אך אפשרי — מתעלמים מ-separator/continuationSeparator)
    const re = new RegExp(
      `<w:${src.tag}\\b([^>]*?)>([\\s\\S]*?)</w:${src.tag}>`,
      "g"
    );
    let m;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1] || "";
      const inner = m[2] || "";
      const idMatch = attrs.match(/\bw:id="(\d+)"/);
      if (!idMatch) continue;
      const id = idMatch[1];
      // דילוג על separator/continuationSeparator (אינם הערות אמיתיות)
      if (/w:type="(separator|continuationSeparator|continuationNotice)"/.test(attrs)) continue;
      all.push({ type: src.type, id, innerXml: inner });
    }
  }
  if (all.length === 0) return result;

  // בונים document.xml סינתטי: לפני כל הערה — פסקת מארקר ייחודית
  const mark = (type, id) => `<w:p><w:r><w:t xml:space="preserve">__RX_NOTE_${type.toUpperCase()}_${id}__</w:t></w:r></w:p>`;
  const endMark = `<w:p><w:r><w:t xml:space="preserve">__RX_NOTE_END__</w:t></w:r></w:p>`;
  let body = "";
  for (const note of all) {
    body += mark(note.type, note.id);
    body += note.innerXml;
  }
  body += endMark;

  let synthDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
<w:body>${body}</w:body></w:document>`;

  synthDoc = prepareDocXmlForMammoth(synthDoc);

  zip.file("word/document.xml", synthDoc);
  const newBuf = await zip.generateAsync({ type: "arraybuffer" });

  // אותם styleMap ו-convertImage כמו הגוף — תמיכה זהה
  const styleMap = [...defaultStyleMap(), ...((options.styleMap) || [])];
  const convertImage = mammoth.images.imgElement(function (image) {
    return image.read("base64").then(function (data) {
      return { src: "data:" + (image.contentType || "image/png") + ";base64," + data };
    });
  });
  const mres = await mammoth.convertToHtml(
    { arrayBuffer: newBuf },
    { styleMap, includeDefaultStyleMap: true, ignoreEmptyParagraphs: false, convertImage }
  );
  let html = mres.value || "";
  html = postProcessMammothHtml(html);

  // הסרת רשימות footnotes/endnotes שmammoth מוסיף בסוף
  html = html.replace(/<ol[^>]*id="footnotes?"[\s\S]*?<\/ol>/gi, "");
  html = html.replace(/<ol[^>]*id="endnotes?"[\s\S]*?<\/ol>/gi, "");

  // פילוח לפי המארקרים
  const markerRe = /<p>__RX_NOTE_(FOOTNOTES|ENDNOTES|COMMENTS)_(\d+)__<\/p>/g;
  const matches = [];
  let mm;
  while ((mm = markerRe.exec(html)) !== null) {
    matches.push({ index: mm.index, length: mm[0].length, type: mm[1].toLowerCase(), id: mm[2] });
  }
  const endIdx = html.indexOf("<p>__RX_NOTE_END__</p>");

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const start = cur.index + cur.length;
    const stop = (i + 1 < matches.length) ? matches[i + 1].index : (endIdx >= 0 ? endIdx : html.length);
    const noteHtml = html.substring(start, stop).trim();
    result[cur.type][cur.id] = noteHtml;
  }
  return result;
}

// =====================================================================
// בנייה דינמית של styleMap ו-CSS לפי קטלוג הסגנונות שב-DOCX (find_all_styles_full).
// =====================================================================

export function buildDynamicStyleMap(stylesCatalog) {
  // משה 2026-05-09: מייצר רק מיפויים מובהקים (headings/title/quote) — לא דורסים את
  // ההתנהגות הברירת-מחדל של mammoth עבור Normal/List Number/וכד'. אחרת הbold/italic
  // הinline-ים של mammoth (w:b/w:i) נדרסים ע"י :fresh ו-class לא רצוי.
  const map = [];
  if (!stylesCatalog || typeof stylesCatalog !== "object") return map;
  for (const name of Object.keys(stylesCatalog)) {
    const safe = safeStyleClass(name);
    const m = name.match(/^heading\s*([1-6])$/i) || name.match(/^כותרת\s*([1-6])$/);
    if (m) {
      map.push(`p[style-name='${name}'] => h${m[1]}.${safe}:fresh`);
      continue;
    }
    if (/^title$/i.test(name) || /^כותרת$/.test(name)) {
      map.push(`p[style-name='${name}'] => h1.title.${safe}:fresh`);
      continue;
    }
    if (/^subtitle$/i.test(name) || /^כותרת משנה$/.test(name)) {
      map.push(`p[style-name='${name}'] => h2.subtitle.${safe}:fresh`);
      continue;
    }
    if (/quote/i.test(name) || /ציטוט/.test(name)) {
      map.push(`p[style-name='${name}'] => blockquote.${safe}:fresh`);
      continue;
    }
    // לא דורסים את שאר הסגנונות. mammoth יטפל בהם כברירת-מחדל.
  }
  return map;
}

export function buildStylesCss(stylesCatalog) {
  if (!stylesCatalog || typeof stylesCatalog !== "object") return "";
  const rules = [];
  for (const name of Object.keys(stylesCatalog)) {
    const info = stylesCatalog[name] || {};
    const safe = safeStyleClass(name);
    const decl = [];
    if (info.font) decl.push(`font-family: "${escCss(info.font)}";`);
    if (info.size_pt) decl.push(`font-size: ${info.size_pt}pt;`);
    if (info.bold) decl.push("font-weight: bold;");
    if (info.italic) decl.push("font-style: italic;");
    if (info.space_before_pt != null) decl.push(`margin-top: ${info.space_before_pt}pt;`);
    if (info.space_after_pt != null) decl.push(`margin-bottom: ${info.space_after_pt}pt;`);
    if (info.line_spacing) decl.push(`line-height: ${info.line_spacing};`);
    if (decl.length) rules.push(`.${safe} { ${decl.join(" ")} }`);
  }
  return rules.join("\n");
}

export function injectStylesCss(css, id = "docx-imported-styles") {
  if (typeof document === "undefined" || !css) return;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function safeStyleClass(name) {
  // class תקני — אותיות באנגלית/ספרות בלבד; שמות לא לטיניים מומרים ל-hash
  const ascii = String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return `docx-style-${ascii}`;
  // עברית/לא-לטיני: hash דטרמיניסטי קצר
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `docx-style-h${(h >>> 0).toString(36)}`;
}

function escCss(s) {
  return String(s).replace(/"/g, '\\"');
}

// =====================================================================
// helpers
// =====================================================================

function sliceBuffer(input) {
  if (input instanceof ArrayBuffer) return input.slice(0);
  if (input && typeof input.slice === "function") return input.slice(0);
  return input;
}

async function readNotesPlain(zip, path, tag) {
  const out = {};
  const f = zip.file(path);
  if (!f) return out;
  const xml = await f.async("string");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  let parser;
  try {
    parser = new DOMParser();
  } catch (e) {
    return out;
  }
  const doc = parser.parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root) return out;
  const notes = root.getElementsByTagNameNS(ns, tag);
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const id = note.getAttributeNS(ns, "id");
    if (id === null || id === undefined) continue;
    const tNodes = note.getElementsByTagNameNS(ns, "t");
    let text = "";
    for (let j = 0; j < tNodes.length; j++) {
      text += tNodes[j].textContent || "";
    }
    out[id] = text;
  }
  return out;
}


function resolveNoteSymbol(noteText, markerToSymbol, noneSymbol) {
  const m = String(noteText || "").match(/@(\d+)/);
  if (m && Object.prototype.hasOwnProperty.call(markerToSymbol, m[1])) {
    return markerToSymbol[m[1]];
  }
  if (noneSymbol && !m) return noneSymbol;
  return null;
}

function replaceNoteReferenceRuns(xml, refTag, notesDict, markerToSymbol, noneSymbol) {
  // מחליפים את כל ה-run של הפניית ההערה, לא רק את התג הפנימי.
  // כך @01/@02 לא יורשים צבע/גודל/פונט של מספר הערת Word.
  const runWithRefRe = new RegExp(
    `<w:r\\b[^>]*>[\\s\\S]*?<w:${refTag}\\b[^>]*\\bw:id="(\\d+)"[^>]*/>[\\s\\S]*?</w:r>`,
    "g"
  );

  xml = xml.replace(runWithRefRe, (_fullRun, id) => {
    const noteText = notesDict[id];
    if (noteText === undefined) return "";
    const symbol = resolveNoteSymbol(noteText, markerToSymbol, noneSymbol);
    return symbol ? wrapTextRun(symbol) : "";
  });

  // fallback נדיר אם ההפניה אינה עטופה ב-run רגיל.
  const bareRefRe = new RegExp(
    `<w:${refTag}\\b[^>]*\\bw:id="(\\d+)"[^>]*/>`,
    "g"
  );

  return xml.replace(bareRefRe, (_m, id) => {
    const noteText = notesDict[id];
    if (noteText === undefined) return "";
    const symbol = resolveNoteSymbol(noteText, markerToSymbol, noneSymbol);
    return symbol ? wrapTextRun(symbol) : "";
  });
}

function prepareDocXmlForMammoth(xml) {
  let out = String(xml || "");
  out = wrapTrackedChanges(out);
  out = wrapColorAndSizeRuns(out);
  return out;
}

function postProcessMammothHtml(html) {
  let out = String(html || "");
  out = unwrapColorAndSizePlaceholders(out);
  out = unwrapTrackedChanges(out);
  out = stripInternalImportPlaceholders(out);
  return out;
}

function cleanCssFontName(font) {
  return String(font || "")
    .replace(/[<>"`;]/g, "")
    .replace(/'/g, "")
    .trim();
}

function stripInternalImportPlaceholders(html) {
  let out = String(html || "");

  // CST תקין שנשאר בטעות.
  out = out.replace(/‹‹CST:[^‹]*‹‹/g, "");
  out = out.replace(/‹‹\/CST‹‹/g, "");

  // CST שבור חלקית.
  out = out.replace(/CST:[0-9a-fA-F]{0,6}\|[0-9.]*\|[^‹<]*‹‹/g, "");

  // Track Changes placeholders אם דלפו.
  out = out.replace(/‹‹TCI:[^‹]*‹‹/g, "");
  out = out.replace(/‹‹\/TCI‹‹/g, "");
  out = out.replace(/‹‹TCD:[^‹]*‹‹/g, "");
  out = out.replace(/‹‹\/TCD‹‹/g, "");

  // כל שאריות placeholder פנימיות.
  out = out.replace(/‹‹/g, "");

  return out;
}
function wrapTextRun(text) {
  const safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<w:r><w:t xml:space="preserve">${safe}</w:t></w:r>`;
}

// =====================================================================
// wrapColorAndSizeRuns — משה 2026-05-09 שלב 5
// סורק את ה-XML של ה-DOCX ועוטף את הטקסט שב-<w:r> שיש לו color/size/font
// ב-placeholder ייחודי שמתחיל ב-‹‹CST: ומסתיים ב-‹‹/CST››. אחרי mammoth מחליפים ב-<span>.
// אנחנו לא נוגעים ב-w:rPr — רק מוסיפים placeholder מסביב לטקסט.
// =====================================================================
const CST_OPEN_RE = /‹‹CST:([0-9a-fA-F]{0,6})\|(\d{0,4})\|([^|]*)‹‹/g;
const CST_CLOSE = "‹‹/CST‹‹";

function wrapColorAndSizeRuns(xml) {
  // לחפש <w:r ...>...<w:rPr>...</w:rPr>...<w:t...>טקסט</w:t>...</w:r>
  // ולשפר רק את הטקסט בתוך <w:t>. ה-rPr לא נוגע — נשמר.
  const runRe = /<w:r(\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  return xml.replace(runRe, (full, attrs, body) => {
    const rPrMatch = body.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/);
    if (!rPrMatch) return full;
    const rPr = rPrMatch[1];
    const colorMatch = rPr.match(/<w:color\s+[^>]*\bw:val="([0-9a-fA-F]{6})"/);
    const szMatch = rPr.match(/<w:sz\s+[^>]*\bw:val="(\d+)"/);
    const fontMatch = rPr.match(/<w:rFonts\s+[^>]*\bw:cs="([^"]+)"/) ||
                      rPr.match(/<w:rFonts\s+[^>]*\bw:ascii="([^"]+)"/);
    if (!colorMatch && !szMatch && !fontMatch) return full;
    const color = colorMatch ? colorMatch[1].toLowerCase() : "";
    const sizeHalf = szMatch ? parseInt(szMatch[1], 10) : 0;
    const sizePt = sizeHalf ? (sizeHalf / 2) : 0;
    const font = fontMatch ? fontMatch[1].replace(/\|/g, "") : "";
    const open = `‹‹CST:${color}|${sizePt || ""}|${font}‹‹`;
    // עוטפים כל <w:t>...</w:t> בתוך ה-run
    const newBody = body.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (m, tAttrs, txt) => {
      const a = tAttrs || ' xml:space="preserve"';
      return `<w:t${a}>${open}${txt}${CST_CLOSE}</w:t>`;
    });
    return `<w:r${attrs || ""}>${newBody}</w:r>`;
  });
}

function unwrapColorAndSizePlaceholders(html) {
  // ‹‹CST:HEX|SIZE|FONT›› ... ‹‹/CST›› → <span style="...">...</span>
  // ה-placeholder עלול להיחתך ע"י תגי mammoth (strong/em). נחפש זוגות פשוטים בתוך טקסט.
  return html.replace(
    /‹‹CST:([0-9a-fA-F]{0,6})\|(\d{0,4}(?:\.\d+)?)\|([^|]*)‹‹([\s\S]*?)‹‹\/CST‹‹/g,
    (m, color, size, font, inner) => {
      const decl = [];
      if (color) decl.push(`color: #${color};`);
      if (size) decl.push(`font-size: ${size}pt;`);
      const safeFont = cleanCssFontName(font);
      if (safeFont) decl.push(`font-family: '${safeFont}';`);
      if (!decl.length) return inner;
      return `<span style="${decl.join(" ")}">${inner}</span>`;
    }
  );
}

// =====================================================================
// משה 2026-05-10: Track Changes (מעקב שינויים) — <w:ins>/<w:del>
// עוטפים את ה-runs בתוכם בסימני placeholder ‹‹INS:author|date›› ו-‹‹DEL:author|date››,
// כדי ש-mammoth יחזיר אותם כטקסט שנוכל להמיר ל-<ins>/<del>.
// =====================================================================
const TC_INS_OPEN = (a, d) => `‹‹TCI:${a || ""}|${d || ""}‹‹`;
const TC_INS_CLOSE = "‹‹/TCI‹‹";
const TC_DEL_OPEN = (a, d) => `‹‹TCD:${a || ""}|${d || ""}‹‹`;
const TC_DEL_CLOSE = "‹‹/TCD‹‹";

function wrapTrackedChanges(xml) {
  // <w:ins ...>...</w:ins>
  let out = xml.replace(
    /<w:ins\b([^>]*)>([\s\S]*?)<\/w:ins>/g,
    (m, attrs, body) => {
      const author = (attrs.match(/\bw:author="([^"]*)"/) || [, ""])[1];
      const date = (attrs.match(/\bw:date="([^"]*)"/) || [, ""])[1];
      // מזריקים placeholder לפני ואחרי ה-body. ה-runs בפנים נשארים.
      const open = `<w:r><w:t xml:space="preserve">${TC_INS_OPEN(author, date)}</w:t></w:r>`;
      const close = `<w:r><w:t xml:space="preserve">${TC_INS_CLOSE}</w:t></w:r>`;
      return open + body + close;
    }
  );
  // <w:del ...><w:r><w:delText>...</w:delText></w:r></w:del>
  out = out.replace(
    /<w:del\b([^>]*)>([\s\S]*?)<\/w:del>/g,
    (m, attrs, body) => {
      const author = (attrs.match(/\bw:author="([^"]*)"/) || [, ""])[1];
      const date = (attrs.match(/\bw:date="([^"]*)"/) || [, ""])[1];
      // ממירים <w:delText> ל-<w:t> כדי ש-mammoth יציג את הטקסט המחוק.
      const bodyConverted = body.replace(/<w:delText\b([^>]*)>/g, "<w:t$1>")
                                 .replace(/<\/w:delText>/g, "</w:t>");
      const open = `<w:r><w:t xml:space="preserve">${TC_DEL_OPEN(author, date)}</w:t></w:r>`;
      const close = `<w:r><w:t xml:space="preserve">${TC_DEL_CLOSE}</w:t></w:r>`;
      return open + bodyConverted + close;
    }
  );
  return out;
}

function unwrapTrackedChanges(html) {
  // ‹‹TCI:author|date›› ... ‹‹/TCI›› → <ins data-author data-date>...</ins>
  let out = html.replace(
    /‹‹TCI:([^|]*)\|([^‹]*)‹‹([\s\S]*?)‹‹\/TCI‹‹/g,
    (m, author, date, inner) => {
      const attrs = [];
      attrs.push('class="tracked-ins"');
      if (author) attrs.push(`data-author="${escForAttr(author)}"`);
      if (date) attrs.push(`data-date="${escForAttr(date)}"`);
      return `<ins ${attrs.join(" ")}>${inner}</ins>`;
    }
  );
  out = out.replace(
    /‹‹TCD:([^|]*)\|([^‹]*)‹‹([\s\S]*?)‹‹\/TCD‹‹/g,
    (m, author, date, inner) => {
      const attrs = [];
      attrs.push('class="tracked-del"');
      if (author) attrs.push(`data-author="${escForAttr(author)}"`);
      if (date) attrs.push(`data-date="${escForAttr(date)}"`);
      return `<del ${attrs.join(" ")}>${inner}</del>`;
    }
  );
  return out;
}

function escForAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function defaultStyleMap() {
  return [
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Heading 5'] => h5:fresh",
    "p[style-name='Heading 6'] => h6:fresh",
    "p[style-name='Title'] => h1.title:fresh",
    "p[style-name='Subtitle'] => h2.subtitle:fresh",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote.intense:fresh",
    // משה 2026-05-09: run-level — מיפויי bold/italic/underline דרך rStyle (סגנון תווים).
    // mammoth ברירת-מחדל תופס רק <w:b/> ישיר; כל הסגנונות בעלי שם ("Strong" וכד') חייבים מיפוי מפורש.
    // אנגלית — נפוצים
    "r[style-name='Strong'] => strong",
    "r[style-name='Bold'] => strong",
    "r[style-name='Emphasis'] => em",
    "r[style-name='Italic'] => em",
    "r[style-name='Underline'] => u",
    "r[style-name='Intense Emphasis'] => strong > em",
    "r[style-name='Subtle Emphasis'] => em",
    "r[style-name='Book Title'] => em",
    "r[style-name='Quote'] => em",
    "r[style-name='Subtle Reference'] => span.subtle-ref",
    "r[style-name='Intense Reference'] => strong",
    // עברית — נפוצים
    "r[style-name='מודגש'] => strong",
    "r[style-name='נטוי'] => em",
    "r[style-name='הדגשה'] => em",
    "r[style-name='הדגשה חזקה'] => strong",
    "r[style-name='הדגשה עדינה'] => em",
    "r[style-name='קו תחתון'] => u",
    "r[style-name='ציטוט'] => em",
    // עברית — שמות סגנונות פסקה
    "p[style-name='כותרת 1'] => h1:fresh",
    "p[style-name='כותרת 2'] => h2:fresh",
    "p[style-name='כותרת 3'] => h3:fresh",
    "p[style-name='כותרת 4'] => h4:fresh",
    "p[style-name='כותרת 5'] => h5:fresh",
    "p[style-name='כותרת 6'] => h6:fresh",
    "p[style-name='כותרת'] => h1.title:fresh",
    "p[style-name='כותרת משנה'] => h2.subtitle:fresh",
    "p[style-name='ציטוט'] => blockquote:fresh",
    "p[style-name='ציטוט בולט'] => blockquote.intense:fresh",
    // משה 2026-05-09: fallback לפי style-id (לקבצים עם שמות סגנון לא-סטנדרטיים)
    "r[style-id='Strong'] => strong",
    "r[style-id='Emphasis'] => em",
    "r[style-id='Bold'] => strong",
    "r[style-id='Italic'] => em",
    // משה 2026-05-10: Highlight (הדגשה צבעונית) — w:highlight של Word
    "r[highlight='yellow'] => mark[data-color='yellow']",
    "r[highlight='green'] => mark[data-color='green']",
    "r[highlight='cyan'] => mark[data-color='cyan']",
    "r[highlight='magenta'] => mark[data-color='magenta']",
    "r[highlight='blue'] => mark[data-color='blue']",
    "r[highlight='red'] => mark[data-color='red']",
    "r[highlight='darkBlue'] => mark[data-color='darkBlue']",
    "r[highlight='darkCyan'] => mark[data-color='darkCyan']",
    "r[highlight='darkGreen'] => mark[data-color='darkGreen']",
    "r[highlight='darkMagenta'] => mark[data-color='darkMagenta']",
    "r[highlight='darkRed'] => mark[data-color='darkRed']",
    "r[highlight='darkYellow'] => mark[data-color='darkYellow']",
    "r[highlight='darkGray'] => mark[data-color='darkGray']",
    "r[highlight='lightGray'] => mark[data-color='lightGray']",
    "r[highlight='black'] => mark[data-color='black']",
  ];
}
