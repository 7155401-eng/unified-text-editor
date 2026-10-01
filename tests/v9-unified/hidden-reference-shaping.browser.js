import {appendV9PlannedPart,createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {layoutV9MainParagraphs,partForRange} from '../../src/engine/v9_main_inline_layout.js';

const geometry=p=>({endY:p.endY,overflowText:p.overflowText,lines:p.lines.map(l=>({x:l.x,y:l.y,width:l.width,lineHeight:l.lineHeightPx,naturalWidth:l.naturalWidth,start:l.source.start,end:l.source.end,text:l.render.body.text,alignment:l.render.alignment,wordSpacing:l.render.wordSpacing,opening:l.render.opening&&{x:l.render.opening.x,y:l.render.opening.y,width:l.render.opening.width}}))});
function config(family,mode){return {mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
 openingWordSettings:{enabled:mode!=='none',position:mode==='raised'?'raised':'dropped',target:'word',count:1,font:'inherit',size:175,weight:'bold',dropLines:2,spaceAfter:.2,scope:'all',skipHeadings:false,skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false,minLines:1}};}
function draw(part){const el=document.createElement('span');appendV9PlannedPart(el,part);return el;}

export function runHiddenReferenceChecks(){
 const results=[];
 for(const family of ['serif','sans-serif','monospace'])for(const cluster of ['ךְ','ןִ','ףָ','ץֵ','קֻ','שָּׁ'])
 for(const target of ['base','mark'])for(const mode of ['none','raised','dropped']){
  const name=`${family}/${cluster}/${target}/${mode}`;
  const context=createV9TextLayoutContext(config(family,mode));
  try{
   const text=cluster+' אב אבגד אב';
   const runs=target==='base'?[{start:0,end:1,marks:{fontSize:36,color:'rgb(30,30,30)'}}]:[{start:1,end:cluster.length,marks:{bold:true,fontSize:24}}];
   const entry=context.prepareEntry({id:'hidden-reference-check',text,runs,mainRefs:[{uid:'hidden',anchor:1,formatted:'',cssText:'margin-left:100px;font-size:100px'}]});
   const before=JSON.stringify(entry),absent={...entry,mainRefs:[]};
   const withPart=partForRange(entry,0,text.length),withoutPart=partForRange(absent,0,text.length);
   const a=draw(withPart),b=draw(withoutPart);
   const measured=context.measure(withPart),reference=context.measure(withoutPart);
   const plan=layoutV9MainParagraphs([entry],[{x:0,width:240,y_start:0,y_end:400}],context,400);
   const referencePlan=layoutV9MainParagraphs([absent],[{x:0,width:240,y_start:0,y_end:400}],context,400);
   const pageA=document.createElement('div'),pageB=document.createElement('div');
   for(const l of plan.lines)renderV9PlannedMainLine(l,pageA,0);
   for(const l of referencePlan.lines)renderV9PlannedMainLine(l,pageB,0);
   const checks={sourcePreserved:a.textContent===text,inputUnchanged:JSON.stringify(entry)===before,
    noMarker:a.querySelectorAll('[data-v9-main-ref]').length===0,
    sameDOM:a.innerHTML===b.innerHTML,sameMeasurement:JSON.stringify(measured)===JSON.stringify(reference),
    samePlannedGeometry:JSON.stringify(geometry(plan))===JSON.stringify(geometry(referencePlan)),
    samePaintedDOM:pageA.innerHTML===pageB.innerHTML,
    sourceAnchorRetained:entry.mainRefs.length===1&&entry.mainRefs[0].anchor===1&&entry.mainRefs[0].uid==='hidden'};
   results.push({name,pass:Object.values(checks).every(Boolean),checks,measured,reference});
  }catch(error){results.push({name,pass:false,error:String(error)});}finally{context.dispose();}
 }
 return {browser:navigator.userAgent,total:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results};
}

export function showHiddenReferencePixelCase(family,cluster,hidden){
 const sample=document.querySelector('#sample');sample.replaceChildren();
 sample.style.cssText=`display:inline-block;direction:rtl;white-space:pre;font:16px/1.5 ${family};color:black;background:white;margin:0;padding:0;border:0;`;
 const text='אב '+cluster+' אב';
 appendV9PlannedPart(sample,{text,runs:[{start:3,end:4,marks:{fontSize:36}}],refs:hidden?[{localPos:4,formatted:'',uid:'hidden'}]:[]});
 return {html:sample.innerHTML,text:sample.textContent};
}
