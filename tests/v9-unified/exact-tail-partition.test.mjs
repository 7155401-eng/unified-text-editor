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


function solveReference({wordCount,rows,maxSpacing,metricFor,maxEvaluations=4096}) {
  const minimumRemaining=new Array(rows.length+1).fill(0);
  for(let i=rows.length-1;i>=0;i--)
    minimumRemaining[i]=minimumRemaining[i+1]+(rows[i].allowsEmpty?0:1);
  if(minimumRemaining[0]>wordCount)return {status:'infeasible',evaluations:0};
  let states=new Map([[0,{cost:0,previous:null,end:0}]]),evaluations=0;
  for(let i=0;i<rows.length;i++){
    const next=new Map();
    const maximumEnd=wordCount-minimumRemaining[i+1];
    for(const [from,state] of states){
      const minimumEnd=i===rows.length-1?wordCount:from+(rows[i].allowsEmpty?0:1);
      for(let to=minimumEnd;to<=maximumEnd;to++){
        if(evaluations>=maxEvaluations)return {status:'budget-exhausted',evaluations};
        evaluations++;
        const metric=metricFor(i,from,to);
        if(!metric||!Number.isFinite(metric.pressure)||metric.pressure<0||
           metric.pressure>maxSpacing+1e-9)continue;
        const cost=state.cost+metric.pressure*metric.pressure;
        const known=next.get(to);
        if(!known||cost<known.cost-1e-9)next.set(to,{cost,previous:state,end:to});
      }
    }
    if(!next.size)return {status:'infeasible',evaluations};
    states=next;
  }
  let state=states.get(wordCount);
  if(!state)return {status:'infeasible',evaluations};
  const boundaries=[];
  while(state.previous){boundaries.push(state.end);state=state.previous;}
  boundaries.reverse();boundaries.pop();
  return {status:'complete',evaluations,boundaries};
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


for(let seed=1;seed<=256;seed++)test(`dominance pruning is result/budget identical to legacy DP ${seed}`,()=>{
  let state=seed;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
  const wordCount=4+(seed%14);
  const rows=Array.from({length:2+(seed%5)},(_,i)=>({allowsEmpty:i===0&&seed%3===0}));
  const maxSpacing=8;
  const matrix=new Map();
  for(let i=0;i<rows.length;i++)for(let from=0;from<=wordCount;from++)for(let to=from;to<=wordCount;to++){
    const r=random();
    matrix.set(`${i}/${from}/${to}`,r<0.22?null:Math.floor(random()*12));
  }
  const maxEvaluations=[3,17,73,257,4096][seed%5];
  const metricFor=(i,from,to)=>{
    const pressure=matrix.get(`${i}/${from}/${to}`);
    return pressure==null?null:{pressure};
  };
  const expected=solveReference({wordCount,rows,maxSpacing,metricFor,maxEvaluations});
  const actual=solve({wordCount,rows,maxSpacing,metricFor,maxEvaluations});
  assert.deepEqual(actual,expected);
});

test('dominated transitions keep evaluation budget but avoid unnecessary metric calls',()=>{
  let calls=0;
  const result=solve({
    wordCount:10,
    rows:Array.from({length:4},()=>({})),
    maxSpacing:8,
    metricFor:(row,_from,to)=>{
      calls++;
      // Row 0 deliberately gives later states a larger accumulated cost.
      // Later rows add zero cost, so an earlier cheaper state that already
      // reaches the same destination mathematically dominates them.
      return {pressure:row===0?to*0.7:0};
    },
  });
  assert.equal(result.status,'complete');
  assert.equal(result.evaluations,70,'evaluation accounting changed');
  assert.ok(calls<result.evaluations,
    `dominance pruning did not avoid metric work: calls=${calls}, evaluations=${result.evaluations}`);
});




for(let seed=1;seed<=192;seed++)test(`batched metrics preserve legacy DP result and evaluation accounting ${seed}`,()=>{
  let state=seed*104729;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
  const wordCount=4+(seed%14);
  const rows=Array.from({length:2+(seed%5)},(_,i)=>({allowsEmpty:i===0&&seed%3===0}));
  const maxSpacing=8;
  const matrix=new Map();
  for(let i=0;i<rows.length;i++)for(let from=0;from<=wordCount;from++)for(let to=from;to<=wordCount;to++){
    const r=random();
    matrix.set(`${i}/${from}/${to}`,r<0.22?null:Math.floor(random()*12));
  }
  const maxEvaluations=[3,17,73,257,4096][seed%5];
  const scalar=(i,from,to)=>{
    const pressure=matrix.get(`${i}/${from}/${to}`);
    return pressure==null?null:{pressure};
  };
  const expected=solveReference({wordCount,rows,maxSpacing,metricFor:scalar,maxEvaluations});
  const actual=solve({
    wordCount,rows,maxSpacing,maxEvaluations,
    metricFor:()=>{throw Error('scalar metricFor should not run when batch is supplied')},
    metricBatchFor:(row,transitions)=>transitions.map(({from,to})=>scalar(row,from,to)),
  });
  assert.deepEqual(actual,expected);
});

test('batched metrics are not requested for a row guaranteed to exhaust the remaining budget',()=>{
  let batchCalls=0;
  const result=solve({
    wordCount:20,
    rows:[{},{},{},{}],
    maxSpacing:8,
    maxEvaluations:40,
    metricFor:()=>{throw Error('scalar metricFor should not run')},
    metricBatchFor:(_row,transitions)=>{
      batchCalls++;
      assert.equal(transitions.length,17,'only the fully affordable first row should be batched');
      return transitions.map(()=>({pressure:0}));
    },
  });
  assert.deepEqual(result,{status:'budget-exhausted',evaluations:40});
  assert.equal(batchCalls,1);
});

test('guaranteed mid-row budget exhaustion skips every doomed-row metric call',()=>{
  let calls=0;
  const result=solve({
    wordCount:20,
    rows:[{},{},{},{}],
    maxSpacing:8,
    maxEvaluations:40,
    metricFor:()=>{
      calls++;
      return {pressure:0};
    },
  });

  // Row 0 has 17 candidates and is fully evaluated. Row 1 has 153
  // candidates but only 23 evaluations remain, so legacy semantics guarantee
  // budget-exhausted before row 1 can complete. The optimized solver must
  // preserve the public result while avoiding those 23 useless measurements.
  assert.deepEqual(result,{status:'budget-exhausted',evaluations:40});
  assert.equal(calls,17);
});
