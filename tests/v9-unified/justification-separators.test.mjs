import test from 'node:test';
import assert from 'node:assert/strict';
import {countV9JustificationGaps,isV9JustificationSeparator} from '../../src/engine/v9_justification_separators.js';

for(const ch of [' ','\t','\u00a0','\u202f','\u2009','\u3000'])
 test(`recognized horizontal separator ${JSON.stringify(ch)}`,()=>{
   assert.equal(isV9JustificationSeparator(ch),true);
   assert.equal(countV9JustificationGaps('אב'+ch+'גד'),1);
 });
for(const ch of ['\n','\r','א','\u200f'])
 test(`non-gap control/text remains excluded ${JSON.stringify(ch)}`,()=>{
   assert.equal(isV9JustificationSeparator(ch),false);
 });
test('multiple separator characters are counted individually',()=>{
  assert.equal(countV9JustificationGaps('אב  גד\tהו\u00a0זח'),4);
});
