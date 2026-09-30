import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalMainText, prepareV9SourceParagraph, sliceV9Paragraph, splitV9Paragraph, joinV9ParagraphFragments } from '../../src/engine/v9_source_fragments.js';
import { layoutV9MainParagraphs, rowGeometry, partForRange } from '../../src/engine/v9_main_inline_layout.js';
import { extractOpeningSegmentForTest, openingWordSkipReason } from '../../src/opening_word.js';
import { splitMainTextAtOffset, buildV9SplitPolicy, buildParagraphBreakCandidates } from '../../src/engine/v9_split_policy.js';
import { mapMainParagraphSource } from '../../src/engine/main_source_mapping.js';

const strips = [{ x: 0, width: 90, y_start: 0, y_end: 300 }];
const makeEntry = (text, extras = {}) => ({ id: 'p1', index: 1, text, runs: [], mainRefs: [], typography: { fontSize: '10px' }, ...extras });
const makeContext = (opening = null) => ({ fontSize: 10, lineHeight: 10,
  describeOpening: e => e.continues || e._v9OpeningWordAllowed === false ? null : (typeof opening === 'function' ? opening(e) : opening),
  measure: part => ({ width: part.text.length * 5 + (part.refs || []).length * 4, height: 10, topInset: 0 }) });
const opw = { start: 0, end: 3, marks: { fontSize: 20 }, position: 'dropped', dropLines: 2, gapPx: 2 };
const plan = (text, opening = opw, ss = strips, bottom = 300, extras = {}) => layoutV9MainParagraphs([makeEntry(text, extras)], ss, makeContext(opening), bottom);
function checkSource(input, result) {
  const actual = result.lines.map(l => l.sourceText).join('') + result.overflowParagraphs.map(p => p.text).join('');
  assert.equal(actual, input);
  let at = 0;
  for (const l of result.lines) { assert.equal(l.source.start, at); assert.equal(l.source.end - l.source.start, l.sourceText.length); at = l.source.end; }
}
function checkGeometry(p) {
  for (const l of p.lines) {
    assert.ok(Number.isFinite(l.x + l.y + l.width + l.lineHeightPx));
    assert.ok(l.naturalWidth <= l.width + 1/64);
    if (l.openingWindow && !l.render.opening && p.lines[0]?.render.opening) {
      const o = p.lines[0].render.opening;
      assert.ok(l.x + l.width <= o.x - o.gap + 1/64);
    }
  }
}


test('legacy audit: default page-split policy never falls back to an arbitrary word gap', () => {
  const metrics = { spaceWidth: 1, measureWord: word => String(word).length };
  const text = 'aaaa bbbb cccc dddd eeee ffff';
  const policy = buildV9SplitPolicy({ preventMidLineSplit: true });
  const normal = buildParagraphBreakCandidates(text, metrics, 10, policy, { source: 'legacy-audit' });
  const emergency = buildParagraphBreakCandidates(text, metrics, 10, policy, { source: 'legacy-audit', emergency: true });
  assert.ok(normal.length > 0, 'fixture produced no legal line-end candidates');
  assert.ok(normal.every(c => c.kind !== 'word-gap'), 'normal split exposed an arbitrary word-gap candidate');
  assert.ok(emergency.every(c => c.kind !== 'word-gap'), 'emergency split ignored the default no-mid-line policy');
});

test('B3: punctuation spacing remains part of the finalized line source', () => {
  const text='אבג, דהו. זחט; יכל: מנס';
  const r=layoutV9MainParagraphs([makeEntry(text)], [{x:0,width:300,y_start:0,y_end:40}], makeContext(null), 40);
  assert.equal(r.lines.length,1);
  assert.equal(r.lines[0].render.body.text,text);
  assert.match(r.lines[0].render.body.text, /, |\. |; |: /u);
});

test('B12: a removed main-note marker maps its label to the exact original boundary', () => {
  const raw='אבג@01דהו זחט';
  const mapped=mapMainParagraphSource(raw,[],[{atInPara:3,sym:'@01',code:'01'}]);
  assert.equal(mapped.mainTextNet,'אבגדהו זחט');
  assert.equal(mapped.mainConsumers.length,1);
  assert.equal(mapped.mainConsumers[0].anchor,3);
  assert.equal(mapped.mainConsumers[0].anchorAffinity,'backward');
  const part=partForRange({
    text:mapped.mainTextNet,runs:[],
    mainRefs:[{...mapped.mainConsumers[0],uid:'exact-ref',num:1,formatted:'1'}],
    typography:{fontSize:'10px'}
  },0,mapped.mainTextNet.length,mapped.mainTextNet.length);
  assert.equal(part.refs[0].localPos,3);
  assert.equal(part.text.slice(0,part.refs[0].localPos),'אבג');
  assert.equal(part.text.slice(part.refs[0].localPos),'דהו זחט');
});

