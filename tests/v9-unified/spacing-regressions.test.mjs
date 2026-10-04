import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMainParagraphSource } from '../../src/engine/main_source_mapping.js';
import { prepareV9SourceParagraph,splitV9Paragraph,joinV9ParagraphFragments,sliceV9Paragraph } from '../../src/engine/v9_source_fragments.js';
import { splitMainTextAtOffset,splitNotesByAnchor,scoreV9PageCandidate,hasUnsafeV9StreamOverflow,selectV9GapFillCandidates,evaluateV9PhysicalGapFillTrigger,evaluateV9PhysicalGapFillGain,getLastMainLineInfo,isV9WhitespaceBreakBoundary,buildParagraphBreakCandidates } from '../../src/engine/v9_split_policy.js';
import { partForRange,layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';
import { splitV9StreamAtWordCount,flowV9MeasuredStream } from '../../src/engine/v9_stream_inline_layout.js';
import { markV9NoteRuns,auditV9NoteStarts,verifyV9StreamCoverage } from '../../src/engine/v9_note_ownership.js';

const markers=raw=>[...raw.matchAll(/@\d\d/gu)].map(m=>({atInPara:m.index,sym:m[0],code:m[0].slice(1)}));
for(const raw of ['alpha@01beta gamma',' alpha  @01beta  gamma ','alpha@01@02beta gamma','alpha\t@01\t beta  gamma','אחד@01שניים\nשלוש'])test(`one boundary map preserves bold after markers: ${JSON.stringify(raw)}`,()=>{
 const text=raw.includes('beta')?'beta':'שניים',at=raw.indexOf(text),input=[{start:at,end:at+text.length,marks:{bold:true,fontSize:9,color:'red'}}];
 const m=mapMainParagraphSource(raw,input,markers(raw));
 assert.equal(m.mainTextNet.slice(m.mainRuns[0].start,m.mainRuns[0].end),text);
 assert.deepEqual(m.mainRuns[0].marks,input[0].marks);
 assert.ok(!m.mainTextNet.includes('@'));
 for(const c of m.mainConsumers)assert.ok(c.anchor>=0&&c.anchor<=m.mainTextNet.length);
 assert.equal(input[0].start,at);
});

test('apostrophe + note marker + following word stays unbreakable without source whitespace',()=>{
 const raw="alpha'@01beta gamma";
 const mapped=mapMainParagraphSource(raw,[],markers(raw));
 assert.equal(mapped.mainTextNet,"alpha'beta gamma");
 assert.equal(mapped.mainConsumers.length,1);
 const anchor=mapped.mainConsumers[0].anchor;
 assert.equal(anchor,6);
 assert.equal(mapped.mainConsumers[0].anchorAffinity,'backward');
 assert.equal(isV9WhitespaceBreakBoundary(mapped.mainTextNet,anchor),false,
  'note boundary became a legal line break without source whitespace');

 const metrics={spaceWidth:4,measureWord:w=>String(w).length*5};
 const candidates=buildParagraphBreakCandidates(
  mapped.mainTextNet,metrics,51,
  {minLineEdgeFill:.2,maxAdjustedLineEdgeFill:2,allowWordGapOnlyInEmergency:true},
  {source:'apostrophe-note-glue',emergency:true}
 );
 assert(!candidates.some(c=>c.offset===anchor),
  'split policy invented a break at the removed note marker');

 const ctx={
  fontSize:10,lineHeight:10,describeOpening:()=>null,
  measure:part=>({width:String(part?.text||'').length*5,height:10,topInset:0})
 };
 const plan=layoutV9MainParagraphs([{
  id:'apostrophe-note-glue',
  text:mapped.mainTextNet,
  runs:[],
  mainRefs:mapped.mainConsumers,
 }],[{x:0,width:51,y_start:0,y_end:80}],ctx,80);

 assert.equal(plan.overflowText,'');
 assert.deepEqual(plan.lines.map(l=>l.render.body.text),["alpha'beta",'gamma']);
 assert.equal(plan.lines[0].wordTokens.length,1);
 assert.equal(plan.lines[0].wordTokens[0].text,"alpha'beta");
 assert(plan.lines[0].wordTokens[0].start<anchor&&plan.lines[0].wordTokens[0].end>anchor,
  'note anchor no longer remains inside the unbroken token');
 assert.equal(plan.lines.map(l=>l.sourceText).join(''),mapped.mainTextNet);
});

test('V9 page-break boundaries require real source whitespace',()=>{
 const samples=[
  ['abc[def] ghi',3,false],
  ['abc]def ghi',4,false],
  ['abc,def ghi',4,false],
  ['abc def',3,true],
  ['abc\ndef',3,true],
  ['אבג״דה ו',3,false],
 ];
 for(const [text,offset,expected] of samples)
  assert.equal(isV9WhitespaceBreakBoundary(text,offset),expected,`${JSON.stringify(text)} @ ${offset}`);

 const metrics={spaceWidth:4,measureWord:w=>String(w).length*7};
 const text='alpha[beta] gamma,delta epsilon';
 const candidates=buildParagraphBreakCandidates(text,metrics,85,{minLineEdgeFill:.2,maxAdjustedLineEdgeFill:2,allowWordGapOnlyInEmergency:true},{emergency:true});
 for(const cand of candidates)
  assert.equal(isV9WhitespaceBreakBoundary(text,cand.offset),true,`illegal non-whitespace candidate: ${JSON.stringify(cand)}`);
});

test('B23: measured commentary stream rows break only on real source whitespace',()=>{
 const text="alpha'beta gamma,delta epsilon zeta eta theta iota";
 const ctx={
  streamId:'01',fontSize:10,lineHeight:10,describeOpening:()=>null,
  prepareEntry:entry=>entry,
  measure:part=>({width:String(part?.text||'').length*5,height:10,topInset:0})
 };
 const plan=flowV9MeasuredStream(
  {text,runs:[]},
  [{x:0,width:58,y_start:0,y_end:100}],
  ctx,
  100
 );
 assert.equal(plan.overflowText,'');
 assert(plan.lines.length>=3,'fixture did not create enough commentary rows');
 assert.equal(plan.lines.map(l=>l.sourceText).join(''),text,'stream source changed while wrapping');

 let offset=0;
 for(let i=0;i<plan.lines.length;i++){
  const line=plan.lines[i];
  assert(line.wordTokens.length>0,`row ${i} has no complete word token`);
  offset+=line.sourceText.length;
  if(i<plan.lines.length-1){
   assert.equal(
    isV9WhitespaceBreakBoundary(text,offset),
    true,
    `stream row ${i} ended inside a source token at offset ${offset}`
   );
  }
  for(const token of line.wordTokens){
   assert(token.end>token.start,`row ${i} contains an empty token`);
   assert.equal(text.slice(token.start,token.end),token.text,
    `row ${i} token was split or rebased incorrectly`);
  }
 }
});

test('B40: following paragraph never inherits a completed opening window',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:e=>e.id==='b40-opening'
   ? {position:'dropped',start:0,end:5,marks:{fontSize:20},dropLines:2,gapPx:2}
   : null,
  measure:p=>{
   const body=String(p?.text||'').trim();
   if(body==='פתיח')return {width:20,height:20,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const plan=layoutV9MainParagraphs([
  {id:'b40-opening',text:'פתיח אב',runs:[],mainRefs:[]},
  {id:'b40-after',text:'גד הו זח טי כל מנ',runs:[],mainRefs:[]},
 ],[{x:0,width:100,y_start:0,y_end:120}],ctx,120);
 const first=plan.lines.filter(l=>l.source?.paragraphId==='b40-opening');
 const after=plan.lines.filter(l=>l.source?.paragraphId==='b40-after');
 assert(first.length&&after.length,'fixture did not render both source paragraphs');
 const opening=first.find(l=>l.render?.opening)?.render?.opening;
 assert(opening,'fixture did not place a dropped opening');
 const next=after[0];
 assert.equal(next.openingWindow,false,'following paragraph inherited the previous opening window');
 assert.equal(next.render?.opening,null,'following paragraph received a duplicate opening');
 assert(Math.abs(next.x)<1e-9&&Math.abs(next.width-100)<1e-9,
  'following paragraph stayed indented: x='+next.x+', width='+next.width);
 assert(next.y+1e-9>=opening.y+opening.height,
  'following paragraph rose into previous opening: nextY='+next.y+', openingBottom='+(opening.y+opening.height));
 assert.equal(plan.lines.map(l=>l.sourceText).join(''),'פתיח אבגד הו זח טי כל מנ');
});

test('source paragraph style becomes a semantic V9 run, separate from stream style',()=>{
 const p=prepareV9SourceParagraph({
   id:'source-style-bold',
   mainText:'alpha beta',
   mainRuns:[],
   style:{fontFamily:'Word Font',fontSize:'12pt',fontWeight:'700'}
 });
 assert.equal(p.mainRuns.length,1);
 assert.deepEqual(p.mainRuns[0],{
   start:0,end:'alpha beta'.length,
   marks:{fontFamily:'Word Font',fontSize:'12pt',fontWeight:'700'}
 });
});

test('backward notes and refs retain previous word at exact split and all aliases rebase',()=>{
 const t='alpha beta gamma',p=prepareV9SourceParagraph({id:'affinity',mainText:t,notes:[{stream:'01',uid:'a',anchor:5,anchorAffinity:'backward'},{stream:'01',uid:'b',anchor:10,absoluteAnchor:10,localAnchor:10,anchorAffinity:'backward'}]});
 const st=splitMainTextAtOffset(t,5),ns=splitNotesByAnchor(p.notes,5,t.length,st.suffixBaseOffset),h=splitV9Paragraph(p,st,ns.before,ns.after);
 assert.deepEqual(h.firstHalf.notes.map(n=>n.uid),['a']);assert.deepEqual(h.firstHalf.mainRefs.map(n=>n.uid),['a']);
 assert.equal(h.secondHalf.notes[0].anchor,4);assert.equal(h.secondHalf.notes[0].absoluteAnchor,4);assert.equal(h.secondHalf.notes[0].localAnchor,4);
 const joined=joinV9ParagraphFragments(h.firstHalf,h.secondHalf);
 assert.equal(joined.mainText,t);assert.equal(joined.notes[1].anchor,10);assert.equal(joined.notes[1].absoluteAnchor,10);
 assert.deepEqual(joined.mainRefs.map(r=>r.anchor),[5,10]);
});

test('final gap search starts with page-sized prefixes instead of the three largest paragraph cuts',()=>{
 const candidates=Array.from({length:30},(_,i)=>({
  kind:'visual-line-end',priority:900,offset:(i+1)*10,source:'test'
 })).reverse();
 const selected=selectV9GapFillCandidates(candidates,{remainingPx:60,lineHeight:20});
 assert.deepEqual(selected.slice(0,5).map(c=>c.offset),[10,20,30,40,50]);
 assert(selected.some(c=>c.offset===30),'three-row gap did not inspect a three-row prefix');
 assert(!selected.some(c=>c.offset===300),'gap search still starts at the end of a long paragraph');
 assert(selected.length>=8 && selected.length<30,`unexpected adaptive budget: ${selected.length}`);
});

test('physical final-gap trigger uses real remaining row space by default',()=>{
 const nearFull=evaluateV9PhysicalGapFillTrigger({remainingPx:19,lineHeight:20,beforeFill:.94,cfg:{}});
 assert.equal(nearFull.ok,true,JSON.stringify(nearFull));
 const tooSmall=evaluateV9PhysicalGapFillTrigger({remainingPx:10,lineHeight:20,beforeFill:.4,cfg:{}});
 assert.equal(tooSmall.ok,false);
 assert.equal(tooSmall.reason,'not-enough-physical-room');
 const legacy=evaluateV9PhysicalGapFillTrigger({remainingPx:40,lineHeight:20,beforeFill:.9,cfg:{finalGapFillTriggerRatio:.84}});
 assert.equal(legacy.ok,false);
 assert.equal(legacy.reason,'configured-fill-ratio');
});

test('physical final-gap gain rejects slivers while accepting meaningful row gain',()=>{
 const meaningful=evaluateV9PhysicalGapFillGain({beforeBottom:180,afterBottom:200,lineHeight:20,beforeFill:.9,afterFill:.92,cfg:{}});
 assert.equal(meaningful.ok,true,JSON.stringify(meaningful));
 const sliver=evaluateV9PhysicalGapFillGain({beforeBottom:180,afterBottom:184,lineHeight:20,beforeFill:.9,afterFill:.904,cfg:{}});
 assert.equal(sliver.ok,false);
 assert.equal(sliver.reason,'too-small-physical-improvement');
 const legacy=evaluateV9PhysicalGapFillGain({beforeBottom:180,afterBottom:200,lineHeight:20,beforeFill:.9,afterFill:.92,cfg:{finalGapFillMinGain:.04}});
 assert.equal(legacy.ok,false);
 assert.equal(legacy.reason,'configured-gain-ratio');
});

test('explicit final-gap candidate budget is respected after offset ordering',()=>{
 const candidates=Array.from({length:10},(_,i)=>({kind:'visual-line-end',priority:900,offset:(i+1)*10}));
 const selected=selectV9GapFillCandidates(candidates,{remainingPx:200,lineHeight:20,maxCandidates:3});
 assert.deepEqual(selected.map(c=>c.offset),[10,20,30]);
});


test('carry rescue line budget samples the earliest safe cuts, not the deepest paragraph offsets',()=>{
 const candidates=Array.from({length:20},(_,i)=>({
  kind:'visual-line-end',priority:900,offset:(i+1)*10,source:'carry-rescue'
 })).reverse();
 const selected=selectV9GapFillCandidates(candidates,{remainingPx:20,lineHeight:20,maxCandidates:4});
 assert.deepEqual(selected.map(c=>c.offset),[10,20,30,40]);
});

test('sparse rescue adaptive search covers the missing physical rows from paragraph start',()=>{
 const candidates=Array.from({length:50},(_,i)=>({
  kind:'visual-line-end',priority:900,offset:(i+1)*10,source:'final-sparse-rescue'
 })).reverse();
 const selected=selectV9GapFillCandidates(candidates,{remainingPx:100,lineHeight:20});
 assert.equal(selected[0].offset,10);
 assert(selected.some(c=>c.offset===50),'five missing rows did not include a five-row prefix');
 assert(!selected.some(c=>c.offset===500),'adaptive sparse search still starts at the paragraph tail');
 assert(selected.length>=11 && selected.length<=36,`unexpected adaptive sparse budget: ${selected.length}`);
});


test('planned tail redistribution counts toward the final line guard',()=>{
 const baseLine={
   text:'a b c d',width:100,naturalWidth:70,isLast:false,forcedBreak:false,
   y:100,lineHeightPx:20,render:{wordSpacing:5,body:{text:'a b c d'}}
 };
 const mkPlan=line=>({
   unstartedNotes:[],
   overflow:{exceedsPage:false,mainText:'',streams:{}},
   pageBox:{height:200,padding:0},
   mainBox:{continues:true,lines:[line]},
   streamBoxes:[],footerBoxes:[]
 });
 const candidate={kind:'visual-line-end',priority:900};
 const policy={rejectSparsePages:false,minLineEdgeFill:.82};
 const rejected=scoreV9PageCandidate(mkPlan({...baseLine}),candidate,policy,{cfg:{pageHeight:200,padding:0}});
 assert.equal(rejected.accept,false,'ordinary short line unexpectedly bypassed final line guard');

 const rebalanced={...baseLine,tailRebalanced:true};
 const accepted=scoreV9PageCandidate(mkPlan(rebalanced),candidate,policy,{cfg:{pageHeight:200,padding:0}});
 assert.equal(accepted.accept,true,accepted.reason);
 const info=getLastMainLineInfo(mkPlan(rebalanced),policy);
 assert(info.lastMainLineEffectiveFillRatio>=.82,
   `effective fill was ignored: ${info.lastMainLineEffectiveFillRatio}`);
 assert.equal(info.isTailRebalancedLineEdge,true);
});

test('tail redistribution still fails the guard when gentle spacing is insufficient',()=>{
 const line={
   text:'a b c d',width:100,naturalWidth:60,isLast:false,forcedBreak:false,
   y:100,lineHeightPx:20,tailRebalanced:true,
   render:{wordSpacing:3,body:{text:'a b c d'}}
 };
 const plan={
   unstartedNotes:[],
   overflow:{exceedsPage:false,mainText:'',streams:{}},
   pageBox:{height:200,padding:0},
   mainBox:{continues:true,lines:[line]},
   streamBoxes:[],footerBoxes:[]
 };
 const score=scoreV9PageCandidate(plan,{kind:'visual-line-end',priority:900},
   {rejectSparsePages:false,minLineEdgeFill:.82},{cfg:{pageHeight:200,padding:0}});
 assert.equal(score.accept,false);
 assert.equal(score.reason,'last-main-line-not-filled');
});

test('started long-note continuation is legal and remains scoreable',()=>{
 const plan={
   unstartedNotes:[],
   overflow:{exceedsPage:false,mainText:'',streams:{'01':{text:'continued note body',runs:[]}}},
   pageBox:{height:200,padding:0},
   mainBox:{continues:false,lines:[{text:'alpha beta',width:100,naturalWidth:96,isLast:true,y:0,lineHeightPx:20}]},
   streamBoxes:[{id:'01',lines:[{text:'note start',y:20,lineHeightPx:20}]}],
   footerBoxes:[]
 };
 assert.equal(hasUnsafeV9StreamOverflow(plan),false);
 const score=scoreV9PageCandidate(plan,{kind:'visual-line-end',priority:900},{rejectSparsePages:false,minLineEdgeFill:.82},{
   movedNotes:[{uid:'n1'}],cfg:{pageHeight:200,padding:0}
 });
 assert.equal(score.accept,true,score.reason);
});

test('stream overflow without a rendered note start remains unsafe',()=>{
 const plan={
   unstartedNotes:[],
   overflow:{exceedsPage:false,mainText:'',streams:{'01':{text:'whole note still pending',runs:[]}}},
   pageBox:{height:200,padding:0},
   mainBox:{continues:false,lines:[{text:'alpha beta',width:100,naturalWidth:96,isLast:true,y:0,lineHeightPx:20}]},
   streamBoxes:[],footerBoxes:[]
 };
 assert.equal(hasUnsafeV9StreamOverflow(plan),true);
 assert.equal(scoreV9PageCandidate(plan,{kind:'visual-line-end',priority:900},{rejectSparsePages:false},{cfg:{pageHeight:200,padding:0}}).accept,false);
});

test('backward references belong to one adjacent line, forward refs remain right-open',()=>{
 const p=prepareV9SourceParagraph({mainText:'abcdef',mainRefs:[{uid:'before',anchor:3,anchorAffinity:'backward'},{uid:'after',anchor:3,anchorAffinity:'forward'}]});
 const a=sliceV9Paragraph(p,0,3),b=sliceV9Paragraph(p,3,6);
 assert.deepEqual(a.mainRefs.map(r=>r.uid),['before']);assert.deepEqual(b.mainRefs.map(r=>r.uid),['after']);
});

test('column split cuts original rich text, not normalized string lengths',()=>{
 const text='one   two\tthree  four',at=text.indexOf('three'),input={text,runs:[{start:at,end:at+5,marks:{bold:true}}]};
 const [a,b]=splitV9StreamAtWordCount(input,2);
 assert.equal(a.text+b.text,text);assert.equal(b.text.slice(b.runs[0].start,b.runs[0].end),'three');
 assert.equal(a.runs.length,0);
});

test('bidi separators at edges are semantic-only, interior note gap remains',()=>{
 const text='\u200e  alpha   beta  \u200e';const e={text,runs:[],mainRefs:[]};
 const p=partForRange(e,0,text.length,text.length);
 assert.equal(p.text,'alpha   beta');assert.equal(p.leadingText+p.text+p.trailingText,text);
});

test('invisible-only word cannot consume a justification slot at line boundary',()=>{
 const text='alpha \u200e beta gamma',ctx={fontSize:10,lineHeight:10,describeOpening:()=>null,measure:p=>({width:p.text.length*5,height:10})};
 const p=layoutV9MainParagraphs([{id:'edge',text,runs:[],mainRefs:[]}],[{x:0,width:40,y_start:0,y_end:100}],ctx,100);
 assert.equal(p.lines.map(l=>l.sourceText).join(''),text);
 assert.deepEqual(p.lines.map(l=>l.render.body.text),['alpha','beta','gamma']);
 assert.ok(p.lines.every(l=>l.render.wordSpacing===0));
});


test('page-ending continuation pulls words first, then finishes exact justification when no gentler partition exists',()=>{
 const text=Array(10).fill('aa').join(' ');
 const ctx={
  fontSize:10,lineHeight:10,describeOpening:()=>null,
  measure:p=>{const body=String(p.text||'').trim(),n=body?body.split(/\s+/u).length:0;const ws=parseFloat(p.style?.wordSpacing||'0')||0;return {width:n?n*10+(n-1)*(2+ws):0,height:10,topInset:0};}
 };
 const p=layoutV9MainParagraphs(
  [{id:'tail-balance',text,runs:[],mainRefs:[],continuesAfter:true}],
  [{x:0,width:54,y_start:0,y_end:30}],ctx,30
 );
 assert.equal(p.lines.length,3);
 // Redistribution remains first and authoritative.
 assert.deepEqual(p.lines.map(l=>l.wordTokens.length),[4,3,3]);
 assert.ok(p.lines.every(l=>l.tailRebalanced===true));
 assert.equal(p.lines.map(l=>l.sourceText).join(''),text);
 // The first line is resolved gently; the two rows that cannot be improved
 // further are now justified exactly rather than deliberately left short.
 assert.deepEqual(p.lines.map(l=>l.render.wordSpacing),[8/3,10,10]);
 assert.deepEqual(p.lines.map(l=>!!l.tailWordSpacingFallbackStretched),[false,true,true]);
 assert.ok(p.lines.every(l=>l.tailWordSpacingCapped===false));
 assert.ok(p.diagnostics.some(d=>d.code==='paragraph-tail-rebalanced'&&d.fallbackStretchedRows===2));
});


test('exact-tail cache reuses identical deterministic searches without changing layout',()=>{
 let measureCalls=0;
 const text=Array(10).fill('aa').join(' ');
 const ctx={
  fontSize:10,lineHeight:10,generation:0,typography:{},describeOpening:()=>null,
  measure:p=>{
   measureCalls++;
   const body=String(p.text||'').trim(),n=body?body.split(/\s+/u).length:0;
   const ws=parseFloat(p.style?.wordSpacing||'0')||0;
   return {width:n?n*10+(n-1)*(2+ws):0,height:10,topInset:0};
  }
 };
 const input=[{id:'tail-cache',text,runs:[],mainRefs:[],continuesAfter:true}];
 const strips=[{x:0,width:54,y_start:0,y_end:30}];

 const first=layoutV9MainParagraphs(input,strips,ctx,30);
 const firstCalls=measureCalls;
 measureCalls=0;
 const second=layoutV9MainParagraphs(input,strips,ctx,30);
 const secondCalls=measureCalls;

 assert.deepEqual(second,first,'cached exact-tail search changed the plan');
 assert(firstCalls>secondCalls,
  `memoization did not reduce measurements: first=${firstCalls}, second=${secondCalls}`);
 assert.equal(first.lines.map(l=>l.sourceText).join(''),text);
 assert.equal(second.lines.map(l=>l.sourceText).join(''),text);
});

test('dropped opening wider than its physical host skips decoration without losing source',()=>{
 const source='OPEN aa aa aa aa aa';
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:()=>({position:'dropped',start:0,end:4,marks:{fontSize:50},dropLines:2,gapPx:2}),
  measure:p=>{
   if((p.runs||[]).some(r=>Number(r?.marks?.fontSize)===50)){
    return {width:180,height:50,topInset:0};
   }
   const body=String(p.text||'').trim();
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const plan=layoutV9MainParagraphs(
  [{id:'too-wide-opening',text:source,runs:[],mainRefs:[]}],
  [{x:0,width:100,y_start:0,y_end:120}],ctx,120
 );
 assert.equal(plan.overflowParagraphs.length,0,'too-wide opening pushed the whole paragraph to overflow');
 assert(plan.lines.length>0,'too-wide opening produced no normal fallback rows');
 assert.equal(plan.lines.map(l=>l.sourceText).join(''),source,'too-wide fallback changed source text');
 assert(!plan.lines.some(l=>l.render?.opening),'impossible dropped opening was still attached');
 const diag=plan.diagnostics.find(d=>d.code==='opening-skipped-too-wide');
 assert(diag,'too-wide opening did not record its fallback');
 assert(diag.openingWidth>diag.availableWidth,
  `fallback diagnostic is not physically justified: ${JSON.stringify(diag)}`);
});

test('dropped opening does not keep a widened row trapped in the previous narrow geometry',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:e=>e.id==='opening-after-knee'
    ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}
    : null,
  measure:p=>{
   const body=String(p.text||'');
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const words=body.trim()?body.trim().split(/\s+/u):[];
   return {width:words.length?words.length*10+(words.length-1)*2:0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs([
   {id:'lead',text:'pre',runs:[],mainRefs:[]},
   {id:'opening-after-knee',text:'OPEN aa aa aa aa aa',runs:[],mainRefs:[]},
 ],[
   {x:0,width:50,y_start:0,y_end:15},
   {x:0,width:100,y_start:15,y_end:100},
 ],ctx,100);

 const openingLine=p.lines.find(l=>l.sourceText.includes('OPEN'));
 assert(openingLine,'fixture lost the opening word');
 assert(!openingLine.render?.opening,
   'unsafe dropped opening remained attached across a changing right edge');
 assert(p.lines.some(l=>(l.runs||[]).some(r=>Number(r.marks?.fontSize)===20)),
   'opening style was lost when falling back to raised/inline');
 const widened=p.lines.find(l=>l.y>=20-.01 && l.width>70);
 assert(widened,
   `opening still trapped the widened row in old geometry: ${p.lines.map(l=>`${l.y}:${l.width}`).join(',')}`);
 assert(p.diagnostics.some(d=>d.code==='opening-raised-at-right-edge-transition'),
   'transition fallback was not diagnosed');
 assert.equal(p.lines.map(l=>l.sourceText).join(''),'preOPEN aa aa aa aa aa');
});



test('dropped opening uses newly freed left width across an RTL fixed-right-edge knee',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:e=>e.id==='left-knee-opening'
    ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}
    : null,
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs([
  {id:'lead-left-knee',text:'pre',runs:[],mainRefs:[]},
  {id:'left-knee-opening',text:'OPEN aa aa aa aa aa aa aa aa aa aa aa aa',runs:[],mainRefs:[]},
 ],[
  {x:50,width:50,y_start:0,y_end:15},
  {x:0,width:100,y_start:15,y_end:100},
 ],ctx,100);

 const host=p.lines.find(l=>l.render?.opening);
 assert(host,'dropped opening disappeared at fixed-right-edge widening');
 assert(Math.abs(host.y-10)<.01,`fixture opening y=${host.y}, expected 10`);
 assert(!p.diagnostics.some(d=>d.code==='opening-raised-at-right-edge-transition'),
  'fixed RTL right edge was incorrectly treated as unsafe');

 const secondWindow=p.lines.find(l=>l.y>=20-.01&&l.y<30-.01);
 assert(secondWindow,'fixture has no second opening-window row');
 assert(secondWindow.openingWindow===true,'second row lost opening-window metadata');
 assert(secondWindow.width>60,
  `newly freed left width was not used: width=${secondWindow.width}`);

 const afterOpening=p.lines.find(l=>l.y>=30-.01);
 assert(afterOpening,'fixture has no row after opening window');
 assert(afterOpening.width>=99,
  `row after opening stayed trapped at old narrow width: ${afterOpening.width}`);
});

test('off-grid narrow→wide boundaries preserve one continuous row grid across many offsets',()=>{
 const pitch=10;
 const ctx={
  fontSize:10,
  lineHeight:pitch,
  describeOpening:()=>null,
  measure:part=>{
   const body=String(part?.text||'').trim();
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:pitch,topInset:0};
  }
 };
 const text=Array(80).fill('aa').join(' ');
 const boundaries=[1.25,3.5,6.75,9.5,10.25,12.5,15.5,19.75,20.25,24.5,29.5,33.25];

 for(const boundary of boundaries){
  const plan=layoutV9MainParagraphs(
   [{id:`grid-${boundary}`,text,runs:[],mainRefs:[]}],
   [
    {x:50,width:50,y_start:0,y_end:boundary,lockYStart:false},
    {x:0,width:100,y_start:boundary,y_end:140,lockYStart:false},
   ],
   ctx,
   140
  );
  assert(plan.lines.length>=4,`boundary ${boundary}: fixture produced too few rows`);

  const lines=[...plan.lines].sort((a,b)=>a.y-b.y);
  for(let i=1;i<lines.length;i++){
   const dy=lines[i].y-lines[i-1].y;
   assert(Math.abs(dy-pitch)<.001,
    `boundary ${boundary}: row-grid gap/collapse at ${lines[i-1].y}->${lines[i].y}, dy=${dy}`);
  }

  const expectedWideY=Math.ceil(boundary/pitch)*pitch;
  const firstWide=lines.find(l=>l.width>90);
  assert(firstWide,`boundary ${boundary}: no wide continuation row`);
  assert(Math.abs(firstWide.y-expectedWideY)<.001,
   `boundary ${boundary}: wide row started at ${firstWide.y}, expected next grid baseline ${expectedWideY}`);

  const prev=lines[lines.indexOf(firstWide)-1];
  if(prev){
   assert(prev.width<60,
    `boundary ${boundary}: row crossing the knee widened early at y=${prev.y}, width=${prev.width}`);
   assert(Math.abs(firstWide.y-prev.y-pitch)<.001,
    `boundary ${boundary}: blank slot before first wide row`);
  }

  for(const line of lines){
   const crosses=line.y<boundary && line.y+pitch>boundary;
   if(crosses){
    assert(line.width<60,
     `boundary ${boundary}: straddling row must stay narrow, got width=${line.width}`);
   }
  }
 }
});

