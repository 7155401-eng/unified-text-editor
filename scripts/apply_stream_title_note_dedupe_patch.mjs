import fs from 'node:fs';

const TARGET = 'src/engine_bridge.js';
const MARKER = 'stream-title-note-dedupe';

function readFile(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] removed duplicate stream-title helper declarations from ${path}`);
  } else {
    console.log(`[${MARKER}] no duplicate stream-title helpers in ${path}`);
  }
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

function removeDuplicateFunctionDeclarations(source, name) {
  const needle = `function ${name}(`;
  const removals = [];
  let index = 0;
  let seen = 0;

  while (true) {
    const start = source.indexOf(needle, index);
    if (start === -1) break;

    const open = source.indexOf('{', start + needle.length);
    if (open === -1) break;

    const end = findMatchingBrace(source, open);
    if (end === -1) break;

    seen++;
    if (seen > 1) {
      let removeStart = start;
      while (removeStart > 0 && /[ \t]/.test(source[removeStart - 1])) removeStart--;
      if (removeStart > 0 && source[removeStart - 1] === '\n') removeStart--;

      let removeEnd = end;
      while (removeEnd < source.length && /[ \t]/.test(source[removeEnd])) removeEnd++;
      if (source[removeEnd] === '\n') removeEnd++;

      removals.push([removeStart, removeEnd]);
    }

    index = end;
  }

  if (!removals.length) return source;

  let out = source;
  for (const [start, end] of removals.reverse()) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function patch(source) {
  source = source.replace(/\r\n/g, '\n');
  source = removeDuplicateFunctionDeclarations(source, 'normalizeStreamTitleNoteText');
  source = removeDuplicateFunctionDeclarations(source, 'isDuplicateStreamTitleNote');
  return source;
}

const before = readFile(TARGET);
const after = patch(before);
writeIfChanged(TARGET, before, after);