test('C8: widening from a narrow strip repacks the first wide row with following words', () => {
  const text='aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
  const widening=[
    {x:60,width:40,y_start:0,y_end:20},
    {x:0,width:100,y_start:20,y_end:100}
  ];
  const r=layoutV9MainParagraphs([makeEntry(text)],widening,makeContext(null),100);
  assert.ok(r.lines.length>=4,'fixture did not span narrow and wide strips');
  const firstWide=r.lines.find(l=>l.y>=20 && l.width>=99);
  assert.ok(firstWide,'no first wide row found');
  assert.ok(firstWide.wordTokens.length>=3,`wide row did not pull enough following text: ${firstWide.render.body.text}`);
  assert.ok(firstWide.naturalWidth/firstWide.width>=0.70,
    `first wide row remains visibly underfilled: ${firstWide.naturalWidth}/${firstWide.width}`);
});

test('opening skip policy is opt-in and uses measured layout facts', () => {
  assert.equal(openingWordSkipReason({}, {lineCount:1,complete:true,firstLineFill:0.2}), '');
  assert.equal(openingWordSkipReason({skipSingleLine:true}, {lineCount:1,complete:true,firstLineFill:1}), 'single-line');
  assert.equal(openingWordSkipReason({skipFewerThanLines:true,minLines:3}, {lineCount:2,complete:true,firstLineFill:1}), 'fewer-than-lines');
  assert.equal(openingWordSkipReason({skipFewerThanLines:true,minLines:3}, {lineCount:2,complete:false,firstLineFill:1}), '');
  assert.equal(openingWordSkipReason({skipShortLine:true,shortLineMinFill:0.7}, {lineCount:4,complete:true,firstLineFill:0.69}), 'short-line');
});
test('V9 preview omits an opening on an opted-in one-row paragraph', () => {
  const opening={...opw,skipPolicy:{skipSingleLine:true,skipShortLine:false,skipFewerThanLines:false,minLines:3,shortLineMinFill:0.65}};
  const r=plan('abc def ghi',opening,[{x:0,width:160,y_start:0,y_end:100}],100);
  assert.equal(r.lines.length,1);
  assert.equal(r.lines[0].render.opening,null);
  assert.ok(r.diagnostics.some(d=>d.code==='opening-skipped-policy'&&d.reason==='single-line'));
});

