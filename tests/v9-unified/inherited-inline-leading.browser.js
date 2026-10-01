import {appendTextWithRuns} from '../../src/engine/runs_dom.js';
import {appendV9PlannedPart,createV9TextLayoutContext} from '../../src/engine/v9_text_measurement.js';
import {buildSinglePage} from '../../src/vilna_v9.js';

const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
function compareGlyphBoxes(actual,expected){
  function boxes(el){
    const origin=el.getBoundingClientRect(),r=document.createRange();
    const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),out=[];
    for(let n;(n=walk.nextNode());){
      r.selectNodeContents(n);
      for(const b of r.getClientRects())out.push({x:b.left-origin.left,y:b.top-origin.top,w:b.width,h:b.height});
    }
    return out;
  }
  const a=boxes(actual),b=boxes(expected);
  assert(a.length===b.length,'native reference and product glyph box counts differ');
  for(let i=0;i<a.length;i++)for(const k of ['x','y','w','h'])
    assert(Math.abs(a[i][k]-b[i][k])<.04,'product glyph geometry differs from native reference');
}
export function runInheritedInlineLeadingChecks(){
  const results=[];
  const run=(name,fn)=>{try{results.push({name,pass:true,...fn()});}catch(e){results.push({name,pass:false,error:String(e)});}};
  function inlineCase(family,childFont,size,lineHeight=null){
    const ctx=createV9TextLayoutContext({mainFontSize:11,mainFontFamily:family,lineHeightRatio:1.55,openingWordSettings:{enabled:false}});
    const text='אב 12 גד',marks={fontFamily:childFont,fontSize:size,bold:true};
    if(lineHeight!==null)marks.lineHeight=lineHeight;
    const part={text,runs:[{start:3,end:5,marks}],refs:[],style:ctx.typography};
    const before=JSON.stringify(part),actual=document.createElement('span'),expected=document.createElement('span');
    try{
      for(const el of [actual,expected]){
        el.style.cssText='display:inline-block;white-space:pre;margin:0;padding:0;border:0;';
        Object.assign(el.style,ctx.typography);document.body.append(el);
      }
      appendV9PlannedPart(actual,part);
      // Native proportional inheritance is the oracle only for a SMALL run
      // with no explicit leading. Large/explicit cases retain the old CSS.
      if(size<11&&lineHeight===null)expected.style.lineHeight='1.55';
      appendTextWithRuns(expected,text,part.runs);
      const m=ctx.measure(part),ar=actual.getBoundingClientRect(),er=expected.getBoundingClientRect();
      assert(Math.abs(ar.width-er.width)<.02&&Math.abs(ar.height-er.height)<.02,'smaller run introduced extra leading');
      compareGlyphBoxes(actual,expected);
      assert(m.height+1/64>=ar.height,'measured allocation clips actual text height');
      if(size<11&&lineHeight===null)assert(m.height<=ctx.lineHeight+1/64,'small run inflated the row pitch');
      assert(actual.textContent===text&&JSON.stringify(part)===before,'source text/runs/typography changed');
      const child=actual.querySelector('span');
      assert(getComputedStyle(child).fontSize===size+'px','fix resized the inline font');
      if(lineHeight!==null)assert(child.style.lineHeight===String(lineHeight),'explicit leading was overwritten');
      return {height:m.height,baseLeading:ctx.lineHeight,nativeHeight:er.height,width:m.width,childLeading:getComputedStyle(child).lineHeight};
    }finally{ctx.dispose();actual.remove();expected.remove();}
  }
  for(const family of ['serif','sans-serif','monospace'])for(const child of ['serif','sans-serif','monospace'])for(const size of [7,9])
    run(`small-inline/${family}/${child}/${size}`,()=>inlineCase(family,child,size));
  for(const family of ['serif','sans-serif','monospace']){
    run(`large-preservation/${family}`,()=>inlineCase(family,'serif',18));
    run(`explicit-preservation/${family}`,()=>inlineCase(family,'serif',9,'20px'));
  }
  // Same source style pattern observed in export 5868655: ordinary 11px text
  // with scattered 9px styled fragments, no explicit fragment line-height.
  // These are independent neutral fixtures, not a re-render of the user's fonts.
  const words=['אב','גד','הוז','חט','יכל','מנס','עפ','צקר','שת'];
  const text=Array.from({length:130},(_,i)=>words[i%words.length]).join(' ');
  const starts=[...text.matchAll(/\S+/g)].map(m=>[m.index,m.index+m[0].length]);
  for(const family of ['serif','sans-serif','monospace'])for(const count of [20,36,54])for(const exchange of [false,true]){
    run(`two-crowns/${family}/${count}/${exchange}`,()=>{
      const stream=(id,step)=>({id,items:[text],rich:{text,runs:starts.filter((_,i)=>i%step===0)
        .map(([start,end])=>({start,end,marks:{fontSize:9,fontFamily:'serif',bold:true}}))}});
      const content={mainText:Array.from({length:count},(_,i)=>words[i%words.length]).join(' '),
        rightStream:stream('01',exchange?7:17),leftStream:stream('02',exchange?17:7),footerStreams:[]};
      const cfg={pageWidth:380,pageHeight:537,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
        mainFontFamily:family,sideFontFamily:family,crownLines:4,crownMainGapPx:8,openingWordSettings:{enabled:false}};
      const input=JSON.stringify({content,cfg}),page=document.createElement('div');document.body.append(page);
      try{
        const plan=buildSinglePage(page,content,cfg);
        assert(plan.crownScenario.name==='two_long_parallel','fixture did not reach two separate crowns');
        assert(plan.streamCoverage.every(x=>x.exact),'source coverage lost');
        assert(JSON.stringify({content,cfg})===input,'source or settings mutated');
        const mb=Math.max(...plan.mainBox.lines.map(l=>l.y+l.lineHeightPx));
        const boxes=plan.streamBoxes.filter(b=>['right','left'].includes(b.role));
        assert(boxes.length===2,'one side was lost');
        const knees=boxes.map(box=>{
          const i=box.lines.findIndex((l,i)=>i>0&&l.y>=mb-.02&&l.width>box.lines[i-1].width+1);
          assert(i>0,'fixture has no actual widening');
          assert(box.lines.every(l=>Math.abs(l.lineHeightPx-17.05)<.02),'row pitch still inflated');
          for(let k=1;k<box.lines.length;k++)assert(Math.abs(box.lines[k].y-box.lines[k-1].y-box.lines[k-1].lineHeightPx)<.02,'extra gap inserted');
          const crown=box.lines.filter(l=>l.width>=174-.02&&l.y+l.lineHeightPx<=plan.crownBottomY+.02);
          assert(crown.length===4,'configured crown rows changed');
          return box.lines[i].y;
        });
        assert(Math.abs(knees[0]-knees[1])<.02,'knees still misaligned');
        const all=[...plan.mainBox.lines,...boxes.flatMap(b=>b.lines)];
        for(let i=0;i<all.length;i++){
          const a=all[i];assert(a.y+a.lineHeightPx<=525+.02,'row left page bounds');
          for(let j=i+1;j<all.length;j++){
            const b=all[j],dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),dy=Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y);
            assert(dx<.2||dy<.2,'row boxes overlap');
          }
        }
        return {knees,delta:Math.abs(knees[0]-knees[1]),mainBottom:mb};
      }finally{page.remove();}
    });
  }
  return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
