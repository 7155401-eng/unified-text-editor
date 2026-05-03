import { schema, makeFootnoteUid } from "./schema.js";

const BRACKET_PAIRS = { "[": "]", "{": "}", "(": ")", "<": ">" };

function makeNoteMark(stream) {
  return schema.marks.footnote.create({
    stream,
    uid: makeFootnoteUid(),
  });
}

function tokensToParagraph(tokens) {
  const inlines = [];
  for (const tok of tokens) {
    if (!tok.content) continue;
    if (tok.type === "text") {
      inlines.push(schema.text(tok.content));
    } else {
      inlines.push(schema.text(tok.content, [makeNoteMark(tok.stream)]));
    }
  }
  if (inlines.length === 0) return schema.node("paragraph", null, []);
  return schema.node("paragraph", null, inlines);
}

function isWordBoundary(text, idx) {
  if (idx <= 0) return true;
  return /\s/.test(text[idx - 1]);
}

// Match @NN or @NNN (2 or 3 digits, not followed by another digit).
// Returns the digit string or null.
function looksLikeAtNN(text, idx) {
  if (text[idx] !== "@") return null;
  const after = text.substring(idx + 1, idx + 5);
  const m = after.match(/^(\d{2,3})(?!\d)/);
  return m ? m[1] : null;
}

function appendText(tokens, ch) {
  const last = tokens[tokens.length - 1];
  if (last && last.type === "text") {
    last.content += ch;
  } else {
    tokens.push({ type: "text", content: ch });
  }
}

// Returns kind: "bracket-around" / "atnn-bracket" / "atnn-bare" / null.
function noteStartsAt(text, idx) {
  const ch = text[idx];
  if (BRACKET_PAIRS[ch]) {
    const code = looksLikeAtNN(text, idx + 1);
    if (code) return "bracket-around";
    return null;
  }
  if (ch === "@") {
    const code = looksLikeAtNN(text, idx);
    if (!code) return null;
    const sep = text[idx + 1 + code.length];
    if (sep !== undefined && BRACKET_PAIRS[sep]) return "atnn-bracket";
    if (isWordBoundary(text, idx)) return "atnn-bare";
    return null;
  }
  return null;
}

function tokenizeInlineParagraph(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const kind = noteStartsAt(text, i);

    if (kind === "bracket-around") {
      const opener = text[i];
      const closer = BRACKET_PAIRS[opener];
      const code = looksLikeAtNN(text, i + 1);
      const contentStart = i + 1 + 1 + code.length;
      const closeIdx = text.indexOf(closer, contentStart);
      if (closeIdx === -1) {
        appendText(tokens, text[i]);
        i++;
        continue;
      }
      let content = text.substring(contentStart, closeIdx);
      content = content.replace(/^[\s:]+/, "");
      tokens.push({ type: "note", stream: code, content: content.trim() });
      i = closeIdx + 1;
      continue;
    }

    if (kind === "atnn-bracket") {
      const code = looksLikeAtNN(text, i);
      const opener = text[i + 1 + code.length];
      const closer = BRACKET_PAIRS[opener];
      const contentStart = i + 1 + code.length + 1;
      const closeIdx = text.indexOf(closer, contentStart);
      if (closeIdx === -1) {
        appendText(tokens, text[i]);
        i++;
        continue;
      }
      const content = text.substring(contentStart, closeIdx).trim();
      tokens.push({ type: "note", stream: code, content });
      i = closeIdx + 1;
      continue;
    }

    if (kind === "atnn-bare") {
      const code = looksLikeAtNN(text, i);
      let contentStart = i + 1 + code.length;
      while (contentStart < text.length && /[\s:]/.test(text[contentStart])) {
        contentStart++;
      }
      let endIdx = text.length;
      let s = contentStart;
      while (s < text.length) {
        if (noteStartsAt(text, s)) {
          endIdx = s;
          break;
        }
        s++;
      }
      const content = text.substring(contentStart, endIdx).trim();
      tokens.push({ type: "note", stream: code, content });
      i = endIdx;
      continue;
    }

    appendText(tokens, text[i]);
    i++;
  }
  return tokens;
}

export function parseInlineFormat(rawText) {
  const blocks = rawText
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const paragraphs = blocks.map((block) => {
    const flat = block.replace(/\r?\n/g, " ");
    return tokensToParagraph(tokenizeInlineParagraph(flat));
  });

  if (paragraphs.length === 0) paragraphs.push(schema.node("paragraph", null, []));
  return schema.node("doc", null, paragraphs);
}

export function parseInternalFormat(rawText) {
  const lines = rawText.split(/\r?\n/);
  const paragraphs = [];
  let current = null;

  function flush() {
    if (!current) return;
    const inlines = [];
    if (current.main) inlines.push(schema.text(current.main));
    const codes = Object.keys(current.notes).sort(
      (a, b) => parseInt(a, 10) - parseInt(b, 10)
    );
    for (const code of codes) {
      for (const noteContent of current.notes[code]) {
        if (!noteContent) continue;
        if (inlines.length > 0) inlines.push(schema.text(" "));
        inlines.push(schema.text(noteContent, [makeNoteMark(code)]));
      }
    }
    paragraphs.push(
      inlines.length === 0
        ? schema.node("paragraph", null, [])
        : schema.node("paragraph", null, inlines)
    );
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const mainMatch = /^@MAIN\s+(.*)$/.exec(line);
    if (mainMatch) {
      flush();
      current = { main: mainMatch[1], notes: {} };
      continue;
    }

    const noteMatch = /^@(\d{2,3})\s+(.*)$/.exec(line);
    if (noteMatch && current) {
      const code = noteMatch[1];
      if (!current.notes[code]) current.notes[code] = [];
      current.notes[code].push(noteMatch[2]);
      continue;
    }

    if (current) {
      current.main = current.main ? current.main + " " + line : line;
    }
  }
  flush();

  if (paragraphs.length === 0) paragraphs.push(schema.node("paragraph", null, []));
  return schema.node("doc", null, paragraphs);
}

export function parseAuto(rawText) {
  if (/(^|\r?\n)@MAIN\s/.test(rawText)) return parseInternalFormat(rawText);
  return parseInlineFormat(rawText);
}
