import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutV9MainParagraphs, partForRange } from '../../src/engine/v9_main_inline_layout.js';
import { prepareV9SourceParagraph, sliceV9Paragraph, sourceMetadata } from '../../src/engine/v9_source_fragments.js';

function context(open = true) {
  return { lineHeight: 10, fontSize: 10,
    describeOpening: e => open && !e.continues ? {start:0,end:e.text.split(/\s/)[0].length,position:'dropped',dropLines:2,gapPx:2,marks:{bold:true}} : null,
    measure: p => ({width:[...p.text].length*5+(p.refs?.length||0)*3,height:10,topInset:0}),
  };
}
const strip = [{x:0,width:100,y_start:0,y_end:100}];

test('an opening-only paragraph owns a terminal reference once', () => {
  const e={id:'one',text:'alpha',runs:[],mainRefs:[{anchor:5,uid:'end'}]};
  const p=layoutV9MainParagraphs([e],strip,context(),100);
  const refs=p.lines.flatMap(l=>[...(l.render.opening?.part.refs||[]),...l.render.body.refs]);
  assert.equal(refs.filter(r=>r.uid==='end').length,1);
  assert.equal(p.lines.map(l=>l.sourceText).join(''),e.text);
});

test('zero-length painted parts do not steal boundary anchors', () => {
  assert.deepEqual(partForRange({text:'one',mainRefs:[{anchor:3}]},3,3).refs,[]);
});

test('unsorted reference inputs paint in source order without changing caller', () => {
  const refs=[{anchor:7,uid:'later'},{anchor:1,uid:'earlier'}];
  const p=partForRange({text:'one two three',mainRefs:refs},0,13);
  assert.deepEqual(p.refs.map(r=>r.uid),['earlier','later']);
  assert.deepEqual(refs.map(r=>r.uid),['later','earlier']);
});

test('a large glyph reserves its actual height even with one requested row', () => {
  const c=context();c.describeOpening=()=>({start:0,end:1,position:'dropped',dropLines:1,gapPx:2,marks:{}});
  c.measure=p=>({width:p.text.length*5,height:p.text.length===1?25:10,topInset:0});
  const p=layoutV9MainParagraphs([{id:'first',text:'a bc de fg hi jk lm no pq',runs:[],mainRefs:[]}],strip,c,100);
  assert.equal(p.lines[0].render.opening.height,25);
  const beside=p.lines.filter(l=>l.y<25);assert.ok(beside.every(l=>l.x+l.width<=93));
});

test('random paragraph carry-over preserves every canonical code unit exactly once', () => {
  for(let seed=1;seed<=50;seed++) {
    const e={id:`random-${seed}`,text:Array.from({length:seed+3},(_,i)=>`x${i%9}`).join(seed%2?' ':'\n'),runs:[],mainRefs:[]};
    let remaining=[e],all=[],guard=0;
    while(remaining.length&&guard++<100){const p=layoutV9MainParagraphs(remaining,[{x:3,width:40+seed%23,y_start:0,y_end:30}],context(),30);assert.ok(p.lines.length,'must progress');all.push(...p.lines);remaining=p.overflowParagraphs;}
    assert.equal(remaining.length,0);assert.equal(all.map(l=>l.sourceText).join(''),e.text);
    let cursor=0;for(const l of all){assert.equal(l.source.start,cursor);cursor=l.source.end;}assert.equal(cursor,e.text.length);
    assert.equal(all.filter(l=>l.render.opening).length,1);
  }
});

test('source-index and heading identity survive page fragments', () => {
  const p=prepareV9SourceParagraph({id:'heading-7',isHeading:true,mainText:'one two three'},6);
  const q=sliceV9Paragraph(p,4,13);
  assert.equal(q.isHeading,true);assert.equal(q._v9Source.index,7);
  assert.equal(q._v9Source.blockType,'heading');
  assert.equal(q._v9Source.headingLevel,1);
  assert.deepEqual(sourceMetadata({source:q._v9Source,sourceOffset:4,continues:true},0,9),{
    paragraphId:'heading-7',paragraphIndex:7,start:4,end:13,rawStart:4,rawEnd:13,
    paragraphStart:false,continuation:true,blockType:'heading',headingLevel:1,domain:'canonical-main-utf16'});
});

test('plans do not allocate a line in a gap or consume text when all slots are absent', () => {
  const e={id:'gap',text:'one two',runs:[],mainRefs:[]};
  const p=layoutV9MainParagraphs([e],[{x:0,width:90,y_start:0,y_end:5},{x:0,width:90,y_start:6,y_end:9}],context(false),9);
  assert.equal(p.lines.length,0);assert.equal(p.overflowParagraphs[0].text,e.text);
});
