// word_extractor_engine.js — מנוע DOCX→HTML חדש (v3, 2026-05-08)
//
// משה: כתיבה מחדש מאפס. המנוע הקודם היה port של word_extractor.py
// שייצר LaTeX, וניסה אחר-כך לנקות אותו ב-regex עד שיהיה HTML. זה
// יצר זליגה של פקודות LaTeX לעורך.
//
// המנוע הזה מודלל לפי docx_extract / docx_find_streams ב-comparator_tool.py:
// קורא את ה-DOCX ישירות, מזהה זרמים לפי תחילית @<digits>: בתוכן ההערות,
// ומפיק HTML פסקה-לפסקה עם <strong>/<em>/<u>/color/size — בלי שלב LaTeX.
//
// API ראשי:
//   - find_all_note_sources(buf)         — לזיהוי לפני הדיאלוג
//   - read_footnotes / read_endnotes / read_comments — ל-preview בדיאלוג
//   - extract_word_html(buf, selected)   — ה-API החדש החדש (HTML טהור)
//   - extract_and_process(buf, sd, ext)  — wrapper תאימות, שקרא הוא ל-extract_word_html
//   - extract_doc_titles / extract_headers_footers / find_sections_in_docx /
//     find_all_styles_in_docx — מטא-דאטה למסך מוקדם בדיאלוג (תאימות)
//
// תלויות: JSZip ל-unzip, DOMParser ל-XML.

import JSZip from "jszip";
import {
  SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT,
  SOURCE_LABELS,
} from "./word_extractor_i18n.js";

// =====================================================================
// constants
// =====================================================================

export const WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// w:val of source/main XML — קצרים יותר ל-DOMParser שאינו תומך ב-namespaces ישירות
const W = "w:";

// =====================================================================
// XML helpers
// =====================================================================

function parseXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  // בדיקת שגיאות parse
  const errNode = doc.querySelector("parsererror");
  if (errNode) throw new Error("XML parse error: " + errNode.textContent);
  return doc;
}

// אוסף את הטקסט הפשוט של אלמנט (concat של כל ה-w:t)
function plainTextOf(element) {
  if (!element) return "";
  const ts = element.getElementsByTagName("w:t");
  let out = "";
  for (let i = 0; i < ts.length; i++) out += ts[i].textContent || "";
  return out;
}

// בדיקת attribute עם namespace (DOMParser ב-application/xml שומר על השם המלא w:val)
function getWVal(element, attr) {
  if (!element) return null;
  return element.getAttribute("w:" + attr);
}

// =====================================================================
// טעינת ZIP — buf -> { 'document.xml': Document, ... }
// =====================================================================

async function loadDocxParts(input) {
  // input יכול להיות ArrayBuffer / Uint8Array / Blob / File
  const zip = await JSZip.loadAsync(input);
  const parts = {};

  const want = [
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/comments.xml",
    "word/styles.xml",
  ];
  for (const path of want) {
    const file = zip.file(path);
    if (!file) continue;
    const text = await file.async("string");
    try {
      parts[path] = parseXml(text);
    } catch (e) {
      console.warn(`[word_extractor] failed to parse ${path}:`, e);
    }
  }
  return parts;
}

// =====================================================================
// run formatting
// =====================================================================

/**
 * אחזור עיצוב ה-rPr של run.
 * @param {Element} rEl — <w:r>
 * @returns {{bold,italic,underline,strike,vertAlign,color,fontSize}}
 */
