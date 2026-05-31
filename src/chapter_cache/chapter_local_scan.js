// משה 2026-05-31: סריקת כותרות מקומית של DOCX בדפדפן. משחזרת את
// scanHeadingsLocally שהוסר ב-PR a1e8b4e ("server-only upload"), כדי שגם
// בסביבה מקומית ללא Cloudflare Worker יעבוד פיצול לפרקים. עובד גם בשרת
// כ-fallback מהיר (לא משדר את הקובץ ל-Worker אם כבר אפשר לסרוק בדפדפן).
//
// פלט תואם 1:1 לזה ש-importWordChaptersOnServer החזיר:
//   { ok, serverSide:true, heads:{1:[],2:[]}, total, h:{1..6}, chars, words,
//     fileHash, fileName }
// כך ש-normalizeServerScanState ב-chapter_server_api.js יבצע map נכון
// בלי שינוי.

import JSZip from "jszip";

// ─── XML helpers (regex-based — מהיר על מסמכי Word גדולים) ────────────────

function sXmlDec(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function sAttr(tagXml, name) {
  const re = new RegExp(`\\b${name}="([^"]*)"`);
  const m = re.exec(tagXml);
  return m ? sXmlDec(m[1]) : null;
}

function sTag(xml, tagName, fromIdx = 0) {
  const re = new RegExp(`<${tagName}\\b[^>]*?/?>`);
  re.lastIndex = fromIdx;
  return re.exec(xml.slice(fromIdx));
}

function sPText(pXml) {
  const re = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let out = "";
  let m;
  while ((m = re.exec(pXml))) out += sXmlDec(m[1]);
  return out;
}

// סורק את styles.xml כדי לקבל מיפוי styleId → outlineLevel (אם מוגדר).
// Word שומר את רמת הכותרת לרוב ב-pPr/outlineLvl, או לפי שם הסגנון "Heading N".
function sParseStyles(stylesXml) {
  const result = {};
  if (!stylesXml) return result;
  const styleRe = /<w:style\b[^>]*?>([\s\S]*?)<\/w:style>/g;
  let m;
  while ((m = styleRe.exec(stylesXml))) {
    const styleHeader = m[0].slice(0, m[0].indexOf(">") + 1);
    const id = sAttr(styleHeader, "w:styleId");
    if (!id) continue;
    const body = m[1];
    let level = null;
    const outlineMatch = body.match(/<w:outlineLvl\b[^>]*\bw:val="(\d+)"/);
    if (outlineMatch) {
      level = parseInt(outlineMatch[1], 10) + 1; // 0-based → 1-based
    } else {
      const nameMatch = body.match(/<w:name\b[^>]*\bw:val="([^"]+)"/);
      const nm = nameMatch ? nameMatch[1].toLowerCase() : "";
      const hm = nm.match(/heading\s*([1-6])/);
      if (hm) level = parseInt(hm[1], 10);
    }
    if (level >= 1 && level <= 6) result[id] = level;
  }
  return result;
}

function sLevelOf(pXml, styles) {
  // 1) explicit outlineLvl in pPr
  const outlineMatch = pXml.match(/<w:outlineLvl\b[^>]*\bw:val="(\d+)"/);
  if (outlineMatch) return parseInt(outlineMatch[1], 10) + 1;
  // 2) pStyle reference
  const styleMatch = pXml.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/);
  if (styleMatch && styles[styleMatch[1]]) return styles[styleMatch[1]];
  return 0;
}

// ─── ZIP fast-path: DecompressionStream (no JSZip) for huge files ─────────

