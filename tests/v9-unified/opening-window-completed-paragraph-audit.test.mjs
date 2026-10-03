import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';

function fixture({text,width=100,openingWidth=20,wordWidth=10,spaceWidth=2}) {
  const ctx = {
    fontSize: 10,
    lineHeight: 10,
    describeOpening: () => ({
      position: 'dropped',
      start: 0,
      end: 4,
      marks: { fontSize: 20 },
      dropLines: 2,
      gapPx: 2,
    }),
    measure: part => {
      const body = String(part.text || '').trim();
      if (body === 'OPEN') return { width: openingWidth, height: 10, topInset: 0 };
      const n = body ? body.split(/\s+/u).length : 0;
      return {
        width: n ? n * wordWidth + (n - 1) * spaceWidth : 0,
        height: 10,
        topInset: 0,
      };
    },
  };
  return layoutV9MainParagraphs(
    [{ id: 'completed-opening-window-audit', text, runs: [], mainRefs: [] }],
    [{ x: 0, width, y_start: 0, y_end: 120 }],
    ctx,
    120
  );
}

test('unsafe full-frame centering keeps a completed opening tail adjacent to the fixed opening', () => {
  const text = 'OPEN ' + Array(12).fill('aa').join(' ');
  const plan = fixture({ text });
  assert.equal(plan.lines.length, 2, `fixture expected two rows, got ${plan.lines.length}`);

  const host = plan.lines.find(line => line.render?.opening);
  const last = plan.lines.at(-1);
  assert(host?.render?.opening, 'opening glyph missing');
  assert(last?.isLast === true, 'second row is not the paragraph tail');
  assert(last.openingWindow === true, 'tail no longer shares the opening window');
  assert.equal(plan.lines.map(line => line.sourceText).join(''), text, 'source changed');

  const opening = host.render.opening;
  assert.equal(last.openingParagraphCentered, undefined,
    'fixture unexpectedly became eligible for full-frame body centering');
  assert.equal(last.render.alignment, 'right',
    'unsafe tail was centered independently inside the leftover opening slot');
  assert(Math.abs(last.x + last.width + opening.gap - opening.x) < 0.01,
    `body slot detached from opening: slotRight=${last.x + last.width}, gap=${opening.gap}, openingX=${opening.x}`);
});

test('sparse completed opening tail also fails closed to adjacency without fake stretch', () => {
  const text = 'OPEN aa bb cc';
  const plan = fixture({ text, width: 80, wordWidth: 25, spaceWidth: 2 });
  assert.equal(plan.lines.map(line => line.sourceText).join(''), text, 'source changed');

  const host = plan.lines.find(line => line.render?.opening);
  const last = plan.lines.at(-1);
  assert(host?.render?.opening, 'opening glyph missing');
  assert(last?.openingWindow === true, 'fixture no longer ends in opening window');

  const opening = host.render.opening;
  assert.equal(last.openingParagraphCentered, undefined,
    'sparse tail unexpectedly became eligible for full-frame body centering');
  assert.equal(last.render.alignment, 'right',
    'sparse tail detached itself by centering inside the leftover opening slot');
  assert.equal(Number(last.render?.wordSpacing || 0), 0,
    'sparse last row manufactured word spacing');
  assert(Math.abs(last.x + last.width + opening.gap - opening.x) < 0.01,
    'sparse body slot is not adjacent to the opening');
});