function readRunFormat(rEl) {
  const fmt = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    vertAlign: null,    // 'super' | 'sub' | null
    color: null,        // 'FF0000' (no #) | null
    fontSize: null,     // number, in pt | null  (Word stores half-points)
  };
  const rPr = rEl.getElementsByTagName("w:rPr")[0];
  if (!rPr) return fmt;

  // ‏החיפוש מוגבל לילדים ישירים כדי לא לתפוס rPr פנימיים מטבלאות וכו'.
  for (const child of Array.from(rPr.children)) {
    const tag = child.tagName; // 'w:b', 'w:i', etc.
    if (tag === "w:b") {
      const val = getWVal(child, "val");
      // ב-OOXML "no value" משמעו true; "0"/"false" מבטלים.
      fmt.bold = !(val === "0" || val === "false");
    } else if (tag === "w:i") {
      const val = getWVal(child, "val");
      fmt.italic = !(val === "0" || val === "false");
    } else if (tag === "w:u") {
      const val = getWVal(child, "val");
      fmt.underline = !!val && val !== "none" && val !== "0" && val !== "false";
    } else if (tag === "w:strike") {
      const val = getWVal(child, "val");
      fmt.strike = !(val === "0" || val === "false");
    } else if (tag === "w:vertAlign") {
      const val = getWVal(child, "val");
      if (val === "superscript") fmt.vertAlign = "super";
      else if (val === "subscript") fmt.vertAlign = "sub";
    } else if (tag === "w:color") {
      const val = getWVal(child, "val");
      if (val && /^[0-9A-Fa-f]{6}$/.test(val)) fmt.color = val.toUpperCase();
    } else if (tag === "w:sz") {
      const val = getWVal(child, "val");
      const n = parseInt(val || "", 10);
      if (Number.isFinite(n) && n > 0) fmt.fontSize = n / 2; // half-points → pt
    }
  }
  return fmt;
}

function formatsEqual(a, b) {
  return a.bold === b.bold &&
         a.italic === b.italic &&
         a.underline === b.underline &&
         a.strike === b.strike &&
         a.vertAlign === b.vertAlign &&
         a.color === b.color &&
         a.fontSize === b.fontSize;
}

// =====================================================================
// run extraction — paragraph → ordered tokens
// =====================================================================

/**
 * Token סוג 'run' = רצף טקסט עם אותו עיצוב.
 * Token סוג 'symbol' = סמל זרם (placeholder של footnote reference).
 */

/**
 * קורא את הטקסט של run (כולל <w:br/> כ-\n).
 * @returns {string}
 */
function runText(rEl) {
  let out = "";
  for (const child of Array.from(rEl.childNodes)) {
    if (child.nodeType !== 1) continue; // ELEMENT_NODE
    const tag = child.tagName;
    if (tag === "w:t") {
      out += child.textContent || "";
    } else if (tag === "w:br") {
      const type = getWVal(child, "type");
      // page/column breaks אנחנו מתעלמים, line breaks → \n
      if (type !== "page" && type !== "column") out += "\n";
    } else if (tag === "w:tab") {
      out += "\t";
    }
  }
  return out;
}

/**
 * עוברים על paragraph ב-DFS, מחזירים tokens של {kind:'text', text, fmt}
 * וכן {kind:'ref', refType, id, fmt} עבור footnoteReference וכו'.
 * @param {Element} pEl — <w:p>
 * @returns {Array<object>}
 */
function tokensOfParagraph(pEl) {
  const tokens = [];

  // אנחנו מטיילים בילדים ישירים; <w:r> מקנן <w:t>/<w:br>/הפניות,
  // ולמרות שיש hyperlinks וכו' — נראה אותם דרך getElementsByTagName רקורסיבי
  // שאנחנו דווקא לא רוצים, כי הסדר חשוב.
  function walk(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === "w:r") {
        const fmt = readRunFormat(child);
        // יש runs שמכילים בתוכם footnoteReference ישירות.
        for (const inner of Array.from(child.childNodes)) {
          if (inner.nodeType !== 1) continue;
          const itag = inner.tagName;
          if (itag === "w:t") {
            tokens.push({ kind: "text", text: inner.textContent || "", fmt });
          } else if (itag === "w:br") {
            const type = getWVal(inner, "type");
            if (type !== "page" && type !== "column") {
              tokens.push({ kind: "text", text: "\n", fmt });
            }
          } else if (itag === "w:tab") {
            tokens.push({ kind: "text", text: "\t", fmt });
          } else if (itag === "w:footnoteReference") {
            const id = getWVal(inner, "id");
            if (id) tokens.push({ kind: "ref", refType: "footnote", id, fmt });
          } else if (itag === "w:endnoteReference") {
            const id = getWVal(inner, "id");
            if (id) tokens.push({ kind: "ref", refType: "endnote", id, fmt });
          } else if (itag === "w:commentReference") {
            const id = getWVal(inner, "id");
            if (id) tokens.push({ kind: "ref", refType: "comment", id, fmt });
          }
        }
      } else if (tag === "w:hyperlink" || tag === "w:smartTag" || tag === "w:sdt" || tag === "w:sdtContent") {
        // עטיפות — היכנס פנימה
        walk(child);
      } else if (tag === "w:ins" || tag === "w:moveTo") {
        // tracked-changes שלא נדחו — נקרא את הילדים
        walk(child);
      } else if (tag === "w:del" || tag === "w:moveFrom") {
        // tracked-changes שנמחקו — נדלג
        continue;
      }
    }
  }
  walk(pEl);
  return tokens;
}

