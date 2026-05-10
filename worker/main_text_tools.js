const SEPARATOR = "\n\u2014 \u2014\n";

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function escapeForRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function splitTextByMarkers(rawText) {
  const matches = [];
  const rx = /@(\d{1,3})/g;
  let m;
  while ((m = rx.exec(rawText)) !== null) {
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

  const intro = rawText.slice(0, matches[0].start);

  let mainText = intro;
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const contentEnd = next ? next.start : rawText.length;
    const content = rawText.slice(cur.end, contentEnd).trim();

    mainText += (mainText.endsWith(" ") || mainText === "") ? cur.symbol : " " + cur.symbol;

    if (content) {
      if (!streams[cur.code]) streams[cur.code] = [];
      streams[cur.code].push(content);
    }
  }

  return { mainText, streams, intro };
}

function buildMainHTML(rawText) {
  const { mainText } = splitTextByMarkers(rawText);
  const html = escapeHtml(mainText).replace(
    /@(\d{1,3})/g,
    (m, n) => {
      const code = String(parseInt(n, 10)).padStart(2, "0");
      const c = colorFor(code);
      return `<span class="stream-marker stream-${code}" data-stream="${code}" data-uid="split-${code}-${Math.random().toString(36).slice(2, 8)}" style="background-color:${c.bg};color:${c.fg};border-radius:3px;padding:0 3px;font-weight:600;">@${n}</span>`;
    }
  );
  const paragraphs = html.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  return paragraphs.length
    ? paragraphs.map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n")
    : `<p>${html.replace(/\n/g, "<br>")}</p>`;
}

function buildStreamHTML(code, notes) {
  if (!notes || !notes.length) return `<p>\u2014</p>`;
  const symbol = `@${code}`;
  const flat = notes.map((n, idx) => `${symbol} [${idx + 1}] ${n.trim()}`).join(SEPARATOR);
  const escaped = escapeHtml(flat).replace(/\n/g, " ");
  return `<p>${escaped}</p>`;
}

function splitStreamNotesByMarkers(streamText) {
  const matches = [...String(streamText || "").matchAll(/@\d{1,3}/g)];
  if (matches.length === 0) return [];
  const notes = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : streamText.length;
    notes.push(streamText.slice(start, end).trim().replace(/^\[\d+\]\s*/, ""));
  }
  return notes;
}

function mergeBackToText(mainText, streamsObj) {
  const cursors = {};
  return String(mainText || "").replace(/@(\d{1,3})/g, (m, n) => {
    const code = String(parseInt(n, 10)).padStart(2, "0");
    cursors[code] = (cursors[code] || 0);
    const notes = streamsObj[code] || [];
    const note = notes[cursors[code]];
    cursors[code]++;
    return note ? `${m} ${note}` : m;
  });
}

function inlineMerge(mainText, panes) {
  let out = String(mainText || "");
  for (const p of panes) {
    const sym = String(p?.symbol || "").trim();
    if (!sym) continue;
    const noteText = String(p?.text || "").trim();
    if (!noteText) continue;

    let parts = noteText.split(sym);
    if (parts.length > 0 && parts[0].trim() === "") parts.shift();

    let counter = 0;
    const regex = new RegExp(escapeForRegex(sym), "g");
    out = out.replace(regex, (match) => {
      if (counter < parts.length) {
        const note = parts[counter].trim();
        counter++;
        return `[[${sym} ${note}]]`;
      }
      return match;
    });
  }
  return out;
}

function inlineSplit(mainText, panes) {
  let out = String(mainText || "");
  const streamTexts = {};
  for (const p of panes) {
    const code = String(p?.streamCode || "");
    const sym = String(p?.symbol || "").trim();
    if (!code || !sym) continue;

    const extracted = [];
    const regex = new RegExp(`\\[\\[${escapeForRegex(sym)}([\\s\\S]*?)\\]\\]`, "g");
    out = out.replace(regex, (_match, content) => {
      extracted.push(content.trim());
      return sym;
    });

    if (extracted.length > 0) {
      streamTexts[code] = extracted.map(n => `${sym} ${n}`).join("\n");
    }
  }
  return { mainText: out, streamTexts };
}

export async function handleMainTextTools(request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Invalid request body' }, 400);
  }

  const action = String(body?.action || '');

  if (action === 'split_markers') {
    const rawText = String(body?.rawText || '');
    const { mainText, streams } = splitTextByMarkers(rawText);
    const streamHtml = {};
    for (const code of Object.keys(streams)) {
      streamHtml[code] = buildStreamHTML(code, streams[code]);
    }
    return jsonResponse({
      mainText,
      mainHtml: buildMainHTML(rawText),
      streams,
      streamHtml,
    });
  }

  if (action === 'merge_back') {
    const streams = {};
    const rawStreams = body?.streams && typeof body.streams === 'object' ? body.streams : {};
    for (const [code, text] of Object.entries(rawStreams)) {
      streams[code] = splitStreamNotesByMarkers(String(text || ''));
    }
    return jsonResponse({
      merged: mergeBackToText(String(body?.mainText || ''), streams),
      streamCount: Object.keys(streams).length,
    });
  }

  if (action === 'inline_merge') {
    const panes = Array.isArray(body?.panes) ? body.panes : [];
    return jsonResponse({
      mainText: inlineMerge(String(body?.mainText || ''), panes),
    });
  }

  if (action === 'inline_split') {
    const panes = Array.isArray(body?.panes) ? body.panes : [];
    return jsonResponse(inlineSplit(String(body?.mainText || ''), panes));
  }

  return jsonResponse({ error: 'unknown_action', message: 'Unknown main text action' }, 400);
}
