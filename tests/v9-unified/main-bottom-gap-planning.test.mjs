import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  DEFAULT_V9_MAIN_BOTTOM_GAP_PX,
  MAX_V9_MAIN_BOTTOM_GAP_PX,
  resolveV9MainBottomGapPx,
} from '../../src/engine/v9_main_bottom_gap_policy.js';

const v9=fs.readFileSync(new URL('../../src/vilna_v9.js',import.meta.url),'utf8');
const v9Apply=fs.readFileSync(new URL('../../src/vilna_v9_apply.js',import.meta.url),'utf8');
const gapPolicySource=fs.readFileSync(new URL('../../src/engine/v9_main_bottom_gap_policy.js',import.meta.url),'utf8');
const gapSource=fs.readFileSync(new URL('../../src/engine/v9_main_bottom_gap.js',import.meta.url),'utf8');

function jsFilesRecursively(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), root);
    if (entry.isDirectory()) out.push(...jsFilesRecursively(full));
    else if (/\.(?:m?js)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

const srcRoot = new URL('../../src/', import.meta.url);

test('live V9 imports only the pure numeric gap policy',()=>{
  assert(v9.includes('./engine/v9_main_bottom_gap_policy.js'),
    'planner does not import the pure gap policy');
  assert(v9Apply.includes('./engine/v9_main_bottom_gap_policy.js'),
    'runtime entry does not import the pure gap policy');
  assert(!v9.includes('./engine/v9_main_bottom_gap.js'),
    'planner still imports the diagnostics module');
  assert(!v9Apply.includes('./engine/v9_main_bottom_gap.js'),
    'runtime entry still imports the diagnostics module');
  assert(!v9Apply.includes('applyV9MainBottomGap('),
    'runtime entry still invokes the post-layout compatibility pass');

  assert(!gapPolicySource.includes('v9_opening_words_from_metadata'),
    'pure policy loads opening-word metadata side effects');
  assert(!gapPolicySource.includes('v9_stretch_policy'),
    'pure policy loads stretch side effects');
  assert(!gapPolicySource.includes('.style.'),
    'pure policy contains DOM style mutations');
  assert(!gapPolicySource.includes('querySelector'),
    'pure policy inspects rendered DOM');
});

test('no production source can re-import or call the post-layout gap engine',()=>{
  const offenders = [];
  const callers = [];
  for (const file of jsFilesRecursively(srcRoot)) {
    const pathname = file.pathname.replace(/\\/gu, '/');
    const source = fs.readFileSync(file, 'utf8');
    if (!pathname.endsWith('/engine/v9_main_bottom_gap.js') &&
        source.includes('v9_main_bottom_gap.js')) {
      offenders.push(pathname);
    }
    if (!pathname.endsWith('/engine/v9_main_bottom_gap.js') &&
        /\bapplyV9MainBottomGap(?:ToPage)?\s*\(/u.test(source)) {
      callers.push(pathname);
    }
  }
  assert.deepEqual(offenders,[],'production source re-imported diagnostic gap module');
  assert.deepEqual(callers,[],'production source reintroduced a post-layout gap call');
});

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
  assert(!body.includes('setTop('),'main-bottom diagnostic still calls a Y mutation helper');
  assert(!body.includes('.style.top ='),'main-bottom diagnostic still writes top');
  assert(!gapSource.includes('function setTop('),'dead top-mutation helper returned to diagnostic module');
  assert(!gapSource.includes('.style.top ='),'diagnostic module contains a hidden top mutation outside applyGapToPage');
});

test('render path has no asynchronous post-paint geometry authority',()=>{
  const start=v9.indexOf('function renderPagePlan(plan, pageEl, cfg)');
  const end=v9.indexOf('\n// =====================================================================\n// API ראשי',start);
  assert(start>=0&&end>start,'cannot isolate renderPagePlan');
  const body=v9.slice(start,end);
  assert(!body.includes('queueMicrotask('),'render path schedules delayed geometry work');
  assert(!body.includes('requestAnimationFrame('),'render path schedules frame-delayed geometry work');
  assert(!body.includes('autoResolveV9CrownMainOverlap'),'render path invokes the removed overlap resolver');
});