// =====================================================================
// HTML rendering
// =====================================================================

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * ממיר רצף text-tokens (אחרי שעיצוב footnoteReference הופך לסמל
 * pseudo-token עם kind:'symbol') ל-inline HTML.
 *
 * @param {Array<object>} tokens — רק tokens של {kind:'text', text, fmt}
 *                                 ו-{kind:'symbol', symbol} (נחשב fmt ריק).
 */
function tokensToInlineHtml(tokens) {
  if (!tokens.length) return "";

  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t0 = tokens[i];
    if (t0.kind === "symbol") {
      out.push(escapeHtml(t0.symbol));
      i++;
      continue;
    }
    // אסוף רצף עם אותו עיצוב
    const fmt = t0.fmt;
    let buf = "";
    while (i < tokens.length && tokens[i].kind === "text" && formatsEqual(tokens[i].fmt, fmt)) {
      buf += tokens[i].text;
      i++;
    }
    if (!buf) continue;
    // \n בתוך text → <br>
    let html = escapeHtml(buf).replace(/\n/g, "<br>");

    // עטיפות פנימה → החוצה
    if (fmt.vertAlign === "super") html = `<sup>${html}</sup>`;
    else if (fmt.vertAlign === "sub") html = `<sub>${html}</sub>`;
    if (fmt.underline) html = `<u>${html}</u>`;
    if (fmt.strike)    html = `<s>${html}</s>`;
    if (fmt.italic)    html = `<em>${html}</em>`;
    if (fmt.bold)      html = `<strong>${html}</strong>`;

    const styles = [];
    if (fmt.color)    styles.push(`color:#${fmt.color}`);
    if (fmt.fontSize) styles.push(`font-size:${fmt.fontSize}pt`);
    if (styles.length) html = `<span style="${styles.join(";")}">${html}</span>`;
    out.push(html);
  }
  return out.join("");
}

/**
 * בודק אם ה-tokens (כולם text+symbol, אחרי שלב הזרם) מצטמצמים
 * לטקסט פנימי ריק (אחרי trim). משמש לדילוג על פסקאות ריקות.
 */
function tokensEffectivelyEmpty(tokens) {
  let s = "";
  for (const t of tokens) {
    if (t.kind === "symbol") s += t.symbol;
    else if (t.kind === "text") s += t.text;
  }
  return s.trim() === "";
}

// =====================================================================
// stream resolution (analog of comparator_tool.py:_res)
// =====================================================================

/**
 * @param {string} text — plain text של ההערה
 * @param {Object<string,string>} m2s — marker → symbol
 * @param {string|null} nsym — symbol של הזרם "ללא סימון" (או null)
 * @returns {{symbol: string|null, prefixLen: number}}
 *          symbol=null ⇒ אין זרם תואם; prefixLen מציין כמה תווים להסיר
 *          מתחילת ה-tokens של ההערה.
 */
