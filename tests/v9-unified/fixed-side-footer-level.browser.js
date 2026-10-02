// Neutral text only. The production checkbox and parser declarations are
// loaded verbatim by the runner; both complete planners are unmodified copies.
import * as next from '../../src/vilna_v9.js';
import {getStreamSettings} from '../../src/original_stream_columns.js';
import {isTalmudOtherAsMishnaEnabled} from '../../src/talmud_controls.js';
export function createFixedSideFooterChecks(base) {
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const words=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta'];
const text=n=>Array.from({length:n},(_,i)=>words[i%words.length]).join(' ');
const mk=(id,n)=>({id,items:[text(n)],rich:{text:text(n),runs:[{start:0,end:text(n).length,marks:{color:'rgb(20,30,40)'}}]}});
function rectangleCheck(plan){
 const lines=[...(plan.mainBox?.lines||[]),...plan.streamBoxes.flatMap(b=>b.lines),...plan.footerBoxes.flatMap(b=>b.lines)];
 for(let i=0;i<lines.length;i++){
  const a=lines[i];assert(a.y+a.lineHeightPx<=plan.pageBox.height-plan.pageBox.padding+.1,'row below page');
  for(let j=i+1;j<lines.length;j++){
   const b=lines[j],dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),dy=Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y);
   assert(dx<.2||dy<.2,'row boxes overlap');
  }
 }
}
function normalized(plan){
 const copy=structuredClone(plan);
 for(const b of copy.footerBoxes)if(b.mishnaSource==='levels')delete b.mishnaLevel;
 return copy;
}
function singlePage(family,presence,reverse){
 const controls=document.createElement('div');controls.innerHTML='<input id="talmud-other-as-mishna" type="checkbox">'+['01','02','03','04'].map(id=>`<div class="stream" data-stream="${id}"></div>`).join('');document.body.append(controls);
 const fixed=reverse?['02','01']:['01','02'];
 window.localStorage.clear();localStorage.setItem('ravtext.talmudLayout','1');localStorage.setItem('ravtext.talmudLayout.streams',fixed.join(','));
 // Reproduce the user's regression: the unrelated global preference may be ON
 // while the dedicated Talmud checkbox is OFF. That must still mean ordinary
 // footer layout in V9.
 localStorage.setItem('ravtext.mishnaWrap','1');
 window.__STREAM_SETTINGS__={};
 let renders=0;
 window.installExactCheckbox(()=>renders++);
 const cb=controls.querySelector('input');assert(cb.checked===false,'control starts checked');
 assert(isTalmudOtherAsMishnaEnabled()===false,'global Mishnah preference leaked into the Talmud-specific gate');
 const offCfg={pageWidth:380,pageHeight:800,padding:12,mainFontSize:13,sideFontSize:10,lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,
  crownLines:4,openingWordSettings:{enabled:false},mishnaWrapOn:isTalmudOtherAsMishnaEnabled(),levels:[['03','04']],talmudStreams:fixed,
  streamSettings:{'01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}},'03':{inlineStyle:{fontSize:10}},'04':{inlineStyle:{fontSize:10}}}};
 const offContent={mainText:text(14),rightStream:['both','right'].includes(presence)?mk(fixed[0],24):null,leftStream:['both','left'].includes(presence)?mk(fixed[1],24):null,footerStreams:[mk('03',4),mk('04',75)]};
 const offHost=document.createElement('div');document.body.append(offHost);
 try {
  const offPlan=next.buildSinglePage(offHost,offContent,offCfg);
  assert(offPlan.footerBoxes.every(b=>!b.mishnaRole),'unchecked Talmud control still produced Mishnah footer roles');
 } finally { offHost.remove(); }
 // The dedicated control must also leave an independently OFF global mode OFF.
 localStorage.setItem('ravtext.mishnaWrap','0');
 cb.click();
 const levels=window.readExactLevels();
 assert(JSON.stringify(levels)===JSON.stringify([['03','04']]),'actual control did not produce footer-only first level');
 assert(localStorage.getItem('ravtext.talmud.otherAsMishna')==='1','dedicated Talmud control was not persisted');
 assert(isTalmudOtherAsMishnaEnabled()===true&&renders===1,'checked Talmud control did not enable the effective gate');
 assert(localStorage.getItem('ravtext.mishnaWrap')==='0','dedicated control overwrote the independent global Mishnah preference');
 cb.click();
 assert(localStorage.getItem('ravtext.talmud.otherAsMishna')==='0','uncheck was not persisted');
 assert(isTalmudOtherAsMishnaEnabled()===false&&renders===2,'uncheck did not disable the effective gate');
 assert(localStorage.getItem('ravtext.mishnaWrap')==='0','uncheck overwrote the independent global preference');
 cb.click();
 assert(isTalmudOtherAsMishnaEnabled()===true&&renders===3,'re-enable failed');
 const ss={'01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}},'03':{inlineStyle:{fontSize:10}},'04':{inlineStyle:{fontSize:10}}};
 const cfg={pageWidth:380,pageHeight:800,padding:12,mainFontSize:13,sideFontSize:10,lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,
 crownLines:4,openingWordSettings:{enabled:false},mishnaWrapOn:isTalmudOtherAsMishnaEnabled(),levels,talmudStreams:fixed,streamSettings:ss};
 const content={mainText:text(14),rightStream:['both','right'].includes(presence)?mk(fixed[0],24):null,leftStream:['both','left'].includes(presence)?mk(fixed[1],24):null,footerStreams:[mk('03',4),mk('04',75)]};
 const input=JSON.stringify({content,cfg}),storageBefore=window.storageSnapshot();
 const hosts=[0,1,2].map(()=>{const p=document.createElement('div');document.body.append(p);return p});
 try{
  const old=base.buildSinglePage(hosts[0],content,cfg),current=next.buildSinglePage(hosts[1],content,cfg);
  const reference=base.buildSinglePage(hosts[2],content,{...cfg,levels:[fixed,['03','04']]});
  const oldPair=old.footerBoxes.filter(b=>b.mishnaRole),newPair=current.footerBoxes.filter(b=>b.mishnaRole);
  assert(oldPair.length===0,'baseline unexpectedly supports checkbox-generated first level');
  assert(newPair.length===2,'candidate did not activate both lower roles');
  assert(newPair.every(b=>b.mishnaLevel===1),'first-level provenance was lost');
  assert(JSON.stringify(normalized(current))===JSON.stringify(normalized(reference)),'short-form result differs from established expanded-level layout');
  assert(hosts[1].innerHTML===hosts[2].innerHTML,'same hierarchy painted differently');
  assert(JSON.stringify(current.streamBoxes)===JSON.stringify(old.streamBoxes),'fixed side geometry or ownership changed');
  assert(current.streamCoverage.every(c=>c.exact),'source coverage not exact');
  assert(JSON.stringify({content,cfg})===input&&window.storageSnapshot()===storageBefore,'input or storage was rewritten');
  rectangleCheck(current);
  const a=current.footerBoxes.find(b=>b.id==='03'),b=current.footerBoxes.find(b=>b.id==='04');
  assert(a.lines.length&&b.lines.length,'footer did not start');
  assert(Math.abs(a.lines[0].y-b.lines[0].y)<.02,'paired notes do not start together');
  assert(b.lines.some(l=>l.width>a.lines[0].width*1.5),'long note never expands below short partner');
  return {family,presence,reverse,storedLevels:levels,baselineWidths:old.footerBoxes.map(b=>b.titleWidth),candidateWidths:current.footerBoxes.map(b=>b.titleWidth),sameAsEstablishedLayout:true,sourceExact:true};
 }finally{controls.remove();hosts.forEach(h=>h.remove())}
}
function runControlAndPageChecks(){
 const results=[];
 for(const family of ['serif','sans-serif','monospace'])for(const presence of ['both','right','left','neither'])for(const reverse of [false,true]){
  try{results.push({pass:true,...singlePage(family,presence,reverse)})}catch(e){results.push({pass:false,family,presence,reverse,error:String(e)})}
 }
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
const sourceOf=node=>{const clone=node.cloneNode(true);clone.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return clone.textContent};
async function runPaginationChecks(){
 const results=[];
 for(const family of ['serif','sans-serif','monospace'])for(const reverse of [false,true]){
  const hosts=[];const fixed=reverse?['02','01']:['01','02'];window.localStorage.clear();window.__STREAM_SETTINGS__={};
  for(const id of ['01','02','03','04'])getStreamSettings()[id]={mainRefEnabled:true,noteNumEnabled:false,lemmaBold:false,titleShow:false};
  const main=text(36),after=text(16),tokens=[...main.matchAll(/\S+/g)];
  const notes=[['01',32,2],['02',25,5],['03',8,8],['04',420,16]].map(([stream,count,token])=>({stream,uid:'pair-'+stream,num:1,anchor:tokens[token].index+tokens[token][0].length,anchorAffinity:'backward',text:text(count)}));
  const input=[{id:'pair-main',mainText:main,notes},{id:'after-main',mainText:after,notes:[]}];
  const cfg={pageWidth:380,pageHeight:537,padding:12,reservedBottom:15,mainFontSize:13,sideFontSize:10,lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,crownLines:4,mainGap:8,streamHorizontalGap:8,openingWordSettings:{enabled:false},talmudStreams:fixed,mishnaWrapOn:true,levels:[['03','04']],maxPages:25,streamSettings:{'01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}},'03':{inlineStyle:{fontSize:10}},'04':{inlineStyle:{fontSize:10}}}};
  const stateBefore=JSON.stringify({input,cfg});
  try{
   const build=async(api,levels)=>{const host=document.createElement('div');hosts.push(host);document.body.append(host);const result=await api.buildPages(host,input,{...cfg,levels});assert(result.complete,'multi-page run incomplete');return {host,result}};
   const reference=await build(base,[fixed,['03','04']]),current=await build(next,cfg.levels);
   assert(current.result.pages.length>=2,'fixture is not actually multi-page');
   assert(current.result.pages.length===reference.result.pages.length,'equivalent configuration changed page count');
   assert(current.host.innerHTML===reference.host.innerHTML,'equivalent configuration has different page HTML');
   assert(JSON.stringify({input,cfg})===stateBefore,'pagination changed source or settings');
   for(const p of input){const rows=[...current.host.querySelectorAll(`[data-v9-paragraph-id="${p.id}"]`)];assert(rows.map(sourceOf).join('')===p.mainText,'main text loss');}
   const owners=notes.map(note=>{
    const key=`pair-main:${note.stream}:${note.uid}`;
    const ref=current.result.pages.findIndex(page=>[...page.querySelectorAll('[data-v9-main-ref]')].some(n=>n.dataset.uid===note.uid));
    const start=current.result.pages.findIndex(page=>[...page.querySelectorAll('[data-v9-note-start]')].some(n=>n.dataset.v9NoteStart===key));
    assert(ref>=0&&ref===start,'note did not start on its source-anchor page');
    const rows=[...current.host.querySelectorAll('.v9-final-stream-line')].filter(el=>el.dataset.v9SourceStream===note.stream);
    assert(rows.map(sourceOf).join('')===note.text,'note text not exact');
    if(['03','04'].includes(note.stream))assert(rows.every(el=>!['right','left'].includes(el.dataset.v9Role)),'footer stole a fixed side');
    return {stream:note.stream,referencePage:ref+1,startPage:start+1,sourceExact:true};
   });
   for(const page of current.result.pages){const lines=[...page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')].map(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top),width:parseFloat(el.style.width),lineHeightPx:parseFloat(el.style.height)}));rectangleCheck({pageBox:{height:522,padding:12},mainBox:{lines},streamBoxes:[],footerBoxes:[]});}
   results.push({family,reverse,pass:true,pages:current.result.pages.length,sameAsEstablishedLayout:true,owners});
  }catch(e){results.push({family,reverse,pass:false,error:String(e)})}finally{hosts.forEach(h=>h.remove())}
 }
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
function runPreservationChecks(){
 const results=[];
 const options=[
  {name:'expanded',fixed:['01','02'],levels:[['01','02'],['03','04']],on:true},
  {name:'no-fixed-selection',fixed:[],levels:[['03','04']],on:true},
  {name:'global-mode-off',fixed:['01','02'],levels:[['03','04']],on:false},
  {name:'first-level-overlaps-fixed',fixed:['01','02'],levels:[['01','03'],['04']],on:true},
  {name:'first-level-empty',fixed:['01','02'],levels:[[],['03','04']],on:true},
  {name:'explicit-pair',fixed:['01','02'],levels:[],on:false,roles:true},
  {name:'separate-levels',fixed:['01','02'],levels:[['01','02'],['03'],['04']],on:true},
  {name:'unrelated-first-level',fixed:['01','02'],levels:[['05','06'],['03','04']],on:true}
 ];
 for(const family of ['serif','sans-serif','monospace'])for(const variant of options)for(const presence of ['both','neither']){
  window.localStorage.clear();window.__STREAM_SETTINGS__={};const hosts=[0,1].map(()=>{const h=document.createElement('div');document.body.append(h);return h});
  try{
   const input={mainText:text(14),rightStream:presence==='both'?mk('01',24):null,leftStream:presence==='both'?mk('02',24):null,footerStreams:[mk('03',4),mk('04',75)]};
   const cfg={pageWidth:380,pageHeight:800,padding:12,mainFontSize:13,sideFontSize:10,lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,crownLines:4,openingWordSettings:{enabled:false},mishnaWrapOn:variant.on,levels:variant.levels,talmudStreams:variant.fixed,
    streamSettings:variant.roles?{'03':{layoutRole:'mishna'},'04':{layoutRole:'mishna'}}:{}};
   const before=JSON.stringify({input,cfg});
   const old=base.buildSinglePage(hosts[0],input,cfg),now=next.buildSinglePage(hosts[1],input,cfg);
   assert(JSON.stringify(now)===JSON.stringify(old),'preserved plan changed');
   assert(hosts[0].innerHTML===hosts[1].innerHTML,'preserved page HTML changed');
   assert(JSON.stringify({input,cfg})===before,'input changed');
   results.push({name:variant.name,family,presence,pass:true,planAndPaintIdentical:true});
  }catch(e){results.push({name:variant.name,family,presence,pass:false,error:String(e)})}finally{hosts.forEach(h=>h.remove())}
 }
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}

return {runControlAndPageChecks,runPaginationChecks,runPreservationChecks};
}