test('opening that starts after a knee occupies the complete wide visual row',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:e=>e.id==='opening-after-left-knee'
    ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}
    : null,
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs([
  {id:'lead-two-rows',text:'aa aa aa aa aa aa',runs:[],mainRefs:[]},
  {id:'opening-after-left-knee',text:'OPEN aa aa aa aa aa aa aa aa',runs:[],mainRefs:[]},
 ],[
  {x:50,width:50,y_start:0,y_end:15},
  {x:0,width:100,y_start:15,y_end:100},
 ],ctx,100);

 const host=p.lines.find(l=>l.render?.opening);
 assert(host,'opening after knee was unexpectedly raised or lost');
 assert(host.y>=20-.01,`opening did not start in wide region: y=${host.y}`);
 const totalVisual=host.width+host.render.opening.gap+host.render.opening.width;
 assert(Math.abs(totalVisual-100)<.01,
  `wide host row was effectively half-width: body=${host.width}, opening=${host.render.opening.width}, gap=${host.render.opening.gap}, total=${totalVisual}`);
 assert(host.x<1,`wide host body did not start at full left edge: x=${host.x}`);
});

test('single-line opening after a widening knee centers the complete visual segment in the wide row',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:e=>e.id==='center-after-knee'
    ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}
    : null,
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs([
  {id:'lead-center-knee',text:'aa aa aa aa aa aa',runs:[],mainRefs:[]},
  {id:'center-after-knee',text:'OPEN aa',runs:[],mainRefs:[]},
 ],[
  {x:50,width:50,y_start:0,y_end:15},
  {x:0,width:100,y_start:15,y_end:100},
 ],ctx,100);
 const line=p.lines.find(l=>l.source?.paragraphId==='center-after-knee');
 assert(line?.render?.opening,'opening after knee missing');
 assert(line.isLast===true,'fixture opening row is not paragraph last line');
 assert(line.y>=20-.01,`opening did not start in wide area: y=${line.y}`);
 assert.equal(line.render.alignment,'right',
  'body was centered separately from opening');
 const total=line.width+line.render.opening.gap+line.render.opening.width;
 assert(Math.abs(total-32)<.01,`unexpected composite width: ${total}`);
 assert(Math.abs(line.x-34)<.01,`composite x=${line.x}, expected 34 in 100px row`);
 assert(Math.abs(line.render.opening.x-46)<.01,
  `opening x=${line.render.opening.x}, expected 46`);
});