async function _zipNativeExtract(arrayBuffer, targetFilename) {
  if (typeof DecompressionStream === "undefined") return null;
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let pos = 0;
  while (pos < bytes.length - 30) {
    if (bytes[pos] !== 0x50 || bytes[pos+1] !== 0x4B || bytes[pos+2] !== 0x03 || bytes[pos+3] !== 0x04) {
      pos++;
      continue;
    }
    const flags       = view.getUint16(pos + 6,  true);
    const compression = view.getUint16(pos + 8,  true);
    const compSize    = view.getUint32(pos + 18, true);
    const fnLen       = view.getUint16(pos + 26, true);
    const extraLen    = view.getUint16(pos + 28, true);
    const dataStart   = pos + 30 + fnLen + extraLen;
    const fn = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + fnLen));
    if (fn === targetFilename) {
      if (flags & 0x08) return null;
      if (compression === 0) {
        return new TextDecoder("utf-8").decode(bytes.subarray(dataStart, dataStart + compSize));
      }
      if (compression !== 8) return null;
      const comp = bytes.slice(dataStart, dataStart + compSize);
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const decompBuf = await new Response(stream).arrayBuffer();
      return new TextDecoder("utf-8").decode(decompBuf);
    }
    if (flags & 0x08) {
      pos = dataStart;
      while (pos < bytes.length - 4 &&
        !(bytes[pos]===0x50 && bytes[pos+1]===0x4B &&
          (bytes[pos+2]===0x03||bytes[pos+2]===0x01||bytes[pos+2]===0x05))) {
        pos++;
      }
    } else {
      pos = dataStart + compSize;
    }
  }
  return null;
}

async function readDocxParts(buf) {
  let docXml = null;
  let stylesXml = null;
  try {
    docXml = await _zipNativeExtract(buf, "word/document.xml");
    stylesXml = await _zipNativeExtract(buf, "word/styles.xml");
  } catch { /* fall through to JSZip */ }
  if (!docXml || !stylesXml) {
    const zip = await JSZip.loadAsync(buf);
    if (!docXml) docXml = (await zip.file("word/document.xml")?.async("text")) || "";
    if (!stylesXml) stylesXml = (await zip.file("word/styles.xml")?.async("text")) || "";
  }
  return { docXml, stylesXml };
}

// ─── Main API ──────────────────────────────────────────────────────────────

