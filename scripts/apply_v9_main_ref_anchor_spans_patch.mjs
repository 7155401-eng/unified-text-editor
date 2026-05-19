import fs from 'node:fs';

function patchFile(file, fn) {
  let src = fs.readFileSync(file, 'utf8');
  const next = fn(src);
  if (next !== src) {
    fs.writeFileSync(file, next);
    console.log(`[v9-main-ref-spans] patched ${file}`);
  } else {
    console.log(`[v9-main-ref-spans] ${file} already up to date`);
  }
}

// 1) Direct source guard: do not count a stream title duplicated as first note.
patchFile('src/engine_bridge.js', (src) => {
  const marker = 'function applyFirstNoteAsTitle(code, notes) {';
  const start = src.indexOf(marker);
  if (start === -1) return src;
  const nextMarker = '\n\nfunction ensureEngineStreamSettings';
  const end = src.indexOf(nextMarker, start);
  if (end === -1) return src;
  const replacement = `function normalizeStreamTitleNoteText(value) {
  return String(value || "")
    .replace(/^\\s*\\[[^\\]]+\\]\\s*/, "")
    .replace(/[\\u200e\\u200f\\u202a-\\u202e]/g, "")
    .replace(/\\s+/g, " ")
    .trim();
}

function isDuplicateStreamTitleNote(noteText, title) {
  const a = normalizeStreamTitleNoteText(noteText);
  const b = normalizeStreamTitleNoteText(title);
  return !!a && !!b && a === b;
}

function applyFirstNoteAsTitle(code, notes) {
  const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
  const streamSettings = getEffectiveStreamSettings(code);
  const manualTitle = String(streamSettings.title || "").trim();
  const first = notes && notes.length ? String(notes[0] || "") : "";
  const existingTitle = manualTitle || labels[code] || defaultLabelForCode(code);
  const duplicateTitleNote = isDuplicateStreamTitleNote(first, existingTitle);

  if (manualTitle) {
    labels[code] = manualTitle;
    return duplicateTitleNote ? notes.slice(1) : notes;
  }

  if (!streamSettings.firstNoteAsTitle && !duplicateTitleNote) return notes;

  const title = duplicateTitleNote ? existingTitle : stripDisplayNum(first || "");
  if (title) labels[code] = title;
  return notes.slice(1);
}`;
  return src.slice(0, start) + replacement + src.slice(end);
});

// 2) V9 apply: do not inject main refs into mainText. Keep source clean and pass notes/refs onward.
patchFile('src/vilna_v9_apply.js', (src) => {
  const re = /    const transformedParagraphs = paragraphs\.map\(\(p\) => \{\n      if \(!p\) return p;\n      const injected = injectMainRefs\(p\.mainText, p\.mainRuns, p\.notes\);\n      return \{ \.\.\.p, mainText: injected\.mainText, mainRuns: injected\.mainRuns, notes: injected\.notes \};\n    \}\);/;
  const replacement = `    const transformedParagraphs = paragraphs.map((p) => {
      if (!p) return p;
      // 2026-05-19: V9 main refs must remain separate anchored entities.
      // Do NOT inject [N] into mainText here; that destroys the original anchor
      // identity and makes the ref indistinguishable from normal text after line
      // breaking. vilna_v9.js now renders refs as span.v9-main-ref from note
      // anchors while keeping mainText clean.
      return {
        ...p,
        mainText: p.mainText,
        mainRuns: p.mainRuns || [],
        notes: p.notes || [],
        mainRefs: Array.isArray(p.mainRefs) ? p.mainRefs : [],
      };
    });`;
  return src.replace(re, replacement);
});

