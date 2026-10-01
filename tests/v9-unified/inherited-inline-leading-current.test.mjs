import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTextWithRuns } from '../../src/engine/runs_dom.js';
import { appendV9PlannedPart } from '../../src/engine/v9_text_measurement.js';

class Element {
  constructor(text=''){ this.value=text; this.children=[]; this.style={}; this.dataset={}; this.classList={add(){}}; }
  appendChild(node){ this.children.push(node); return node; }
  set textContent(text){ this.value=text; this.children=[]; }
  get textContent(){ return this.value+this.children.map(n=>n.textContent).join(''); }
}
function render(marks,{style={fontSize:'11px',lineHeight:'17.05px'},measured=true}={}){
  const old=globalThis.document;
  globalThis.document={createElement:()=>new Element(),createTextNode:t=>new Element(t)};
  const part={text:'abc',runs:[{start:0,end:3,marks}],refs:[],style};
  const before=JSON.stringify(part),node=new Element();
  try { measured?appendV9PlannedPart(node,part):appendTextWithRuns(node,part.text,part.runs); }
  finally { globalThis.document=old; }
  assert.equal(JSON.stringify(part),before);
  assert.equal(node.textContent,'abc');
  return node.children[0];
}
for(const size of [7,9,'9px','6pt','0.8em','80%']) test(`smaller V9 run gets proportional leading: ${size}`,()=>{
  assert.equal(render({fontSize:size}).style.lineHeight,'1.55');
});
for(const size of [11,18,'11px','20px','12pt','1em','100%']) test(`equal/larger run keeps previous leading: ${size}`,()=>{
  assert.equal(render({fontSize:size}).style.lineHeight,undefined);
});
for(const lineHeight of [1,1.8,'20px','normal','inherit','0']) test(`explicit leading stays authoritative: ${lineHeight}`,()=>{
  assert.equal(render({fontSize:9,lineHeight}).style.lineHeight,String(lineHeight));
});
for(const marks of [{fontSize:9,superscript:true},{fontSize:9,subscript:true},{fontSize:9,verticalAlign:'baseline'},{fontSize:9,verticalAlign:'2px'}]) test(`vertical positioning unchanged: ${JSON.stringify(marks)}`,()=>{
  assert.equal(render(marks).style.lineHeight,undefined);
});
test('regular renderer path stays unchanged without parent typography',()=>{
  assert.equal(render({fontSize:9},{measured:false}).style.lineHeight,undefined);
});
