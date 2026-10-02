import {appendV9PlannedPart,createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {appendTextWithRuns,sliceRuns} from '../../src/engine/runs_dom.js';
import {layoutV9MainParagraphs,partForRange} from '../../src/engine/v9_main_inline_layout.js';

export const referenceClusters = ['ךְ','ןִ','ףָ','ץֵ','קֻ','שָּׁ'];
export const referenceStyles = ['plain','base-only','mark-only'];
const assert = (value,message) => { if (!value) throw new Error(message); };
const sourceOf = host => { const copy=host.cloneNode(true); copy.querySelectorAll('[data-v9-main-ref]').forEach(ref=>ref.remove()); return copy.textContent; };
const geometry = plan => ({endY:plan.endY,overflow:plan.overflowText,lines:plan.lines.map(line=>({
  x:line.x,y:line.y,width:line.width,height:line.lineHeightPx,natural:line.naturalWidth,
  sourceStart:line.source.start,sourceEnd:line.source.end,alignment:line.render.alignment,
  spacing:line.render.wordSpacing,opening:line.render.opening&&{
    x:line.render.opening.x,y:line.render.opening.y,width:line.render.opening.width,height:line.render.opening.height,
  },
}))});
// Independent expected cut: the platform's grapheme segmentation, not the
// production cut helper. Fixtures here are a base plus combining marks.
const segmenter = new Intl.Segmenter('he',{granularity:'grapheme'});
function expectedPart(part) {
  const segments=segmenter.segment(part.text);
  return {...part,refs:(part.refs||[]).map(ref=>{
    if(!ref.formatted)return ref;
    const pos=Math.max(0,Math.min(part.text.length,Number(ref.localPos)||0));
    const cluster=pos<part.text.length?segments.containing(pos):null;
    return cluster&&cluster.index<pos?{...ref,localPos:cluster.index+cluster.segment.length}:ref;
  })};
}
function runsFor(cluster,style) {
  if(style==='base-only')return [{start:0,end:1,marks:{fontSize:36,bold:true}}];
  if(style==='mark-only')return [{start:1,end:cluster.length,marks:{fontSize:28,color:'rgb(31,47,67)'}}];
  return [];
}
function config(family,mode) {
  return {mainFontFamily:family,mainFontSize:20,lineHeightRatio:1.5,
    openingWordSettings:{enabled:mode!=='none',target:'word',count:1,font:'inherit',size:175,weight:'bold',position:mode==='raised'?'raised':'dropped',dropLines:2,spaceAfter:.2,scope:'all',skipHeadings:false,skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false}};
}

export function runVisibleReferenceChecks() {
  const results=[];
  for(const family of ['serif','sans-serif','monospace'])for(const cluster of referenceClusters)
  for(const style of referenceStyles)for(const mode of ['none','raised','dropped']) {
    const name=`${family}/${cluster}/${style}/${mode}`;
    const context=createV9TextLayoutContext(config(family,mode)),referenceContext=createV9TextLayoutContext(config(family,mode));
    const page=document.createElement('div');page.style.cssText='position:relative;direction:rtl;';document.body.append(page);
    try {
      const text=cluster+' אב גד דה אב גד דה אב';
      const entry=context.prepareEntry({id:'visible-combining',index:1,text,runs:runsFor(cluster,style),
        mainRefs:[{uid:'inside',anchor:1,anchorAffinity:'forward',formatted:'[1]',cssText:'font-size:10px;line-height:1;vertical-align:super'},
          {uid:'hidden',anchor:1,formatted:''},{uid:'last',anchor:text.length,formatted:'[2]',cssText:'font-size:10px;line-height:1;vertical-align:super'}]});
      const snapshot=JSON.stringify(entry),part=partForRange(entry,0,text.length);
      const actual=context.measure(part),native=referenceContext.measure(expectedPart(part));
      assert(JSON.stringify(actual)===JSON.stringify(native),'combining sequence did not use native cluster measurement');
      const measured=referenceContext.measure;
      referenceContext.measure=part=>measured(expectedPart(part));
      const strips=[{x:0,width:240,y_start:0,y_end:450}];
      const plan=layoutV9MainParagraphs([entry],strips,context,450);
      const expected=layoutV9MainParagraphs([entry],strips,referenceContext,450);
      assert(JSON.stringify(geometry(plan))===JSON.stringify(geometry(expected)),'planned geometry differs from complete-cluster measurement');
      const planBefore=JSON.stringify(plan);
      for(const line of plan.lines)renderV9PlannedMainLine(line,page,0);
      assert(JSON.stringify(plan)===planBefore,'paint changed planned data');
      assert(JSON.stringify(entry)===snapshot,'source data/anchors mutated');
      assert(sourceOf(page)+plan.overflowText===text,'source characters lost or duplicated');
      assert(plan.overflowText==='','fixture overflowed');
      const refs=plan.lines.flatMap(line=>[...(line.render.opening?.part.refs||[]),...line.render.body.refs]);
      assert(refs.map(ref=>ref.uid).sort().join(',')==='hidden,inside,last','reference ownership changed');
      const marker=page.querySelector('[data-uid="inside"]');
      assert(marker&&marker.dataset.anchor==='1','semantic note anchor changed');
      assert(page.querySelectorAll('[data-v9-main-ref]').length===2,'visible/hidden reference count changed');
      // The text immediately preceding the visible object must contain the
      // whole base+mark sequence, even though its semantic source anchor is 1.
      assert(marker.previousSibling?.textContent.endsWith(cluster),'visible number still detaches the combining marks');
      for(const line of plan.lines) {
        assert(line.naturalWidth<=line.width+1/64,'note was not included in available-width validation');
        const measure=context.measure(line.render.body);
        assert(Math.abs(measure.width-line.naturalWidth)<.02,'measure and paint consume different parts');
      }
      results.push({name,pass:true,sourceAnchor:marker.dataset.anchor,sourceLocalPos:marker.dataset.localPos,
        measured:actual,rows:plan.lines.length});
    } catch(error) { results.push({name,pass:false,error:String(error)}); }
    finally {context.dispose();referenceContext.dispose();page.remove();}
  }
  return {total:results.length,passed:results.filter(result=>result.pass).length,
    failed:results.filter(result=>!result.pass).length,results};
}

export function showReferenceRaster(family,cluster,style,expected) {
  const host=document.querySelector('#sample');host.replaceChildren();
  host.style.cssText=`display:inline-block;white-space:pre;direction:rtl;font:20px/1.5 ${family};margin:0;padding:0;border:0;color:black;background:white;`;
  const part={text:cluster+' אב',runs:runsFor(cluster,style),refs:[{
    localPos:1,anchor:1,uid:'inside',formatted:'[1]',cssText:'font-size:10px;line-height:1;vertical-align:super',
  }]};
  if(!expected)appendV9PlannedPart(host,part);
  else {
    // Direct contiguous native text is the oracle. The reference is drawn
    // separately with its ORIGINAL semantic coordinates, after the cluster.
    appendTextWithRuns(host,cluster,sliceRuns(part.runs,0,cluster.length));
    appendV9PlannedPart(host,{text:'',refs:part.refs});
    appendTextWithRuns(host,part.text.slice(cluster.length),sliceRuns(part.runs,cluster.length,part.text.length));
  }
  return {source:sourceOf(host),html:host.innerHTML};
}
