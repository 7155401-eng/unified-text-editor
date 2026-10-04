import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '.');
const mod = await import(pathToFileURL(path.join(root, 'src/engine/v9_main_inline_layout.js')).href);
const { layoutV9MainParagraphs } = mod;

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function measureKey(part) {
  return JSON.stringify({
    text: String(part?.text || ''),
    leadingText: String(part?.leadingText || ''),
    trailingText: String(part?.trailingText || ''),
    runs: part?.runs || [],
    refs: part?.refs || [],
    style: part?.style || {},
  });
}

function makeContext({ opening = false } = {}) {
  let calls = 0;
  const unique = new Map();
  const ctx = {
    fontSize: 10,
    lineHeight: 10,
    generation: 0,
    typography: {},
    describeOpening: opening
      ? () => ({ position: 'dropped', start: 0, end: 4, marks: {}, dropLines: 2, gapPx: 2 })
      : () => null,
    measure(part) {
      calls++;
      const key = measureKey(part);
      if (unique.has(key)) return unique.get(key);
      const body = String(part?.text || '').trim();
      let result;
      if (opening && body === 'OPEN') {
        result = { width: 20, height: 10, topInset: 0 };
      } else {
        const words = body ? body.split(/\s+/u) : [];
        const ws = parseFloat(part?.style?.wordSpacing || '0') || 0;
        result = {
          width: words.length ? words.length * 10 + (words.length - 1) * (2 + ws) : 0,
          height: 10,
          topInset: 0,
        };
      }
      unique.set(key, result);
      return result;
    },
    stats() {
      return { measureCalls: calls, uniqueMeasureInputs: unique.size };
    },
  };
  return ctx;
}

const fixtures = [
  {
    name: 'plain-10-words-3-rows',
    text: Array(10).fill('aa').join(' '),
    strips: [{ x: 0, width: 54, y_start: 0, y_end: 30 }],
    pageBottom: 30,
    opening: false,
  },
  {
    name: 'plain-24-words-5-rows',
    text: Array(24).fill('aa').join(' '),
    strips: [{ x: 0, width: 62, y_start: 0, y_end: 50 }],
    pageBottom: 50,
    opening: false,
  },
  {
    name: 'plain-35-words-5-rows',
    text: Array(35).fill('aa').join(' '),
    strips: [{ x: 0, width: 86, y_start: 0, y_end: 50 }],
    pageBottom: 50,
    opening: false,
  },
  {
    name: 'opening-18-words-5-rows',
    text: 'OPEN ' + Array(18).fill('aa').join(' '),
    strips: [{ x: 0, width: 62, y_start: 0, y_end: 50 }],
    pageBottom: 50,
    opening: true,
  },
  {
    name: 'widening-30-words-6-rows',
    text: Array(30).fill('aa').join(' '),
    strips: [
      { x: 22, width: 58, y_start: 0, y_end: 20 },
      { x: 0, width: 80, y_start: 20, y_end: 60 },
    ],
    pageBottom: 60,
    opening: false,
  },
];

const output = [];
for (const fixture of fixtures) {
  const context = makeContext({ opening: fixture.opening });
  const input = [{
    id: fixture.name,
    text: fixture.text,
    runs: [],
    mainRefs: [],
    continuesAfter: true,
  }];
  const started = performance.now();
  const plan = layoutV9MainParagraphs(input, fixture.strips, context, fixture.pageBottom);
  const elapsedMs = performance.now() - started;
  const stats = context.stats();
  output.push({
    name: fixture.name,
    ...stats,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    planHash: stableHash(plan),
    sourceHash: stableHash(plan.lines?.map(line => line.sourceText).join('') || ''),
    lines: plan.lines?.length || 0,
    overflowChars: String(plan.overflowText || '').length,
    diagnostics: (plan.diagnostics || []).map(d => d.code),
  });
}

process.stdout.write(JSON.stringify({ root, fixtures: output }, null, 2) + '\n');
