import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTextWithRuns, applyMarksToSpan } from '../../src/engine/runs_dom.js';

class Element {
  constructor(text = '') { this.children = []; this.style = {}; this.dataset = {}; this.value = text; this.classes = new Set(); this.classList = {add: c => this.classes.add(c)}; }
  appendChild(node) { this.children.push(node); return node; }
  set textContent(text) { this.value = text; this.children = []; }
  get textContent() { return this.value + this.children.map(n => n.textContent).join(''); }
}
function paint(text, runs) {
  const old = globalThis.document;
  globalThis.document = {createElement: () => new Element(), createTextNode: text => new Element(text)};
  const result = new Element();
  try { appendTextWithRuns(result, text, runs); } finally { globalThis.document = old; }
  assert.equal(result.textContent, text, 'source characters must not change');
  return result;
}

for (const text of ['ךְ', 'ןִ', 'ףָ', 'ץֵ', 'קֻ', 'שָּׁ']) {
  test(`base-only styling keeps attached marks in one shaping run: ${text}`, () => {
    const runs = [{start: 0, end: 1, marks: {fontSize: 36, bold: true}}];
    const before = JSON.stringify(runs);
    const node = paint(text, runs);
    assert.equal(node.children.length, 1, 'combining mark detached from base');
    assert.equal(node.children[0].textContent, text);
    assert.equal(node.children[0].style.fontSize, '36px');
    assert.equal(JSON.stringify(runs), before, 'source runs mutated');
  });
}

test('mark-only range expands to its base without changing source', () => {
  const node = paint('א שָּׁ ב', [{start: 3, end: 5, marks: {color: 'red'}}]);
  assert.deepEqual(node.children.map(n => n.textContent), ['א ', 'שָּׁ', ' ב']);
  assert.equal(node.children[1].style.color, 'red');
});

test('overlapping styles remain combined and later values still win', () => {
  const node = paint('כָּ', [
    {start: 0, end: 1, marks: {bold: true, color: 'red'}},
    {start: 1, end: 3, marks: {italic: true, color: 'blue'}},
  ]);
  assert.equal(node.children.length, 1);
  assert.deepEqual(node.children[0].style, {fontWeight: '700', fontStyle: 'italic', color: 'blue'});
});

for (const [start, end] of [[1, 1], [2, 1], [10, 15], [-3, -1]]) {
  test(`empty or reversed range is not expanded into formatting: ${start}:${end}`, () => {
    const node = paint('כָּ', [{start, end, marks: {bold: true}}]);
    assert.equal(node.children.length, 1);
    assert.deepEqual(node.children[0].style, {});
  });
}

test('non-BMP base and combining marks retain complete code points', () => {
  const text = '\u{1D15F}\u{1D165}';
  const node = paint(text, [{start: 2, end: 4, marks: {bold: true}}]);
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].textContent, text);
});

test('ordinary character boundaries, inline code and superscript remain intact', () => {
  const node = paint('ab 1', [
    {start: 0, end: 2, marks: {code: true}},
    {start: 3, end: 4, marks: {superscript: true}},
  ]);
  assert.deepEqual(node.children.map(n => n.textContent), ['ab', ' ', '1']);
  assert.equal(node.children[0].style.unicodeBidi, 'isolate');
  assert.equal(node.children[0].style.direction, 'ltr');
  assert.equal(node.children[2].style.verticalAlign, 'super');
});

test('explicit font shaping options reach styled spans', () => {
  const span = new Element();
  applyMarksToSpan(span, {fontFeatureSettings: '"mark" 1, "mkmk" 1', fontVariant: 'normal', fontKerning: 'normal'});
  assert.equal(span.style.fontFeatureSettings, '"mark" 1, "mkmk" 1');
  assert.equal(span.style.fontVariant, 'normal');
  assert.equal(span.style.fontKerning, 'normal');
});
