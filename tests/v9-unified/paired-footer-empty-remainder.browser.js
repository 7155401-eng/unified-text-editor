// Regression: base-pitch preflight succeeds but the real styled first row
// does not fit. No painted box must still mean ALL input is retained as carry.
import * as candidate from '../../src/vilna_v9.js';
import {getStreamSettings} from '../../src/original_stream_columns.js';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const words=['ab','cde','fghi','jk','lmn','opq','rst'];
const textOf=n=>Array.from({length:n},(_,i)=>words[i%words.length]).join(' ');
const sourceOf=el=>{const clone=el.cloneNode(true);clone.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return clone.textContent;};
function stream(id,text,large=false){
 const key='fixture:'+id;
 const runs=[{start:0,end:text.length,marks:{v9NoteKey:key}},{start:0,end:1,marks:{v9NoteStart:key}},
  {start:10,end:18,marks:{bold:true,color:'rgb(31,47,67)'}}];
 if(large)runs.push({start:0,end:1,marks:{fontSize:200}});
 return {id,items:[text],runs,rich:{text,runs}};
}
function fixture({family,target,role,kind,mode='compact'}){
 const otherId=target==='03'?'04':'03';
 const text=((kind==='width'?'W'.repeat(80)+' ':'i ')+textOf(150)).slice(0,310);
 const a=stream(target,text,kind==='height'),b=stream(otherId,textOf(role==='float'?180:8));
 const cfg={pageWidth:380,pageHeight:kind==='height'?180:537,padding:12,reservedBottom:15,mainFontSize:13,sideFontSize:11,
  lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,crownLines:4,talmudStreams:['01','02'],
  mishnaWrapOn:mode!=='explicit',levels:mode==='explicit'?[]:[['03','04']],
  streamSettings:mode==='explicit'?{'03':{layoutRole:'mishna'},'04':{layoutRole:'mishna'}}:{},openingWordSettings:{enabled:false}};
 const content={mainText:'ab cd',rightStream:null,leftStream:null,footerStreams:target==='03'?[a,b]:[b,a],
  requiredNoteStarts:[a,b].map(s=>({key:'fixture:'+s.id,stream:s.id,requireMainAnchor:false}))};
 return {cfg,content,a};
}
function rectangles(plan){
 const rows=[...(plan.mainBox?.lines||[]),...plan.streamBoxes.flatMap(b=>b.lines),...plan.footerBoxes.flatMap(b=>b.lines)];
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];assert(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<.2||Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y)<.2,'new overlap');
 }
}
export async function runPairedFooterRemainderChecks(base){
 const results=[];
 function single(options,preserve=false){
  const {content,cfg,a}=fixture(options),hosts=[0,1].map(()=>{const el=document.createElement('div');document.body.append(el);return el;});
  if(preserve&&options.control==='no-room')cfg.pageHeight=65;
  if(preserve&&options.control==='unpaired'){cfg.mishnaWrapOn=false;cfg.levels=[];cfg.streamSettings={};}
  const before=JSON.stringify({content,cfg});
  try{
   let previous,error=null;
   try{previous=base.buildSinglePage(hosts[0],content,cfg);}catch(e){error=String(e);}
   const current=candidate.buildSinglePage(hosts[1],content,cfg);
   assert(JSON.stringify({content,cfg})===before,'caller source, styles or settings changed');
   assert(current.streamCoverage.every(c=>c.exact),'source coverage violated');
   if(preserve){
    assert(!error,'control unexpectedly triggered original failure: '+error);
    assert(JSON.stringify(current)===JSON.stringify(previous)&&hosts[0].innerHTML===hosts[1].innerHTML,'unaffected plan or paint changed');
    return {scope:'preservation',planAndPaintIdentical:true};
   }
   const expected=`V9_STREAM_SOURCE_MISMATCH: ${options.target} (input=310, planned=0, remaining=0)`;
   assert(error?.includes(expected),'baseline did not reproduce exact missing-input failure: '+error);
   const coverage=current.streamCoverage.find(c=>c.stream===options.target);
   assert(coverage.inputCharacters===310&&coverage.plannedCharacters===0&&coverage.remainingCharacters===310,'full unplaced source was not retained');
   assert(JSON.stringify(current.overflow.streams[options.target])===JSON.stringify(a.rich),'carry lost rich source or note metadata');
   assert(current.overflow.hasStreamContinuation===true,'continuation flag lost');
   assert(current.unstartedNotes.some(n=>n.stream===options.target),'unstarted note incorrectly accepted as started');
   assert(!current.footerBoxes.some(b=>b.id===options.target),'empty phantom box was added');
   rectangles(current);
   return {scope:'exact-regression',baselineError:error,coverage,unstartedPreserved:true,richSourceExact:true};
  }finally{hosts.forEach(h=>h.remove());}
 }
 function add(options,preserve=false){try{results.push({name:JSON.stringify(options),pass:true,...single(options,preserve)});}catch(e){results.push({name:JSON.stringify(options),pass:false,error:String(e)});}}
 for(const family of ['serif','sans-serif','monospace'])for(const target of ['03','04'])for(const role of ['float','flow'])for(const kind of ['width','height'])add({family,target,role,kind});
 for(const family of ['serif','sans-serif','monospace'])for(const role of ['float','flow'])add({family,target:'03',role,kind:'height',mode:'explicit'});
 for(const family of ['serif','sans-serif','monospace'])for(const role of ['float','flow'])for(const control of ['ordinary','no-room','unpaired'])add({family,target:'03',role,kind:control==='unpaired'?'width':'ordinary',control},true);
 for(const family of ['serif','sans-serif','monospace']){
  const name='multi-page/'+family,hosts=[];
  try{
   window.__STREAM_SETTINGS__={};for(const id of ['03','04'])getStreamSettings()[id]={mainRefEnabled:true,noteNumEnabled:false,lemmaBold:false,titleShow:false};
   const main=textOf(180),tokens=[...main.matchAll(/\S+/g)],anchor=tokens[150].index+tokens[150][0].length;
   const notes=[{stream:'03',uid:'note03',num:1,anchor,anchorAffinity:'backward',text:('i '+textOf(110)).slice(0,310),runs:[{start:0,end:1,marks:{fontSize:250}}]},
    {stream:'04',uid:'note04',num:1,anchor,anchorAffinity:'backward',text:textOf(170)}];
   const input=[{id:'main',mainText:main,notes}],cfg={pageWidth:380,pageHeight:537,padding:12,reservedBottom:15,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
    mainFontFamily:family,sideFontFamily:family,talmudStreams:['01','02'],levels:[['03','04']],mishnaWrapOn:true,openingWordSettings:{enabled:false},maxPages:15};
   const before=JSON.stringify({input,cfg});
   const render=async api=>{const h=document.createElement('div');document.body.append(h);hosts.push(h);return {host:h,result:await api.buildPages(h,input,cfg)};};
   let oldError=null;try{await render(base);}catch(e){oldError=String(e);}
   assert(oldError?.includes('V9_STREAM_SOURCE_MISMATCH: 03 (input=310, planned=0, remaining=0)'),'full pagination did not reproduce the reported failure');
   const {host,result}=await render(candidate);
   assert(result.complete&&result.pages.length>=2,'full pagination did not complete');
   assert(!(result.noteAnchorFallbacks||[]).length,'note-anchor fallback used');
   assert(JSON.stringify({input,cfg})===before,'pagination changed input or settings');
   assert([...host.querySelectorAll('[data-v9-paragraph-id="main"]')].map(sourceOf).join('')===main,'main source changed');
   const noteOwnership=notes.map(n=>{
    const painted=[...host.querySelectorAll('.v9-final-stream-line')].filter(el=>el.dataset.v9SourceStream===n.stream).map(sourceOf).join('');
    assert(painted===n.text,'note source changed');
    const ref=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-main-ref]')].some(el=>el.dataset.uid===n.uid));
    const start=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-note-start]')].some(el=>el.dataset.v9NoteStart===`main:${n.stream}:${n.uid}`));
    assert(ref>=0&&ref===start,'note start separated from its anchor page');
    return {stream:n.stream,sourceExact:true,referencePage:ref+1,startPage:start+1};
   });
   for(const p of result.pages){const lines=[...p.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')].map(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top),width:parseFloat(el.style.width),lineHeightPx:parseFloat(el.style.height)}));assert(lines.every(l=>l.y+l.lineHeightPx<=510+.05),'row outside page');rectangles({mainBox:{lines},streamBoxes:[],footerBoxes:[]});}
   results.push({name,pass:true,scope:'full-pagination',baselineError:oldError,pages:result.pages.length,mainSourceExact:true,noteOwnership});
  }catch(e){results.push({name,pass:false,error:String(e)});}finally{hosts.forEach(h=>h.remove());}
 }
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
