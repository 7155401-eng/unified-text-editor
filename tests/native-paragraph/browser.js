import { createV9TextLayoutContext, renderV9PlannedMainLine } from '../../src/engine/v9_text_measurement.js';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';
import { renderNativeParagraph, inspectNativeParagraph } from './prototype.js';
import { probeJointNativeGroup, renderJointNativeCandidate } from './joint-group.js';
import { runNativeNext } from './next-browser.js';

export const makeConfig=(family='serif',drop=2,percent=200,enabled=true)=>({
  mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
  openingWordSettings:{enabled,target:'word',count:1,font:'inherit',size:percent,weight:'bold',
    position:'dropped',dropLines:drop,spaceAfter:.2,scope:'all',skipHeadings:false,skipShortLine:false,
    skipSingleLine:false,skipFewerThanLines:false,minLines:1}});
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};

function withCase(config,entry,settings,fn){
 const host=document.createElement('div');host.style.cssText='margin:0;padding:0;border:0;';document.body.append(host);
 const context=createV9TextLayoutContext(config);
 try{return fn(renderNativeParagraph(host,context.prepareEntry(entry),context,settings));}
 finally{context.dispose();host.remove();}
}

export async function runNativeProof(){
 await document.fonts.ready;
 const matrix=[],centering=[],references=[],widening=[],wrapEffects=[];
 for(const family of ['serif','sans-serif','monospace'])for(const mode of ['float','initial-word','inline'])
 for(const wrap of ['wrap','pretty','balance'])for(const exclusion of ['none','left','right','both'])for(const words of [9,40]){
  const config=makeConfig(family,3,175), settings={width:300,mode,wrap,exclusion,cutoff:48,cutwidth:55};
  const text='פתיח '+Array(words).fill('מִלָּה').join(' ');
  const entry={id:'native-rich',text,runs:[{start:5,end:10,marks:{bold:true,color:'rgb(140,0,0)'}},{start:12,end:20,marks:{italic:true}}],mainRefs:[{uid:'hidden',anchor:6,formatted:''},{uid:'visible',anchor:text.length,formatted:'[7]',cssText:'font-size:12px;vertical-align:super'}]};
  const m=withCase(config,entry,settings,inspectNativeParagraph);
  assert(m.sourcePreserved,'source changed in matrix');assert(m.checks.inputUnchanged,'source entry mutated');
  assert(m.checks.oneParagraph&&m.checks.flowPositioned,'not native paragraph flow');
  assert(m.checks.typographyPreserved,'opening size changed');
  assert(m.references.length===1&&m.references[0].uid==='visible','hidden marker painted or visible marker lost');
  assert(!m.contract.productionEligible,'prototype reported ready for production');
  matrix.push({family,mode,wrap,exclusion,words,measurement:m});
 }
 // Last-row regression: compare both meanings of "center" rather than reusing
 // the old tests which accepted a left-pinned body as a correct centered group.
 for(const family of ['serif','sans-serif','monospace'])for(const drop of [2,3,4])
 for(const wrap of ['wrap','pretty','balance'])for(const width of [240,320]){
  let found=null;
  for(let words=3;words<=36;words++){
   const entry={id:'two-line',text:'פתיח '+Array(words).fill('אב').join(' '),runs:[],mainRefs:[]};
   const m=withCase(makeConfig(family,drop),entry,{width,mode:'float',wrap},inspectNativeParagraph);
   if(m.rowCount===2&&m.center){found={family,drop,wrap,width,words,measurement:m};break;}
  }
  assert(found,'two-row fixture not found');assert(!found.measurement.center.meetsReportedCentering,'unexpectedly changed native centering behavior; inspect before changing expectations');
  assert(found.measurement.contract.reasons.includes('combined-final-line-centering'),'centering defect not retained');
  centering.push(found);

 }
 // An actual request already in the user's backlog: no break inside a source
 // word, including an apostrophe plus a footnote anchor. Preserve the metadata.
 for(const enabled of [false,true])for(const family of ['serif','sans-serif','monospace'])for(const width of [100,140,180]){
  const text="אב אבגדה'וזחטי אב אבגד";
  const anchor=text.indexOf("'")+1;
  const entry={id:'no-space',text,runs:[{start:anchor,end:anchor+2,marks:{bold:true}}],mainRefs:[{uid:'midword',anchor,formatted:enabled?'[8]':'',cssText:'font-size:11px;vertical-align:super'}]};
  const m=withCase(makeConfig(family,2,200,false),entry,{width,mode:'inline'},inspectNativeParagraph);
  assert(m.sourcePreserved,'reference probe changed source');
  assert(m.checks.noSpaceBreaks,'protected native source token was split');
  assert(m.references.length===(enabled?1:0),'reference visibility lost');
  const current=createV9TextLayoutContext(makeConfig(family,2,200,false));
  let baseline;
  try{
   const p=layoutV9MainParagraphs([current.prepareEntry(entry)],[{x:0,width,y_start:0,y_end:1000}],current,1000);
   const broken=[...text.matchAll(/\S+/gu)].filter(word=>p.lines.filter(l=>l.source.start<word.index+word[0].length&&l.source.end>word.index).length>1);
   baseline={rowCount:p.lines.length,overflowReason:p.overflowReason,overflowText:p.overflowText,noSpaceBreaks:broken.length===0};
   assert(baseline.noSpaceBreaks,'baseline now splits a source word; inspect the existing product first');
  }finally{current.dispose();}
  references.push({enabled,family,width,measurement:m,v9Baseline:baseline});
 }
 for(const family of ['serif','sans-serif','monospace'])for(const exclusion of ['left','right','both'])for(const drop of [2,4]){
  const entry={id:'widen',text:'פתיח '+Array(100).fill('אב').join(' '),runs:[],mainRefs:[]};
  const m=withCase(makeConfig(family,drop,150),entry,{width:300,mode:'float',exclusion,cutoff:48,cutwidth:75},inspectNativeParagraph);
  widening.push({family,exclusion,drop,measurement:m});
 }
 for(const family of ['serif','sans-serif','monospace'])for(const mode of ['float','inline'])for(const words of [9,13,21]){
  const entry={id:'wrap-effect',text:'פתיח '+Array(words).fill('אבגד').join(' '),runs:[],mainRefs:[]};
  const variants={};
  for(const wrap of ['wrap','pretty','balance'])variants[wrap]=withCase(makeConfig(family,2),entry,{width:300,mode,wrap},inspectNativeParagraph);
  const signature=m=>JSON.stringify(m.rows.map(r=>[r.start,r.end,r.left,r.right]));
  wrapEffects.push({family,mode,words,prettyChangesRows:signature(variants.pretty)!==signature(variants.wrap),balanceChangesRows:signature(variants.balance)!==signature(variants.wrap),variants});
 }
 const total=matrix.length+centering.length+references.length+widening.length+wrapEffects.length*3;
 return {browser:navigator.userAgent,counts:{matrix:matrix.length,twoLine:centering.length,references:references.length,widening:widening.length,wrapEffectCases:wrapEffects.length*3,total,
   sourceInvariantFailures:matrix.filter(x=>!x.measurement.sourcePreserved).length,
   twoLineCombinedCenterFailures:centering.filter(x=>!x.measurement.center.meetsReportedCentering).length,
   noSpaceReferenceFailures:references.filter(x=>x.measurement.conflicts.length>0).length,
   acceptedForProduction:0},matrix,centering,references,widening,wrapEffects};
}

