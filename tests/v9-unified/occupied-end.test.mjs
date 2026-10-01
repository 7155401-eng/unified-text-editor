import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutV9MainParagraphs} from '../../src/engine/v9_main_inline_layout.js';

const context=(opening=null)=>({
 fontSize:10,lineHeight:10,describeOpening:()=>opening,
 measure:part=>({width:part.text.length*5,height:part.runs?.some(r=>r.marks?.tall)?40:10,topInset:0})
});
function flow(text,strips,{runs=[],opening=null,options={},pageBottom=strips.at(-1)?.y_end||0,continuesAfter=false}={}){
 const entry={id:'source',text,runs,sourceOffset:12,mainRefs:[
  {uid:'hidden',anchor:Math.min(1,text.length),formatted:''},
  {uid:'tail',anchor:text.length,formatted:'[2]'}
 ],continuesAfter};
 const before=JSON.stringify({entry,strips,options});
 const result=layoutV9MainParagraphs([entry],strips,context(opening),pageBottom,options);
 assert.equal(JSON.stringify({entry,strips,options}),before,'source input mutated');
 assert.equal(result.lines.map(l=>l.sourceText).join('')+result.overflowText,text,'source order changed');
 const refs=[...result.lines.flatMap(l=>[...(l.render.opening?.part.refs||[]),...l.render.body.refs]),...result.overflowParagraphs.flatMap(e=>e.mainRefs)];
 // Whitespace-only source intentionally carries no painted/overflow line in the
 // existing planner; keep that legacy source-control fixture separate below.
 if(text.trim())assert.deepEqual(refs.map(r=>r.uid).sort(),['hidden','tail'],'anchor lost or repeated');
 return result;
}
for(const origin of [0,7,27.25])for(const prefix of ['', 'ok '])for(const lateWidth of [25,35,45]){
 test(`failed wider-slot attempts are not occupied content: ${origin}/${prefix.length}/${lateWidth}`,()=>{
  const p=flow(prefix+'X'.repeat(30),[
   {x:0,width:20,y_start:origin,y_end:origin+20},
   {x:0,width:lateWidth,y_start:origin+70,y_end:origin+100}
  ]);
  assert.equal(p.overflowReason,'unbreakable-content-or-no-row-space');
  assert.equal(p.endY,origin+(prefix?10:0),'failed search reserved an empty vertical tail');
  assert.equal(p.lines.length,prefix?1:0);
  assert.equal(p.overflowText,'X'.repeat(30));
 });
}
for(const origin of [0,13])for(const prefix of ['', 'ok ']){
 test(`height failure in a later region reserves no phantom rows: ${origin}/${prefix.length}`,()=>{
  const p=flow(prefix+'BIG',[
   {x:0,width:12,y_start:origin,y_end:origin+20},
   {x:0,width:40,y_start:origin+70,y_end:origin+90}
  ],{runs:[{start:prefix.length,end:prefix.length+3,marks:{tall:true}}]});
  assert.equal(p.endY,origin+(prefix?10:0));
  assert.equal(p.overflowText,'BIG');
 });
}
for(const origin of [0,13])test(`a successful placement after a real gap DOES occupy the later region: ${origin}`,()=>{
 const p=flow('ok abcdef',[
  {x:0,width:12,y_start:origin,y_end:origin+20},
  {x:0,width:40,y_start:origin+70,y_end:origin+100}
 ]);
 assert.equal(p.overflowText,'');assert.equal(p.endY,origin+80);
 assert.deepEqual(p.lines.map(l=>l.y),[origin,origin+70]);
});
for(const maxLines of [0,1])for(const dropLines of [2,4])test(`committed opening keeps its entire window, also at a row limit: ${maxLines}/${dropLines}`,()=>{
 const p=flow('OPEN aa bb cc dd ee', [{x:0,width:65,y_start:11,y_end:111}],{
  opening:{start:0,end:4,position:'dropped',marks:{fontSize:20},gapPx:2,dropLines},options:{maxLines}
 });
 const op=p.lines[0].render.opening;
 assert(op);assert(p.endY>=op.y+op.height,'opening clearance underreported');
 assert.equal(p.endY,Math.max(11,...p.lines.map(l=>l.y+l.lineHeightPx),op.y+op.height));
});
test('an emitted opening is retained even when all body placement attempts fail',()=>{
 const p=flow('OPEN '+ 'X'.repeat(30),[
  {x:0,width:50,y_start:0,y_end:40},{x:0,width:60,y_start:80,y_end:100}
 ],{opening:{start:0,end:4,position:'dropped',marks:{},gapPx:2,dropLines:3}});
 assert.equal(p.lines.length,1);assert(p.lines[0].render.opening);
 assert.equal(p.endY,30);assert.equal(p.overflowText,' '+'X'.repeat(30));
});
test('an opening that cannot be placed commits no reservation',()=>{
 const p=flow('OPEN aa', [{x:0,width:15,y_start:17,y_end:97}],{
  opening:{start:0,end:4,position:'dropped',marks:{},gapPx:2,dropLines:3}
 });
 assert.equal(p.endY,17);assert.equal(p.lines.length,0);assert.equal(p.overflowText,'OPEN aa');
});
test('explicit empty lines remain occupied and are not collapsed',()=>{
 const p=flow('ok\n\n\n', [{x:0,width:60,y_start:7,y_end:97}]);
 assert.equal(p.lines.length,3);assert.equal(p.endY,37);assert.equal(p.overflowText,'');
});
test('a tall committed line retains its full measured extent',()=>{
 const p=flow('BIG', [{x:0,width:60,y_start:7,y_end:97}],{runs:[{start:0,end:3,marks:{tall:true}}]});
 assert.equal(p.endY,47);assert.equal(p.lines[0].lineHeightPx,40);
});
test('an empty entry preserves the allocation origin',()=>{
 const p=layoutV9MainParagraphs([{id:'empty',text:'',runs:[],mainRefs:[]}],[{x:0,width:50,y_start:17,y_end:90}],context(),90);
 assert.equal(p.endY,17);assert.equal(p.lines.length,0);
});
test('no allocated strips means no occupied extent',()=>{
 const p=flow('abc',[]);assert.equal(p.endY,0);assert.equal(p.lines.length,0);
});
test('unsorted strips retain the first allocated origin without mutating inputs',()=>{
 const p=flow('X'.repeat(30),[{x:0,width:40,y_start:80,y_end:100},{x:0,width:20,y_start:7,y_end:27}],{pageBottom:100});
 assert.equal(p.endY,7);assert.equal(p.lines.length,0);
});