test('centered hard-break line centers opening plus body as one visual segment',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:()=>({position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}),
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs(
  [{id:'opening-hard-break',text:'OPEN aa\n',runs:[],mainRefs:[]}],
  [{x:0,width:100,y_start:0,y_end:100}],ctx,100
 );
 assert.equal(p.lines.length,1);
 const line=p.lines[0];
 assert(line.render.opening,'opening glyph missing');
 assert.equal(line.forcedBreak,true);
 assert.equal(line.render.alignment,'right',
   'hard-break body was centered independently instead of centering the opening+body segment');
 assert(Math.abs(line.x-34)<.01,`combined segment x=${line.x}, expected 34`);
 assert(Math.abs(line.width-10)<.01,`combined body width=${line.width}, expected natural width 10`);
 assert(Math.abs(line.render.opening.x-46)<.01,
   `opening x=${line.render.opening.x}, expected 46 for centered composite`);
});

test('second and final opening-window row shares the paragraph centre without moving its opening',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:()=>({position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}),
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs(
  [{id:'opening-two-line-last',text:'OPEN aa aa aa aa aa aa aa',runs:[],mainRefs:[]}],
  [{x:0,width:100,y_start:0,y_end:100}],ctx,100
 );
 assert.equal(p.lines.length,2,`fixture expected two text rows, got ${p.lines.length}`);
 const host=p.lines[0],last=p.lines[1];
 assert(host.render.opening,'opening glyph missing');
 assert(last.isLast===true,'second row is not paragraph last row');
 assert(last.openingWindow===true,'last row no longer overlaps opening window');
 assert.equal(last.render.alignment,'center','last body was pushed to an edge');
 const opening=host.render.opening;
 assert.equal(last.x,45,'last row did not use the full paragraph frame');
 assert.equal(last.width,last.naturalWidth,'last row box differs from its measured text');
 assert.equal(last.openingParagraphCentered,true);
 assert.equal(host.x,0,'first row moved');
 assert.equal(host.width,78,'first row lost the opening reservation');
 assert.equal(opening.x,80,'opening moved');
 const bodyLeft=last.x+(last.width-last.naturalWidth)/2;
 const bodyRight=bodyLeft+last.naturalWidth;
 assert(Math.abs((bodyLeft+bodyRight)/2-50)<.01,
  'last row is not centered in the complete paragraph');
 assert(bodyLeft>0,'last row was pinned to the left edge');
 assert(bodyRight<=opening.x-opening.gap,'last row overlaps the opening or its gap');
 assert.equal(last.render.wordSpacing,0,'last row was stretched');
 assert.notEqual(last.openingCompositeCentered,true,'opening counted a second time on the last row');
});


