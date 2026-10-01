import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mainBlockTagForType, normalizeMainBlockType, v9BlockTypography } from '../../src/engine/main_block_semantics.js';

test('main block semantics map editor block types to output elements',()=>{
  assert.equal(mainBlockTagForType('paragraph'),'p');
  assert.equal(mainBlockTagForType('heading',3),'h3');
  assert.equal(mainBlockTagForType('codeBlock'),'pre');
  assert.equal(mainBlockTagForType('blockquote'),'blockquote');
  assert.equal(mainBlockTagForType('table'),'table');
  assert.equal(normalizeMainBlockType('unknown'),'paragraph');
});

test('V9 code block typography is applied before measurement',()=>{
  const base={fontFamily:'serif',fontSize:'17px',lineHeight:'25px',direction:'rtl'};
  const code=v9BlockTypography('codeBlock',base);
  assert.match(code.fontFamily,/Consolas/);
  assert.equal(code.fontSize,'13px');
  assert.equal(code.lineHeight,'19.5px');
  assert.equal(code.direction,'ltr');
  const quote=v9BlockTypography('blockquote',base);
  assert.equal(quote.fontStyle,'italic');
  assert.equal(quote.fontFamily,'serif');
});

test('engine bridge preserves codeBlock and blockquote instead of downgrading them to paragraph',()=>{
  const src=fs.readFileSync(new URL('../../src/engine_bridge.js',import.meta.url),'utf8');
  assert.match(src,/\["heading", "codeBlock", "blockquote", "table"\]\.includes\(info\.blockType\)/);
  assert(!/blockType:\s*info\.blockType === "heading" \? "heading" : "paragraph"/.test(src));
});
