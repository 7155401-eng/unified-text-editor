// A second, independently reported stage: fixing a no-break blocker is not
// acceptance of joint centering, and joint centering is not visual equivalence.
import {createV9TextLayoutContext} from '../../src/engine/v9_text_measurement.js';
import {renderNativeParagraph,inspectNativeParagraph} from './prototype.js';
import {probeJointNativeGroup,renderJointNativeCandidate} from './joint-group.js';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const clean=m=>({rows:m.rows,opening:m.opening,height:m.height,sourceLength:m.sourceLength});

function measure(config,entry,settings){
 const host=document.createElement('div');host.style.cssText='direction:rtl;margin:0;padding:0;border:0;';document.body.append(host);
 const context=createV9TextLayoutContext(config);
 try {return inspectNativeParagraph(renderNativeParagraph(host,context.prepareEntry(entry),context,settings));}
 finally {context.dispose();host.remove();}
}

export async function runNativeNext(makeConfig){
 await document.fonts.ready;
 const protectedCases=[],jointGroups=[],negativeControls=[];
 const samples=[
  {text:"אב אבגדה'וזחטי אב אבגד",anchor:9},
  {text:'אב ABC123DEF אבגד',anchor:6},
  {text:'אב שָּׁלוֹם־עולם אבגד',anchor:6},
  {text:'אב אלף\u00a0בית אבגד',anchor:6},
  {text:'אב (ABC)־אבגד אבגד',anchor:6},
  {text:'אב אלף\u202fבית אבגד',anchor:6},
 ];
 for(const family of ['serif','sans-serif','monospace'])for(const width of [100,160,340])
 for(const sample of samples)for(const visible of [false,true]){
  const {text,anchor}=sample;
  // Test the note at its requested source offset. Even odd offsets must not
  // mutate the source or move the anchor; complete typography is a later gate.
  const entry={id:'source-token-check',text,runs:[{start:0,end:text.length,marks:{color:'rgb(30,30,30)'}},{start:anchor,end:anchor+2,marks:{bold:true}}],
   mainRefs:[{uid:'midword',anchor,formatted:visible?'[ 8 ]':'',cssText:'font-size:11px;vertical-align:super'}]};
  const config=makeConfig(family,2,200,false);
  const unprotected=measure(config,entry,{width,mode:'inline',keepSourceTokens:false});
  const protectedResult=measure(config,entry,{width,mode:'inline',keepSourceTokens:true});
  assert(protectedResult.sourcePreserved&&protectedResult.checks.inputUnchanged,'source changed in protected test');
  assert(protectedResult.conflicts.length===0,'source token still split');
  assert(protectedResult.references.length===(visible?1:0),'note display count changed');
  assert(!protectedResult.contract.productionEligible,'an overflow/source check was promoted to production');
  if(!protectedResult.checks.rowFit)assert(protectedResult.contract.reasons.includes('rowFit'),'overlong unbreakable word was silently accepted');
  let hiddenMatchesAbsent=null;
  if(!visible){
   const absent=measure(config,{...entry,mainRefs:[]},{width,mode:'inline',keepSourceTokens:true});
   hiddenMatchesAbsent=JSON.stringify(clean(protectedResult))===JSON.stringify(clean(absent));
   assert(hiddenMatchesAbsent,'hidden note changed geometry: '+JSON.stringify({family,width,text,anchor,protected:clean(protectedResult),absent:clean(absent)}));
  }
  protectedCases.push({family,width,visible,text,anchor,unprotected,protected:protectedResult,hiddenMatchesAbsent});
 }
 for(const family of ['serif','sans-serif','monospace'])for(const drop of [2,3,4])
 for(const wrap of ['wrap','pretty','balance'])for(const width of [240,320]){
  let entry=null;
  const config=makeConfig(family,drop);
  for(let words=3;words<=36;words++){
   const e={id:'joint-probe',text:'פתיח '+Array(words).fill('אב').join(' '),runs:[],mainRefs:[]};
   const m=measure(config,e,{width,mode:'float',wrap});
   if(m.rowCount===2&&m.center){entry=e;break;}
  }
  assert(entry,'two-row source missing');
  const context=createV9TextLayoutContext(config);
  try{
   const prepared=context.prepareEntry(entry),before=JSON.stringify(prepared);
   const result=probeJointNativeGroup(prepared,context,{width,mode:'float',wrap});
   assert(JSON.stringify(prepared)===before,'candidate planner rewrote source');
   assert(!result.productionEligible,'joint probe accepted production');
   assert(result.trials.length<=64,'candidate count is unbounded');
   if(result.accepted){
    assert(result.measurement.jointCenter.meetsReportedCentering,'candidate did not center the opening and last body together');
    assert(result.sameAppearanceProven===false,'group sizing silently counted as identical appearance');
    const finalHost=document.createElement('div');finalHost.dir='rtl';document.body.append(finalHost);
    try{
     const final=renderJointNativeCandidate(finalHost,prepared,context,{width,mode:'float',wrap},result.inset);
     assert(JSON.stringify(clean(final.measurement))===JSON.stringify(clean(result.measurement)), 'final single rendering differs from candidate measurement');
     assert(final.measurement.jointCenter.meetsReportedCentering,'final render lost shared centering');
     assert(!final.handle.element.querySelector('br'),'manual row breaks introduced');
    }finally{finalHost.remove();}
   }
   jointGroups.push({family,drop,wrap,width,source:entry.text,result});
  }finally{context.dispose();}
 }
 const ctx=createV9TextLayoutContext(makeConfig('serif',3));
 try{
  for(const change of [{continuesAfter:true},{text:'פתיח אב\nגד'}, {exclusion:'right'}, {text:'פתיח אב'}]){
   const {exclusion,...delta}=change;
   const entry=ctx.prepareEntry({id:'unsupported',text:'פתיח '+Array(10).fill('אב').join(' '),runs:[],mainRefs:[],...delta});
   const result=probeJointNativeGroup(entry,ctx,{width:240,...(exclusion?{exclusion}:{})});
   assert(!result.accepted,'out-of-scope continuation, break, geometry or line count was accepted');
   negativeControls.push({change,result});
  }
 }finally{ctx.dispose();}
 return {counts:{protectedCases:protectedCases.length,protectedNoSpaceFailures:protectedCases.filter(x=>x.protected.conflicts.length).length,
   unprotectedNoSpaceFailures:protectedCases.filter(x=>x.unprotected.conflicts.length).length,
   protectedOverflowBlockers:protectedCases.filter(x=>!x.protected.checks.rowFit).length,
   hiddenGeometryComparisons:protectedCases.filter(x=>x.hiddenMatchesAbsent!==null).length,
   hiddenGeometryFailures:protectedCases.filter(x=>x.hiddenMatchesAbsent===false).length,
   jointCases:jointGroups.length,jointCenteredCandidates:jointGroups.filter(x=>x.result.accepted).length,
   jointCasesWithChangedRowBoundaries:jointGroups.filter(x=>x.result.accepted&&x.result.rowBoundariesChanged).length,
   jointWholeParagraphCenters:jointGroups.filter(x=>x.result.accepted&&x.result.measurement.wholeParagraphCentered).length,
   candidateLayoutsMeasured:jointGroups.reduce((n,x)=>n+x.result.trials.length,0),
   negativeControls:negativeControls.length,acceptedForProduction:0},
  protectedCases,jointGroups,negativeControls};
}