test('opening after a widening knee stays on the wide host across boundary/drop-line matrix',()=>{
 const boundaries=[2.5,5,7.5,12.5,15,17.5,22.5,27.5,32.5,37.5];
 const openingWidths=[16,24,36];
 const dropLinesList=[2,3,4];
 const preRowsList=[0,1,2,3,4,5];

 for(const boundary of boundaries){
  for(const openingWidth of openingWidths){
   for(const dropLines of dropLinesList){
    for(const preRows of preRowsList){
     const pitch=10;
     const ctx={
      fontSize:10,lineHeight:pitch,
      describeOpening:e=>e.id==='matrix-opening'
        ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines,gapPx:2}
        : null,
      measure:p=>{
       const body=String(p.text||'').trim();
       if(body==='OPEN')return {width:openingWidth,height:10,topInset:0};
       const n=body?body.split(/\s+/u).length:0;
       return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
      }
     };
     const entries=[];
     for(let i=0;i<preRows;i++)entries.push({id:`pre-${i}`,text:'aa',runs:[],mainRefs:[]});
     entries.push({
      id:'matrix-opening',
      text:'OPEN '+Array(18).fill('aa').join(' '),
      runs:[],mainRefs:[]
     });

     const p=layoutV9MainParagraphs(entries,[
      {x:50,width:50,y_start:0,y_end:boundary,lockYStart:false},
      {x:0,width:100,y_start:boundary,y_end:180,lockYStart:false},
     ],ctx,180);

     const host=p.lines.find(l=>l.source?.paragraphId==='matrix-opening'&&l.render?.opening);
     assert(host,`missing opening: boundary=${boundary} width=${openingWidth} drop=${dropLines} preRows=${preRows}`);

     if(host.y>=boundary-.001){
      assert(host.openingHostFullWidth>=99.9,
       `opening fell back to narrow host after knee: boundary=${boundary} y=${host.y} host=${host.openingHostFullWidth} width=${openingWidth} drop=${dropLines} preRows=${preRows}`);
      assert((host.render.opening.x+host.render.opening.width)>=99.9,
       `opening no longer reaches wide host edge after knee: boundary=${boundary} y=${host.y} openingRight=${host.render.opening.x+host.render.opening.width}`);
      const availableBodyWidth=host.render.opening.x-host.render.opening.gap-(host.openingHostX||0);
      assert(availableBodyWidth>50,
       `opening created a half-width body slot in wide region: boundary=${boundary} y=${host.y} bodySlot=${availableBodyWidth} openingWidth=${openingWidth}`);
     }

     const paragraphLines=p.lines
      .filter(l=>l.source?.paragraphId==='matrix-opening')
      .sort((a,b)=>a.y-b.y);
     for(let i=1;i<paragraphLines.length;i++){
      const prev=paragraphLines[i-1],cur=paragraphLines[i];
      const prevPitch=Number(prev.lineHeightPx)||pitch;
      const dy=cur.y-prev.y;
      assert(Math.abs(dy-prevPitch)<.01,
       `opening paragraph lost row-grid continuity: boundary=${boundary} prevY=${prev.y} y=${cur.y} dy=${dy} pitch=${prevPitch}`);
     }

     // A row that STARTS before the knee but extends across it is deliberately
     // narrow. That is the user's required "one more narrow row". Only rows
     // whose entire row starts at/after the knee must use the wide host.
     for(const row of paragraphLines){
      if(row.y>=boundary-.001){
       assert(row.openingHostFullWidth>=99.9 || row.width>=99.9,
        `fully post-knee row stayed narrow: boundary=${boundary} y=${row.y} width=${row.width} host=${row.openingHostFullWidth}`);
      }
     }
    }
   }
  }
 }
});

