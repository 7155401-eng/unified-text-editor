import { buildPages } from '../../src/vilna_v9.js';
import { getStreamSettings } from '../../src/original_stream_columns.js';

const neutral='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר אחד עשר שנים עשר';
const sideText='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';

function anchorAt(text,index){
  const words=[...String(text).matchAll(/\S+/gu)];
  const w=words[Math.min(words.length-1,Math.max(0,index))];
  return w ? w.index+w[0].length : Math.max(0,text.length-1);
}
function input(){
  return Array.from({length:7},(_,pi)=>{
    const main=Array(3+(pi%3)).fill(neutral).join(' ');
    return {id:`underfill-${pi}`,mainText:main,notes:[
      {stream:'01',uid:`uf-a-${pi}`,num:pi*3+1,anchor:anchorAt(main,5),anchorAffinity:'backward',text:Array(5+(pi%3)).fill(sideText).join(' ')},
      {stream:'02',uid:`uf-b-${pi}`,num:pi*3+2,anchor:anchorAt(main,12),anchorAffinity:'backward',text:Array(6+((pi+1)%3)).fill(sideText).join(' ')},
      {stream:'03',uid:`uf-f-${pi}`,num:pi*3+3,anchor:anchorAt(main,19),anchorAffinity:'backward',text:Array(3+(pi%2)).fill(neutral).join(' ')}
    ]};
  });
}

export async function runUnderfillTrace(){
  const settings=getStreamSettings(),saved={};
  for(const id of ['01','02','03']){
    saved[id]=settings[id];
    settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false,titleShow:false};
  }
  const host=document.createElement('div');
  host.style.cssText='position:relative;width:400px;';
  document.body.appendChild(host);
  try{
    window.__ravtextAuditV9GapFillTrace=true;
    window.__ravtextV9GapFillTrace=[];
    window.__ravtextAuditV9ExtensionTrace=true;
    window.__ravtextV9ExtensionTrace=[];
    const result=await buildPages(host,input(),{
      pageWidth:380,pageHeight:360,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
      mainFontFamily:'serif',sideFontFamily:'serif',talmudStreams:['01','02'],maxPages:120,
      crownLines:4,crownMainGapPx:11,mainBottomGapPx:24,mishnaWrapOn:false,
      streamSettings:{
        '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
        '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
        '03':{inlineStyle:{fontSize:10,lineHeight:1.4},cols:1},
      },
      openingWordSettings:{enabled:false},
    });
    const pages=result.pages.map((p,index)=>{
      const lines=[...p.querySelectorAll('.v9-line')];
      return {
        index,
        fill:Number(p.dataset.v9PageFill),
        main:lines.filter(l=>l.dataset.v9Role==='main').length,
        commentary:lines.filter(l=>l.dataset.v9Role!=='main').length,
        pendingIn:p.dataset.v9PendingIn,
        carryInChars:Number(p.dataset.v9CarryInChars||0),
        sparseRescue:p.dataset.v9SparseRescue||'',
        mainPass:p.dataset.v9MainPass||'',
      };
    });
    return {
      complete:result.complete,
      pages,
      worst:[...pages.slice(0,-1)].sort((a,b)=>a.fill-b.fill).slice(0,5),
      gapTrace:[...(window.__ravtextV9GapFillTrace||[])],
      extensionTrace:[...(window.__ravtextV9ExtensionTrace||[])],
      anchorFallbacks:result.noteAnchorFallbacks||[],
    };
  } finally {
    host.remove();
    window.__ravtextAuditV9GapFillTrace=false;
    window.__ravtextAuditV9ExtensionTrace=false;
    for(const id of ['01','02','03']){if(saved[id]===undefined)delete settings[id];else settings[id]=saved[id];}
  }
}
