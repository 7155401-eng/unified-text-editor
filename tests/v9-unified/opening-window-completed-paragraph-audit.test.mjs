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

function paintedBodyWidth(line) {
  const gaps = (String(line?.render?.body?.text || '').match(/ /g) || []).length;
  return Number(line?.naturalWidth || 0) + gaps * Number(line?.render?.wordSpacing || 0);
}

test('completed two-row opening paragraph can use its whole window before declaring the tail centered', () => {
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
  const bodyLeft = last.x;
  const bodyRight = bodyLeft + paintedBodyWidth(last);
  assert(bodyRight <= opening.x - opening.gap + 0.01, 'tail overlaps opening or its configured gap');

  const visualLeft = Math.min(bodyLeft, opening.x);
  const visualRight = Math.max(bodyRight, opening.x + opening.width);
  const expectedCenter = (Number(last.openingHostX || 0) + Number(last.openingHostFullWidth || 100) / 2);
  const actualCenter = (visualLeft + visualRight) / 2;

  assert(Math.abs(actualCenter - expectedCenter) < 0.01,
    `completed opening paragraph is still asymmetric: center=${actualCenter}, expected=${expectedCenter}, body=${bodyLeft}..${bodyRight}, opening=${opening.x}..${opening.x + opening.width}`);
  assert(Math.abs(bodyRight + opening.gap - opening.x) < 0.01,
    'balanced tail must remain adjacent to the fixed opening');
});

test('when exact balancing is impossible, completed opening tail stays adjacent without fake stretch', () => {
  const text = 'OPEN aa bb cc';
  const plan = fixture({ text, width: 80, wordWidth: 25, spaceWidth: 2 });
  assert.equal(plan.lines.map(line => line.sourceText).join(''), text, 'source changed');

  const host = plan.lines.find(line => line.render?.opening);
  const last = plan.lines.at(-1);
  assert(host?.render?.opening, 'opening glyph missing');
  assert(last?.openingWindow === true, 'fixture no longer ends in opening window');

  const opening = host.render.opening;
  const bodyLeft = last.x;
  const bodyRight = bodyLeft + paintedBodyWidth(last);
  assert(bodyRight <= opening.x - opening.gap + 0.01, 'fallback overlaps opening');
  assert(Math.abs(bodyRight + opening.gap - opening.x) < 0.01,
    'fallback detached the last body from the opening');
  assert(Number(last.render?.wordSpacing || 0) <= 0.01,
    'single-word fallback manufactured word spacing');
});
