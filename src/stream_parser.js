// משה 2026-05-07: thin client only — האלגוריתם הועבר לשרת (worker/stream_parser.js).
// בלי השרת אין אפשרות לזהות זרמים. זאת הגנה מפני העתקת הקוד.
// 2026-05-19: הסורק מחזיר גם חיווי כותרות כדי שהמשתמש ידע מיד אם אפשר לחלק לספר/פרקים.

const ENDPOINT = '/api/streams/parse';

const HEBREW_MARKS_RX = /[\u0591-\u05C7]/g;
let lastHeadingNoticeKey = "";

function stripHebrewMarks(text) {
  return String(text || "").normalize("NFD").replace(HEBREW_MARKS_RX, "");
}

function scanHeadings(text) {
  const raw = String(text || "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const htmlH1 = (raw.match(/<h1\b/gi) || []).length;
  const htmlH2 = (raw.match(/<h2\b/gi) || []).length;
  let h1 = htmlH1;
  let h2 = htmlH2;
  const samples = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^##\s+\S/.test(trimmed)) {
      h2++;
      if (samples.length < 5) samples.push(trimmed.replace(/^##\s+/, ""));
      continue;
    }

    if (/^#\s+\S/.test(trimmed)) {
      h1++;
      if (samples.length < 5) samples.push(trimmed.replace(/^#\s+/, ""));
      continue;
    }

    const normalized = stripHebrewMarks(trimmed).trim();

    // במסמכים תורניים רביל כותרות H1 מיובאות כטקסט רגיל:
    // פרק / שער / פרשה, כולל ניקוד במקור.
    if (/^(?:פרק|שער|פרשה)\s+\S/u.test(normalized)) {
      h1++;
      if (samples.length < 5) samples.push(trimmed);
      continue;
    }

    // רמה משנית נפוצה כאשר אין H2 סמנטי.
    if (/^(?:סימן|משנה|הלכה|סעיף)\s+\S/u.test(normalized)) {
      h2++;
      if (samples.length < 5) samples.push(trimmed);
    }
  }

  return {
    h1,
    h2,
    total: h1 + h2,
    samples,
  };
}

function notifyHeadingScan(headings) {
  if (!headings || !headings.total) return;

  const key = `${headings.h1}|${headings.h2}|${headings.samples.join("|")}`;
  if (key === lastHeadingNoticeKey) return;
  lastHeadingNoticeKey = key;

  const detail = { ...headings };
  try {
    window.dispatchEvent(new CustomEvent("ravtext:document-headings-scanned", { detail }));
  } catch (_) {}

  const status = document.getElementById("status");
  if (status) {
    status.textContent = `זוהו ${headings.total} כותרות במסמך — H1: ${headings.h1}, H2: ${headings.h2}.`;
  }

  // נדחה לסוף פעולת הסורק, כדי שה-alert הקייל על זרמים יופיע קודם.
  setTimeout(() => {
    const lines = [
      `זוהו ${headings.total} כותרות במסמך.`,
      `H1: ${headings.h1}`,
      `H2: ${headings.h2}`,
    ];

    if (headings.samples.length) {
      lines.push("");
      lines.push("דוגמאות:");
      headings.samples.forEach((sample) => lines.push(`• ${sample}`));
    }

    lines.push("");
    lines.push('אפשר לפתוח "ייבוא ספר" ולחלק את המסמך לפי הכותרות שזוהו.');
    alert(lines.join("\n"));
  }, 0);
}

async function callServer(text) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: String(text || '') }),
  });
  if (!res.ok) {
    throw new Error(`Stream parse failed: HTTP ${res.status}`);
  }
  return res.json();
}

function attachHeadingStats(result, text) {
  const headings = scanHeadings(text);
  const out = result && typeof result === "object" ? result : {};
  out.stats = out.stats && typeof out.stats === "object" ? out.stats : { total: 0, byStream: {} };
  out.stats.headings = headings;
  notifyHeadingScan(headings);
  return out;
}

export async function parseRawTextToHTML(text) {
  const result = await callServer(text);
  return attachHeadingStats(result, text);
}

export async function scanRawText(text) {
  const r = await callServer(text);
  return attachHeadingStats(r, text).stats;
}