test('V9 preview omits an opening when a complete paragraph has fewer than N rows', () => {
  const opening={...opw,skipPolicy:{skipSingleLine:false,skipShortLine:false,skipFewerThanLines:true,minLines:3,shortLineMinFill:0.65}};
  const r=plan('aaa bbb ccc ddd eee fff',opening,[{x:0,width:70,y_start:0,y_end:100}],100);
  assert.equal(r.lines.length,2);
  assert.ok(r.lines.every(l=>!l.render.opening));
  assert.ok(r.diagnostics.some(d=>d.code==='opening-skipped-policy'&&d.reason==='fewer-than-lines'));
});
test('canonical mapping retains explicit breaks, removes markers once', () => {
  const raw = '  @01alpha  beta\r\n gamma\t delta  ';
  const m = canonicalMainText(raw);
  assert.equal(m.text, 'alpha beta\ngamma delta');
  assert.equal(m.starts.length, m.text.length);
  for(let i=0;i<m.text.length;i++) assert.ok(m.ends[i]>m.starts[i]);
  assert.equal(m.starts[0], raw.indexOf('alpha'));
});
test('runs and reference anchors remap at ingress', () => {
  const raw = '@01alpha  beta';
  const p = prepareV9SourceParagraph({ mainText: raw, mainRuns: [{start:10,end:14,marks:{bold:true}}], notes:[{uid:'n',anchor:10,stream:'01'}]}, 3);
  assert.equal(p.mainText, 'alpha beta'); assert.equal(p.mainRuns[0].start,6); assert.equal(p.mainRefs[0].anchor,6);
  assert.equal(p._v9Source.index,4);
});
test('canonical text does not break combining marks or UTF16 surrogate pairs', () => {
  const t = 'שָׁלוֹם 😀 עולם'; const p=prepareV9SourceParagraph({mainText:t});
  assert.equal(p.mainText,t); assert.equal(p._v9Source.starts.length,t.length);
});
test('table text still enters V9',()=>{
  const p=prepareV9SourceParagraph({blockType:'table',tableRows:[['a','b'],['c','d']]});
  assert.equal(p.mainText,'a | b\nc | d');
});
test('fragment splits preserve every separator and all styles', () => {
  const p=prepareV9SourceParagraph({mainText:'alpha beta gamma',mainRuns:[{start:6,end:10,marks:{color:'red'}}],mainRefs:[{uid:'r',anchor:6}]});
  const halves=splitV9Paragraph(p,splitMainTextAtOffset(p.mainText,5),[],[]);
  assert.equal(halves.firstHalf.mainText+halves.secondHalf.mainText,p.mainText);
  assert.equal(halves.firstHalf._v9SourceEnd,halves.secondHalf._v9SourceOffset);
  assert.equal(halves.secondHalf.mainRuns[0].start,0); assert.equal(halves.secondHalf.mainRefs[0].anchor,0);
  assert.equal(halves.secondHalf._v9OpeningWordAllowed,false);
  const joined=joinV9ParagraphFragments(halves.firstHalf,halves.secondHalf,[]);
  assert.equal(joined.mainText,p.mainText);
});
test('fragment refs at shared and terminal boundaries appear exactly once',()=>{
  const p=prepareV9SourceParagraph({mainText:'abcd',mainRefs:[{uid:'a',anchor:2},{uid:'b',anchor:4}]});
  const a=sliceV9Paragraph(p,0,2),b=sliceV9Paragraph(p,2,4);
  assert.equal(a.mainRefs.length,0); assert.deepEqual(b.mainRefs.map(x=>x.uid),['a','b']);
});
test('join rejects different or nonadjacent paragraphs',()=>{
  const p=prepareV9SourceParagraph({mainText:'abcdef'}),q=prepareV9SourceParagraph({mainText:'uvwxyz'});
  assert.throws(()=>joinV9ParagraphFragments(sliceV9Paragraph(p,0,2),sliceV9Paragraph(q,2,4)));
  assert.throws(()=>joinV9ParagraphFragments(sliceV9Paragraph(p,0,2),sliceV9Paragraph(p,3,4)));
});
test('row geometry intersects a widening transition, without changing strips',()=>{
  const s=[{x:20,width:50,y_start:0,y_end:15},{x:0,width:100,y_start:15,y_end:100}];
  assert.deepEqual(rowGeometry(s,10,10,100),{x:20,width:50});
  assert.deepEqual(rowGeometry(s,20,10,100),{x:0,width:100});
});
test('row cannot bridge an unallocated gap',()=>{
  assert.equal(rowGeometry([{x:0,width:90,y_start:0,y_end:4},{x:0,width:90,y_start:6,y_end:20}],0,10,20),null);
});
test('planned drop cap and suffix preserve every source character',()=>{
  const t='abc def ghi jkl mno pqr stu vwx yz'; const r=plan(t); checkSource(t,r); checkGeometry(r);
  assert.equal(r.lines.filter(l=>l.render.opening).length,1);
});
test('explicit line and blank line breaks are not merged',()=>{
  const t='abc def\nghi\n\njkl'; const r=plan(t); checkSource(t,r);
  assert.equal(r.lines.filter(l=>l.forcedBreak).length,3);
  assert.ok(r.lines.every(l=>!l.render.body.text.includes('\n')));
});
for(let dropLines=1;dropLines<=8;dropLines++)test(`dropLines=${dropLines} reserves actual height`,()=>{
  const a=makeEntry('abc def'),b=makeEntry('new end',{id:'p2',index:2});
  const r=layoutV9MainParagraphs([a,b],strips,makeContext({...opw,dropLines}),300);
  assert.equal(r.lines.filter(l=>l.render.opening).length,2);
  assert.ok(r.lines.find(l=>l.source.paragraphId==='p2').y>=dropLines*10);
});
test('oversize opening does not silently shrink or discard source',()=>{
  const t='abcdefghijk suffix';const r=plan(t,{...opw,end:11},[{x:0,width:30,y_start:0,y_end:100}],100);
  assert.equal(r.overflowReason,'opening-wider-than-allocated-region'); assert.equal(r.lines.length,0);checkSource(t,r);
});
test('opening shorter than remainder still takes normal following rows',()=>{
  const r=plan('abc '+ 'def '.repeat(30).trim());checkGeometry(r);
  assert.equal(r.lines[0].openingWindow,true); assert.equal(r.lines[1].openingWindow,true);
  assert.equal(r.lines.at(-1).openingWindow,false);
});
test('letter suffix remains in same paragraph',()=>{
  const t='abcdef ghi';const r=plan(t,{...opw,end:1});checkSource(t,r);
  assert.equal(r.lines[0].render.opening.part.text,'a'); assert.ok(r.lines[0].render.body.text.startsWith('bcdef'));
});
test('source and runs survive repeated page overflow',()=>{
  const t='abc '+ 'def ghi jkl '.repeat(8).trim();let entries=[makeEntry(t,{runs:[{start:8,end:32,marks:{color:'red'}}]})],all=[];
  for(let i=0;i<40&&entries.length;i++){
    const r=layoutV9MainParagraphs(entries,[{x:0,width:50,y_start:0,y_end:30}],makeContext(opw),30);
    assert.ok(r.lines.length>0);all.push(...r.lines);entries=r.overflowParagraphs;
  }
  assert.equal(entries.length,0);assert.equal(all.map(l=>l.sourceText).join(''),t);
  assert.equal(all.filter(l=>l.render.opening).length,1);
  assert.ok(all.some(l=>l.render.body.runs.some(x=>x.marks.color==='red')));
  let at=0;for(const l of all){assert.equal(l.source.start,at);at=l.source.end;}
});
test('original paragraph identities survive carry-over',()=>{
  const a=makeEntry('abc def ghi jkl mno'),b=makeEntry('uvw xyz',{id:'p2',index:2});
  const r=layoutV9MainParagraphs([a,b],[{x:0,width:40,y_start:0,y_end:20}],makeContext(opw),20);
  assert.equal(r.overflowParagraphs.length,2);
  assert.equal(r.overflowParagraphs[0].continues,true);
  assert.equal(r.overflowParagraphs[1].continues,false);
  const r2=layoutV9MainParagraphs(r.overflowParagraphs,strips,makeContext(opw),300);
  assert.equal(r2.lines.filter(l=>l.render.opening).length,1);
  assert.equal(r2.lines.find(l=>l.render.opening).source.paragraphId,'p2');
});
test('refs are assigned exactly once, including opening and source whitespace',()=>{
  const t='abc def ghi jkl mno pqr';
  const refs=[0,3,4,7,8,12,t.length].map((anchor,i)=>({anchor,uid:`r${i}`,formatted:String(i)}));
  const r=plan(t,opw,strips,300,{mainRefs:refs});
  const found=r.lines.flatMap(l=>[...(l.render.opening?.part.refs||[]),...l.render.body.refs]).map(r=>r.uid);
  assert.deepEqual([...found].sort(),refs.map(r=>r.uid).sort());
});
test('body and opening retain independent inline marks',()=>{
  const t='abc def ghi';const r=plan(t,opw,strips,300,{runs:[{start:0,end:3,marks:{color:'blue'}},{start:4,end:11,marks:{italic:true}}]});
  assert.ok(r.lines[0].render.opening.part.runs.some(r=>r.marks.color==='blue'));
  assert.ok(r.lines[0].render.body.runs.some(r=>r.marks.italic));
});
test('plans are immutable but inputs remain unfrozen and unchanged',()=>{
  const e=makeEntry('abc def',{runs:[{start:4,end:7,marks:{bold:true}}]}),s=structuredClone(strips),before=JSON.stringify([e,s]);
  const r=layoutV9MainParagraphs([e],s,makeContext(opw),300);
  assert.equal(JSON.stringify([e,s]),before);assert.equal(Object.isFrozen(e.runs[0].marks),false);
  assert.ok(Object.isFrozen(r.lines[0].render.body));assert.throws(()=>{r.lines[0].width=1;});
});
test('raised opening takes part in the normal line plan',()=>{
  const t='abc def';const r=plan(t,{...opw,position:'raised'});checkSource(t,r);
  assert.equal(r.lines.filter(l=>l.render.opening).length,0);
  assert.ok(r.lines[0].render.body.runs.some(r=>r.marks.fontSize===20));
});
test('letter extraction uses one grapheme rather than entire word',()=>{
  const p=extractOpeningSegmentForTest('שָׁלוֹם עולם',{target:'letter',count:1});
  assert.equal(p.segment,'שָׁ');assert.equal(p.prefix+p.segment+p.suffix,'שָׁלוֹם עולם');
});
test('confirmed main geometry fix and final painter authority remain in source',()=>{
  const v9=fs.readFileSync(new URL('../../src/vilna_v9.js',import.meta.url),'utf8');
  assert.ok(v9.includes('const mainStrips = rawMainStrips;'));
  assert.ok(!v9.includes('const canFlow =')); assert.ok(!v9.includes('__skipNextLine'));
  assert.ok(!v9.includes('flowInput = makeRichText(model.flow'));
  assert.ok(v9.includes('renderV9PlannedMainLine(line, pageEl, padding)'));
});