function resolveNoteStream(text, m2s, nsym) {
  const m = text.match(/@(\d+)/);
  if (m && Object.prototype.hasOwnProperty.call(m2s, m[1])) {
    const symbol = m2s[m[1]];
    // קידומת: '^.*?@<digits>\s*:?\s*'
    const prefixRe = new RegExp("^.*?@" + m[1] + "\\s*:?\\s*");
    const match = text.match(prefixRe);
    const prefixLen = match ? match[0].length : 0;
    return { symbol, prefixLen };
  }
  if (nsym && !m) {
    // ללא סימון — מסירים רק רווחים מובילים
    const ws = text.match(/^\s*/);
    return { symbol: nsym, prefixLen: ws ? ws[0].length : 0 };
  }
  return { symbol: null, prefixLen: 0 };
}

/**
 * חותך מראש tokens לפי prefixLen. הקידומת יכולה להיפרס בין מספר tokens.
 * @param {Array<object>} tokens — text tokens
 * @param {number} n — כמה תווים להסיר
 */
function trimPrefixFromTokens(tokens, n) {
  if (n <= 0) return tokens.slice();
  let remain = n;
  const out = [];
  for (const t of tokens) {
    if (t.kind !== "text") {
      // ref/symbol בתוך הקידומת — לא צפוי, אבל אם קרה נקבל כאחד.
      if (remain > 0) { remain--; continue; }
      out.push(t);
      continue;
    }
    if (remain >= t.text.length) {
      remain -= t.text.length;
      continue;
    }
    if (remain > 0) {
      out.push({ ...t, text: t.text.slice(remain) });
      remain = 0;
    } else {
      out.push(t);
    }
  }
  return out;
}

// =====================================================================
// note tables: id → {tokens, plainText}
// =====================================================================

/**
 * קוראים את כל ההערות מ-notes XML, מסננים id<=0 (פרידות סטנדרטיות).
 *
 * @param {Document} doc — DOM של footnotes/endnotes/comments
 * @param {string} tag   — 'footnote' | 'endnote' | 'comment'
 * @param {boolean} includeZero — אם true (לcomment), id>=0 נקלטים
 * @returns {Object<string, {paragraphs: Array<Array<token>>, plainText: string}>}
 */
function buildNotesTable(doc, tag, includeZero) {
  const notes = {};
  if (!doc) return notes;
  const wantTag = "w:" + tag;
  const elems = doc.getElementsByTagName(wantTag);
  for (let i = 0; i < elems.length; i++) {
    const el = elems[i];
    const idStr = el.getAttribute("w:id");
    if (idStr === null) continue;
    const idNum = parseInt(idStr, 10);
    if (!Number.isFinite(idNum)) continue;
    if (includeZero) {
      if (idNum < 0) continue;
    } else {
      if (idNum <= 0) continue;
    }

    // אסוף פסקאות
    const paragraphs = [];
    const ps = el.getElementsByTagName("w:p");
    if (ps.length === 0) {
      // לפעמים ההערה היא runs ישירות בלי <w:p> — נטפל בה כפסקה אחת
      const tokens = tokensOfParagraph(el);
      if (tokens.length) paragraphs.push(tokens);
    } else {
      for (let j = 0; j < ps.length; j++) {
        const tokens = tokensOfParagraph(ps[j]);
        paragraphs.push(tokens);
      }
    }

    // plain text — concat של כל הטקסטים בכל הפסקאות
    let plain = "";
    for (let j = 0; j < paragraphs.length; j++) {
      for (const tk of paragraphs[j]) {
        if (tk.kind === "text") plain += tk.text;
      }
      if (j < paragraphs.length - 1) plain += "\n";
    }
    notes[idStr] = { paragraphs, plainText: plain };
  }
  return notes;
}

// =====================================================================
// public — find_all_note_sources (תאימות)
// =====================================================================

/**
 * סורק ומחזיר את רשימת מקורות ההערות (לדיאלוג).
 * תאם API: אותו מבנה שבו ה-dialog מעיין.
 */
