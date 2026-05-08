// extractor.py port — read txt / docx / rtf / md from a Browser File object.
// Returns plain Hebrew text suitable for vocalization.

export const SUPPORTED_EXTS = new Set([".txt", ".docx", ".rtf", ".md"]);

function getExt(name) {
  const i = (name || "").lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

export async function extractText(file) {
  if (!file) throw new Error("לא נבחר קובץ");
  const ext = getExt(file.name || "");
  if (ext === ".txt" || ext === ".md") {
    return await readTextFile(file);
  }
  if (ext === ".docx") {
    return await readDocx(file);
  }
  if (ext === ".rtf") {
    return await readRtf(file);
  }
  throw new Error(
    `סוג קובץ לא נתמך: ${ext}. נתמכים: ${Array.from(SUPPORTED_EXTS).sort().join(", ")}`
  );
}

async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Try utf-8-sig (strip BOM), utf-8, windows-1255, cp1252, iso-8859-8
  // (TextDecoder with fatal:true mirrors the Python "try each encoding" loop.)
  const tryDec = (label, stripBom) => {
    try {
      const dec = new TextDecoder(label, { fatal: true });
      let bytesIn = bytes;
      if (stripBom && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        bytesIn = bytes.slice(3);
      }
      return dec.decode(bytesIn);
    } catch (e) {
      return null;
    }
  };
  let s = tryDec("utf-8", true);   // utf-8-sig
  if (s !== null) return s;
  s = tryDec("utf-8", false);
  if (s !== null) return s;
  s = tryDec("windows-1255", false);
  if (s !== null) return s;
  s = tryDec("windows-1252", false);
  if (s !== null) return s;
  s = tryDec("iso-8859-8", false);
  if (s !== null) return s;
  // Fallback — replacement
  return new TextDecoder("utf-8").decode(bytes);
}

// ---- Minimal docx unzip + text extraction (no dependencies) ----
// docx is a zip; we read word/document.xml and pull <w:t> / <w:tab> / <w:br>.

async function readDocx(file) {
  const buf = await file.arrayBuffer();
  const entries = parseZipCentralDir(new Uint8Array(buf));
  const docEntry = entries.find(e => e.name === "word/document.xml");
  if (!docEntry) throw new Error("docx: לא נמצא word/document.xml");
  const xmlBytes = await inflateEntry(new Uint8Array(buf), docEntry);
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  return parseWordDocumentXml(xml).trim();
}

function parseWordDocumentXml(xml) {
  // For each <w:p> walk children in order, picking text from w:t,
  // \t for w:tab, \n for w:br.
  const ns = "w";
  const paragraphs = [];
  // Match each <w:p ...>...</w:p> non-greedy.
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = pRe.exec(xml)) !== null) {
    const inner = m[1];
    const chunks = [];
    // Walk tags in order.
    const tagRe = /<w:(t|tab|br)\b([^/>]*)(\/>|>([\s\S]*?)<\/w:\1>)/g;
    let tm;
    while ((tm = tagRe.exec(inner)) !== null) {
      const tag = tm[1];
      const closing = tm[3];
      const inside = tm[4] || "";
      if (tag === "t") {
        chunks.push(decodeXmlEntities(inside));
      } else if (tag === "tab") {
        chunks.push("\t");
      } else if (tag === "br") {
        chunks.push("\n");
      }
    }
    paragraphs.push(chunks.join(""));
  }
  return paragraphs.join("\n");
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// ---- Tiny ZIP reader (no streaming, ZIP32 only — sufficient for typical docx) ----

function readUInt16LE(b, o) { return b[o] | (b[o + 1] << 8); }
function readUInt32LE(b, o) {
  return ((b[o]) | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function parseZipCentralDir(bytes) {
  // Find EOCD: 0x06054b50 from the end (last 64KB)
  const sig = 0x06054b50;
  let eocd = -1;
  const minStart = Math.max(0, bytes.length - 0xFFFF - 22);
  for (let i = bytes.length - 22; i >= minStart; i--) {
    if (readUInt32LE(bytes, i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("docx: ZIP EOCD not found");
  const totalEntries = readUInt16LE(bytes, eocd + 10);
  const cdSize = readUInt32LE(bytes, eocd + 12);
  const cdOff = readUInt32LE(bytes, eocd + 16);
  const entries = [];
  let p = cdOff;
  const cdEnd = cdOff + cdSize;
  for (let n = 0; n < totalEntries && p < cdEnd; n++) {
    if (readUInt32LE(bytes, p) !== 0x02014b50) break;
    const compMethod = readUInt16LE(bytes, p + 10);
    const compSize = readUInt32LE(bytes, p + 20);
    const uncompSize = readUInt32LE(bytes, p + 24);
    const nameLen = readUInt16LE(bytes, p + 28);
    const extraLen = readUInt16LE(bytes, p + 30);
    const commLen = readUInt16LE(bytes, p + 32);
    const localOff = readUInt32LE(bytes, p + 42);
    const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes);
    entries.push({ name, compMethod, compSize, uncompSize, localOff });
    p += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

async function inflateEntry(bytes, entry) {
  // Local header: 0x04034b50 ; followed by name+extra; then data.
  const lo = entry.localOff;
  if (readUInt32LE(bytes, lo) !== 0x04034b50) {
    throw new Error("docx: bad local header");
  }
  const nameLen = readUInt16LE(bytes, lo + 26);
  const extraLen = readUInt16LE(bytes, lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = bytes.slice(dataStart, dataStart + entry.compSize);
  if (entry.compMethod === 0) return data;          // stored
  if (entry.compMethod === 8) {                     // deflate (raw)
    if (typeof DecompressionStream === "function") {
      const stream = new Blob([data]).stream().pipeThrough(
        new DecompressionStream("deflate-raw")
      );
      const ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error("docx: DecompressionStream לא זמין בדפדפן הזה");
  }
  throw new Error(`docx: שיטת דחיסה לא נתמכת (${entry.compMethod})`);
}

// ---- RTF — strip control words / groups / unicode escapes ----

async function readRtf(file) {
  const buf = await file.arrayBuffer();
  // RTF is latin-1; \uNNNN escapes carry the actual Unicode codepoints.
  let raw = new TextDecoder("latin1").decode(new Uint8Array(buf));
  raw = raw.replace(/\\u(-?\d+)\??/g, (_, n) => {
    let cp = parseInt(n, 10);
    if (cp < 0) cp = (cp + 65536) % 65536;
    return String.fromCodePoint(cp % 65536);
  });
  // Remove {\* ... } groups (no nesting). Repeat in case of consecutive ones.
  raw = raw.replace(/\{\\\*?[^{}]*\}/g, "");
  // Strip \word or \word123 or \word123<space>
  raw = raw.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  raw = raw.replace(/[{}]/g, "");
  raw = raw.replace(/\\par/g, "\n");
  return raw.trim();
}
