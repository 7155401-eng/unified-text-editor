import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRibbonResponsiveLayout } from '../../src/ribbon_responsive.js';

function fakeTabs(widthByLevel, clientWidth = 100) {
  const classes = new Set();
  const dataset = {};
  const classList = {
    add: (...names) => names.forEach(n => classes.add(n)),
    remove: (...names) => names.forEach(n => classes.delete(n)),
    contains: n => classes.has(n),
  };
  const level = () => classes.has('rt-compact-3') ? 3
    : classes.has('rt-compact-2') ? 2
    : classes.has('rt-compact') ? 1 : 0;
  return {
    classList,
    dataset,
    get clientWidth(){ return clientWidth; },
    get scrollWidth(){ return widthByLevel[level()] ?? widthByLevel.at(-1) ?? clientWidth; },
  };
}

test('ribbon keeps normal spacing when it already fits',()=>{
  const el=fakeTabs([90,80,70,60]);
  const r=applyRibbonResponsiveLayout(el);
  assert.deepEqual(r,{level:0,overflow:false});
  assert.equal(el.dataset.ribbonResponsiveLevel,'0');
  assert(!el.classList.contains('rt-compact'));
  assert(!el.classList.contains('has-overflow'));
});

test('ribbon progressively tightens only as far as needed',()=>{
  const one=fakeTabs([130,98,80,70]);
  assert.deepEqual(applyRibbonResponsiveLayout(one),{level:1,overflow:false});
  assert(one.classList.contains('rt-compact'));
  assert(!one.classList.contains('rt-compact-2'));

  const two=fakeTabs([150,125,99,80]);
  assert.deepEqual(applyRibbonResponsiveLayout(two),{level:2,overflow:false});
  assert(two.classList.contains('rt-compact'));
  assert(two.classList.contains('rt-compact-2'));
  assert(!two.classList.contains('rt-compact-3'));
});

test('ribbon wraps before admitting horizontal overflow',()=>{
  const wrapped=fakeTabs([180,155,130,96]);
  assert.deepEqual(applyRibbonResponsiveLayout(wrapped),{level:3,overflow:false});
  assert(wrapped.classList.contains('rt-compact-3'));
  assert(!wrapped.classList.contains('has-overflow'));

  const impossible=fakeTabs([220,200,175,140]);
  assert.deepEqual(applyRibbonResponsiveLayout(impossible),{level:3,overflow:true});
  assert(impossible.classList.contains('rt-compact-3'));
  assert(impossible.classList.contains('has-overflow'));
});
