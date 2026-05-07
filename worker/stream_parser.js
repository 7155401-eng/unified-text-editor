// משה 2026-05-07: stream parser — אלגוריתם זיהוי דפוסי זרם.
// הועבר מ-src/stream_parser.js (היה בדפדפן, נחשף לכל גנב).
// כעת רץ רק כאן בשרת. הדפדפן קורא דרך /api/streams/parse.

const PALETTE = [
  { bg: '#FEE2E2', fg: '#7F1D1D' },
  { bg: '#DBEAFE', fg: '#1E3A8A' },
  { bg: '#DCFCE7', fg: '#14532D' },
  { bg: '#FEF3C7', fg: '#78350F' },
  { bg: '#F3E8FF', fg: '#581C87' },
  { bg: '#CFFAFE', fg: '#164E63' },
  { bg: '#FCE7F3', fg: '#831843' },
  { bg: '#E5E7EB', fg: '#1F2937' },
];

// משה 2026-05-07: מיירור של DEFAULT_STREAM_LABELS מ-engine_bridge.js
// (commit 67545d9 — שמות פרשנים במקום "זרם XX").
const DEFAULT_STREAM_LABELS = {
  '01': 'מגן אברהם',
  '02': 'משנה ברורה',
  '03': 'ביאור הלכה',
  '04': 'טורי זהב',
  '05': 'כף החיים',
};

function defaultLabelForCode(code) {
  return DEFAULT_STREAM_LABELS[code] || `זרם ${code}`;
}

function colorFor(streamCode) {
  const n = parseInt(streamCode, 10);
  if (Number.isFinite(n) && n >= 1) {
    return PALETTE[(n - 1) % PALETTE.length];
  }
  let h = 0;
  for (const ch of streamCode) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _uidCounter = 0;
function uid() {
  _uidCounter++;
  return `auto-${Date.now().toString(36)}-${_uidCounter}`;
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
    '</span>'
  );
}

const PATTERNS = [
  {
    name: 'curly',
    rx: /\{([^{}\n]{1,200})\}/g,
    streamFor: () => 'curly',
    symbolFor: (m) => `{${m[1]}}`,
    bodyFor: (m) => m[0],
  },
  {
    name: 'atNN',
    rx: /@(\d{1,3})/g,
    streamFor: (m) => String(parseInt(m[1], 10)).padStart(2, '0'),
    symbolFor: (m) => `@${m[1]}`,
    bodyFor: (m) => m[0],
  },
  {
    name: 'bracketN',
    rx: /\[(\d{1,3})\]/g,
    streamFor: (m) => `b${m[1]}`,
    symbolFor: (m) => `[${m[1]}]`,
    bodyFor: (m) => m[0],
  },
  {
    name: 'parenN',
    rx: /\((\d{1,3})\)/g,
    streamFor: (m) => `p${m[1]}`,
    symbolFor: (m) => `(${m[1]})`,
    bodyFor: (m) => m[0],
  },
  {
    name: 'asterisk',
    rx: /(\*{1,5})(?!\*)/g,
    streamFor: (m) => `asterisk-${m[1].length}`,
    symbolFor: (m) => m[1],
    bodyFor: (m) => m[0],
  },
  {
    name: 'dagger',
    rx: /[†‡]/g,
    streamFor: (m) => (m[0] === '†' ? 'dagger' : 'double-dagger'),
    symbolFor: (m) => m[0],
    bodyFor: (m) => m[0],
  },
];

export function parseStreamsToHtml(text) {
  if (typeof text !== 'string') {
    return { html: '', stats: { total: 0, byStream: {}, byPattern: {} } };
  }

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

  events.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted = [];
  let cursor = 0;
  for (const e of events) {
    if (e.start < cursor) continue;
    accepted.push(e);
    cursor = e.end;
  }

  let out = '';
  let i = 0;
  for (const e of accepted) {
    if (i < e.start) out += escapeHtml(text.slice(i, e.start));
    out += wrapMark(e.streamCode, e.symbol, escapeHtml(e.body));
    i = e.end;
  }
  if (i < text.length) out += escapeHtml(text.slice(i));

  const paragraphs = out.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  const html = paragraphs.length
    ? paragraphs.map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n')
    : `<p>${out.replace(/\n/g, '<br>')}</p>`;

  const stats = { total: accepted.length, byStream: {}, byPattern: {} };
  for (const e of accepted) {
    stats.byStream[e.streamCode] = (stats.byStream[e.streamCode] || 0) + 1;
    stats.byPattern[e.patternName] = (stats.byPattern[e.patternName] || 0) + 1;
  }

  return { html, stats };
}
