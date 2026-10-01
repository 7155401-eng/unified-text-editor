import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutV9MainParagraphs} from '../../src/engine/v9_main_inline_layout.js';

const sourcePart = part => part ? (part.leadingText || '') + part.text + (part.trailingText || '') : '';
const controls = /[\u061c\u200e\u200f\u2060]/gu;
function context(prefix = '', position = 'dropped', end = prefix.length + 4) {
  return {
    fontSize: 10, lineHeight: 10,
    describeOpening: () => position === 'none' ? null : {
      position, start: prefix.length, end, marks: {fontSize: 20}, dropLines: 2, gapPx: 2,
    },
    measure: part => {
      const text = part.text.replace(controls, '').trim();
      const words = text ? text.split(/\s+/u) : [];
      const width = text.includes('X'.repeat(40)) ? 1000
        : text === 'OPEN' ? 20 : words.length ? words.length * 10 + (words.length - 1) * 2 : 0;
      // These units isolate source ownership; labels are measured by the browser suite.
      return {width, height: 10, topInset: 0};
    },
  };
}
function inspect(text, ctx, continuesAfter = true, {width = 54, pageBottom = 37} = {}) {
  const refs = Array.from({length: text.length + 1}, (_, anchor) =>
    ['forward', 'backward'].map(anchorAffinity => ({
      uid: `${anchor}-${anchorAffinity}`, anchor, anchorAffinity,
      formatted: anchor % 2 ? '[1]' : '', stream: '01',
    }))).flat();
  const entry = {id: 'opening-tail-source', text, sourceOffset: 37, mainRefs: refs,
    runs: [{start: 0, end: text.length, marks: {color: 'red'}},
      {start: text.indexOf('aa'), end: text.indexOf('aa') + 2, marks: {bold: true}}], continuesAfter};
  const strips = [{x: 13, width, y_start: 7, y_end: pageBottom}];
  const snapshot = JSON.stringify({entry, strips});
  const plan = layoutV9MainParagraphs([entry], strips, ctx, pageBottom);
  assert.equal(JSON.stringify({entry, strips}), snapshot, 'caller source/styles/anchors changed');
  assert(plan.lines.some(line => line.tailRebalanced), 'fixture did not enter tail redistribution');
  assert.equal(plan.lines.map(line => line.sourceText).join('') + plan.overflowText, text);
  for (const line of plan.lines) {
    assert.equal(sourcePart(line.render.opening?.part) + sourcePart(line.render.body), line.sourceText,
      'paint fragments do not cover the exact source row');
    assert.equal(line.source.paragraphId, entry.id);
    assert.equal(line.isLast, false, 'page continuation became a paragraph ending');
    assert.equal(line.render.alignment, 'right');
  }
  const owners = [
    ...plan.lines.flatMap(line => [...(line.render.opening?.part.refs || []), ...line.render.body.refs]),
    ...plan.overflowParagraphs.flatMap(part => part.mainRefs),
  ];
  assert.deepEqual(owners.map(ref => ref.uid).sort(), refs.map(ref => ref.uid).sort(),
    'a visible/hidden reference was lost or duplicated across the opening/body/page boundary');
  return plan;
}

for (const separator of [' ', '  ', '\t', ' \u200f', '\u200e ', ' \u2060 ', '\u00a0', '\u202f'])
for (const prefix of ['', '  ', '\u200f '])
for (const continuesAfter of [true, false]) {
  test(`tail source partition: prefix=${JSON.stringify(prefix)}, gap=${JSON.stringify(separator)}, continuation=${continuesAfter}`, () => {
    const text = prefix + 'OPEN' + separator + 'aa aa aa aa aa aa' + (continuesAfter ? '' : ' ' + 'X'.repeat(80));
    const plan = inspect(text, context(prefix), continuesAfter);
    assert.equal(plan.lines.filter(line => line.render.opening).length, 1);
    assert.equal(sourcePart(plan.lines[0].render.opening.part), prefix + 'OPEN');
  });
}

for (const position of ['none', 'raised']) {
  test(`ordinary ${position} source path remains complete`, () => {
    inspect('OPEN aa aa aa aa aa aa aa aa aa aa', context('', position));
  });
}

test('letter opening ends inside the source word without adding a separator', () => {
  const plan = inspect('OPEN aa aa aa aa aa aa aa', context('', 'dropped', 1));
  assert.equal(sourcePart(plan.lines[0].render.opening.part), 'O');
  assert(sourcePart(plan.lines[0].render.body).startsWith('PEN'));
});

test('a complete short paragraph is not forced through continuation redistribution', () => {
  const entry = {id: 'complete', text: 'OPEN aa', runs: [], mainRefs: [], continuesAfter: false};
  const plan = layoutV9MainParagraphs([entry], [{x: 0, width: 100, y_start: 0, y_end: 100}], context(), 100);
  assert(plan.lines[0].openingCompositeCentered);
  assert(!plan.lines.some(line => line.tailRebalanced));
  assert.equal(plan.lines.map(line => sourcePart(line.render.opening?.part) + sourcePart(line.render.body)).join(''), entry.text);
});

for (const prefix of ['', '  ']) for (const separator of [' ', ' \u200f ']) {
  test(`opening-only host keeps notes in the first real body row: ${JSON.stringify({prefix, separator})}`, () => {
    const ctx = context(prefix);
    const ordinaryMeasure = ctx.measure;
    ctx.measure = part => part.text.replace(controls, '').trim() === 'OPEN'
      ? {width: 50, height: 10, topInset: 0} : ordinaryMeasure(part);
    const plan = inspect(prefix + 'OPEN' + separator + 'aa aa aa aa aa aa', ctx, true, {width: 60, pageBottom: 107});
    const host = plan.lines[0];
    assert.equal(host.wordTokens.length, 0, 'body words were moved into the glyph box');
    assert.equal(sourcePart(host.render.body), '', 'source separator moved into the glyph box');
    assert.equal(host.render.body.refs.length, 0, 'a note was placed on top of the opening');
    assert.equal(host.sourceText, prefix + 'OPEN');
    assert.equal(sourcePart(plan.lines[1].render.body).slice(0, separator.length), separator);
  });
}