export async function find_all_note_sources(input) {
  const parts = await loadDocxParts(input);
  const sources = [];

  function scan(doc, tag, sourceType, hebName, includeZero) {
    if (!doc) return;
    const wantTag = "w:" + tag;
    const elems = doc.getElementsByTagName(wantTag);
    const markerCounts = {};
    let unmarked = 0;
    for (let i = 0; i < elems.length; i++) {
      const el = elems[i];
      const idStr = el.getAttribute("w:id");
      if (idStr === null) continue;
      const idNum = parseInt(idStr, 10);
      if (!Number.isFinite(idNum)) continue;
      if (includeZero) { if (idNum < 0) continue; }
      else { if (idNum <= 0) continue; }
      const txt = plainTextOf(el);
      const m = txt.match(/@(\d+)/);
      if (m) markerCounts[m[1]] = (markerCounts[m[1]] || 0) + 1;
      else unmarked++;
    }
    const sortedKeys = Object.keys(markerCounts).sort();
    for (const mk of sortedKeys) {
      sources.push({
        id: `${sourceType}_@${mk}`,
        source_type: sourceType,
        source: sourceType,
        marker: mk,
        has_at: true,
        count: markerCounts[mk],
        icon: SOURCE_LABELS[sourceType] || "",
        label: `${hebName} @${mk}`,
      });
    }
    if (unmarked) {
      sources.push({
        id: `${sourceType}_none`,
        source_type: sourceType,
        source: sourceType,
        marker: null,
        has_at: false,
        count: unmarked,
        icon: SOURCE_LABELS[sourceType] || "",
        label: `${hebName} ללא סימון (${unmarked})`,
      });
    }
  }

  scan(parts["word/footnotes.xml"], "footnote", SOURCE_FOOTNOTE, "שוליים", false);
  scan(parts["word/endnotes.xml"],  "endnote",  SOURCE_ENDNOTE,  "סיום",   false);
  scan(parts["word/comments.xml"],  "comment",  SOURCE_COMMENT,  "בלון",   true);

  return sources;
}

// =====================================================================
// public — read_footnotes / read_endnotes / read_comments (לpreview)
// =====================================================================

// תאימות: ה-dialog משתמש ב-`rich.get_text()` בעת preview.
// אנחנו מחזירים ‫{ id: { get_text: () => string, paragraphs, plainText } }
function notesAsLegacy(notes) {
  const out = {};
  for (const id of Object.keys(notes)) {
    const n = notes[id];
    out[id] = {
      paragraphs: n.paragraphs,
      plainText: n.plainText,
      get_text() { return n.plainText; },
    };
  }
  return out;
}

export async function read_footnotes(input) {
  const parts = await loadDocxParts(input);
  return notesAsLegacy(buildNotesTable(parts["word/footnotes.xml"], "footnote", false));
}
export async function read_endnotes(input) {
  const parts = await loadDocxParts(input);
  return notesAsLegacy(buildNotesTable(parts["word/endnotes.xml"], "endnote", false));
}
export async function read_comments(input) {
  const parts = await loadDocxParts(input);
  return notesAsLegacy(buildNotesTable(parts["word/comments.xml"], "comment", true));
}

// =====================================================================
// public — extract_word_html (ה-API החדש החדש)
// =====================================================================

/**
 * @param {ArrayBuffer|Uint8Array|Blob|File} input — DOCX
 * @param {Array<{stream, symbol}>} selected — בחירת המשתמש בדיאלוג
 * @returns {Promise<{
 *   mainHtml: string,
 *   streamsByCode: Object<string, string>,
 *   streamLabels:  Object<string, string>,
 *   streamSymbols: Object<string, string>,
 *   diag: object,
 * }>}
 */
