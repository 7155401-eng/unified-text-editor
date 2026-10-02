// Neutral reproductions of an anchored long side stream starving earlier footers.
// No user text, proprietary font, or new line-breaking implementation.
import {buildSinglePage} from '../../src/vilna_v9.js';
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const words=['אב','גדה','וזחט','יכל','מנס','עפצ','קרשת'];
const textOf=n=>Array.from({length:n},(_,i)=>words[i%words.length]).join(' ');
const stream=(id,n)=>{const text=textOf(n);return {id,items:[text],rich:{text,runs:[{start:0,end:text.length,marks:{v9NoteKey:id}},{start:0,end:2,marks:{v9NoteStart:id}}]}};};
export function footerFixture({family='serif',longSide='right',mainWords=18,footerSize=10,paired=true,mode='starved'}={}){
 const text=textOf(mode==='main-overflow'?500:mainWords);
 const short=stream('01',mode==='no-continuation'?9:14),long=stream('02',mode==='no-continuation'?12:400);
 const content={mainText:text,mainParagraphs:[{id:'fixture-main',text,runs:[],mainRefs:[]}],
  rightStream:longSide==='right'?long:short,leftStream:longSide==='right'?short:long,
  footerStreams:mode==='no-footers'?[]:[stream('03',mode==='long-footer'?500:20),stream('04',mode==='long-footer'?500:30)]};
 if(mode==='unstarted-side'){const s=content.rightStream;s.rich.text='W'.repeat(300);s.items=[s.rich.text];s.rich.runs[0].end=s.rich.text.length;}
 content.requiredNoteStarts=[content.rightStream,content.leftStream,...content.footerStreams].map((s,i)=>({key:s.id,stream:s.id,paragraphId:'fixture-main',anchor:3+i*4,requireMainAnchor:true,sourceLength:text.length}));
 const cfg={pageWidth:380,pageHeight:537,padding:12,reservedBottom:15,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
  mainFontFamily:family,sideFontFamily:family,crownLines:4,crownMainGapPx:8,mainGap:8,streamHorizontalGap:12,
  openingWordSettings:{enabled:false},streamSettings:{'03':{inlineStyle:{fontSize:footerSize}},'04':{inlineStyle:{fontSize:footerSize}}},
  levels:[['01','02'],['03','04']],mishnaWrapOn:paired};
 return {content,cfg};
}
function geometry(plan){return [...(plan.mainBox?.lines||[]),...plan.streamBoxes.flatMap(b=>b.lines),...plan.footerBoxes.flatMap(b=>b.lines)];}
function firstDifferences(a,b,limit=12){
 const out=[];
 const walk=(x,y,path)=>{
  if(out.length>=limit)return;
  if(Object.is(x,y))return;
  const xo=x&&typeof x==='object',yo=y&&typeof y==='object';
  if(!xo||!yo||Array.isArray(x)!==Array.isArray(y)){
   out.push({path,left:x,right:y});return;
  }
  const keys=new Set([...Object.keys(x),...Object.keys(y)]);
  for(const key of keys){if(out.length>=limit)break;walk(x[key],y[key],path?path+'.'+key:key);}
 };
 walk(a,b,'');return out;
}
export function runFooterReservationChecks({baselineBuildSinglePage}={}){
 assert(typeof baselineBuildSinglePage==='function','Pinned baseline is required for preservation checks');
 const results=[];
 const inspect=(options)=>{
  const {content,cfg}=footerFixture(options),before=JSON.stringify({content,cfg});
  const host=document.createElement('div');document.body.append(host);
  const oldHost=document.createElement('div');document.body.append(oldHost);
  try{
   const old=baselineBuildSinglePage(oldHost,content,cfg),plan=buildSinglePage(host,content,cfg);
   assert(JSON.stringify({content,cfg})===before,'caller input or settings were changed');
   assert(plan.streamCoverage.every(c=>c.exact),'source coverage incomplete');
   assert((plan.mainBox?.lines||[]).map(l=>l.sourceText).join('')+(plan.overflow.mainText||'')===content.mainText,'main source altered');
   if(options.mode&&options.mode!=='starved'){
    assert(!plan.footerSpaceReservation,'excluded baseline was changed');
    const planSame=JSON.stringify(plan)===JSON.stringify(old),htmlSame=host.innerHTML===oldHost.innerHTML;
    assert(planSame&&htmlSame,
      'excluded case is not identical to original: '+JSON.stringify({planSame,htmlSame,diffs:firstDifferences(old,plan)}));
    return {scope:'preservation-only',sameAsBaseline:!!old};
   }
   assert(old.unstartedNotes.some(n=>['03','04'].includes(n.stream)),'test never reproduced missing footer note');
   assert(plan.footerSpaceReservation,'required footer reservation was not attempted or not accepted');
   assert(!plan.unstartedNotes.length,'an anchored note did not start on its page');
   assert(!plan.overflow.mainText&&!plan.overflow.exceedsPage,'actual page overflow');
   const fs=plan.streamCoverage.filter(c=>['03','04'].includes(c.stream));
   assert(fs.length===2&&fs.every(c=>c.remainingCharacters===0),'earlier footers were displaced');
   assert(plan.streamCoverage.some(c=>c.stream==='02'&&c.plannedCharacters>0&&c.remainingCharacters>0),'long side note did not continue after starting');
   const lines=geometry(plan),bottom=cfg.pageHeight-cfg.padding-cfg.reservedBottom;
   for(let i=0;i<lines.length;i++){
    const a=lines[i];assert(a.y+a.lineHeightPx<=bottom+1/64,'line exceeds page bottom');
    for(let j=i+1;j<lines.length;j++){
     const b=lines[j];assert(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<=1/64||Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y)<=1/64,'overlapping final lines');
    }
   }
   assert(plan.footerSpaceReservation.allocationTrials===1,'unbounded reservation search');
   return {scope:'measured-allocation',reservation:plan.footerSpaceReservation,previouslyUnstarted:old?.unstartedNotes.length??null,footerCharacters:fs.reduce((a,c)=>a+c.plannedCharacters,0),sideContinuation:plan.streamCoverage.find(c=>c.stream==='02').remainingCharacters};
  }finally{host.remove();oldHost.remove();}
 };
 const run=options=>{try{results.push({name:JSON.stringify(options),pass:true,...inspect(options)});}catch(e){results.push({name:JSON.stringify(options),pass:false,error:String(e)});}};
 for(const family of ['serif','sans-serif','monospace'])for(const longSide of ['left','right'])for(const mainWords of [18,30])for(const footerSize of [10,11])for(const paired of [true,false])run({family,longSide,mainWords,footerSize,paired});
 for(const family of ['serif','sans-serif','monospace'])for(const mode of ['no-footers','no-continuation','long-footer','unstarted-side','main-overflow'])run({family,mode});
 return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
}
