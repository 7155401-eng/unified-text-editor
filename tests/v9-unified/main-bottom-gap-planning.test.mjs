import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  DEFAULT_V9_MAIN_BOTTOM_GAP_PX,
  MAX_V9_MAIN_BOTTOM_GAP_PX,
  resolveV9MainBottomGapPx,
} from '../../src/engine/v9_main_bottom_gap.js';

const v9=fs.readFileSync(new URL('../../src/vilna_v9.js',import.meta.url),'utf8');
const gapSource=fs.readFileSync(new URL('../../src/engine/v9_main_bottom_gap.js',import.meta.url),'utf8');

test('main-bottom gap explicit values are clamped once before planning',()=>{
  assert.equal(resolveV9MainBottomGapPx(null,0),0);
  assert.equal(resolveV9MainBottomGapPx(null,28),28);
  assert.equal(resolveV9MainBottomGapPx(null,999),MAX_V9_MAIN_BOTTOM_GAP_PX);
  assert.equal(resolveV9MainBottomGapPx(null,-3),0);
  assert.equal(DEFAULT_V9_MAIN_BOTTOM_GAP_PX,16);
});

test('V9 planner owns main-to-footer gap and renderer has no delayed gap microtask',()=>{
  assert(v9.includes('result.mainBottomGapPlan = {'),'planner does not record main-bottom gap geometry');
  assert(v9.includes('const firstFooterGap = mainOwnsFooterBoundary'),'footer gap is not selected in planning');
  assert(!v9.includes('applyV9MainBottomGapToPage'),'V9 renderer still invokes post-render Y mutation');
  assert(!v9.includes('autoResolveV9CrownMainOverlap'),'dead DOM-measure-and-shift geometry engine survived');
  assert(!v9.includes('queueMicrotask(finish)'),'obsolete delayed geometry microtask survived');
});

test('main-bottom compatibility pass is diagnostic-only',()=>{
  const start=gapSource.indexOf('function applyGapToPage(pageEl, desiredGapPx)');
  const end=gapSource.indexOf('\n\nfunction v9RectRelativeToPage',start);
  assert(start>=0&&end>start,'cannot isolate applyGapToPage');
  const body=gapSource.slice(start,end);
  assert(body.includes('authority: "planner"'),'diagnostic does not identify planner authority');
  assert(!body.includes('setTop('),'main-bottom diagnostic still mutates element top');
  assert(!body.includes('.style.top ='),'main-bottom diagnostic still writes top');
});