test('dropped opening crossing a left-widening knee never traps later rows at half width',()=>{
 const pitch=10;
 const ctx={
  fontSize:10,lineHeight:pitch,
  describeOpening:e=>e.id==='opening-cross-knee'
    ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}
    : null,
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 for(const boundary of [1.25,3.5,6.75,9.5]){
  const p=layoutV9MainParagraphs(
   [{id:'opening-cross-knee',text:'OPEN '+Array(18).fill('aa').join(' '),runs:[],mainRefs:[]}],
   [
    {x:50,width:50,y_start:0,y_end:boundary,lockYStart:false},
    {x:0,width:100,y_start:boundary,y_end:120,lockYStart:false},
   ],ctx,120
  );
  const host=p.lines.find(l=>l.render?.opening);
  assert(host,`boundary ${boundary}: opening disappeared`);
  const windowRows=p.lines.filter(l=>l.openingWindow);
  assert(windowRows.length>=2,`boundary ${boundary}: expected two opening-window rows`);
  const second=windowRows[1];
  assert(second.width>70,
    `boundary ${boundary}: second opening row remained half width: width=${second.width}`);
  const after=p.lines.find(l=>l.y>=host.render.opening.y+host.render.opening.height-.01);
  assert(after,`boundary ${boundary}: missing row after opening`);
  assert(after.width>=99,
    `boundary ${boundary}: row after opening remained half width: width=${after.width}`);
 }
});


