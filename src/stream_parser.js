// stream_parser.js
// מזהה דפוסי סימון בטקסט גולמי וממיר אותם לסימני זרם.

import { defaultLabelForCode } from "./engine_bridge.js";
//
// כללי זיהוי (לפי הוראת משה):
//   • @NN  — כל מספר זרם בנפרד ("01", "02", ... "99")
//   • [N]  — כל מספר בסוגריים מרובעות בנפרד
//   • (N)  — כל מספר בסוגריים עגולות בנפרד
//   • *, **, *** — כל סוג כוכבית כזרם נפרד ("asterisk-1", "asterisk-2", ...)
//   • †, ‡ — כל סמל פגיון/חרב כזרם נפרד
//   • {...} — תוכן בסוגריים מסולסלות = פריט בזרם "curly"
//
// הפונקציה מחזירה HTML עם <span class="stream-marker"> סביב כל זיהוי,
// עם data-stream, data-uid, data-symbol תקינים.

let _uidCounter = 0;
function uid() {
  _uidCounter++;
  return `auto-${Date.now().toString(36)}-${_uidCounter}`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// פלטה — מקבילה ל‑STREAM_PALETTE ב‑stream_mark.js
const PALETTE = [
  { bg: "#FEE2E2", fg: "#7F1D1D" }, // 01
  { bg: "#DBEAFE", fg: "#1E3A8A" }, // 02
  { bg: "#DCFCE7", fg: "#14532D" }, // 03
  { bg: "#FEF3C7", fg: "#78350F" }, // 04
  { bg: "#F3E8FF", fg: "#581C87" }, // 05
  { bg: "#CFFAFE", fg: "#164E63" }, // 06
  { bg: "#FCE7F3", fg: "#831843" }, // 07
  { bg: "#E5E7EB", fg: "#1F2937" }, // 08
];

function colorFor(streamCode) {
  // אם זרם מספרי — שייכות לפלטה
  const n = parseInt(streamCode, 10);
  if (Number.isFinite(n) && n >= 1) {
    return PALETTE[(n - 1) % PALETTE.length];
  }
  // עבור זרמי טקסט (curly/asterisk/dagger) — האש מהשם
  let h = 0;
  for (const ch of streamCode) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function wrapMark(streamCode, symbol, body) {
  const c = colorFor(streamCode);
  const u = uid();
  return (
    `<span class="stream-marker stream-${escapeHtml(streamCode)}" ` +
    `data-stream="${escapeHtml(streamCode)}" ` +
    `data-uid="${u}" ` +
    `data-symbol="${escapeHtml(symbol)}" ` +
    `style="background-color:${c.bg};color:${c.fg};border-radius:3px;padding:0 3px;font-weight:600;" ` +
    `title="${escapeHtml(defaultLabelForCode(streamCode))}">` +
    body +
    "</span>"
  );
}

// תבניות מקודמות לפי סדר ספציפיות (יש סדר חשוב — מסולסלות לפני [N] לפני @NN)
const PATTERNS = [
  {
    name: "curly",
    rx: /\{([^{}\n]{1,200})\}/g,
    streamFor: () => "curly",
    symbolFor: (m) => `{${m[1]}}`,
    bodyFor: (m) => m[0],
  },
  {
    name: "atNN",
    rx: /@(\d{1,3})/g,
    streamFor: (m) => String(parseInt(m[1], 10)).padStart(2, "0"),
    symbolFor: (m) => `@${m[1]}`,
    bodyFor: (m) => m[0],
  },
  {
    name: "bracketN",
    rx: /\[(\d{1,3})\]/g,
    streamFor: (m) => `b${m[1]}`,
    symbolFor: (m) => `[${m[1]}]`,
    bodyFor: (m) => m[0],
  },
  {
    name: "parenN",
    rx: /\((\d{1,3})\)/g,
    streamFor: (m) => `p${m[1]}`,
    symbolFor: (m) => `(${m[1]})`,
    bodyFor: (m) => m[0],
  },
  {
    name: "asterisk",
    rx: /(\*{1,5})(?!\*)/g,
    streamFor: (m) => `asterisk-${m[1].length}`,
    symbolFor: (m) => m[1],
    bodyFor: (m) => m[0],
  },
  {
    name: "dagger",
    rx: /[†‡]/g,
    streamFor: (m) => (m[0] === "†" ? "dagger" : "double-dagger"),
    symbolFor: (m) => m[0],
    bodyFor: (m) => m[0],
  },
];

// === API ראשי ===
// מקבל טקסט גולמי, מחזיר HTML עם סימני זרם מוטמעים.
export function parseRawTextToHTML(text) {
  // אוסף את כל ההתאמות מכל התבניות
  const events = [];
  for (const p of PATTERNS) {
    let m;
    p.rx.lastIndex = 0;
    while ((m = p.rx.exec(text)) !== null) {
      events.push({
        start: m.index,
        end: m.index + m[0].length,
        streamCode: p.streamFor(m),
        symbol: p.symbolFor(m),
        body: p.bodyFor(m),
        patternName: p.name,
      });
    }
  }

  // מיון לפי start, ובמקרה של חפיפה — שימור הראשון, פסילת חופפים
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted = [];
  let cursor = 0;
  for (const e of events) {
    if (e.start < cursor) continue; // חופף לקודם
    accepted.push(e);
    cursor = e.end;
  }

  // בנייה: טקסט בין האירועים + sip בכל אירוע
  let out = "";
  let i = 0;
  for (const e of accepted) {
    if (i < e.start) out += escapeHtml(text.slice(i, e.start));
    out += wrapMark(e.streamCode, e.symbol, escapeHtml(e.body));
    i = e.end;
  }
  if (i < text.length) out += escapeHtml(text.slice(i));

  // מחלק לפסקאות לפי שורה ריקה
  const paragraphs = out.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  const html = paragraphs.length
    ? paragraphs.map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n")
    : `<p>${out.replace(/\n/g, "<br>")}</p>`;

  // סטטיסטיקה — מי זוהה
  const stats = { total: accepted.length, byStream: {}, byPattern: {} };
  for (const e of accepted) {
    stats.byStream[e.streamCode] = (stats.byStream[e.streamCode] || 0) + 1;
    stats.byPattern[e.patternName] = (stats.byPattern[e.patternName] || 0) + 1;
  }

  return { html, stats };
}

// סוקר טקסט ומחזיר רק את הסטטיסטיקה (בלי לבנות HTML)
export function scanRawText(text) {
  return parseRawTextToHTML(text).stats;
}
