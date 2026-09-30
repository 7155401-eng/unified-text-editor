import { buildPages } from '../../src/vilna_v9.js';
import { getStreamSettings } from '../../src/original_stream_columns.js';

const neutral='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר אחד עשר שנים עשר';
const sideText='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';

function makeHost() {
  const el=document.createElement('div');
  el.style.cssText='position:relative;width:400px;';
  document.body.appendChild(el);
  return el;
}

function anchorAt(text,index) {
  const words=[...String(text).matchAll(/\S+/gu)];
  const w=words[Math.min(words.length-1,Math.max(0,index))];
  return w ? w.index+w[0].length : Math.max(0,text.length-1);
}

function scenarioInput(includeFooter) {
  return Array.from({length:7},(_,pi)=>{
    const main=Array(3+(pi%3)).fill(neutral).join(' ');
    const notes=[
      {stream:'01',uid:`fill-a-${pi}`,num:pi*3+1,anchor:anchorAt(main,5),anchorAffinity:'backward',
       text:Array(5+(pi%3)).fill(sideText).join(' ')},
      {stream:'02',uid:`fill-b-${pi}`,num:pi*3+2,anchor:anchorAt(main,12),anchorAffinity:'backward',
       text:Array(6+((pi+1)%3)).fill(sideText).join(' ')},
    ];
    if(includeFooter) notes.push({
      stream:'03',uid:`fill-f-${pi}`,num:pi*3+3,anchor:anchorAt(main,19),anchorAffinity:'backward',
      text:Array(3+(pi%2)).fill(neutral).join(' ')
    });
    return {id:`fill-matrix-${includeFooter?'f':'n'}-${pi}`,mainText:main,notes};
  });
}

function summarizeSplitTrace(trace=[]) {
  let decisionCount=0;
  let maxLostFill=0;
  let worst=null;

  for(const item of trace){
    const candidates=Array.isArray(item?.candidates)?item.candidates:[];
    const accepted=candidates.filter(c=>
      c?.meta &&
      c?.policyScore?.accept!==false &&
      c?.meta?.hasNoteOverflow!==true &&
      Number.isFinite(Number(c?.meta?.fill))
    );
    if(!accepted.length) continue;
    decisionCount++;

    const topPriority=Math.max(...accepted.map(c=>Number(c.priority)||0));
    const selectedPool=accepted.filter(c=>(Number(c.priority)||0)===topPriority);
    const selected=selectedPool.sort((a,b)=>(Number(b.meta.score)||-Infinity)-(Number(a.meta.score)||-Infinity))[0];
    const bestFill=[...accepted].sort((a,b)=>Number(b.meta.fill)-Number(a.meta.fill))[0];
    const selectedFill=Number(selected?.meta?.fill);
    const bestFillValue=Number(bestFill?.meta?.fill);
    const lost=Number.isFinite(selectedFill)&&Number.isFinite(bestFillValue)
      ? Math.max(0,bestFillValue-selectedFill)
      : 0;

    if(lost>maxLostFill){
      maxLostFill=lost;
      worst={
        pageIdx:item?.pageIdx??null,
        selectedPriority:topPriority,
        selected:{kind:selected?.kind,offset:selected?.offset,fill:selectedFill,score:selected?.meta?.score},
        bestFill:{kind:bestFill?.kind,offset:bestFill?.offset,priority:bestFill?.priority,fill:bestFillValue,score:bestFill?.meta?.score},
        lostFill:+lost.toFixed(4),
      };
    }
  }
  return {decisionCount,maxLostFill:+maxLostFill.toFixed(4),worst};
}

function pageStats(page,index) {
  const fill=Number(page.dataset.v9PageFill);
  const lines=[...page.querySelectorAll('.v9-line')];
  const main=lines.filter(l=>l.dataset.v9Role==='main').length;
  const commentary=lines.length-main;
  return {
    index,
    fill:Number.isFinite(fill)?fill:null,
    main,
    commentary,
    sparseRescue:page.dataset.v9SparseRescue||'',
    mainPass:page.dataset.v9MainPass||'',
  };
}

