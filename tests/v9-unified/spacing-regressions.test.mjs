import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMainParagraphSource } from '../../src/engine/main_source_mapping.js';
import { prepareV9SourceParagraph,splitV9Paragraph,joinV9ParagraphFragments,sliceV9Paragraph } from '../../src/engine/v9_source_fragments.js';
import { splitMainTextAtOffset,splitNotesByAnchor,scoreV9PageCandidate,hasUnsafeV9StreamOverflow,selectV9GapFillCandidates,getLastMainLineInfo,isV9WhitespaceBreakBoundary,buildParagraphBreakCandidates } from '../../src/engine/v9_split_policy.js';
import { partForRange,layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';
import { splitV9StreamAtWordCount } from '../../src/engine/v9_stream_inline_layout.js';
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


test('page-ending continuation rebalances the paragraph tail instead of rubber-stretching one row',()=>{
 const text=Array(10).fill('aa').join(' ');
 const ctx={
  fontSize:10,lineHeight:10,describeOpening:()=>null,
  measure:p=>{const body=String(p.text||'').trim(),n=body?body.split(/\s+/u).length:0;return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};}
 };
 const p=layoutV9MainParagraphs(
  [{id:'tail-balance',text,runs:[],mainRefs:[],continuesAfter:true}],
  [{x:0,width:54,y_start:0,y_end:30}],ctx,30
 );
 assert.equal(p.lines.length,3);
 assert.deepEqual(p.lines.map(l=>l.wordTokens.length),[4,3,3]);
 assert.ok(p.lines.every(l=>l.tailRebalanced===true));
 assert.equal(p.lines.map(l=>l.sourceText).join(''),text);
 assert.ok(Math.max(...p.lines.map(l=>l.render.wordSpacing))<=6.5001,
  `tail spacing was not gently capped: ${p.lines.map(l=>l.render.wordSpacing).join(',')}`);
 assert.ok(p.diagnostics.some(d=>d.code==='paragraph-tail-rebalanced'));
});

test('opening-word host row and following window row belong to the same tail rebalance',()=>{
 const text='OPEN aa aa aa aa aa aa';
 const ctx={
  fontSize:10,lineHeight:10,
  describeOpening:()=>({position:'dropped',start:0,end:4,marks:{},dropLines:2,gapPx:2}),
  measure:p=>{
   const body=String(p.text||'').trim();
   if(body==='OPEN')return {width:20,height:10,topInset:0};
   const n=body?body.split(/\s+/u).length:0;
   return {width:n?n*10+(n-1)*2:0,height:10,topInset:0};
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
 assert.ok(Math.max(...p.lines.map(l=>l.render.wordSpacing))<=6.5001,
  `opening paragraph tail was not gently distributed: ${p.lines.map(l=>l.render.wordSpacing).join(',')}`);
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
