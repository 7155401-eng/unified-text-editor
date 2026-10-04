import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRuns } from '../../src/engine/runs_dom.js';

function sameMarks(a,b){
  const ak=Object.keys(a||{}).sort(),bk=Object.keys(b||{}).sort();
  if(ak.length!==bk.length)return false;
  for(let i=0;i<ak.length;i++)if(ak[i]!==bk[i]||a[ak[i]]!==b[bk[i]])return false;
  return true;
}
function mergeAdjacent(runs){
  const out=[];
  for(const r of runs||[]){
    if(!r||r.end<=r.start)continue;
    const prev=out[out.length-1];
    if(prev&&prev.end===r.start&&sameMarks(prev.marks,r.marks))prev.end=r.end;
    else out.push({start:r.start,end:r.end,marks:r.marks||{}});
  }
  return out;
}

// Exact historical normalizeRuns semantics for ASCII fixtures (no combining
// marks, so cleanRun is only range clamping/rejection).
function legacyNormalize(text,runs){
  const len=text?text.length:0;
  if(!len)return [];
  const list=Array.isArray(runs)?runs.map((r)=>{
    const start=Math.max(0,Math.min(len,Number(r?.start)||0));
    const end=Math.max(0,Math.min(len,Number(r?.end)||0));
    return end>start?{start,end,marks:r?.marks||{}}:null;
  }).filter(Boolean):[];
  if(!list.length)return [{start:0,end:len,marks:{}}];

  const points=new Set([0,len]);
  for(const r of list){points.add(r.start);points.add(r.end);}
  const sorted=[...points].sort((a,b)=>a-b),out=[];
  for(let i=0;i<sorted.length-1;i++){
    const start=sorted[i],end=sorted[i+1];
    if(end<=start)continue;
    const marks={};
    for(const r of list)if(r.start<=start&&r.end>=end)Object.assign(marks,r.marks||{});
    out.push({start,end,marks});
  }
  return mergeAdjacent(out);
}

function rng(seed){
  let state=seed>>>0;
  return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
}
const markPool=[
  {},
  {bold:true},
  {italic:true},
  {color:'red'},
  {bold:true,color:'blue'},
  {fontSize:'14px'},
];

for(let seed=1;seed<=256;seed++)test(`linear disjoint normalization matches legacy ${seed}`,()=>{
  const random=rng(seed);
  const len=24+(seed%31);
  const text='x'.repeat(len);
  const runs=[];
  let cursor=0;
  while(cursor<len&&runs.length<18){
    cursor+=Math.floor(random()*3);
    if(cursor>=len)break;
    const end=Math.min(len,cursor+1+Math.floor(random()*5));
    runs.push({start:cursor,end,marks:markPool[Math.floor(random()*markPool.length)]});
    cursor=end;
  }
  assert.deepEqual(normalizeRuns(text,runs),legacyNormalize(text,runs));
});

for(let seed=1;seed<=128;seed++)test(`overlap/out-of-order fallback matches legacy ${seed}`,()=>{
  const random=rng(seed*7919);
  const len=32;
  const text='y'.repeat(len);
  const runs=[];
  for(let i=0;i<10;i++){
    const a=Math.floor(random()*(len+8))-4;
    const b=Math.floor(random()*(len+8))-4;
    runs.push({
      start:Math.min(a,b),
      end:Math.max(a,b)+1,
      marks:markPool[Math.floor(random()*markPool.length)],
    });
  }
  // Deliberately destroy source order for many fixtures.
  if(seed%2===0)runs.reverse();
  assert.deepEqual(normalizeRuns(text,runs),legacyNormalize(text,runs));
});

test('disjoint fast path still fills unmarked gaps and merges identical adjacent marks',()=>{
  const actual=normalizeRuns('abcdefghij',[
    {start:2,end:4,marks:{bold:true}},
    {start:4,end:6,marks:{bold:true}},
    {start:8,end:10,marks:{italic:true}},
  ]);
  assert.deepEqual(actual,[
    {start:0,end:2,marks:{}},
    {start:2,end:6,marks:{bold:true}},
    {start:6,end:8,marks:{}},
    {start:8,end:10,marks:{italic:true}},
  ]);
});