export async function extract_word_html(input, selected) {
  const parts = await loadDocxParts(input);
  const docXml = parts["word/document.xml"];
  if (!docXml) {
    return {
      mainHtml: "<p>קובץ DOCX ללא תוכן (חסר word/document.xml)</p>",
      streamsByCode: {}, streamLabels: {}, streamSymbols: {},
      diag: { error: "no document.xml" },
    };
  }

  const fnNotes = buildNotesTable(parts["word/footnotes.xml"], "footnote", false);
  const enNotes = buildNotesTable(parts["word/endnotes.xml"],  "endnote",  false);
  const cmNotes = buildNotesTable(parts["word/comments.xml"],  "comment",  true);

  // בנה מילוני marker → symbol, ו-symbol-של-no-marker
  const fn_m = {}, en_m = {}, cm_m = {};
  let fn_n = null, en_n = null, cm_n = null;

  // streamsByCode: code → buf של HTML (להדפסה)
  // נצמיד code סדרתי לסמלים ייחודיים בלבד.
  const symbolToCode = {};
  const streamLabels = {};
  const streamSymbols = {};
  const streamBuckets = {};   // code → [paragraphHtml,...] (paragraphs של הערות)
  let nextCode = 1;

  function ensureCode(symbol, label) {
    if (!symbol) return null;
    if (symbolToCode[symbol]) {
      // עדכן label אם עוד לא נקבע
      if (!streamLabels[symbolToCode[symbol]] && label) {
        streamLabels[symbolToCode[symbol]] = label;
      }
      return symbolToCode[symbol];
    }
    const code = String(nextCode++).padStart(2, "0");
    symbolToCode[symbol] = code;
    streamSymbols[code] = symbol;
    streamLabels[code] = label || symbol;
    streamBuckets[code] = [];
    return code;
  }

  for (const item of selected || []) {
    const stream = item && item.stream ? item.stream : item;
    const symbol = (item && item.symbol) || stream?.series || null;
    if (!stream || !symbol) continue;
    const src = stream.source_type || stream.source;
    const marker = stream.marker;
    const labelMain = stream.label || `${src} ${marker ? "@" + marker : "ללא סימון"}`;
    ensureCode(symbol, labelMain);

    if (src === "footnote") {
      if (marker) fn_m[marker] = symbol;
      else fn_n = symbol;
    } else if (src === "endnote") {
      if (marker) en_m[marker] = symbol;
      else en_n = symbol;
    } else if (src === "comment") {
      if (marker) cm_m[marker] = symbol;
      else cm_n = symbol;
    }
  }

  // ---------- handle a single note reference inside the body ----------
  function handleRef(refType, id, refFmt) {
    let table, m2s, nsym;
    if (refType === "footnote") { table = fnNotes; m2s = fn_m; nsym = fn_n; }
    else if (refType === "endnote") { table = enNotes; m2s = en_m; nsym = en_n; }
    else if (refType === "comment") { table = cmNotes; m2s = cm_m; nsym = cm_n; }
    else return null;

    const note = table[id];
    if (!note) return null;
    const { symbol, prefixLen } = resolveNoteStream(note.plainText, m2s, nsym);
    if (!symbol) return null;
    const code = symbolToCode[symbol];
    if (!code) return null;

    // בנה את ה-HTML של ההערה: סמל הזרם בתחילה, ואחר-כך ה-paragraphs של ההערה
    // אחרי הסרת הקידומת מהפסקה הראשונה.
    const noteParas = note.paragraphs.map(p => p.slice());
    if (noteParas.length === 0) noteParas.push([]);
    if (prefixLen > 0) noteParas[0] = trimPrefixFromTokens(noteParas[0], prefixLen);

    const noteHtmls = noteParas.map(tokens => tokensToInlineHtml(tokens));
    // הוסף את ה-symbol כתחילית של הפסקה הראשונה
    if (noteHtmls.length === 0) noteHtmls.push("");
    noteHtmls[0] = escapeHtml(symbol) + " " + noteHtmls[0];

    // דחוף לזרם — כל פסקה בנפרד (כך שמספר פסקאות בהערה אחת תיראינה כפסקאות נפרדות)
    for (const para of noteHtmls) {
      streamBuckets[code].push(para);
    }
    return symbol;
  }

  // ---------- main body ----------
  // השורש body
  const bodyEls = docXml.getElementsByTagName("w:body");
  const body = bodyEls[0];
  const bodyParas = [];
  if (body) {
    // נשמור על אותו מבנה כמו ב-comparator_tool: שטיחה של כל ה-w:p במסמך
    // (כולל אלה שבתוך טבלאות וכו'). זה תואם
    // `findall(f'.//{{{WNS}}}p')` ב-Python.
    const allPs = body.getElementsByTagName("w:p");
    for (let i = 0; i < allPs.length; i++) {
      const tokens = tokensOfParagraph(allPs[i]);
      // עיבוד refs לסמלים
      const out = [];
      for (const tk of tokens) {
        if (tk.kind === "ref") {
          const sym = handleRef(tk.refType, tk.id, tk.fmt);
          if (sym) out.push({ kind: "symbol", symbol: sym });
          // אחרת — דרופ; אין לנו זרם תואם
        } else {
          out.push(tk);
        }
      }
      if (tokensEffectivelyEmpty(out)) continue;
      const html = tokensToInlineHtml(out);
      bodyParas.push(html);
    }
  }

  const mainHtml = bodyParas.length
    ? bodyParas.map(b => `<p>${b}</p>`).join("")
    : "<p></p>";

  const streamsByCode = {};
  for (const code of Object.keys(streamBuckets)) {
    const paras = streamBuckets[code];
    streamsByCode[code] = paras.length
      ? paras.map(b => `<p>${b}</p>`).join("")
      : "<p></p>";
  }

  return {
    mainHtml,
    streamsByCode,
    streamLabels,
    streamSymbols,
    diag: {
      paragraphCount: bodyParas.length,
      streamCounts: Object.fromEntries(
        Object.entries(streamBuckets).map(([k, v]) => [k, v.length])
      ),
    },
  };
}