export async function runV9FillAudit() {
  const settings=getStreamSettings();
  const saved={};
  for(const id of ['01','02','03']){
    saved[id]=settings[id];
    settings[id]={
      ...(settings[id]||{}),
      mainRefEnabled:true,
      noteNumEnabled:true,
      lemmaBold:false,
      titleShow:false,
    };
  }

  const scenarios=[];
  try {
    for(const crownLines of [2,4]){
      for(const crownMainGapPx of [0,7,11,16]){
        for(const opening of [false,true]){
          for(const includeFooter of [false,true]){
            const host=makeHost();
            try {
              const input=scenarioInput(includeFooter);
              const config={
                pageWidth:380,
                pageHeight:360,
                padding:12,
                mainFontSize:13,
                sideFontSize:11,
                lineHeightRatio:1.55,
                mainFontFamily:'serif',
                sideFontFamily:'serif',
                talmudStreams:['01','02'],
                maxPages:120,
                crownLines,
                crownMainGapPx,
                mainBottomGapPx:includeFooter?24:0,
                mishnaWrapOn:false,
                streamSettings:{
                  '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
                  '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
                  '03':{inlineStyle:{fontSize:10,lineHeight:1.4},cols:1},
                },
                openingWordSettings:opening
                  ? {enabled:true,target:'word',count:1,position:'dropped',size:150,font:'inherit',dropLines:2,spaceAfter:.3,scope:'all'}
                  : {enabled:false},
              };
              window.__ravtextAuditV9SplitTrace=true;
              window.__ravtextV9SplitDecisionTrace=[];
              window.__ravtextAuditV9GapFillTrace=true;
              window.__ravtextV9GapFillTrace=[];
              window.__ravtextAuditV9ExtensionTrace=true;
              window.__ravtextV9ExtensionTrace=[];
              const result=await buildPages(host,input,config);
              const splitTrace=[...(window.__ravtextV9SplitDecisionTrace||[])];
              const gapFillTrace=[...(window.__ravtextV9GapFillTrace||[])];
              const extensionTrace=[...(window.__ravtextV9ExtensionTrace||[])];
              window.__ravtextV9SplitDecisionTrace=[];
              window.__ravtextAuditV9SplitTrace=false;
              window.__ravtextV9GapFillTrace=[];
              window.__ravtextAuditV9GapFillTrace=false;
              window.__ravtextV9ExtensionTrace=[];
              window.__ravtextAuditV9ExtensionTrace=false;
              if(!result.complete) throw new Error(`incomplete matrix scenario ${JSON.stringify({crownLines,crownMainGapPx,opening,includeFooter})}`);
              const stats=result.pages.map(pageStats);
              const intermediate=stats.slice(0,-1).filter(x=>Number.isFinite(x.fill));
              const fills=intermediate.map(x=>x.fill);
              const min=fills.length?Math.min(...fills):1;
              const avg=fills.length?fills.reduce((a,b)=>a+b,0)/fills.length:1;
              const sorted=[...intermediate].sort((a,b)=>a.fill-b.fill);
              scenarios.push({
                crownLines,crownMainGapPx,opening,includeFooter,
                pages:result.pages.length,
                minFill:+min.toFixed(4),
                avgFill:+avg.toFixed(4),
                under82:fills.filter(x=>x<.82).length,
                under68:fills.filter(x=>x<.68).length,
                under55:fills.filter(x=>x<.55).length,
                worst:sorted.slice(0,3),
                anchorFallbacks:(result.noteAnchorFallbacks||[]).length,
                splitTrace:summarizeSplitTrace(splitTrace),
                gapFillTrace:gapFillTrace
                  .filter(g=>Number.isFinite(Number(g?.beforeFill)) && Number(g.beforeFill)<.84)
                  .map(g=>({
                    pageIdx:g.pageIdx,
                    beforeFill:g.beforeFill,
                    afterFill:g.afterFill,
                    accepted:g.accepted,
                    remainingPxBefore:g.remainingPxBefore,
                    candidateCount:g.candidateCount,
                    selectedKind:g.selectedKind,
                    selectedOffset:g.selectedOffset,
                    rejectedReasons:(g.rejectedReasons||[]).slice(0,20),
                  })),
                extensionTrace:extensionTrace
                  .filter(e=>Number.isFinite(Number(e?.currentFill)) && Number(e.currentFill)<.84)
                  .map(e=>({
                    pageIdx:e.pageIdx,
                    currentFill:e.currentFill,
                    secondTextLength:e.secondTextLength,
                    selected:e.selected,
                    candidates:(e.candidates||[]).slice(0,30),
                  })),
              });
            } finally {
              host.remove();
            }
          }
        }
      }
    }
  } finally {
    for(const id of ['01','02','03']){
      if(saved[id]===undefined) delete settings[id];
      else settings[id]=saved[id];
    }
  }

  const worstScenarios=[...scenarios].sort((a,b)=>a.minFill-b.minFill).slice(0,12);
  const priorityLoss=[...scenarios]
    .filter(s=>Number(s.splitTrace?.maxLostFill)>0)
    .sort((a,b)=>Number(b.splitTrace.maxLostFill)-Number(a.splitTrace.maxLostFill))
    .slice(0,12);
  return {
    scenarios:scenarios.length,
    worstGlobal:worstScenarios,
    priorityLoss,
    worstGapFillRejections:[...scenarios]
      .flatMap(s=>(s.gapFillTrace||[]).map(g=>({
        crownLines:s.crownLines,crownMainGapPx:s.crownMainGapPx,opening:s.opening,includeFooter:s.includeFooter,...g
      })))
      .filter(g=>!g.accepted)
      .sort((a,b)=>Number(a.beforeFill)-Number(b.beforeFill))
      .slice(0,30),
    worstExtensionDecisions:[...scenarios]
      .flatMap(s=>(s.extensionTrace||[]).map(e=>({
        crownLines:s.crownLines,crownMainGapPx:s.crownMainGapPx,opening:s.opening,includeFooter:s.includeFooter,...e
      })))
      .sort((a,b)=>Number(a.currentFill)-Number(b.currentFill))
      .slice(0,30),
    under82Scenarios:scenarios.filter(s=>s.under82>0).length,
    under68Scenarios:scenarios.filter(s=>s.under68>0).length,
    under55Scenarios:scenarios.filter(s=>s.under55>0).length,
  };
}
