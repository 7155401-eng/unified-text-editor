import * as currentMeasurement from '../../src/engine/v9_text_measurement.js';
import * as currentPlanner from '../../src/engine/v9_main_inline_layout.js';

export function runExactParagraphAlignmentChecks(old) {
 const now={m:currentMeasurement,p:currentPlanner},records=[];
 const assert=(v,message)=>{if(!v)throw Error(message)};
 const source=host=>{const clone=host.cloneNode(true);clone.querySelectorAll('[data-v9-main-ref]').forEach(e=>e.remove());return clone.textContent};
 const cfg=(family,opening=false,drop=2)=>({mainFontSize:13,mainFontFamily:family,lineHeightRatio:1.55,openingWordSettings:{enabled:opening,target:'word',count:1,font:'inherit',size:150,weight:'bold',position:'dropped',dropLines:drop,spaceAfter:.3,scope:'all',skipHeadings:false,skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false}});
 const textOf=n=>Array.from({length:n},(_,i)=>['אב','גד הו','זחטי','כלמנ','סעפצ'][i%5]).join(' ');
 function checkPair(entry,settings,strips,bottom=507,options={}){
  const before=JSON.stringify({entry,settings,strips}),ctx0=old.m.createV9TextLayoutContext(settings),ctx1=now.m.createV9TextLayoutContext(settings);
  const hosts=[0,1].map(()=>{const h=document.createElement('div');h.style.cssText='position:relative;margin:0;padding:0;';document.body.append(h);return h});
  try{
   const a=old.p.layoutV9MainParagraphs([ctx0.prepareEntry(entry)],strips,ctx0,bottom),b=now.p.layoutV9MainParagraphs([ctx1.prepareEntry(entry)],strips,ctx1,bottom);
   const snapshot=JSON.stringify(b);
   a.lines.forEach(l=>old.m.renderV9PlannedMainLine(l,hosts[0],0));b.lines.forEach(l=>now.m.renderV9PlannedMainLine(l,hosts[1],0));
   assert(JSON.stringify({entry,settings,strips})===before,'caller input changed');assert(JSON.stringify(b)===snapshot,'painter changed plan');
   assert(source(hosts[1])+b.overflowText===entry.text,'source text lost/duplicated');
   assert(a.lines.length===b.lines.length,'number of rows changed');
   assert(a.endY===b.endY,'occupied extent changed');
   assert(JSON.stringify(a.overflowParagraphs)===JSON.stringify(b.overflowParagraphs),'page-owned source or overflow anchors changed');
   const same=JSON.stringify(a)===JSON.stringify(b);
   const refs=plan=>[...plan.lines.flatMap(l=>[...(l.render.opening?.part.refs||[]),...l.render.body.refs]),...plan.overflowParagraphs.flatMap(p=>p.mainRefs||[])];
   assert(refs(b).map(r=>r.uid).sort().join('|')===(entry.mainRefs||[]).map(r=>r.uid).sort().join('|'),'reference ownership changed');
   const ranges=hosts.map(h=>[...h.querySelectorAll('.v9-planned-line-text')].map(el=>{const range=document.createRange();range.selectNodeContents(el);const r=range.getBoundingClientRect(),base=h.getBoundingClientRect();return {left:r.left-base.left,right:r.right-base.left,width:r.width,top:r.top-base.top,bottom:r.bottom-base.top}}));
   const exact=b.lines.some(l=>l.tailExactRebalanced),center=b.lines.some(l=>l.openingParagraphCentered),
    fallback=b.lines.some(l=>l.tailWordSpacingFallbackStretched);
   if(options.specialJustification){
    for(let i=0;i<b.lines.length;i++){
     const prev=a.lines[i],line=b.lines[i];
     assert(line.x===prev.x&&line.y===prev.y&&line.width===prev.width&&line.lineHeightPx===prev.lineHeightPx,
      'special-separator justification changed row geometry');
     assert(JSON.stringify(line.render.opening)===JSON.stringify(prev.render.opening),
      'special-separator justification moved opening geometry');
    }
    // Word redistribution BETWEEN the already-owned rows is deliberately
    // allowed: this is how V9 fills a short row. The checks above this branch
    // already require exact whole-source conservation, identical page overflow,
    // identical row count/extent and identical reference ownership.
    return {same,exact,center,fallback,rows:b.lines.length,
     beforeUnderfilled:a.lines.filter((l,i)=>!l.isLast&&l.wordTokens.length&&ranges[0][i].left-l.x>.5).length,
     afterUnderfilled:b.lines.filter((l,i)=>!l.isLast&&l.wordTokens.length&&ranges[1][i].left-l.x>.5).length,
     maxEvaluations:Math.max(0,...b.diagnostics.map(d=>d.exactPartitionEvaluations||0)),
     beforeCenter:a.lines.length===2?(ranges[0][1].left+ranges[0][1].right)/2:null,
     afterCenter:b.lines.length===2?(ranges[1][1].left+ranges[1][1].right)/2:null};
   }
   if(exact){
    assert(a.lines.some(l=>l.tailWordSpacingCapped),'exact recovery changed an already-uncapped tail');
    assert(b.lines.every(l=>!l.tailWordSpacingCapped),'exact alternative still caps a row');
    for(let i=0;i<b.lines.length;i++){
     const l=b.lines[i],prev=a.lines[i];
     assert(l.x===prev.x&&l.y===prev.y&&l.width===prev.width&&l.lineHeightPx===prev.lineHeightPx,'exact tail changed a row box');
     assert(JSON.stringify(l.render.opening)===JSON.stringify(prev.render.opening),'opening changed');
     if(prev.wordTokens.length)assert(l.wordTokens.length,'recovery emptied a previously occupied body row');
     if(l.wordTokens.length){
      assert(l.render.wordSpacing<=8+1e-9,'gentle spacing increased');
      assert(Math.abs(ranges[1][i].left-l.x)<=.04,'recovered line does not reach left edge');
      assert(Math.abs(ranges[1][i].right-l.x-l.width)<=.04,'recovered line exceeds or misses right edge');
     }
    }
   }
   if(fallback){
    assert(a.lines.some(l=>l.tailWordSpacingCapped),'fallback did not reproduce a historically capped tail');
    assert(b.lines.every(l=>!l.tailWordSpacingCapped),'fallback still reports clipped spacing');
    for(let i=0;i<b.lines.length;i++){
     const l=b.lines[i],prev=a.lines[i];
     assert(l.x===prev.x&&l.y===prev.y&&l.width===prev.width&&l.lineHeightPx===prev.lineHeightPx,'fallback changed a row box');
     assert(JSON.stringify(l.render.opening)===JSON.stringify(prev.render.opening),'fallback moved the opening');
     assert(JSON.stringify(l.wordTokens)===JSON.stringify(prev.wordTokens),'fallback changed source word ownership after redistribution finished');
     if(l.tailWordSpacingFallbackStretched){
      assert(l.render.wordSpacing===l.tailWordSpacingTarget,'fallback did not apply the exact measured spacing');
      assert(l.render.wordSpacing>0,'fallback stretch has no spacing');
      assert(Math.abs(ranges[1][i].left-l.x)<=.04,'fallback row still misses the left edge');
      assert(Math.abs(ranges[1][i].right-l.x-l.width)<=.04,'fallback row exceeds or misses the right edge');
     }
    }
   }
   if(center){
    assert(b.lines.length===2&&b.lines[1].isLast,'centering applied beyond complete two-row paragraph');
    assert(JSON.stringify(a.lines[0])===JSON.stringify(b.lines[0]),'centering changed first row or opening');
    const last=b.lines[1],glyph=b.lines[0].render.opening,rect=ranges[1][1];
    assert(Math.abs((rect.left+rect.right)/2-last.openingHostX-last.openingHostFullWidth/2)<=.04,'last row not centred on paragraph frame');
    assert(rect.right<=glyph.x-glyph.gap+.04,'centred row overlaps opening or gap');
    assert(last.y===a.lines[1].y&&last.lineHeightPx===a.lines[1].lineHeightPx&&last.naturalWidth===a.lines[1].naturalWidth,'centering changed height/word size');
   }
   if(!exact&&!center&&!fallback){assert(same,'unsupported case changed plan');assert(hosts[0].innerHTML===hosts[1].innerHTML,'unsupported case changed paint');}
   return {same,exact,center,fallback,rows:b.lines.length,
    beforeUnderfilled:a.lines.filter((l,i)=>!l.isLast&&l.wordTokens.length&&ranges[0][i].left-l.x>.5).length,
    afterUnderfilled:b.lines.filter((l,i)=>!l.isLast&&l.wordTokens.length&&ranges[1][i].left-l.x>.5).length,
    maxEvaluations:Math.max(0,...b.diagnostics.map(d=>d.exactPartitionEvaluations||0)),
    beforeCenter:a.lines.length===2?(ranges[0][1].left+ranges[0][1].right)/2:null,
    afterCenter:b.lines.length===2?(ranges[1][1].left+ranges[1][1].right)/2:null};
  }finally{ctx0.dispose();ctx1.dispose();hosts.forEach(h=>h.remove())}
 }
 function run(name,fn){try{records.push({name,pass:true,...fn()})}catch(error){records.push({name,pass:false,error:String(error)})}}
 for(const family of ['serif','sans-serif','monospace'])for(const width of [100,174,240,356])for(const n of [12,24,40])for(const continued of [false,true])for(const opening of [false,true])
  run(`original-matrix/${family}/${width}/${n}/${continued}/${opening}`,()=>{
   const result=checkPair({id:'one-paragraph',text:textOf(n),runs:[],mainRefs:[],continuesAfter:continued},cfg(family,opening),[{x:13,width,y_start:7,y_end:507}]);
   const known=['serif/174/24/false','serif/174/40/true','sans-serif/174/40/false','sans-serif/174/40/true','sans-serif/356/40/false','monospace/174/40/false','monospace/240/40/false','monospace/240/40/true'];
   if(continued&&known.includes(`${family}/${width}/${n}/${opening}`))assert(result.exact,'known recoverable paragraph still has clipped spacing');
   return result;
  });
 // Exact source edge glue and unique note ownership after simultaneous moves.
 for(const family of ['serif','sans-serif','monospace'])for(const opening of [false,true])for(const variant of ['prefix','hidden-all','visible','rich','tab','nbsp']){
  let text=(opening?'פתיח ':'')+textOf(40);
  if(variant==='prefix')text=' \u200f '+text;
  if(variant==='tab')text=text.replaceAll(' ','\t');
  if(variant==='nbsp')text=text.replaceAll(' ','\u00a0');
  const refs=variant==='hidden-all'?Array.from({length:text.length+1},(_,anchor)=>({uid:'h'+anchor,anchor,formatted:'',anchorAffinity:anchor%2?'forward':'backward'})):
    variant==='visible'?[{uid:'first',anchor:7,formatted:'[1]'},{uid:'last',anchor:text.length,formatted:'[2]'}]:[];
  const runs=variant==='rich'?[{start:4,end:15,marks:{fontSize:11,bold:true,color:'rgb(20,40,60)'}}]:[];
  run(`source-conservation/${family}/${opening}/${variant}`,()=>checkPair(
   {id:'rich-tail',text,runs,mainRefs:refs,continuesAfter:true},
   cfg(family,opening),[{x:13,width:174,y_start:7,y_end:507}],507,
   {specialJustification:['tab','nbsp'].includes(variant)}
  ));
 }
 // Separators tokenization already treats as word boundaries must also justify.
 // Only these non-ASCII/tab cases may differ from the pinned baseline.
 const specialSeparators=[
  ['nbsp','\u00a0'],['nnbsp','\u202f'],['thin','\u2009'],['tab','\t']
 ];
 for(const family of ['serif','sans-serif','monospace'])
 for(const opening of [false,true])
 for(const continued of [false,true])
 for(const [variant,separator] of specialSeparators){
  run(`special-separator-fill/${family}/${opening}/${continued}/${variant}`,()=>{
   const words=Array.from({length:36},(_,i)=>['אב','גד','הוז','חטיכ','למנ'][i%5]);
   const text=(opening?'פתיח'+separator:'')+words.join(separator);
   const result=checkPair(
    {id:'special-separator-fill',text,runs:[],mainRefs:[],continuesAfter:continued},
    cfg(family,opening),[{x:13,width:174,y_start:7,y_end:507}],507,
    {specialJustification:true}
   );
   assert(result.afterUnderfilled===0,
    `non-final rows still miss left edge: ${result.afterUnderfilled}`);
   return result;
  });
 }

 // Locate both collision-free and physically impossible two-row endings in
 // the UNCHANGED baseline, then evaluate the same source and settings.
 for(const family of ['serif','sans-serif','monospace'])for(const width of [174,356])for(const drop of [2,3,4])for(const withRef of [false,true])for(const safe of [false,true]){
  run(`two-row-centre/${family}/${width}/${drop}/${withRef}/${safe}`,()=>{
   const settings=cfg(family,true,drop),ctx=old.m.createV9TextLayoutContext(settings);let found=null;
   try{
    for(let n=4;n<100;n++){
     const text='פתיח '+Array.from({length:n},(_,i)=>['אב','גד','הוז','חטיכ'][i%4]).join(' ');
     const entry={id:'centred-pair',text,runs:[],mainRefs:withRef?[{uid:'tail',anchor:text.length,formatted:'[1]',cssText:'font-size:8px;line-height:1'}]:[]};
     const plan=old.p.layoutV9MainParagraphs([ctx.prepareEntry(entry)],[{x:13,width,y_start:7,y_end:507}],ctx,507);
     if(plan.lines.length!==2||!plan.lines[0].render.opening||!plan.lines[1].openingWindow||plan.lines[1].naturalWidth<20)continue;
     const glyph=plan.lines[0].render.opening,canFit=13+width/2+plan.lines[1].naturalWidth/2<=glyph.x-glyph.gap+1/64;
     if(canFit===safe){found=entry;break;}
    }
   }finally{ctx.dispose()}
   assert(found,'no matching physical-centre fixture');
   const r=checkPair(found,settings,[{x:13,width,y_start:7,y_end:507}]);
   assert(r.center===safe,'centering safety/eligibility differs');return r;
  });
 }
 return {total:records.length,passed:records.filter(r=>r.pass).length,failed:records.filter(r=>!r.pass).length,
  exactRecovered:records.filter(r=>r.pass&&r.exact).length,centred:records.filter(r=>r.pass&&r.center).length,
  fallbackStretched:records.filter(r=>r.pass&&r.fallback).length,
  unchanged:records.filter(r=>r.pass&&r.same).length,
  beforeUnderfilled:records.filter(r=>r.name.startsWith('original-matrix/')).reduce((n,r)=>n+(r.beforeUnderfilled||0),0),
  afterUnderfilled:records.filter(r=>r.name.startsWith('original-matrix/')).reduce((n,r)=>n+(r.afterUnderfilled||0),0),
  maxEvaluations:Math.max(...records.map(r=>r.maxEvaluations||0)),records};
}
