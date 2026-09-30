import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isV9StandaloneDirectionControl,
  isV9StandaloneDirectionControlOnly,
  splitV9EdgeGlue,
} from '../../src/engine/v9_bidi_controls.js';
import { partForRange } from '../../src/engine/v9_main_inline_layout.js';

test('standalone bidi marks are layout-neutral but explicitly classified', () => {
  for (const ch of ['\u061c','\u200e','\u200f','\u2060']) {
    assert.equal(isV9StandaloneDirectionControl(ch), true, JSON.stringify(ch));
    assert.equal(isV9StandaloneDirectionControlOnly(ch + ch), true, JSON.stringify(ch));
  }
  for (const ch of ['(', ')', "'", 'א', '1', '\u2067']) {
    assert.equal(isV9StandaloneDirectionControl(ch), false, JSON.stringify(ch));
  }
});

test('edge glue keeps neutral punctuation visible while separating bidi controls from width', () => {
  const raw=" \u200f\u061c ('אב\u200e ";
  const edge=splitV9EdgeGlue(raw);
  assert.equal(edge.leadingText,' \u200f\u061c ');
  assert.equal(edge.visible,"('אב");
  assert.equal(edge.trailingText,'\u200e ');
  assert.equal(edge.leadingText+edge.visible+edge.trailingText,raw);
});

test('partForRange preserves bidi controls in source glue and never invents punctuation', () => {
  const text=" \u200f ('אב\u200e ";
  const p=partForRange({text,runs:[],mainRefs:[],typography:{}},0,text.length,text.length);
  assert.equal(p.text,"('אב");
  assert.equal(p.leadingText,' \u200f ');
  assert.equal(p.trailingText,'\u200e ');
  assert.equal(p.leadingText+p.text+p.trailingText,text);
});
