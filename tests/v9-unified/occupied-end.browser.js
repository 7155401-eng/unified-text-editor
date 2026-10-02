import {createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {layoutV9MainParagraphs} from '../../src/engine/v9_main_inline_layout.js';
import {flowV9MeasuredStream} from '../../src/engine/v9_stream_inline_layout.js';
import {buildSinglePage} from '../../src/vilna_v9.js';
import {runOpeningWindowRetryChecks} from './opening-window-retry.browser.js';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const sourceOf=el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return copy.textContent;};
// The immutable pre-#1040 baseline has eight known opening-tail cases with
// one missing ASCII separator. Account for ONLY that explicitly repaired defect
// in the comparison oracle; every other plan/paint field still must match.
function baselineWithCompleteOpeningSeparator(shape) {
 const expected=structuredClone(shape);
 const sourcePart=part=>part?(part.leadingText||'')+part.text+(part.trailingText||''):'';
 for(const line of expected.lines){
  const opening=sourcePart(line.render.opening?.part),body=sourcePart(line.render.body);
  if(opening+body===line.sourceText)continue;
  assert(line.tailRebalanced&&line.render.opening&&line.wordTokens.length>0&&
    opening+' '+body===line.sourceText,'unexpected baseline source defect');
  line.render.body.leadingText=' '+(line.render.body.leadingText||'');
 }
 return expected;
}
function extent(lines,origin){
 let end=origin;
 for(const line of lines){
  end=Math.max(end,line.y+line.lineHeightPx);
  const opening=line.render?.opening;
  if(opening)end=Math.max(end,opening.y+opening.height);
 }
 return end;
}
function withoutJustificationDetails(shape) {
 const out=structuredClone(shape);
 for(const line of out.lines||[]) {
  if(line.render) delete line.render.wordSpacing;
  delete line.tailWordSpacingTarget;
  delete line.tailWordSpacingCapped;
  delete line.tailWordSpacingFallbackStretched;
 }
 for(const diagnostic of out.diagnostics||[]) delete diagnostic.fallbackStretchedRows;
 return out;
}
function normalizedPaintHTML(root) {
 const copy=root.cloneNode(true);
 for(const body of copy.querySelectorAll('.v9-planned-line-text,.v9-planned-stream-text')) {
  body.style.wordSpacing='';
 }
 return copy.innerHTML;
}
function checkRectangles(page,lines,padding=0){
 const collisions=[];
 const painted=[...page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')];
 assert(painted.length===lines.length,'painted row count changed');
 for(let i=0;i<lines.length;i++){
  const a=lines[i],style=painted[i].style;
  assert(Math.abs(parseFloat(style.left)-padding-a.x)<.02&&Math.abs(parseFloat(style.top)-a.y)<.02&&Math.abs(parseFloat(style.height)-a.lineHeightPx)<.02,'paint rewrote planned placement');
  for(let j=i+1;j<lines.length;j++){
   const b=lines[j];
   const dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),dy=Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y);
   if(dx>=.2&&dy>=.2)collisions.push({i,j,dx,dy});
  }
 }
 // The old baseline contained two overlapping full-width side rows. The
 // final-width reconciliation repairs them; no overlap is accepted now.
 assert(collisions.length===0, 'overlapping boxes remain in the final plan');
 return collisions;
}
export function runOccupiedEndChecks(baseline){
 const results=[];
 assert(baseline?.layoutV9MainParagraphs&&baseline?.createV9TextLayoutContext&&baseline?.buildSinglePage,'pinned baseline is required');
 const run=(name,fn)=>{try{results.push({name,pass:true,...fn()});}catch(error){results.push({name,pass:false,error:String(error)});}};
 for(const family of ['serif','sans-serif','monospace'])for(const origin of [0,17])
 for(const prefix of ['', 'אב אב '])for(const kind of ['width','height'])for(const dropped of [false,true]){
  run(`occupied/${family}/${origin}/${prefix.length}/${kind}/opening=${dropped}`,()=>{
   const context=createV9TextLayoutContext({mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
    openingWordSettings:{enabled:dropped,target:'word',count:1,font:'inherit',size:175,weight:'bold',position:'dropped',dropLines:3,spaceAfter:.2,scope:'all',skipHeadings:false,skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false}});
   const page=document.createElement('div');page.style.position='relative';document.body.append(page);
   try{
    const lead=(dropped?'פתיח ':'')+prefix;
    const text=lead+(kind==='width'?'W'.repeat(80):'ט')+' אב';
    const runs=kind==='height'?[{start:lead.length,end:lead.length+1,marks:{fontSize:170,color:'rgb(31,47,67)'}}]:[{start:0,end:lead.length,marks:{bold:true}}];
    const entry=context.prepareEntry({id:'occupied',text,runs,mainRefs:[{uid:'hidden',anchor:lead.length,formatted:''},{uid:'visible',anchor:text.length,formatted:'[2]'}]});
    const strips=[{x:0,width:120,y_start:origin,y_end:origin+130},{x:0,width:250,y_start:origin+220,y_end:origin+245}];
    const snapshot=JSON.stringify({entry,strips});
    const plan=layoutV9MainParagraphs([entry],strips,context,origin+245);
    const planBeforePaint=JSON.stringify(plan);
    const {endY:baselineEnd,...oldShape}=baseline.layoutV9MainParagraphs([entry],strips,context,origin+245);
    const baselineShape=baselineWithCompleteOpeningSeparator(oldShape);
    const {endY:currentEnd,...currentShape}=plan;
    assert(JSON.stringify(withoutJustificationDetails(currentShape))===JSON.stringify(withoutJustificationDetails(baselineShape)),
      'occupancy correction changed row content, anchors or planned placement beyond justification');
    const referencePage=document.createElement('div');
    for(const line of baselineShape.lines)renderV9PlannedMainLine(line,referencePage,0);
    for(const line of plan.lines)renderV9PlannedMainLine(line,page,0);
    assert(plan.overflowText.length>0,'fixture must reject the overwide/tall candidate');
    assert(plan.endY===extent(plan.lines,origin),`failed search takes space: end=${plan.endY}, committed=${extent(plan.lines,origin)}`);
    assert(plan.lines.map(l=>l.sourceText).join('')+plan.overflowText===text,'source model changed');
    const renderedSourceExact=sourceOf(page)+plan.overflowText===text;
    assert(normalizedPaintHTML(page)===normalizedPaintHTML(referencePage),
      'paint differs from pinned baseline beyond word justification');
    assert(renderedSourceExact,'opening-tail source conservation regressed');
    assert(JSON.stringify({entry,strips})===snapshot,'source/styles/anchors mutated');
    assert(JSON.stringify(plan)===planBeforePaint,'painter changed the plan');
    const refs=[...plan.lines.flatMap(l=>[...(l.render.opening?.part.refs||[]),...l.render.body.refs]),...plan.overflowParagraphs.flatMap(p=>p.mainRefs)];
    assert(refs.map(r=>r.uid).sort().join(',')==='hidden,visible','reference ownership changed');
    checkRectangles(page,plan.lines);
    if(dropped){assert(page.querySelectorAll('.v9-opening-glyph').length===1,'committed opening was lost');assert(plan.endY>=origin+72,'opening window was reclaimed');}
    return {endY:plan.endY,baselineEnd,rows:plan.lines.length,reason:plan.overflowReason,overflow:plan.overflowText.length,renderedSourceExact};
   }finally{context.dispose();page.remove();}
  });
 }
 for(const family of ['serif','sans-serif','monospace'])for(const prefix of ['', 'אב ']){
  run(`stream-wrapper/${family}/${prefix.length}`,()=>{
   const context=createV9TextLayoutContext({mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,openingWordSettings:{enabled:false}});
   try{
    const input={text:prefix+'W'.repeat(80),runs:[]};
    const plan=flowV9MeasuredStream(input,[{x:0,width:60,y_start:13,y_end:100},{x:0,width:100,y_start:200,y_end:300}],context,300);
    assert(plan.endY===extent(plan.lines,13),'stream wrapper retained phantom occupancy');
    assert(plan.lines.map(l=>l.sourceText).join('')+plan.overflowRich.text===input.text,'stream source changed');
    return {endY:plan.endY,rows:plan.lines.length};
   }finally{context.dispose();}
  });
 }
 for(const family of ['serif','sans-serif','monospace'])for(const sideCount of [1,2])for(const prefix of ['', 'אב אב אב אב ']){
  run(`actual-page/${family}/${sideCount}/${prefix.length}`,()=>{
   const phrase='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
   const stream=(id,n)=>({id,items:[Array(n).fill(phrase).join(' ')]});
   const content={mainText:'אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר',rightStream:{id:'01',items:[prefix+'W'.repeat(45)+' אב אב']},leftStream:sideCount===2?stream('02',7):null,footerStreams:[stream('03',4)]};
   const config={pageWidth:380,pageHeight:700,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,crownLines:4,crownMainGapPx:11,mainBottomGapPx:9,mainFontFamily:family,sideFontFamily:family,openingWordSettings:{enabled:false}};
   const snapshot=JSON.stringify({content,config});
   const page=document.createElement('div');page.style.position='relative';document.body.append(page);
   try{
    const baselinePage=document.createElement('div');document.body.append(baselinePage);
    let originalPlan;
    try{originalPlan=baseline.buildSinglePage(baselinePage,content,config);}finally{baselinePage.remove();}
    const originalLines=[...originalPlan.mainBox.lines,...originalPlan.streamBoxes.flatMap(b=>b.lines),...originalPlan.footerBoxes.flatMap(b=>b.lines)];
    const originalCollisions=[];
    for(let i=0;i<originalLines.length;i++)for(let j=i+1;j<originalLines.length;j++){
      const a=originalLines[i],b=originalLines[j];
      const dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),dy=Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y);
      if(dx>=.2&&dy>=.2)originalCollisions.push({i,j,dx,dy});
    }
    const plan=buildSinglePage(page,content,config);
    const right=plan.streamBoxes.find(b=>b.role==='right');
    assert(right,'right stream allocation missing');
    const realEnd=extent(right.lines,right.strips[0].y_start);
    assert(Math.abs(right.endY-realEnd)<.02,`rejected side content blocks later layout: ${right.endY} vs ${realEnd}`);
    assert(plan.streamCoverage.every(c=>c.exact),'page source coverage is not exact');
    assert(JSON.stringify({content,config})===snapshot,'page input/settings changed');
    const lines=[...plan.mainBox.lines,...plan.streamBoxes.flatMap(b=>b.lines),...plan.footerBoxes.flatMap(b=>b.lines)];
    const remainingCollisions=checkRectangles(page,lines,config.padding);
    assert(lines.every(l=>l.y+l.lineHeightPx<=config.pageHeight-config.padding+.02),'row crosses physical page bottom');
    return {mainEndY:plan.mainBox.endY,sideEndY:right.endY,footerBaseY:plan.mainBottomGapPlan.baseY,rows:lines.length,originalCollisions,remainingCollisions,remainingIssue:remainingCollisions.length?'pre-existing-overlap':null};
   }finally{page.remove();}
  });
 }
 const previous=runOpeningWindowRetryChecks();
 return {total:results.length+previous.total,passed:results.filter(r=>r.pass).length+previous.passed,failed:results.filter(r=>!r.pass).length+previous.failed,
  remainingIssues:results.filter(r=>r.remainingIssue).map(r=>({name:r.name,issue:r.remainingIssue})),
  groups:{occupiedEnd:results.length,...previous.groups},results:[...results,...previous.results]};
}
