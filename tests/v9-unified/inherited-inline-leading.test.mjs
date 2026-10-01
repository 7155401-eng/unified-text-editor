import test from 'node:test';
import assert from 'node:assert/strict';
import {appendTextWithRuns} from '../../src/engine/runs_dom.js';
import {appendV9PlannedPart} from '../../src/engine/v9_text_measurement.js';

class Element {
  constructor(text=''){this.value=text;this.children=[];this.style={};this.dataset={};this.classList={add(){}};}
  appendChild(node){this.children.push(node);return node;}
  set textContent(text){this.value=text;this.children=[];}
  get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
}
function render(marks, {style={fontSize:'11px',lineHeight:'17.05px'}, measured=true, extraRuns=[]}={}) {
  const old=globalThis.document;
  globalThis.document={createElement:()=>new Element(),createTextNode:t=>new Element(t)};
  const part={text:'abc',runs:[{start:0,end:3,marks},...extraRuns],refs:[],style};
  const before=JSON.stringify(part),node=new Element();
  try {if(measured)appendV9PlannedPart(node,part);else appendTextWithRuns(node,part.text,part.runs);}
  finally {globalThis.document=old;}
  assert.equal(JSON.stringify(part),before,'source marks or typography mutated');
  assert.equal(node.textContent,'abc');
  return node.children;
}
for(const size of [7,9,'9px','6pt','0.8em','80%'])test(`smaller implicit run leading scales without changing font: ${size}`,()=>{
  const [span]=render({fontSize:size});assert.equal(span.style.lineHeight,'1.55');
});
for(const size of [11,18,'11px','20px','12pt','1em','100%'])test(`equal or larger font retains prior leading: ${size}`,()=>{
  assert.equal(render({fontSize:size})[0].style.lineHeight,undefined);
});
for(const lineHeight of [1,1.8,'20px','normal','inherit','0'])test(`explicit run leading remains authoritative: ${lineHeight}`,()=>{
  assert.equal(render({fontSize:9,lineHeight})[0].style.lineHeight,String(lineHeight));
});
for(const extra of [{superscript:true},{subscript:true},{verticalAlign:'baseline'},{verticalAlign:'2px'}])test(`vertical positioning remains unchanged: ${JSON.stringify(extra)}`,()=>{
  assert.equal(render({fontSize:9,...extra})[0].style.lineHeight,undefined);
});
for(const style of [{},{fontSize:'11px',lineHeight:'1.55'},{fontSize:'11px',lineHeight:'normal'}, {fontSize:'11pt',lineHeight:'17.05px'}])test(`non-pixel or missing parent typography is untouched: ${JSON.stringify(style)}`,()=>{
  assert.equal(render({fontSize:9},{style})[0].style.lineHeight,undefined);
});
test('regular renderer has no new implicit leading behavior',()=>{
  assert.equal(render({fontSize:9},{measured:false})[0].style.lineHeight,undefined);
});
test('overlapping explicit leading wins over derived size handling',()=>{
  const spans=render({fontSize:9},{extraRuns:[{start:1,end:2,marks:{lineHeight:2}}]});
  assert.deepEqual(spans.map(s=>s.style.lineHeight),['1.55','2','1.55']);
});
test('no explicit font size means no new leading style',()=>{
  assert.equal(render({bold:true})[0].style.lineHeight,undefined);
});
