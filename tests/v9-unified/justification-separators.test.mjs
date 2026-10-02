import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countV9JustificationGaps,
  hasSpecialV9JustificationSeparator,
  isV9JustificationSeparator,
  needsExplicitV9JustificationSpacer,
} from '../../src/engine/v9_justification_separators.js';

test('ASCII-only spacing stays on the historical path',()=>{
  assert.equal(countV9JustificationGaps('אב גד  הו'),3);
  assert.equal(hasSpecialV9JustificationSeparator('אב גד  הו'),false);
  assert.equal(isV9JustificationSeparator(' '),true);
  assert.equal(needsExplicitV9JustificationSpacer(' '),false);
});

for (const ch of ['\t','\u00a0','\u202f','\u2009','\u3000']) {
  test(`special separator ${JSON.stringify(ch)} is recognized`,()=>{
    assert.equal(isV9JustificationSeparator(ch),true);
    assert.equal(hasSpecialV9JustificationSeparator('אב'+ch+'גד'),true);
    assert.equal(countV9JustificationGaps('אב'+ch+'גד'),1);
  });
}

for (const ch of ['\u202f','\u2009','\u3000']) {
  test(`non-native separator ${JSON.stringify(ch)} receives explicit spacer`,()=>{
    assert.equal(needsExplicitV9JustificationSpacer(ch),true);
  });
}

for (const ch of [' ','\t','\u00a0']) {
  test(`native separator ${JSON.stringify(ch)} does not receive explicit spacer`,()=>{
    assert.equal(needsExplicitV9JustificationSpacer(ch),false);
  });
}

for (const ch of ['\n','\r','א','\u200f']) {
  test(`non-horizontal token ${JSON.stringify(ch)} is excluded`,()=>{
    assert.equal(isV9JustificationSeparator(ch),false);
  });
}
