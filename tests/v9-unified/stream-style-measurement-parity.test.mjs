import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { applyStreamContainerStyleToElement } from '../../src/style_registry.js';

test('shared stream container helper applies runtime inline metrics',()=>{
  const el={style:{}};
  const applied=applyStreamContainerStyleToElement(el,{
    inlineStyle:{
      fontFamily:'Test Face',
      fontSize:17,
      fontSizeUnit:'px',
      lineHeight:1.8,
      color:'#123456',
      fontWeight:'700',
    },
  });
  assert.equal(applied,true);
  assert.equal(el.style.fontFamily,'Test Face');
  assert.equal(el.style.fontSize,'17px');
  assert.equal(el.style.lineHeight,'1.8');
  assert.equal(el.style.color,'#123456');
  assert.equal(el.style.fontWeight,'700');
});

test('manualStyle remains a backwards-compatible fallback when inlineStyle is absent',()=>{
  const el={style:{}};
  applyStreamContainerStyleToElement(el,{
    manualStyle:{fontSize:19,fontSizeUnit:'px',lineHeight:2},
  });
  assert.equal(el.style.fontSize,'19px');
  assert.equal(el.style.lineHeight,'2');
});

test('measurement and final renderer call the same stream-style helper',()=>{
  const renderer=fs.readFileSync(new URL('../../src/engine/renderer.js',import.meta.url),'utf8');
  const packer=fs.readFileSync(new URL('../../src/engine/dom_packer.js',import.meta.url),'utf8');

  assert.match(renderer,/applyStreamContainerStyleToElement\(wrap, settings\)/);
  assert.match(packer,/applyStreamContainerStyleToElement\(s, settings\)/);

  assert(!/applyStyleToElement\(s, settings\.styleId\)/.test(packer),
    'measurement path regressed to styleId-only styling');
});
