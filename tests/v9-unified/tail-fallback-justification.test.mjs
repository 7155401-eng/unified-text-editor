import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutV9MainParagraphs} from '../../src/engine/v9_main_inline_layout.js';

function context(widths,{fontSize=13,lineHeight=20}={}){
  return {
    fontSize,lineHeight,typography:{fontSize:fontSize+'px',lineHeight:lineHeight+'px',direction:'rtl',wordSpacing:'0px'},
    describeOpening:()=>null,
    measure(part){
      const words=String(part.text||'').trim().split(/\s+/u).filter(Boolean);
      const natural=words.reduce((n,w)=>n+(widths[w]??20),0)+Math.max(0,words.length-1)*4;
      const ws=parseFloat(part.style?.wordSpacing||'0')||0;
      return {width:natural+Math.max(0,words.length-1)*ws,height:lineHeight,topInset:0};
    }
  };
}
test('continuation tail stretches exact word gaps after redistribution is exhausted',()=>{
  const entry={id:'p',text:'aa bb cc dd ee ff gg hh',runs:[],mainRefs:[],continuesAfter:true};
  const ctx=context(Object.fromEntries(entry.text.split(' ').map(w=>[w,31])));
  const plan=layoutV9MainParagraphs([entry],[{x:0,width:100,y_start:0,y_end:60}],ctx,60);
  assert.equal(plan.lines.length,3);
  const stretched=plan.lines.filter(l=>l.tailWordSpacingFallbackStretched);
  assert(stretched.length>0,'fixture did not activate fallback stretch');
  for(const l of stretched){
    assert.equal(l.tailWordSpacingCapped,false);
    assert.equal(l.render.wordSpacing,l.tailWordSpacingTarget);
    assert(l.render.wordSpacing>8,'fixture never exceeded the old gentle cap');
  }
});
