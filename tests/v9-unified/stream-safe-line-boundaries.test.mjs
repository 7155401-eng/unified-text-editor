import test from 'node:test';
import assert from 'node:assert/strict';

import { flowV9MeasuredStream } from '../../src/engine/v9_stream_inline_layout.js';

function deterministicContext() {
  const typography = {
    fontFamily: 'serif',
    fontSize: '10px',
    lineHeight: '10px',
    direction: 'rtl',
    wordSpacing: '0px',
  };

  const measure = part => {
    const text = String(part?.text || '');
    const wordSpacing = Number.parseFloat(part?.style?.wordSpacing || '0') || 0;
    let width = 0;
    for (const ch of text) width += /\s/u.test(ch) ? 3 + wordSpacing : 5;
    return { width, height: 10, topInset: 0 };
  };

  return {
    streamId: '01',
    typography,
    fontSize: 10,
    lineHeight: 10,
    generation: 0,
    prepareEntry(entry) {
      return {
        ...entry,
        typography,
        runs: entry.runs || [],
        mainRefs: entry.mainRefs || [],
      };
    },
    describeOpening() { return null; },
    measure,
    measureMany(parts) { return parts.map(measure); },
  };
}

function assertSafeBoundaries(source, result) {
  assert.ok(result.lines.length >= 2, 'fixture did not produce multiple commentary rows');
  assert.ok(result.overflowRich.text.length > 0, 'fixture did not exercise a page/box continuation');

  const consumed = result.lines.map(line => line.sourceText).join('');
  assert.equal(
    consumed + result.overflowRich.text,
    source,
    'commentary line planning lost, duplicated, or normalized source text'
  );

  for (let i = 0; i < result.lines.length; i++) {
    const line = result.lines[i];
    assert.equal(
      line.sourceText,
      source.slice(line.source.start, line.source.end),
      `row ${i} source metadata does not match the original commentary text`
    );

    for (const token of line.wordTokens || []) {
      assert.equal(source.slice(token.start, token.end), token.text,
        `row ${i} word token no longer maps to the original source`);
      assert.doesNotMatch(token.text, /\s/u,
        `row ${i} contains a whitespace-split partial token`);
    }

    if (i > 0) {
      const prev = result.lines[i - 1];
      const boundary = line.source.start;
      assert.equal(prev.source.end, boundary,
        `rows ${i - 1}/${i} are not adjacent in source coordinates`);
      assert.ok(boundary > 0 && /\s/u.test(source[boundary - 1]),
        `row boundary ${boundary} was invented inside commentary text instead of after source whitespace`);

      const allTokens = [
        ...(prev.wordTokens || []),
        ...(line.wordTokens || []),
      ];
      assert.equal(
        allTokens.some(token => token.start < boundary && token.end > boundary),
        false,
        `row boundary ${boundary} split a commentary word token`
      );
    }
  }

  const pageBoundary = result.lines.at(-1).source.end;
  assert.ok(pageBoundary > 0 && /\s/u.test(source[pageBoundary - 1]),
    `page/box continuation boundary ${pageBoundary} did not end at source whitespace`);
  assert.equal(
    result.lines.flatMap(line => line.wordTokens || [])
      .some(token => token.start < pageBoundary && token.end > pageBoundary),
    false,
    'page/box continuation split a commentary word token'
  );
}

test('B23 commentary rows and continuation split only at real source whitespace', () => {
  const source = [
    'אבג', 'דהו', 'זחט', 'יכל', 'מנס', 'עפצ', 'קרש',
    'תאב', 'גדה', 'וזח', 'טיכ', 'למנ', 'סעפ', 'צקר',
  ].join(' ');

  const result = flowV9MeasuredStream(
    { text: source, runs: [] },
    [{ x: 0, width: 58, y_start: 0, y_end: 30 }],
    deterministicContext(),
    30
  );

  assertSafeBoundaries(source, result);
});

test('B23 keeps source-safe commentary boundaries with tabs and repeated spaces', () => {
  const source = 'אבג  דהו\tזחט יכל   מנס עפצ קרש  תאב גדה וזח טיכ למנ סעפ צקר';

  const result = flowV9MeasuredStream(
    { text: source, runs: [{ start: 5, end: 18, marks: { bold: true } }] },
    [{ x: 0, width: 58, y_start: 0, y_end: 30 }],
    deterministicContext(),
    30
  );

  assertSafeBoundaries(source, result);
  assert.ok(
    result.lines.some(line => (line.runs || []).some(run => run.marks?.bold)),
    'fixture failed to carry a styled commentary run through line planning'
  );
});