// =====================================================================
// תאימות אחורה: extract_and_process — wrapper סביב extract_word_html
// =====================================================================
// ה-dialog הישן קרא לזה ועיבד את ה-RichText חזרה. בגרסה החדשה, ה-dialog
// עבר ל-extract_word_html ישירות. אנחנו עדיין מחזיקים פונקציה מלאה
// פה, אבל היא מחזירה אובייקט שונה — כל הקוד שמתבסס על RichText/LaTeX
// כבר לא קיים.
//
// אם יש קוד חיצוני שעדיין משתמש ב-API הישן — הוא צריך להיות מותאם.
export async function extract_and_process(input, sd, _extMap) {
  // sd: { sid: { source_type, marker, series, ... } }
  const selected = [];
  for (const sid of Object.keys(sd || {})) {
    const s = sd[sid];
    if (!s || !s.series) continue;
    selected.push({
      stream: {
        source_type: s.source_type,
        marker: s.marker,
        label: `${s.source_type} ${s.marker ? "@" + s.marker : "ללא סימון"}`,
      },
      symbol: `@${s.series}`, // השארה זמנית למקרה של קוד חיצוני
    });
  }
  return await extract_word_html(input, selected);
}

// =====================================================================
// metadata helpers — תאימות (מחזירים ערכים סבירים, לא חיוני להציג מטא-דאטה)
// =====================================================================

export async function extract_doc_titles(_input) {
  return ["", ""];
}
export async function extract_headers_footers(_input) {
  return { header: "", footer: "" };
}
export async function find_sections_in_docx(_input) {
  return [];
}
export async function find_all_styles_in_docx(_input) {
  return {};
}

// =====================================================================
// פגיעות-תאימות: API שלא בשימוש פעיל אבל יוצא ע"י המודול הישן
// =====================================================================

// לא חיוני אבל הקיים ייצא, ויש קוד שלא מתחת לעצמו עשוי לייבא:
export async function count_notes_per_stream(_input, _sd) { return {}; }
export async function load_external_notes(_ext_file, _ext_marker) { return null; }
export async function find_all_styles_full(_input) { return {}; }
export async function extract_parallel_paragraphs(_input) { return []; }

// תאימות: אובייקט dummy עבור קוד שעדיין משתמש ב-RichText
export class CharToken {
  constructor(char) { this.char = char; }
}
export class RichText {
  constructor(tokens) { this.tokens = tokens || []; }
  get_text() { return this.tokens.map(t => t.char || "").join(""); }
}
export function richSlice(rich, a, b) {
  return new RichText((rich.tokens || []).slice(a, b));
}