export async function showComparison(options={}){
 const {family='serif',words=12,drop=2,width=300,wrap='wrap',mode='float',exclusion='none',joint=false}=options;
 const nativeHost=document.querySelector('#native-host'),oldHost=document.querySelector('#v9-host');
 nativeHost.replaceChildren();oldHost.replaceChildren();
 const c=createV9TextLayoutContext(makeConfig(family,drop));
 try{
  const entry=c.prepareEntry({id:'preview',index:1,text:'פתיח '+Array(words).fill('אב').join(' '),runs:[],mainRefs:[]});
  const nativeSettings={width,mode,wrap,exclusion,cutwidth:60,cutoff:48};
  const candidate=joint?probeJointNativeGroup(entry,c,nativeSettings):null;
  const finalGroup=candidate?.accepted?renderJointNativeCandidate(nativeHost,entry,c,nativeSettings,candidate.inset):null;
  const native=finalGroup?.handle || renderNativeParagraph(nativeHost,entry,c,nativeSettings);
  await document.fonts.ready;
  const report=finalGroup?.measurement || inspectNativeParagraph(native);
  if(candidate)report.jointProbe={found:candidate.accepted,inset:candidate.inset,
    rowBoundariesChanged:candidate.rowBoundariesChanged,trials:candidate.trials.length,
    reason:candidate.reason,identicalAppearance:false,productionEligible:false};
  const x=exclusion==='left'||exclusion==='both'?60:0;
  const right=exclusion==='right'||exclusion==='both'?60:0;
  const strips=exclusion==='none'?[{x:0,width,y_start:0,y_end:1500}]:[{x,width:width-x-right,y_start:0,y_end:48},{x:0,width,y_start:48,y_end:1500}];
  const planned=layoutV9MainParagraphs([entry],strips,c,1500);
  oldHost.style.width=width+'px';oldHost.style.height=Math.max(planned.endY,120)+'px';
  for(const line of planned.lines)renderV9PlannedMainLine(line,oldHost,0);
  document.querySelector('#results').textContent=JSON.stringify({native:report,v9:{lines:planned.lines.length,diagnostics:planned.diagnostics,overflow:planned.overflowText}},null,2);
  document.querySelector('#status').textContent=candidate
    ?(candidate.accepted?'נמצא מרכוז משותף לפתיח ולשורה האחרונה, אך תיבת הפסקה השתנתה. אין התאמה מלאה למראה ואין אישור למוצר.':'לא נמצא מועמד מתאים לניסוי המרכוז הזה; מוצגת הזרימה הטבעית הרגילה.')
    :(report.contract.reasons.length?'הניסוי עדיין אינו עומד בתנאי ההחלפה: '+report.contract.reasons.join(', '):'תנאי הבדיקה המקומית עברו. אין בכך אישור לשילוב במוצר.');
  return report;
 }finally{c.dispose();}
}
window.nativeParagraphProof={run:runNativeProof,runNext:()=>runNativeNext(makeConfig),show:showComparison};