test('final row inside a dropped-opening window keeps normal last-line semantics',()=>{
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:()=>({position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines:2,gapPx:2}),
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
  }
 };
 let plan=null;
 for(let words=3;words<=12;words++){
  const text='OPEN '+Array(words).fill('aa').join(' ');
  const candidate=layoutV9MainParagraphs(
   [{id:'opening-window-center',text,runs:[],mainRefs:[]}],
   [{x:0,width:100,y_start:0,y_end:100}],ctx,100
  );
  if(candidate.lines.length===2&&candidate.lines[1].isLast&&candidate.lines[1].openingWindow){
   plan=candidate;break;
  }
 }
 assert(plan,'fixture did not end on second opening-window row');
 const host=plan.lines.find(l=>l.render?.opening);
 const last=plan.lines.at(-1);
 assert(host?.render?.opening,'opening missing');
 assert.equal(last.render.alignment,'center','final body row has special edge alignment');
 assert.notEqual(last.openingCompositeCentered,true,'the opening is not owned by this row');
 const freeRight=host.render.opening.x-host.render.opening.gap;
 assert.equal(last.openingParagraphCentered,true);
 assert.equal(last.x,45);
 assert.equal(last.width,last.naturalWidth);
 assert.equal(host.x,0,'first row moved');
 assert.equal(host.width,78,'first row lost its original slot');
 assert.equal(host.render.opening.x,80,'opening moved');
 assert.equal(last.render.wordSpacing,0,'last row was stretched');
 const bodyLeft=last.x+(last.width-last.naturalWidth)/2;
 assert(Math.abs((bodyLeft+last.naturalWidth/2)-50)<.001,
  'last body row is not centered inside the full paragraph');
 assert(bodyLeft+last.naturalWidth<=freeRight+.001,'last body overlaps the opening');
});

