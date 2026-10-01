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
  try {
    if(measured) appendV9PlannedPart(node,part);
    else appendTextWithRuns(node,part.text,part.runs);
  } finally { globalThis.document=old; }
  assert.equal(JSON.stringify(part),before,'source marks or typography mutated');
  assert.equal(node.textContent,'abc');
  return node.children[0];
}
for(const size of [7,9,'9px','6pt','0.8em','80%']) test(`smaller V9 run gets proportional inherited leading: ${size}`,()=>{
  const span=render({fontSize:size});
  assert.equal(span.style.lineHeight,'1.55');
});
for(const size of [11,18,'11px','20px','12pt','1em','100%']) test(`equal/larger run keeps previous leading behavior: ${size}`,()=>{
  const span=render({fontSize:size});
  assert.equal(span.style.lineHeight,undefined);
});
for(const lineHeight of [1,1.8,'20px','normal','inherit','0']) test(`explicit run leading stays authoritative: ${lineHeight}`,()=>{
  const span=render({fontSize:9,lineHeight});
  assert.equal(span.style.lineHeight,String(lineHeight));
});
for(const marks of [{fontSize:9,superscript:true},{fontSize:9,subscript:true},{fontSize:9,verticalAlign:'baseline'},{fontSize:9,verticalAlign:'2px'}]) test(`vertical positioning is not rewritten: ${JSON.stringify(marks)}`,()=>{
  const span=render(marks);
  assert.equal(span.style.lineHeight,undefined);
});
test('regular renderer path is unchanged without parent typography',()=>{
  const span=render({fontSize:9},{measured:false});
  assert.equal(span.style.lineHeight,undefined);
});
