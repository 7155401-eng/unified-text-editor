import test from 'node:test';
import assert from 'node:assert/strict';
import { mainRefNoSpaceTokenBounds } from '../../src/engine/reference_line_break.js';

test('apostrophe + reference + word is one source token when there is no space',()=>{
  assert.deepEqual(mainRefNoSpaceTokenBounds("ר'משה",2),{start:0,end:5});
});

test('a real source space remains a legal line-break boundary',()=>{
  assert.deepEqual(mainRefNoSpaceTokenBounds("ר' משה",3),{start:3,end:6});
  assert.deepEqual(mainRefNoSpaceTokenBounds("ר' משה",2),{start:0,end:2});
  assert.equal(mainRefNoSpaceTokenBounds("ר'  משה",3),null);
});

test('punctuation is also atomic until actual whitespace',()=>{
  assert.deepEqual(mainRefNoSpaceTokenBounds("alpha,beta",6),{start:0,end:10});
});