test('opening-word rows remain one paragraph: redistribute first, then finish exact justification',()=>{
 const text='OPEN aa aa aa aa aa aa';
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:()=>({position:'dropped',start:0,end:4,marks:{},dropLines:2,gapPx:2}),
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   const ws=parseFloat(p.style?.wordSpacing||'0')||0;
   return {width:n?n*10+(n-1)*(2+ws):0,height:10,topInset:0};
  }
 };
 const p=layoutV9MainParagraphs(
  [{id:'opening-tail',text,runs:[],mainRefs:[],continuesAfter:true}],
  [{x:0,width:54,y_start:0,y_end:30}],ctx,30
 );
 assert.equal(p.lines.length,3);
 assert.ok(p.lines[0].render.opening,'opening glyph was lost during tail rebalance');
 assert.equal(p.lines[0].render.opening.part.text,'OPEN');
 assert.equal(p.lines[0].openingWindow,true);
 assert.equal(p.lines[1].openingWindow,true);
 assert.ok(p.lines.every(l=>l.tailRebalanced===true),'opening/window rows were split out of the paragraph rebalance');
 assert(!p.lines[0].render.body.text.includes('OPEN'),'opening text was duplicated into the body span');
 assert.equal(p.lines.map(l=>l.sourceText).join(''),text);
 assert.deepEqual(p.lines.map(l=>l.wordTokens.length),[2,2,2]);
 assert.deepEqual(p.lines.map(l=>l.render.wordSpacing),[10,10,32]);
 assert.ok(p.lines.every(l=>l.tailWordSpacingFallbackStretched),'fixture should prove the no-more-words fallback beside and below the opening');
 assert.ok(p.lines.every(l=>l.tailWordSpacingCapped===false));
 assert.equal(p.diagnostics.find(d=>d.code==='paragraph-tail-rebalanced')?.fallbackStretchedRows,3);
});

