import test from 'node:test';
import assert from 'node:assert/strict';
import {appendV9PlannedPart} from '../../src/engine/v9_text_measurement.js';

class Element {
  constructor(tag = '', value = '') {
    this.tag = tag; this.value = value; this.children = []; this.style = {}; this.dataset = {};
    this.classList = {add: () => {}};
  }
  appendChild(child) { this.children.push(child); return child; }
  set textContent(text) { this.value = text; this.children = []; }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
}
function paint(part) {
  const saved = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag), createTextNode: text => new Element('#text', text)};
  const host = new Element('span'), before = JSON.stringify(part);
  try { appendV9PlannedPart(host, part); } finally { globalThis.document = saved; }
  assert.equal(JSON.stringify(part), before, 'source or anchor data mutated');
  return host;
}
const references = host => host.children.filter(child => child.dataset.v9MainRef);
const withoutReferences = host => host.children.filter(child => !child.dataset.v9MainRef).map(child => child.textContent).join('');
const clusters = ['ךְ', 'ןִ', 'ףָ', 'ץֵ', 'קֻ', 'שָּׁ', 'a\u0301\u0323', '\u{1D15F}\u{1D165}'];

for (const text of clusters) for (let position = 1; position < text.length; position++) {
  for (const affinity of ['forward', 'backward']) {
    test(`reference does not divide a base/mark sequence ${JSON.stringify(text)}/${position}/${affinity}`, () => {
      const ref = {localPos: position, anchor: 100 + position, uid: 'v', stream: '01', formatted: '[7]', anchorAffinity: affinity};
      const host = paint({text, runs: [{start: 0, end: text.length, marks: {fontSize: 36, color: 'red'}}], refs: [ref]});
      assert.equal(host.children[0].textContent, text, 'reference split the combined glyph');
      assert.equal(host.children[1].textContent, '[7]');
      assert.equal(host.children[0].style.fontSize, '36px');
      assert.equal(withoutReferences(host), text);
      assert.equal(references(host)[0].dataset.anchor, String(ref.anchor), 'semantic anchor was rewritten');
      assert.equal(references(host)[0].dataset.localPos, String(position), 'original local source position was rewritten');
    });
  }
}

for (const [text, position] of [['abc', 1], ["אב'גד", 3], ['אב־גד', 2], ['אב גד', 3], ['אב\nגד', 3], ['ךְאב', 2]]) {
  test(`ordinary source positions stay exact ${JSON.stringify(text)}/${position}`, () => {
    const host = paint({text, refs: [{localPos: position, formatted: '[1]', uid: 'v'}]});
    assert.equal(host.textContent, text.slice(0, position) + '[1]' + text.slice(position));
  });
}

test('multiple notes inside one cluster retain their source order and identifiers', () => {
  const host = paint({text: 'שָּׁב', refs: [
    {uid: 'a', localPos: 1, formatted: '[1]'}, {uid: 'hidden', localPos: 2, formatted: ''},
    {uid: 'b', localPos: 2, formatted: '[2]'}, {uid: 'c', localPos: 3, formatted: '[3]'},
    {uid: 'd', localPos: 4, formatted: '[4]'},
  ]});
  assert.equal(host.textContent, 'שָּׁ[1][2][3][4]ב');
  assert.deepEqual(references(host).map(ref => ref.dataset.uid), ['a', 'b', 'c', 'd']);
  assert.deepEqual(references(host).map(ref => ref.dataset.localPos), ['1', '2', '3', '4']);
});

test('base-only formatting still reaches the marks when a note is within the cluster', () => {
  const host = paint({text: 'אב ךְ גד', runs: [{start: 3, end: 4, marks: {fontSize: 36, bold: true}}], refs: [{localPos: 4, formatted: '[2]'}]});
  assert.deepEqual(host.children.map(child => child.textContent), ['אב ', 'ךְ', '[2]', ' גד']);
  assert.equal(host.children[1].style.fontSize, '36px');
  assert.equal(host.children[1].style.fontWeight, '700');
});

test('hidden-only reference does not split the DOM or consume source', () => {
  const host = paint({text: 'ךְ', refs: [{localPos: 1, formatted: '', uid: 'hidden'}]});
  assert.equal(host.children.length, 1);
  assert.equal(host.textContent, 'ךְ');
});

test('real source whitespace and directional edge controls remain unchanged', () => {
  const host = paint({text: 'ךְ  אב', leadingText: ' \u200f', trailingText: '\t\u200e ', refs: [{localPos: 1, formatted: '[1]'}]});
  assert.equal(withoutReferences(host), ' \u200fךְ  אב\t\u200e ');
});

test('a mark-only leading run is not moved when source position is zero', () => {
  const host = paint({text: '\u0301x', refs: [{localPos: 0, formatted: '[1]'}]});
  assert.equal(host.textContent, '[1]\u0301x');
});

test('empty and out-of-range offsets keep existing clamping behavior', () => {
  const host = paint({text: 'ab', refs: [{localPos: -2, formatted: '[1]'}, {localPos: 99, formatted: '[2]'}]});
  assert.equal(host.textContent, '[1]ab[2]');
  assert.equal(paint({text: '', refs: [{localPos: 0, formatted: '[3]'}]}).textContent, '[3]');
});