// 3) V9 core: carry note anchors to main lines and render refs as dedicated spans.
patchFile('src/vilna_v9.js', (src) => {
  let out = src;

  out = out.replace(
    'import { applyBarStyleToElement } from "./original_stream_columns.js";',
    'import { applyBarStyleToElement, formatStreamNumber, styleIdForStreamNumber } from "./original_stream_columns.js";'
  );

  const helpersMarker = '// =====================================================================\n// בונה strips לראשי לפי בר־מצרא: כשפרשן נגמר, הראשי מתפשט לתוך שטחו.';
  const helpers = `// =====================================================================
// Main-reference anchors for V9
// =====================================================================
function v9MainRefsFromParagraph(p, textLen) {
  const source = Array.isArray(p?.mainRefs) && p.mainRefs.length ? p.mainRefs : (Array.isArray(p?.notes) ? p.notes : []);
  const out = [];
  for (const raw of source || []) {
    const stream = String(raw?.stream || raw?.code || raw?.streamId || raw?.streamCode || "");
    if (!stream) continue;
    const anchorRaw = raw?.absoluteAnchor ?? raw?.anchor ?? raw?.localAnchor;
    const anchor = Number(anchorRaw);
    if (!Number.isFinite(anchor)) continue;
    const clamped = Math.max(0, Math.min(Number(textLen) || 0, anchor));
    const num = typeof raw?.num === "number" && raw.num > 0 ? raw.num : 0;
    if (!num) continue;
    out.push({
      stream,
      code: stream,
      num,
      uid: raw?.uid || `${stream}:${num}:${clamped}`,
      anchor: clamped,
      absoluteAnchor: clamped,
      localAnchor: clamped,
      priority: Number(raw?.priority) || 0,
    });
  }
  out.sort((a, b) =>
    (a.anchor - b.anchor) ||
    ((a.priority || 0) - (b.priority || 0)) ||
    String(a.stream).localeCompare(String(b.stream)) ||
    ((a.num || 0) - (b.num || 0))
  );
  return out;
}

function v9RefsForWordTokens(mainRefs, wordTokens) {
  if (!Array.isArray(mainRefs) || !mainRefs.length || !Array.isArray(wordTokens) || !wordTokens.length) return [];
  const first = wordTokens[0];
  const last = wordTokens[wordTokens.length - 1];
  const start = Number(first?.start) || 0;
  const end = Number(last?.end) || start;
  const refs = mainRefs.filter((ref) => {
    const a = Number(ref?.absoluteAnchor ?? ref?.anchor);
    return Number.isFinite(a) && a >= start && a <= end;
  });
  if (!refs.length) return [];

  const usedKeys = new Set();
  return refs.map((ref) => {
    const anchor = Number(ref.absoluteAnchor ?? ref.anchor) || 0;
    let pos = 0;
    for (let i = 0; i < wordTokens.length; i++) {
      const tok = wordTokens[i];
      if (i > 0) pos += 1;
      const ts = Number(tok.start) || 0;
      const te = Number(tok.end) || ts;
      const text = String(tok.text || "");
      if (anchor <= ts) return { ...ref, localPos: pos };
      if (anchor > ts && anchor <= te) {
        const inside = anchor - ts;
        const toStart = inside;
        const toEnd = te - anchor;
        return { ...ref, localPos: toStart <= toEnd ? pos : pos + text.length };
      }
      pos += text.length;
    }
    return { ...ref, localPos: pos };
  }).filter((ref) => {
    const key = ref.uid || `${ref.stream}:${ref.num}:${ref.anchor}`;
    if (usedKeys.has(key)) return false;
    usedKeys.add(key);
    return true;
  }).sort((a, b) =>
    (Number(a.localPos) - Number(b.localPos)) ||
    String(a.stream).localeCompare(String(b.stream)) ||
    ((a.num || 0) - (b.num || 0))
  );
}

function appendV9MainRefSpan(parent, ref) {
  const formatted = ref?.formatted || formatStreamNumber(ref.stream || ref.code, ref.num, "main");
  if (!formatted) return false;
  const span = document.createElement("span");
  span.className = "stream-ref v9-main-ref";
  span.textContent = formatted;
  span.setAttribute("dir", "ltr");
  span.style.unicodeBidi = "isolate";
  span.style.display = "inline-block";
  span.dataset.v9MainRef = "1";
  span.dataset.stream = String(ref.stream || ref.code || "");
  span.dataset.num = String(ref.num || "");
  span.dataset.uid = String(ref.uid || "");
  span.dataset.anchor = String(ref.absoluteAnchor ?? ref.anchor ?? "");
  span.dataset.localPos = String(ref.localPos ?? "");
  const styleId = styleIdForStreamNumber(ref.stream || ref.code, "main");
  if (styleId) applyStyleToElement(span, styleId);
  parent.appendChild(span);
  return true;
}

function appendV9TextWithMainRefs(parent, line) {
  const refs = Array.isArray(line?.mainRefs) ? line.mainRefs : [];
  const text = String(line?.text || "");
  const runs = Array.isArray(line?.runs) ? line.runs : [];
  if (!refs.length) {
    appendTextWithRuns(parent, text, runs);
    return;
  }
  let cursor = 0;
  for (const ref of refs) {
    const pos = Math.max(0, Math.min(text.length, Number(ref.localPos) || 0));
    if (pos > cursor) appendTextWithRuns(parent, text.slice(cursor, pos), sliceRuns(runs, cursor, pos));
    appendV9MainRefSpan(parent, ref);
    cursor = Math.max(cursor, pos);
  }
  if (cursor < text.length) appendTextWithRuns(parent, text.slice(cursor), sliceRuns(runs, cursor, text.length));
}

`;
  if (!out.includes('function v9MainRefsFromParagraph(') && out.includes(helpersMarker)) {
    out = out.replace(helpersMarker, helpers + helpersMarker);
  }

  out = out.replace(
    '    const entries = Array.isArray(pageContent.mainParagraphs) && pageContent.mainParagraphs.length\n    ? pageContent.mainParagraphs\n    : [{ text: pageContent.mainText || "", runs: pageContent.mainRuns || [], continues: !!pageContent.mainStartsContinued }];',
    '    const entries = Array.isArray(pageContent.mainParagraphs) && pageContent.mainParagraphs.length\n    ? pageContent.mainParagraphs\n    : [{ text: pageContent.mainText || "", runs: pageContent.mainRuns || [], mainRefs: pageContent.mainRefs || [], continues: !!pageContent.mainStartsContinued }];'
  );

  out = out.replace(
    '    const lines = flow.lines || [];\n    if (model && lines.length) {',
    '    const lines = flow.lines || [];\n    const entryRefs = Array.isArray(entry.mainRefs) ? entry.mainRefs : [];\n    for (const line of lines) {\n      line.mainRefs = v9RefsForWordTokens(entryRefs, line.wordTokens || []);\n    }\n    if (model && lines.length) {'
  );

  out = out.replace(
    '        runs: line.runs || [],\n      });',
    '        runs: line.runs || [],\n        wordTokens: line.wordTokens || [],\n        mainRefs: line.mainRefs || [],\n      });'
  );

  out = out.replace(
    '      } else {\n        appendTextWithRuns(lineEl, line.text, line.runs);\n      }',
    '      } else {\n        appendV9TextWithMainRefs(lineEl, line);\n      }'
  );

  out = out.replace(
    '    mainParagraphs.push({\n      id: p.id || `main-${mainParagraphIndex}`,\n      index: mainParagraphIndex,\n      text: cleanPiece,\n      runs: localRuns,\n      rich: makeRichText(cleanPiece, localRuns),',
    '    mainParagraphs.push({\n      id: p.id || `main-${mainParagraphIndex}`,\n      index: mainParagraphIndex,\n      text: cleanPiece,\n      runs: localRuns,\n      rich: makeRichText(cleanPiece, localRuns),\n      mainRefs: v9MainRefsFromParagraph(p, cleanPiece.length),'
  );

  out = out.replace(
    '    return { mainText, mainRuns, mainParagraphs, mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };',
    '    return { mainText, mainRuns, mainParagraphs, mainRefs: mainParagraphs.flatMap(p => p.mainRefs || []), mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };'
  );

  out = out.replace(
    '  return { mainText, mainRuns, mainParagraphs, mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };',
    '  return { mainText, mainRuns, mainParagraphs, mainRefs: mainParagraphs.flatMap(p => p.mainRefs || []), mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };'
  );

  return out;
});
