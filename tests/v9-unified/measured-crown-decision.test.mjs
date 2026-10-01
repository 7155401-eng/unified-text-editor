import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAtLeastV9Rows,flowV9MeasuredStream} from '../../src/engine/v9_stream_inline_layout.js';

function makeContext() {
  const context={fontSize:10,lineHeight:10,prepareEntry:entry=>({...entry}),describeOpening:()=>null,calls:0,
    measure(part){this.calls++;return {width:part.text.length*5,height:10,topInset:0};}};
  return context;
}
for (const rows of [1,2,3,4,5,1.5,2.5]) for (const width of [25,40]) {
  test(`threshold matches measured complete rows: rows=${rows}, width=${width}`,()=>{
    const ctx=makeContext(),rich={text:'aa bb cc dd ee ff gg hh ii jj',runs:[{start:3,end:5,marks:{bold:true}}]};
    const before=JSON.stringify(rich);
    const full=flowV9MeasuredStream(rich,[{x:0,width,y_start:0,y_end:1000}],ctx,1000);
    assert.equal(hasAtLeastV9Rows(rich,ctx,width,rows),full.lines.length>=rows);
    assert.equal(JSON.stringify(rich),before);
  });
}
for (const rows of [0,-1,NaN,Infinity]) test(`invalid row threshold fails without measurement: ${String(rows)}`,()=>{
  const ctx=makeContext();assert.equal(hasAtLeastV9Rows('aa',ctx,40,rows),false);assert.equal(ctx.calls,0);
});
for (const width of [0,-1,NaN,Infinity]) test(`invalid width fails without measurement: ${String(width)}`,()=>{
  const ctx=makeContext();assert.equal(hasAtLeastV9Rows('aa',ctx,width,4),false);assert.equal(ctx.calls,0);
});
for (const input of [null,'',{text:'',runs:[]}]) test(`empty source is not measured: ${JSON.stringify(input)}`,()=>{
  const ctx=makeContext();assert.equal(hasAtLeastV9Rows(input,ctx,40,4),false);assert.equal(ctx.calls,0);
});
test('source line breaks count as actual rows, not horizontal wrapping estimates',()=>{
  assert.equal(hasAtLeastV9Rows('aa\nbb\ncc\ndd',makeContext(),1000,4),true);
  assert.equal(hasAtLeastV9Rows('aa bb cc dd',makeContext(),1000,4),false);
});
test('an unplaceable first word does not manufacture extra crown rows',()=>{
  assert.equal(hasAtLeastV9Rows('X'.repeat(50)+' aa bb cc dd',makeContext(),40,4),false);
});
test('threshold query stops at the requested leading rows',()=>{
  const input=Array(150).fill('aa').join(' '),short=makeContext(),full=makeContext();
  assert(hasAtLeastV9Rows(input,short,25,4));
  flowV9MeasuredStream(input,[{x:0,width:25,y_start:0,y_end:10000}],full,10000);
  assert(short.calls<full.calls,'threshold measurement processed the whole long stream');
});
