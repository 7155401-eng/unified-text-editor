import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLastRow, nativeEligibility } from './contracts.js';

test('body-only centering is not accepted as opening+body centering',()=>{
 const x=analyzeLastRow({hostLeft:0,hostRight:100,opening:{left:80,right:100,gap:2},row:{left:34,right:44}});
 assert.equal(x.bodyCenter,x.freeCenter);assert.equal(x.meetsReportedCentering,false);
 assert.equal(x.fixedEdgeConflict,true);assert.equal(x.bodyPinnedToLeft,false);
});
test('the prior left-edge regression is rejected even when its envelope is centered',()=>{
 const x=analyzeLastRow({hostLeft:0,hostRight:100,opening:{left:80,right:100,gap:2},row:{left:0,right:10}});
 assert.equal(x.centeredEnvelope,true);assert.equal(x.bodyPinnedToLeft,true);assert.equal(x.meetsReportedCentering,false);
});
test('a changed group position may meet centering but is not silently declared visually equivalent',()=>{
 const x=analyzeLastRow({hostLeft:0,hostRight:100,opening:{left:50,right:70,gap:2},row:{left:30,right:40}});
 assert.equal(x.meetsReportedCentering,true);assert.equal(x.openingAtHostRight,false);
});
for(const left of [0,7.25,127])for(const width of [100,240.5,600])test(`fixed-edge invariant ${left}/${width}`,()=>{
 const desiredLeft=2*(left+width/2)-(left+width);
 assert(Math.abs(desiredLeft-left)<1e-9);
 const x=analyzeLastRow({hostLeft:left,hostRight:left+width,opening:{left:left+width-20,right:left+width,gap:2},row:{left:desiredLeft,right:desiredLeft+10}});
 assert.equal(x.meetsReportedCentering,false);
});
for(const value of [undefined,NaN,Infinity,'100'])test(`invalid geometry rejected: ${String(value)}`,()=>{
 assert.equal(analyzeLastRow({hostLeft:0,hostRight:value,opening:{left:50,right:70},row:{left:30,right:40}}).valid,false);
});
const good={sourcePreserved:true,inputUnchanged:true,oneParagraph:true,flowPositioned:true,typographyPreserved:true,rowFit:true,noSpaceBreaks:true};
test('local passing is never approval for replacing the production paginator',()=>{
 const x=nativeEligibility(good);assert.equal(x.localContractsPass,true);assert.equal(x.productionEligible,false);assert(x.pending.includes('full-V9-pagination'));
});
for(const name of Object.keys(good))test(`regression detector retains ${name}`,()=>{
 const x=nativeEligibility({...good,[name]:false});assert.equal(x.localContractsPass,false);assert(x.reasons.includes(name));
});
test('semantic source membership alone does not override a centering failure',()=>{
 const x=nativeEligibility({...good,centeredOpeningTail:{meetsReportedCentering:false}});
 assert.equal(x.localContractsPass,false);assert(x.reasons.includes('combined-final-line-centering'));
});
