// Full multi-page acceptance using neutral text. Both versions retain all
// source characters and must start each note on its main-anchor page.
import {buildPages} from '../../src/vilna_v9.js';
import {getStreamSettings} from '../../src/original_stream_columns.js';
const words=['אב','גדה','וזחט','יכל','מנס','עפצ','קרשת'];
const textOf=n=>Array.from({length:n},(_,i)=>words[i%words.length]).join(' ');
const sourceOf=el=>{const c=el.cloneNode(true);c.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return c.textContent;};
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
async function paginate(buildPages, getStreamSettings, family){
 const settings=getStreamSettings(),beforeSettings={};
 const main=textOf(36),a=[...main.matchAll(/\S+/gu)];
 const notes=[{stream:'01',words:14,index:1},{stream:'03',words:20,index:4},{stream:'04',words:30,index:7},{stream:'02',words:400,index:24}].map(x=>({stream:x.stream,uid:'neutral-'+x.stream,num:1,anchor:a[x.index].index+a[x.index][0].length,anchorAffinity:'backward',text:textOf(x.words)}));
 const input=[{id:'footer-priority-main',mainText:main,notes},{id:'footer-priority-after',mainText:textOf(18),notes:[]}];
 const cfg={pageWidth:380,pageHeight:537,padding:12,reservedBottom:15,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,crownLines:4,crownMainGapPx:8,mainGap:8,streamHorizontalGap:12,talmudStreams:['01','02'],levels:[['01','02'],['03','04']],mishnaWrapOn:true,maxPages:25,openingWordSettings:{enabled:false},streamSettings:{'03':{inlineStyle:{fontSize:10}},'04':{inlineStyle:{fontSize:10}}}};
 const snapshot=JSON.stringify({input,cfg}),host=document.createElement('div');document.body.append(host);
 try{
  for(const id of ['01','02','03','04']){beforeSettings[id]=settings[id];settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:false,lemmaBold:false,titleShow:false};}
  const result=await buildPages(host,input,cfg);
  assert(result.complete,'pagination incomplete');assert(JSON.stringify({input,cfg})===snapshot,'input changed');assert(!(result.noteAnchorFallbacks||[]).length,'note-anchor fallback');
  for(const p of input){const rows=[...host.querySelectorAll(`[data-v9-paragraph-id="${p.id}"]`)];assert(rows.map(sourceOf).join('')===p.mainText,'main source loss');}
  const noteResults=notes.map(note=>{
   const key=`footer-priority-main:${note.stream}:${note.uid}`;
   const refPage=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-main-ref]')].some(n=>n.dataset.uid===note.uid));
   const startPage=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-note-start]')].some(n=>n.dataset.v9NoteStart===key));
   const painted=[...host.querySelectorAll('.v9-final-stream-line')].filter(n=>n.dataset.v9SourceStream===note.stream).map(sourceOf).join('');
   assert(refPage>=0&&refPage===startPage,'note started on wrong source page');assert(painted===note.text,`note source changed ${note.stream}: ${painted.length}/${note.text.length}`);
   return {stream:note.stream,referencePage:refPage+1,startPage:startPage+1,sourceExact:true,paintedCharacters:painted.length};
  });
  const pageGeometry=result.pages.map(page=>{
   const lines=[...page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')].map(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top),w:parseFloat(el.style.width),h:parseFloat(el.style.height)}));let collisions=0;
   for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){const a=lines[i],b=lines[j];if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.2&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.2)collisions++;}
   assert(collisions===0,'overlapping page boxes');assert(lines.every(l=>l.y+l.h<=510+.05),'physical page overflow');
   return {fill:Number(page.dataset.v9PageFill),rows:lines.length,bottom:Math.max(...lines.map(l=>l.y+l.h)),collisions};
  });
  return{family,pages:result.pages.length,complete:true,sourceExact:true,noteResults,pageGeometry};
 }finally{host.remove();for(const id of ['01','02','03','04']){if(beforeSettings[id]===undefined)delete settings[id];else settings[id]=beforeSettings[id];}}
}

export async function runFooterPaginationChecks({baselineBuildPages,baselineGetStreamSettings}={}){
 assert(typeof baselineBuildPages==='function'&&typeof baselineGetStreamSettings==='function','Exact pinned baseline is required');
 const results=[];
 for(const family of ['serif','sans-serif','monospace']){
  try{
   const baseline=await paginate(baselineBuildPages,baselineGetStreamSettings,family);
   const candidate=await paginate(buildPages,getStreamSettings,family);
   assert(candidate.pages<=baseline.pages,'allocation recovery added a page');
   const oldLong=baseline.noteResults.find(n=>n.stream==='02');
   const newLong=candidate.noteResults.find(n=>n.stream==='02');
   assert(newLong.startPage<oldLong.startPage,'long note and its source anchor still postponed together');
   for(const stream of ['01','03','04'])assert(candidate.noteResults.find(n=>n.stream===stream).startPage===baseline.noteResults.find(n=>n.stream===stream).startPage,'previously owned note was displaced');
   assert(candidate.pageGeometry[0].bottom>baseline.pageGeometry[0].bottom+100,'reported sparse-page fixture did not improve');
   results.push({name:'multi-page/'+family,pass:true,baseline,candidate});
  }catch(error){results.push({name:'multi-page/'+family,pass:false,error:String(error)});}
 }
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