async function fileHashLocal(buf) {
  try {
    if (!crypto?.subtle) return null;
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

// onProgress({stage, pct, detail}) — תואם ל-onProgress של importWordChaptersOnServer.
export async function scanWordChaptersLocally(file, onProgress) {
  const reportStage = (stage, detail) => {
    try { onProgress?.({ stage, pct: null, detail }); } catch {}
  };
  reportStage("processing", "קורא את הקובץ");
  const buf = await file.arrayBuffer();
  reportStage("processing", "פותח את הארכיון");
  const { docXml, stylesXml } = await readDocxParts(buf);
  if (!docXml) throw new Error("לא נמצא גוף מסמך Word תקין.");

  reportStage("processing", "מנתח סגנונות");
  const styles = sParseStyles(stylesXml);

  reportStage("processing", "סורק כותרות");
  const heads = { 1: [], 2: [] };
  const h = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let partIndex = 0;
  let pos = 0;
  const END_TAG = "</w:p>";

  while (pos < docXml.length) {
    const pStart = docXml.indexOf("<w:p", pos);
    if (pStart < 0) break;
    const ch = docXml.charCodeAt(pStart + 4);
    if (ch !== 62 /* > */ && ch !== 32 /* space */ && ch !== 9 && ch !== 10 && ch !== 13) {
      if (ch === 47 /* / — self-closing <w:p/> */) { partIndex++; pos = pStart + 6; continue; }
      pos = pStart + 4;
      continue;
    }
    const pEnd = docXml.indexOf(END_TAG, pStart);
    if (pEnd < 0) break;
    pos = pEnd + 6;

    const pPrStartCandidate = docXml.indexOf("<w:pStyle", pStart);
    const outlineCandidate  = docXml.indexOf("<w:outlineLvl", pStart);
    const hasStyle   = pPrStartCandidate >= pStart && pPrStartCandidate < pEnd;
    const hasOutline = outlineCandidate >= pStart && outlineCandidate < pEnd;
    if (hasStyle || hasOutline) {
      const pXml = docXml.slice(pStart, pEnd + 6);
      const level = sLevelOf(pXml, styles);
      if (level >= 1 && level <= 6) {
        h[level] = (h[level] || 0) + 1;
        if (level <= 2) {
          const text = sPText(pXml).trim();
          if (text) heads[level].push({ title: text, start: partIndex });
        }
      }
    }
    partIndex++;
  }

  reportStage("processing", "סופר תווים");
  const tRe = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let totalChars = 0;
  let tm;
  while ((tm = tRe.exec(docXml))) totalChars += tm[1].length;

  const hash = await fileHashLocal(buf);

  return {
    ok: true,
    serverSide: true, // ל-normalizeServerScanState
    heads,
    total: heads[1].length + heads[2].length,
    h,
    chars: totalChars,
    words: Math.round(totalChars / 5),
    fileHash: hash,
    fileName: file?.name || "מסמך Word",
    _docXml: docXml,    // נשמר לחילוץ פרק בודק לאחר מכן (לא נשלח לרשת)
    _stylesXml: stylesXml,
  };
}

// חילוץ פרק יחיד מהמסמך — מקבל את ה-doc/styles XML שכבר חולץ בסריקה,
// או מחלץ מחדש אם לא ניתנו. מחזיר בפורמט של extractWordChapterOnServer.
export async function extractWordChapterLocally(file, { level, index, scanResult } = {}) {
  let docXml = scanResult?._docXml;
  let stylesXml = scanResult?._stylesXml;
  if (!docXml) {
    const parts = await readDocxParts(await file.arrayBuffer());
    docXml = parts.docXml; stylesXml = parts.stylesXml;
  }
  if (!docXml) throw new Error("לא נמצא גוף מסמך Word.");
  const styles = sParseStyles(stylesXml);

  // מצא את ה-paragraph ranges לפי heads
  const heads = { 1: [], 2: [] };
  const paraOffsets = []; // { start, end, level }
  let pos = 0, partIndex = 0;
  const END_TAG = "</w:p>";
  while (pos < docXml.length) {
    const pStart = docXml.indexOf("<w:p", pos);
    if (pStart < 0) break;
    const ch = docXml.charCodeAt(pStart + 4);
    if (ch !== 62 && ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) {
      if (ch === 47) { paraOffsets.push({ start: pStart, end: pStart + 6, level: 0 }); partIndex++; pos = pStart + 6; continue; }
      pos = pStart + 4;
      continue;
    }
    const pEnd = docXml.indexOf(END_TAG, pStart);
    if (pEnd < 0) break;
    const pXml = docXml.slice(pStart, pEnd + 6);
    let pLevel = 0;
    if (pXml.includes("<w:pStyle") || pXml.includes("<w:outlineLvl")) {
      pLevel = sLevelOf(pXml, styles);
      if (pLevel >= 1 && pLevel <= 2) {
        const text = sPText(pXml).trim();
        if (text) heads[pLevel].push({ title: text, start: partIndex });
      }
    }
    paraOffsets.push({ start: pStart, end: pEnd + 6, level: pLevel });
    pos = pEnd + 6;
    partIndex++;
  }

  const wanted = heads[level]?.[index];
  if (!wanted) throw new Error("פרק לא נמצא בקובץ.");
  const startPara = wanted.start;
  const nextHead = heads[level]?.[index + 1];
  const endPara = nextHead ? nextHead.start : paraOffsets.length;

  // הרכב XML חדש שכולל רק את הפסקאות של הפרק הזה
  const fromPos = paraOffsets[startPara]?.start ?? 0;
  const toPos   = endPara < paraOffsets.length ? paraOffsets[endPara].start : docXml.length;
  const bodyOpen = docXml.match(/<w:body\b[^>]*>/);
  const sliceXml = docXml.slice(fromPos, toPos);

  // Collect plain text from this chapter
  const tRe = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let plain = "";
  let m;
  while ((m = tRe.exec(sliceXml))) plain += sXmlDec(m[1]) + (m[0].endsWith("</w:t>") ? "" : "");
  // Group by paragraph
  const paragraphs = [];
  const pRe = /<w:p\b[^>]*?>([\s\S]*?)<\/w:p>/g;
  let pm;
  while ((pm = pRe.exec(sliceXml))) {
    const ptext = sPText(pm[1]).trim();
    if (ptext) paragraphs.push(ptext);
  }

  return {
    ok: true,
    serverSide: true,
    chapter: {
      level,
      index,
      title: wanted.title,
      paragraphs,
      plain,
      bodyOpen: bodyOpen?.[0] || "<w:body>",
      sliceXml,
    },
  };
}
