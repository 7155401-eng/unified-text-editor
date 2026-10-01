import test from 'node:test';
import assert from 'node:assert/strict';
import {appendV9PlannedPart} from '../../src/engine/v9_text_measurement.js';

class Node {
 constructor(tag='',text=''){this.tag=tag;this.value=text;this.children=[];this.style={};this.dataset={};this.className='';this.classList={add:c=>this.className+=(this.className?' ':'')+c};}
 appendChild(n){this.children.push(n);return n;}
 set textContent(text){this.value=text;this.children=[];}
 get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
 snapshot(){return {tag:this.tag,text:this.value,style:this.style,dataset:this.dataset,className:this.className,children:this.children.map(n=>n.snapshot())};}
}
function paint(part){
 const old=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 const root=new Node('span'),before=JSON.stringify(part);
 try{appendV9PlannedPart(root,part);}finally{globalThis.document=old;}
 assert.equal(JSON.stringify(part),before,'source text/runs/anchor metadata mutated');
 return root;
}
function check(part){
 const actual=paint(part),expected=paint({...part,refs:(part.refs||[]).filter(r=>r.formatted)});
 assert.deepEqual(actual.snapshot(),expected.snapshot(),'a hidden reference split a text/shaping run');
 return actual;
}
for(const text of ['ךְ','ןִ','ףָ','ץֵ','קֻ','שָּׁ'])for(const mark of [{fontSize:36},{bold:true},{fontFamily:'serif',fontSize:28,color:'red'}]){
 test(`hidden reference inside ${text} preserves whole-cluster formatting ${JSON.stringify(mark)}`,()=>{
  const part={text,runs:[{start:0,end:1,marks:mark}],refs:[{localPos:1,anchor:101,uid:'hidden',formatted:''}]};
  assert.equal(check(part).textContent,text);
 });
}
for(const formatted of ['',null,undefined,false,0])test(`non-rendered label cannot create a shaping boundary: ${String(formatted)}`,()=>{
 const part={text:'abcdef',runs:[{start:0,end:6,marks:{fontSize:20}}],refs:[{localPos:3,formatted}]};
 check(part);
});
for(const localPos of [0,1,3,6])test(`preserve actual spaces/edge controls at hidden offset ${localPos}`,()=>{
 const part={text:'ab  cd',leadingText:' \u200f',trailingText:'\u200e\t ',refs:[{localPos,formatted:''}]};
 assert.equal(check(part).textContent,part.leadingText+part.text+part.trailingText);
});
test('visible notes retain their label, styling and metadata across hidden anchors',()=>{
 const refs=[{localPos:0,uid:'start',formatted:'[1]',cssText:'font-size:17px'},{localPos:2,uid:'hidden',formatted:''},{localPos:3,uid:'middle',formatted:'[ 2 ]',stream:'A',anchorAffinity:'backward'},{localPos:4,uid:'hidden2',formatted:''},{localPos:6,uid:'end',formatted:'[3]'}];
 const node=check({text:'abcdef',refs});
 assert.equal(node.textContent,'[1]abc[ 2 ]def[3]');
 assert.deepEqual(node.children.filter(n=>n.dataset.v9MainRef).map(n=>n.dataset.uid),['start','middle','end']);
});
test('a whitespace-only visible label is not mistaken for a disabled reference',()=>{
 const node=check({text:'ab',refs:[{localPos:1,formatted:' ',uid:'space'}]});
 assert.equal(node.textContent,'a b');assert.equal(node.children.filter(n=>n.dataset.v9MainRef).length,1);
});
test('overlapping styles keep precedence when a hidden anchor is inside a combining cluster',()=>{
 check({text:'שָּׁב',runs:[{start:0,end:5,marks:{color:'red'}},{start:2,end:4,marks:{color:'blue',bold:true}}],refs:[{localPos:2,formatted:''},{localPos:3,formatted:''}]});
});
test('empty text and hidden-only metadata remain empty without source mutation',()=>{
 assert.equal(check({text:'',refs:[{localPos:0,formatted:'',uid:'empty'}]}).children.length,0);
});
