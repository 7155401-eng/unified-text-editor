import test from 'node:test';
import assert from 'node:assert/strict';
import {findV9ExactTailPartition as solve} from '../../src/engine/v9_exact_tail_partition.js';

// An exhaustive independent oracle for tiny layered partitions.
function exhaustive(n, rows, cap, matrix) {
  const out=[];
  function visit(i, from, cost, boundaries) {
    if(i===rows.length) {if(from===n)out.push({cost,boundaries:boundaries.slice(0,-1)});return;}
    for(let to=from+(rows[i].allowsEmpty?0:1);to<=n;to++) {
      const p=matrix[`${i}/${from}/${to}`];
      if(Number.isFinite(p)&&p>=0&&p<=cap)visit(i+1,to,cost+p*p,[...boundaries,to]);
    }
  }
  visit(0,0,0,[]);return out.sort((a,b)=>a.cost-b.cost)[0]||null;
}
for(let seed=1;seed<=128;seed++)test(`bounded exact partition agrees with exhaustive search ${seed}`,()=>{
  let state=seed;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
  const n=4+seed%6,rows=Array.from({length:2+seed%3},(_,i)=>({allowsEmpty:i===0&&seed%2===0}));
  const matrix={};
  for(let i=0;i<rows.length;i++)for(let from=0;from<=n;from++)for(let to=from;to<=n;to++)
    matrix[`${i}/${from}/${to}`]=random()<.2?Infinity:Math.floor(random()*12);
  const snapshot=JSON.stringify({rows,matrix}),expected=exhaustive(n,rows,8,matrix);
  const result=solve({wordCount:n,rows,maxSpacing:8,metricFor:(i,a,b)=>({pressure:matrix[`${i}/${a}/${b}`]})});
  assert.equal(JSON.stringify({rows,matrix}),snapshot);
  assert(result.evaluations<=4096);
  if(!expected)assert.equal(result.status,'infeasible');
  else{
    assert.equal(result.status,'complete');let from=0,cost=0;
    [...result.boundaries,n].forEach((to,i)=>{const p=matrix[`${i}/${from}/${to}`];assert(p<=8);cost+=p*p;from=to;});
    assert.equal(cost,expected.cost);
  }
});
test('default 4096 budget preserves feasible five-row tails beyond 1536 evaluations',()=>{
  const rows=Array.from({length:5},()=>({}));
  const metricFor=()=>({pressure:1});
  const limited=solve({wordCount:35,rows,maxSpacing:8,maxEvaluations:1536,metricFor});
  assert.deepEqual(limited,{status:'budget-exhausted',evaluations:1536});

  const full=solve({wordCount:35,rows,maxSpacing:8,metricFor});
  assert.equal(full.status,'complete');
  assert.equal(full.evaluations,1550);
  assert.deepEqual(full.boundaries,[1,2,3,4]);
});

test('budget exhaustion cannot return a partial candidate',()=>{
  const r=solve({wordCount:30,rows:[{},{},{},{}],maxSpacing:8,maxEvaluations:3,metricFor:()=>({pressure:1})});
  assert.deepEqual(r,{status:'budget-exhausted',evaluations:3});
});
test('a row with no legal interval rejects without inventing words or rows',()=>{
  const r=solve({wordCount:3,rows:[{},{}],maxSpacing:8,metricFor:()=>null});
  assert.equal(r.status,'infeasible');assert(!r.boundaries);
});
for(const change of [{wordCount:0},{wordCount:1.5},{rows:[]},{maxSpacing:NaN},{maxEvaluations:0},{metricFor:null}])
 test(`invalid arguments fail without calling measurement: ${JSON.stringify(change)}`,()=>{
  const r=solve({wordCount:3,rows:[{},{}],maxSpacing:8,metricFor:()=>{throw Error('unexpected measurement')},...change});
  assert.equal(r.status,'invalid-input');assert.equal(r.evaluations,0);
 });
test('rows without enough words cannot allocate empty body lines',()=>{
 assert.deepEqual(solve({wordCount:1,rows:[{},{}],maxSpacing:8,metricFor:()=>{throw Error('unexpected')}}),{status:'infeasible',evaluations:0});
});
