import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';

const context = (dropLines = 2) => ({
  fontSize: 10, lineHeight: 10,
  describeOpening: () => ({ position: 'dropped', start: 0, end: 4, marks: {fontSize: 20}, dropLines, gapPx: 2 }),
  measure: part => {
    const text = String(part.text || '').trim();
    if (text === 'OPEN') return {width: 20, height: 10, topInset: 0};
    const words = text ? text.split(/\s+/u).length : 0;
    return {width: words ? words * 10 + (words - 1) * 2 : 0, height: 10, topInset: 0};
  },
});
function plan(text, {x = 0, width = 100, dropLines = 2, continuesAfter = false, strips} = {}) {
  const entry = {id: 'one-source-paragraph', text, runs: [{start: 5, end: 7, marks: {bold: true}}], mainRefs: [], continuesAfter};
  const before = JSON.stringify(entry);
  const result = layoutV9MainParagraphs([entry], strips || [{x, width, y_start: 0, y_end: 200}], context(dropLines), 200);
  assert.equal(result.overflowText, '');
  assert.equal(result.lines.map(l => l.sourceText).join(''), text, 'source changed');
  assert.equal(JSON.stringify(entry), before, 'source entry mutated');
  assert.equal(result.lines.filter(l => l.render.opening).length, 1, 'opening lost or duplicated');
  for (const line of result.lines) assert.equal(line.source.paragraphId, entry.id, 'artificial paragraph created');
  return result;
}

for (const x of [0, 27]) for (const dropLines of [2, 3, 4]) for (const newline of ['', '\n']) {
  test(`last body row stays centered in opening-aware free space: x=${x}, drop=${dropLines}, hardBreak=${!!newline}`, () => {
    const result = plan('OPEN aa aa aa aa aa aa aa' + newline, {x, dropLines});
    assert.equal(result.lines.length, 2);
    const [first, last] = result.lines;
    assert.equal(last.isLast, true);
    assert.equal(last.openingWindow, true);
    assert.equal(last.render.alignment, 'center', 'final row inherited a special edge-alignment rule');
    assert.equal(last.x, x);
    assert.equal(last.width, 78, 'body slot must exclude the 20px opening plus its 2px gap');
    assert.equal(last.naturalWidth, 10);
    assert.equal(last.render.wordSpacing, 0, 'final row must not be stretched');
    assert.notEqual(last.openingCompositeCentered, true, 'opening painted on a previous row was counted again');
    const left = last.x + (last.width - last.naturalWidth) / 2;
    const right = left + last.naturalWidth;
    assert.equal(left - x, first.render.opening.x - first.render.opening.gap - right,
      'the free space on both sides of the last body must be equal');
    assert.equal(first.render.opening.x, x + 80, 'centering moved the opening away from its original row');
  });
}

test('a genuinely one-row paragraph still centers opening + gap + body together', () => {
  const result = plan('OPEN aa');
  assert.equal(result.lines.length, 1);
  const line = result.lines[0];
  assert.equal(line.openingCompositeCentered, true);
  assert.equal(line.x, 34);
  assert.equal(line.width, 10);
  assert.equal(line.render.opening.x, 46);
  assert.equal((line.x + line.render.opening.x + line.render.opening.width) / 2, 50);
});

test('last opening-window row uses the widened free slot, not stale narrow geometry', () => {
  const result = plan('OPEN aa aa aa aa aa aa aa', {dropLines: 3, strips: [
    {x: 50, width: 50, y_start: 0, y_end: 15},
    {x: 0, width: 100, y_start: 15, y_end: 200},
  ]});
  assert.equal(result.lines.length, 3);
  const last = result.lines.at(-1);
  assert.equal(last.y, 20);
  assert.equal(last.openingWindow, true);
  assert.equal(last.render.alignment, 'center');
  assert.equal(last.x, 0);
  assert.equal(last.width, 78);
  assert.equal(result.lines[0].render.opening.x, 80);
});

test('final row below the opening centers across the complete host', () => {
  const result = plan('OPEN ' + Array(15).fill('aa').join(' '));
  const last = result.lines.at(-1);
  assert.equal(last.openingWindow, false);
  assert.equal(last.render.alignment, 'center');
  assert.equal(last.width, 100);
});

test('an artificial page continuation is not promoted into a centered paragraph ending', () => {
  const result = plan('OPEN aa aa aa aa aa aa aa', {continuesAfter: true});
  const last = result.lines.at(-1);
  assert.equal(last.isLast, false);
  assert.equal(last.render.alignment, 'right');
  assert.notEqual(last.openingCompositeCentered, true);
});
