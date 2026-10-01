// The old branch's intended fix, tested through the real current page planner.
// Expectations use complete rows from the actual stream context and allocation,
// not the proposed boolean helper or Canvas/default-font estimates.
import {buildSinglePage} from '../../src/vilna_v9.js';
import {streamContextForV9,flowV9MeasuredStream} from '../../src/engine/v9_stream_inline_layout.js';
import {normalizeRichTextEntry,makeRichText} from '../../src/engine/rich_text_runs.js';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const WORDS=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa','lambda','mu'];
const textOf=n=>Array.from({length:n},(_,i)=>WORDS[i%WORDS.length]).join(' ');
const mk=(id,n,runs=[])=>({id,items:[textOf(n)],rich:{text:textOf(n),runs},runs});
const common={pageWidth:380,pageHeight:1400,padding:12,mainFontSize:13,sideFontSize:11,
 lineHeightRatio:1.55,mainFontFamily:'serif',sideFontFamily:'serif',crownLines:4,crownMainGapPx:11,
 openingWordSettings:{enabled:false},streamSettings:{}};

function inspect({right=null,left=null,cfg={}}) {
 const config={...common,...cfg},inner=config.pageWidth-2*config.padding;
 const half=Math.floor(inner*(config.sideHalfRatio??.49));
 const probeConfig={...config,__v9StreamContexts:new Map()};
 const prepared=[right,left].map(stream=>{
  if(!stream)return null;
  const rich=stream.rich?normalizeRichTextEntry(stream.rich):makeRichText(stream.items.join(' '),stream.runs||[]);
  if(!rich.text)return null;
  const settings=config.streamSettings[stream.id]||{};
  const context=streamContextForV9(probeConfig,stream.id,settings.styleId||'',settings.inlineStyle||settings.manualStyle||null);
  const count=width=>flowV9MeasuredStream(rich,[{x:0,width,y_start:0,y_end:100000}],context,100000,{maxLines:config.crownLines||4}).lines.length;
  return {half:count(half),full:count(inner)};
 });
 const target=config.crownLines||4,[r,l]=prepared;
 let expected;
 if(!r&&!l)expected='no_streams';
 else if(!r||!l)expected=(r||l).half>=target?'one_long_split':'one_short_no_crown';
 else if(r.half>=target&&l.half>=target)expected='two_long_parallel';
 else if((r.half>=target&&r.full>=target)||(l.half>=target&&l.full>=target))expected='one_full_one_short';
 else expected='two_short_no_crown';
 const content={mainText:'אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר',rightStream:right,leftStream:left,footerStreams:[]};
 const snapshot=JSON.stringify({content,config});
 const page=document.createElement('div');page.style.position='relative';document.body.append(page);
 try {
  const plan=buildSinglePage(page,content,config);
  assert(plan.crownScenario.name===expected,`scenario=${plan.crownScenario.name}, measured=${expected}; rows=${JSON.stringify(prepared)}, halfWidth=${half}`);
  assert(JSON.stringify({content,config})===snapshot,'source or caller settings mutated');
  assert(plan.streamCoverage.every(s=>s.exact),'source coverage changed');
  assert(plan.mainBox.lines.map(l=>l.sourceText??l.text).join('')+plan.overflow.mainText===content.mainText,'main source changed');
  const all=[...plan.mainBox.lines,...plan.streamBoxes.flatMap(b=>b.lines)];
  assert(all.every(line=>line.y+line.lineHeightPx<=config.pageHeight-config.padding+.05),'row escaped the physical page');
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
   const a=all[i],b=all[j];
   const x=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),y=Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y);
   assert(x<.2||y<.2,'row boxes overlap in the measured-scenario fixture');
  }
  const drawn=page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line');
  assert(drawn.length===all.length,'a planned row was lost or duplicated in paint');
  for(let i=0;i<all.length;i++){
   const line=all[i],style=drawn[i].style;
   assert(Math.abs(parseFloat(style.left)-config.padding-line.x)<.02&&Math.abs(parseFloat(style.top)-line.y)<.02,
    'renderer changed the planned row position');
  }
  return {scenario:plan.crownScenario.name,measuredRows:prepared,halfWidth:half,rows:all.length};
 } finally {page.remove();for(const c of probeConfig.__v9StreamContexts.values())c.dispose();}
}

export function runMeasuredCrownDecisionChecks(){
 const results=[];
 const run=(name,fn)=>{try{results.push({name,pass:true,...fn()});}catch(error){results.push({name,pass:false,error:String(error)});}};
 // Per-stream style versus rich in-text style, in both input-side positions.
 for(const family of ['serif','sans-serif','monospace'])for(const size of [7,11,18,24])
 for(const n of [12,24,36,48])for(const rich of [false,true])for(const side of ['right','left']){
  run(`typography/${family}/${size}/${n}/${rich}/${side}`,()=>{
   const text=textOf(n),runs=rich?[{start:0,end:text.length,marks:{fontSize:size,bold:true,color:'rgb(31,47,67)'}}]:[];
   return inspect({[side]:mk('01',n,runs),cfg:{sideFontFamily:family,streamSettings:rich?{}:{'01':{inlineStyle:{fontSize:size}}}}});
  });
 }
 // Narrow custom columns and the actual 49% default, not the obsolete 50% guess.
 for(const family of ['serif','sans-serif','monospace'])for(const ratio of [.32,.49,.5])for(const n of [11,13,19,20]){
  run(`allocation/${family}/${ratio}/${n}`,()=>inspect({right:mk('01',n),cfg:{sideFontFamily:family,sideHalfRatio:ratio}}));
 }
 // Exercise all two-stream branches with different resolved font sizes.
 for(const family of ['serif','sans-serif','monospace'])for(const counts of [[8,8],[24,24],[72,8],[8,72]])
 for(const sizes of [[7,18],[18,7]]){
  run(`two-streams/${family}/${counts}/${sizes}`,()=>inspect({right:mk('01',counts[0]),left:mk('02',counts[1]),
   cfg:{sideFontFamily:family,streamSettings:{'01':{inlineStyle:{fontSize:sizes[0]}},'02':{inlineStyle:{fontSize:sizes[1]}}}}}));
 }
 for(const count of [2,3,5])for(const side of ['right','left']){
  run(`configured-row-count/${count}/${side}`,()=>inspect({[side]:mk('01',16),cfg:{crownLines:count,streamSettings:{'01':{inlineStyle:{fontSize:18}}}}}));
 }
 for(const mode of ['absent','right-empty','left-empty','both-empty']){
  run(`empty/${mode}`,()=>inspect({right:mode==='right-empty'||mode==='both-empty'?mk('01',0):null,
   left:mode==='left-empty'||mode==='both-empty'?mk('02',0):null}));
 }
 for(const side of ['right','left']){
  run(`explicit-breaks/${side}`,()=>{const st=mk('01',0);st.items=['alpha\nbeta\ngamma\ndelta'];st.rich={text:st.items[0],runs:[]};return inspect({[side]:st});});
 }
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
