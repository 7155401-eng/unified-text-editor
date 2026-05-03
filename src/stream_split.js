// stream_split.js
// פיצול ואיחוד תוכן בין חלונית ראשית לחלוניות זרמים.
//
// "פיצול" (split):
//   טקסט ראשי כמו: "פתיחה @01 הערה ראשונה @02 הערה שנייה @01 הערה נוספת"
//   הופך ל:
//     ראשי:    "פתיחה [@01] [@02] [@01]"   (סימני זרם בלבד)
//     זרם 01:  "הערה ראשונה / הערה נוספת"
//     זרם 02:  "הערה שנייה"
//
// הסתכלות: חיתוך לפי כל סימן ‎@NN — הטקסט בין סימן N לסימן N+1 שייך לזרם N.

const MARKER_RX = /@(\d{1,3})/g;
const SEPARATOR = "\n— —\n"; // מפריד ויזואלי בין הערות מאותו זרם

/**
 * סורק טקסט גולמי, מחזיר:
 *   { mainText, streams }
 * כאשר streams הוא אובייקט { "01": [...], "02": [...] }
 */
export function splitTextByMarkers(rawText) {
  const matches = [];
  let m;
  MARKER_RX.lastIndex = 0;
  while ((m = MARKER_RX.exec(rawText)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      symbol: m[0],
      code: String(parseInt(m[1], 10)).padStart(2, "0"),
    });
  }

  const streams = {};
  if (matches.length === 0) {
    return { mainText: rawText, streams, intro: rawText };
  }

  // טקסט לפני הסימן הראשון = הקדמה (נשאר בראשי)
  const intro = rawText.slice(0, matches[0].start);

  let mainText = intro;
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const contentEnd = next ? next.start : rawText.length;
    const content = rawText.slice(cur.end, contentEnd).trim();

    // הוסף לראשי רק את הסימן עצמו (כמשמר מקום)
    mainText += (mainText.endsWith(" ") || mainText === "") ? cur.symbol : " " + cur.symbol;

    // הוסף את התוכן לזרם המתאים
    if (content) {
      if (!streams[cur.code]) streams[cur.code] = [];
      streams[cur.code].push(content);
    }
  }

  return { mainText, streams, intro };
}

/**
 * בונה HTML עבור הראשי — הקדמה + סימני זרם צבעוניים בלבד
 */
export function buildMainHTML(rawText) {
  const { mainText } = splitTextByMarkers(rawText);
  // המרת @NN ל‑<span> צבעוני
  const html = escapeHtml(mainText).replace(
    /@(\d{1,3})/g,
    (m, n) => {
      const code = String(parseInt(n, 10)).padStart(2, "0");
      const c = colorFor(code);
      return `<span class="stream-marker stream-${code}" data-stream="${code}" data-uid="split-${code}-${Math.random().toString(36).slice(2, 8)}" style="background-color:${c.bg};color:${c.fg};border-radius:3px;padding:0 3px;font-weight:600;">@${n}</span>`;
    }
  );
  // מחלק לפסקאות לפי שורה ריקה
  const paragraphs = html.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  return paragraphs.length
    ? paragraphs.map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n")
    : `<p>${html.replace(/\n/g, "<br>")}</p>`;
}

/**
 * בונה HTML לחלונית זרם בודד — פסקה אחת רציפה, סימני @NN אינלייניים.
 * המערך notes יוצר מחרוזת רציפה: "@NN note1 @NN note2 @NN note3"
 * הסימנים יזוהו אוטומטית ע"י StreamMark Plugin ויקבלו num רץ.
 */
export function buildStreamHTML(code, notes) {
  if (!notes || !notes.length) return `<p>—</p>`;
  const symbol = `@${code}`;
  const flat = notes.map((n, idx) => `${symbol} [${idx + 1}] ${n.trim()}`).join(SEPARATOR);
  // פסקה אחת — \n מנותקות הופכות לרווחים
  const escaped = escapeHtml(flat).replace(/\n/g, " ");
  return `<p>${escaped}</p>`;
}

/**
 * מפצל תוכן של חלונית זרם להערות לפי סימוני @NN בתוכה.
 * כל @NN בפנים מתחיל הערה חדשה. טקסט לפני @NN הראשון = הקדמה (לא הערה).
 */
export function splitStreamNotesByMarkers(streamText) {
  const matches = [...streamText.matchAll(/@\d{1,3}/g)];
  if (matches.length === 0) return [];
  const notes = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : streamText.length;
    notes.push(streamText.slice(start, end).trim().replace(/^\[\d+\]\s*/, ""));
  }
  return notes;
}

/**
 * איחוד הפוך — לוקח ראשי + חלוניות זרמים, מחזיר טקסט גולמי
 */
export function mergeBackToText(mainText, streamsObj) {
  // הולך על mainText, כל פעם שמוצא @NN — מוסיף את ההערה הבאה מאותו זרם
  const cursors = {}; // לכל זרם — איזה הערה הבאה לקחת
  const out = mainText.replace(/@(\d{1,3})/g, (m, n) => {
    const code = String(parseInt(n, 10)).padStart(2, "0");
    cursors[code] = (cursors[code] || 0);
    const notes = streamsObj[code] || [];
    const note = notes[cursors[code]];
    cursors[code]++;
    return note ? `${m} ${note}` : m;
  });
  return out;
}

// === עזרים פנימיים ===

const PALETTE = [
  { bg: "#FEE2E2", fg: "#7F1D1D" },
  { bg: "#DBEAFE", fg: "#1E3A8A" },
  { bg: "#DCFCE7", fg: "#14532D" },
  { bg: "#FEF3C7", fg: "#78350F" },
  { bg: "#F3E8FF", fg: "#581C87" },
  { bg: "#CFFAFE", fg: "#164E63" },
  { bg: "#FCE7F3", fg: "#831843" },
  { bg: "#E5E7EB", fg: "#1F2937" },
];

function colorFor(code) {
  const n = parseInt(code, 10);
  if (Number.isFinite(n) && n >= 1) return PALETTE[(n - 1) % PALETTE.length];
  return PALETTE[0];
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
