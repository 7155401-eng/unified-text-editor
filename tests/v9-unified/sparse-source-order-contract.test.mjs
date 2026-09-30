import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../../src/vilna_v9.js',import.meta.url),'utf8');

test('final sparse rescue cannot leapfrog an active split tail',()=>{
  const start=source.indexOf('const trySparseIntermediateRescue = () => {');
  assert(start>=0,'sparse rescue function missing');
  const end=source.indexOf('const sparseRescue = trySparseIntermediateRescue();',start);
  assert(end>start,'sparse rescue call boundary missing');
  const body=source.slice(start,end);
  const guard=body.indexOf('if (splitInfo) return null;');
  const nextSource=body.indexOf('const nextAvailable = getSlice(bestN + 1);');
  assert(guard>=0,'active split source-order guard missing');
  assert(nextSource>=0,'next paragraph lookup missing');
  assert(guard<nextSource,'next paragraph can be inspected before the active split tail is guarded');
});
