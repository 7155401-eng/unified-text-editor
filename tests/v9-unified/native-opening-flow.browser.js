import {createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {layoutV9MainParagraphs} from '../../src/engine/v9_main_inline_layout.js';

const assert=(v,m)=>{if(!v)throw new Error(m)};
const words=['אב','גדה','וזח','טיכל','מנס','עפצק','רשת','שלום','עולם'];

function settings(family,dropLines){
  return {
    mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
    openingWordSettings:{enabled:true,target:'word',count:1,font:'inherit',size:175,weight:'bold',
      position:'dropped',dropLines,spaceAfter:.30,scope:'all',skipHeadings:false,
      skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false}
  };
}
function makeText(count){
  return 'פתיח '+Array.from({length:count},(_,i)=>words[i%words.length]).join(' ');
}
function mergeByTop(items,tolerance=.75){
  const lines=[];
  for(const item of items.sort((a,b)=>a.top-b.top||b.right-a.right)){
    let row=lines.find(line=>Math.abs(line.top-item.top)<=tolerance);
    if(!row){row={top:item.top,bottom:item.bottom,items:[]};lines.push(row);}
    row.items.push(item);row.top=Math.min(row.top,item.top);row.bottom=Math.max(row.bottom,item.bottom);
  }
  return lines.sort((a,b)=>a.top-b.top).map((line,index)=>{
    const left=Math.min(...line.items.map(x=>x.left)),right=Math.max(...line.items.map(x=>x.right));
    return {index,left,right,top:line.top,bottom:line.bottom,width:right-left,
      words:line.items.length,text:line.items.map(x=>x.text).join(' ')};
  });
}
async function nativeFlow({text,width,family,dropLines}){
  const fontSize=16,lineHeight=24,openingScale=1.75,gap=fontSize*.30;
  const root=document.createElement('div');
  root.className='native-opening-proof';
  root.style.cssText='position:absolute;left:0;top:0;margin:0;padding:0;border:0;direction:rtl;';
  const p=document.createElement('div');
  p.style.cssText='position:relative;box-sizing:border-box;margin:0;padding:0;border:0;white-space:normal;';
  Object.assign(p.style,{width:width+'px',direction:'rtl',fontFamily:family,fontSize:fontSize+'px',
    lineHeight:lineHeight+'px',textAlign:'justify',textAlignLast:'center'});
  const firstSpace=text.indexOf(' ');
  const openingText=firstSpace<0?text:text.slice(0,firstSpace);
  const remainder=firstSpace<0?'':text.slice(firstSpace);
  const opening=document.createElement('span');
  opening.className='native-opening-word';
  opening.textContent=openingText;
  Object.assign(opening.style,{float:'right',fontFamily:family,fontSize:(fontSize*openingScale)+'px',
    fontWeight:'700',lineHeight:'1',height:(dropLines*lineHeight)+'px',marginLeft:gap+'px',
    shapeOutside:'margin-box',whiteSpace:'pre'});
  p.append(opening);
  const tokenRe=/\s+|\S+/gu;let match;
  while((match=tokenRe.exec(remainder))){
    if(/^\s+$/u.test(match[0]))p.append(document.createTextNode(match[0]));
    else{
      const span=document.createElement('span');span.className='native-word';span.textContent=match[0];
      span.dataset.sourceStart=String(firstSpace+match.index);span.dataset.sourceEnd=String(firstSpace+match.index+match[0].length);
      p.append(span);
    }
  }
  root.append(p);document.body.append(root);await document.fonts.ready;
  const pr=p.getBoundingClientRect(),or=opening.getBoundingClientRect();
  const items=[...p.querySelectorAll('.native-word')].map(el=>{
    const r=el.getBoundingClientRect();return {text:el.textContent,left:r.left-pr.left,right:r.right-pr.left,
      top:r.top-pr.top,bottom:r.bottom-pr.top,start:Number(el.dataset.sourceStart),end:Number(el.dataset.sourceEnd)};
  });
  const lines=mergeByTop(items).map((line,index,all)=>{
    const overlapsOpening=line.top<or.bottom-pr.top-.5&&line.bottom>or.top-pr.top+.5;
    const targetRight=overlapsOpening?(or.left-pr.left-gap):width;
    return {...line,isLast:index===all.length-1,overlapsOpening,targetRight,
      leftGap:line.left,rightGap:targetRight-line.right,
      fullCenterDeviation:Math.abs((line.left+line.right)/2-width/2)};
  });
  const out={sourceExact:p.textContent===text,width,height:p.getBoundingClientRect().height,
    opening:{left:or.left-pr.left,right:or.right-pr.left,top:or.top-pr.top,bottom:or.bottom-pr.top,gap},
    lines,html:p.outerHTML};
  root.remove();return out;
}
async function currentV9({text,width,family,dropLines}){
  const cfg=settings(family,dropLines),ctx=createV9TextLayoutContext(cfg);
  const host=document.createElement('div');host.className='v9-proof';host.style.cssText='position:absolute;left:0;top:0;direction:rtl;';
  document.body.append(host);
  try{
    const entry=ctx.prepareEntry({id:'native-opening-proof',index:1,text,runs:[],mainRefs:[]});
    const plan=layoutV9MainParagraphs([entry],[{x:0,width,y_start:0,y_end:2000}],ctx,2000);
    for(const line of plan.lines)renderV9PlannedMainLine(line,host,0);
    const base=host.getBoundingClientRect();
    const bodies=[...host.querySelectorAll('.v9-planned-line-text')];
    const lines=plan.lines.map((line,index)=>{
      const range=document.createRange();range.selectNodeContents(bodies[index]);const r=range.getBoundingClientRect();
      const opening=line.render.opening;
      return {index,left:r.left-base.left,right:r.right-base.left,top:r.top-base.top,bottom:r.bottom-base.top,
        width:r.width,words:line.wordTokens.length,text:line.wordTokens.map(x=>x.text).join(' '),isLast:line.isLast,
        openingWindow:line.openingWindow,leftGap:(r.left-base.left)-line.x,
        rightGap:(line.x+line.width)-(r.right-base.left),
        fullCenterDeviation:Math.abs(((r.left+r.right)/2-base.left)-width/2),
        wordSpacing:line.render.wordSpacing,opening:opening?{x:opening.x,y:opening.y,width:opening.width,height:opening.height,gap:opening.gap}:null};
    });
    return {sourceExact:host.textContent===text,overflow:plan.overflowText,lines,diagnostics:plan.diagnostics,
      height:plan.endY,html:host.innerHTML};
  }finally{ctx.dispose();host.remove();}
}

export async function runNativeOpeningProof(){
  const records=[];let nativeLeftMisses=0,nativeFinalOffCenter=0,v9LeftMisses=0,v9FinalOffCenter=0,wordBreakDiffs=0;
  for(const family of ['serif','sans-serif','monospace'])for(const width of [160,220,320])
  for(const count of [6,10,18,28])for(const dropLines of [2,3]){
    const text=makeText(count),native=await nativeFlow({text,width,family,dropLines}),v9=await currentV9({text,width,family,dropLines});
    assert(native.sourceExact,'native source changed');assert(v9.sourceExact&&v9.overflow==='','V9 source changed/overflowed');
    const nonFinal=native.lines.filter(l=>!l.isLast);
    const nMiss=nonFinal.filter(l=>Math.abs(l.leftGap)>.75||Math.abs(l.rightGap)>.75).length;
    const vMiss=v9.lines.filter(l=>!l.isLast&&l.words>0).filter(l=>Math.abs(l.leftGap)>.75||Math.abs(l.rightGap)>.75).length;
    const nFinal=native.lines.at(-1),vFinal=v9.lines.at(-1);
    const nOff=nFinal?Number(nFinal.fullCenterDeviation>.75):0;
    const vOff=vFinal?Number(vFinal.fullCenterDeviation>.75):0;
    const nCounts=native.lines.map(l=>l.words),vCounts=v9.lines.map(l=>l.words);
    const diff=JSON.stringify(nCounts)!==JSON.stringify(vCounts);
    nativeLeftMisses+=nMiss;v9LeftMisses+=vMiss;nativeFinalOffCenter+=nOff;v9FinalOffCenter+=vOff;wordBreakDiffs+=Number(diff);
    records.push({family,width,count,dropLines,native:{lineCount:native.lines.length,wordCounts:nCounts,leftMisses:nMiss,
      finalCenterDeviation:nFinal?.fullCenterDeviation??null,finalOverlapsOpening:nFinal?.overlapsOpening??false,height:native.height},
      v9:{lineCount:v9.lines.length,wordCounts:vCounts,leftMisses:vMiss,finalCenterDeviation:vFinal?.fullCenterDeviation??null,height:v9.height},
      wordBreaksDiffer:diff});
  }
  return {total:records.length,nativeLeftMisses,v9LeftMisses,nativeFinalOffCenter,v9FinalOffCenter,wordBreakDiffs,records};
}

export async function renderComparisonCase({family='serif',width=220,count=10,dropLines=2}={}){
  const stage=document.querySelector('#stage');stage.replaceChildren();
  const text=makeText(count);
  for(const [label,type] of [['Browser native float','native'],['Current V9','v9']]){
    const wrap=document.createElement('section');wrap.style.cssText='display:inline-block;vertical-align:top;margin:16px;padding:12px;border:1px solid #bbb;background:white;';
    const h=document.createElement('h3');h.textContent=label;h.style.cssText='direction:ltr;font:600 14px sans-serif;margin:0 0 8px;';wrap.append(h);
    const body=document.createElement('div');body.style.cssText=`position:relative;width:${width}px;min-height:240px;background:#fff;overflow:visible;`;wrap.append(body);stage.append(wrap);
    if(type==='native'){
      const fontSize=16,lineHeight=24,gap=fontSize*.30,firstSpace=text.indexOf(' ');
      const p=document.createElement('div');Object.assign(p.style,{width:width+'px',direction:'rtl',fontFamily:family,fontSize:fontSize+'px',lineHeight:lineHeight+'px',textAlign:'justify',textAlignLast:'center'});
      const op=document.createElement('span');op.textContent=text.slice(0,firstSpace);Object.assign(op.style,{float:'right',fontSize:(fontSize*1.75)+'px',fontWeight:'700',lineHeight:'1',height:(dropLines*lineHeight)+'px',marginLeft:gap+'px',shapeOutside:'margin-box'});
      p.append(op,document.createTextNode(text.slice(firstSpace)));body.append(p);
    }else{
      const cfg=settings(family,dropLines),ctx=createV9TextLayoutContext(cfg);const entry=ctx.prepareEntry({id:'shot',index:1,text,runs:[],mainRefs:[]});
      const plan=layoutV9MainParagraphs([entry],[{x:0,width,y_start:0,y_end:500}],ctx,500);for(const l of plan.lines)renderV9PlannedMainLine(l,body,0);ctx.dispose();
    }
  }
  await document.fonts.ready;return {text};
}
