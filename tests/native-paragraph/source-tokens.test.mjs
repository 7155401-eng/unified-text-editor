import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSourceChunks} from './source-tokens.js';

const samples = ["אבג'דה",'אב גד','  אב  גד  ','אב\nגד','אב\r\nגד','א\tב','א\u00a0ב','א\u202fב','א\ufeffב','שָּׁלוֹם','A😀B','', '   ', '\u200f(א)\u200e ב'];
for (const text of samples) test(`all reference offsets retain source order and metadata: ${JSON.stringify(text)}`, () => {
  const refs = Array.from({length:text.length+1},(_,localPos)=>({localPos,anchor:100+localPos,uid:`ref-${localPos}`,formatted:localPos%2?'[ 7 ]':'',anchorAffinity:localPos%3?'forward':'backward'}));
  const part = {text,refs,runs:[{start:0,end:text.length,marks:{bold:true}},{start:1,end:Math.max(1,text.length-1),marks:{color:'red'}}], leadingText:' ',trailingText:'\t'};
  const before = JSON.stringify(part);
  const chunks = nativeSourceChunks(part);
  assert.equal(chunks.map(c=>c.text).join(''),text);
  const after = chunks.flatMap(c=>c.refs.map(r=>({...r,localPos:c.start+r.localPos})));
  assert.deepEqual(after,refs,'reference lost, duplicated, moved or reordered');
  assert.equal(JSON.stringify(part),before,'input mutated');
  for(const c of chunks)for(const run of c.runs){assert(run.start>=0&&run.end<=c.text.length);}
});
test('word-final reference stays with preceding source token; leading reference follows whitespace',()=>{
  const chunks = nativeSourceChunks({text:'ab cd',refs:[{localPos:0,uid:'head'},{localPos:2,uid:'end'},{localPos:3,uid:'start'},{localPos:5,uid:'tail'}]});
  assert.deepEqual(chunks.map(c=>[c.text,c.noWrap,c.refs.map(r=>r.uid)]),[['ab',true,['head','end']],[' ',false,[]],['cd',true,['start','tail']]]);
});
for(const space of ['\u00a0','\u202f','\ufeff'])test(`non-breaking separator remains inside a single token ${JSON.stringify(space)}`,()=>{
  const chunks=nativeSourceChunks({text:'ab'+space+'cd'});assert.equal(chunks.length,1);assert(chunks[0].noWrap);
});
test('equal-position references preserve order and all formatting options',()=>{
  const refs=[{localPos:1,uid:'a',cssText:'font-size:18px'},{localPos:1,uid:'b',formatted:'[2]'}];
  assert.deepEqual(nativeSourceChunks({text:'abc',refs})[0].refs,refs);
});
test('effective positions match existing painter clamping, including unsorted input',()=>{
  const refs=[{localPos:2,uid:'a'},{localPos:0,uid:'b'},{localPos:99,uid:'c'}];
  const chunks=nativeSourceChunks({text:'ab cd',refs});
  assert.deepEqual(chunks.flatMap(c=>c.refs.map(r=>[r.uid,c.start+r.localPos])),[['a',2],['b',2],['c',5]]);
});
test('each character retains all overlapping styles and their precedence',()=>{
 const runs=[{start:0,end:11,marks:{color:'red',bold:true}},{start:2,end:7,marks:{color:'blue',italic:true}}];
 const part={text:'ab cde fghi',runs};
 const chunks=nativeSourceChunks(part);
 for(const c of chunks)for(let i=0;i<c.text.length;i++){
  const original=Object.assign({},...runs.filter(r=>r.start<=c.start+i&&r.end>c.start+i).map(r=>r.marks));
  const actual=Object.assign({},...c.runs.filter(r=>r.start<=i&&r.end>i).map(r=>r.marks));
  assert.deepEqual(actual,original);
 }
});
for(const value of [null,{}, {text:42}])test(`invalid part is rejected: ${JSON.stringify(value)}`,()=>assert.throws(()=>nativeSourceChunks(value),TypeError));