test('continuation tail rebalance starts only after the last explicit source line break',()=>{
 const text='aa aa aa aa\naa aa aa aa aa aa';
 const ctx={
  fontSize:10,lineHeight:10,describeOpening:()=>null,
  measure:p=>{const body=String(p.text||'').trim(),n=body?body.split(/\s+/u).length:0;return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};}
 };
 const p=layoutV9MainParagraphs(
  [{id:'tail-after-break',text,runs:[],mainRefs:[],continuesAfter:true}],
  [{x:0,width:54,y_start:0,y_end:30}],ctx,30
 );
 assert.equal(p.lines.length,3);
 assert.equal(p.lines[0].forcedBreak,true);
 assert.notEqual(p.lines[0].tailRebalanced,true);
 assert.deepEqual(p.lines.slice(1).map(l=>l.wordTokens.length),[3,3]);
 assert.ok(p.lines.slice(1).every(l=>l.tailRebalanced===true));
 assert.equal(p.lines.map(l=>l.sourceText).join(''),text);
});

test('note ownership requires a body word, not only a note number',()=>{
 const nodes=[{kind:'number',text:'[1] '},{kind:'lemma',text:'alpha'},{kind:'rest',text:' beta'}],runs=markV9NoteRuns('[1] alpha beta',[],nodes,{_v9NoteKey:'k'});
 assert.equal(runs.find(r=>r.marks.v9NoteStart).start,4);
 const required=[{key:'k'}];
 assert.equal(auditV9NoteStarts({streamBoxes:[{lines:[{runs:[{start:0,end:4,marks:{v9NoteKey:'k'}}]}]}]},required).length,1);
 assert.equal(auditV9NoteStarts({streamBoxes:[{lines:[{runs}]}]},required).length,0);
 assert.equal(scoreV9PageCandidate({unstartedNotes:required},{},{}).accept,false);
});

for (const [raw, expected] of [['al@01pha','alpha'],['al@01@02pha','alpha'],['alpha,@01beta','alpha,beta'],['alpha @01 beta','alpha beta'],['א@01ב','אב']]) test(`reference removal never invents spaces: ${raw}`,()=>{
 const mapped=mapMainParagraphSource(raw,[],markers(raw)); assert.equal(mapped.mainTextNet,expected);
});
test('hidden reference collapses Word NBSP/thin-space residue to one ordinary separator',()=>{
 const cases=[
  ['alpha\u00a0@01\u00a0beta','alpha beta'],
  ['alpha\u202f@01\u2009beta','alpha beta'],
  ['alpha\u3000@01\tbeta','alpha beta'],
  ['א\u00a0@01\u202fב','א ב'],
 ];
 for(const [raw,expected] of cases){
  const mapped=mapMainParagraphSource(raw,[],markers(raw));
  assert.equal(mapped.mainTextNet,expected,JSON.stringify(raw));
  assert(!/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u.test(mapped.mainTextNet),
    `hidden marker left a Unicode blank slot: ${JSON.stringify(mapped.mainTextNet)}`);
 }
});

test('nested reference removal preserves adjacent text and explicit whitespace',()=>{
 const r=mapMainParagraphSource('a@01b  c',[],[{atInPara:1,sym:'@01',code:'01'}],{normalize:false});assert.equal(r.mainTextNet,'ab  c');
 const visible=mapMainParagraphSource('a@01b',[],[{atInPara:1,sym:'@01',code:'01',replaceWith:'[1]'}],{normalize:false});assert.equal(visible.mainTextNet,'a[1]b');
});

test('stream conservation verifies both columns and refuses a missing or reordered suffix',()=>{
 const streams=[{id:'01',rich:{text:'alpha ',runs:[]}},{id:'01',rich:{text:'beta gamma',runs:[]}}];
 const plan={streamBoxes:[{id:'01',lines:[{text:'alpha '}]},{id:'01',lines:[{text:'beta '}]}],overflow:{streams:{'01':{text:'gamma',runs:[]}}}};
 assert.deepEqual(verifyV9StreamCoverage(streams,plan),[{stream:'01',inputCharacters:16,plannedCharacters:11,remainingCharacters:5,exact:true}]);
 plan.overflow.streams['01'].text='';
 assert.throws(()=>verifyV9StreamCoverage(streams,plan),/V9_STREAM_SOURCE_MISMATCH/);
});
