import { buildSinglePage } from '../../src/vilna_v9.js';

const phrase = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const mainText = Array(5).fill('אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר').join(' ');
const text = Array(24).fill(phrase).join(' ');
const base = { pageWidth:380,pageHeight:900,padding:12,mainFontSize:13,sideFontSize:11,
  lineHeightRatio:1.55,mainFontFamily:'serif',sideFontFamily:'serif',crownLines:4,
  balanceSingleStreamSides:true,openingWordSettings:{enabled:false} };
const assert = (ok, message) => { if (!ok) throw new Error(message); };

function inspect(config, {size=13,start=.2,side='right',twoStreams=false,richRuns=null}={}) {
  const runs = richRuns || (size===11 ? [] : [{start:Math.floor(text.length*start),end:text.length,
    marks:{fontSize:size,color:'rgb(31,47,67)'}}]);
  const single = {id:'01',items:[text],runs,rich:{text,runs}};
  const content = {mainText,rightStream:side==='right'?single:null,
    leftStream:side==='left'?single:null,footerStreams:[]};
  if(twoStreams) content.leftStream={...single,id:'02'};
  const original=JSON.stringify(content),settings=JSON.stringify(config);
  const page=document.createElement('div');page.className='v9-page';page.style.position='relative';document.body.append(page);
  try {
    const plan=buildSinglePage(page,content,config);
    assert(JSON.stringify(content)===original,'source text/runs mutated');
    assert(JSON.stringify(config)===settings,'caller settings mutated');
    assert(plan.streamCoverage.every(s=>s.exact),'source coverage mismatch');
    const boxes=['right','left'].map(role=>plan.streamBoxes.find(b=>b.role===role));
    assert(boxes.every(Boolean),'both columns must exist');
    const summaries=[];
    for(const box of boxes) {
      const crownStrip=box.strips[0];
      const crownRows=box.lines.filter(l=>l.y < crownStrip.y_end-.02 && Math.abs(l.width-crownStrip.width)<.02
        && l.y+l.lineHeightPx<=crownStrip.y_end+.02);
      assert(crownRows.length===config.crownLines,`${box.role} has ${crownRows.length} complete wide crown rows instead of ${config.crownLines}`);
      const expected=[...box.lines].sort((a,b)=>a.y-b.y);
      for(let i=1;i<expected.length;i++) {
        const prev=expected[i-1],line=expected[i];
        assert(Math.abs(line.y-prev.y-prev.lineHeightPx)<.05,`${box.role} artificial row gap at ${i}`);
      }
      assert(box.lines.every(l=>l.y+l.lineHeightPx<=config.pageHeight-config.padding+.05),'row outside page');
      summaries.push({role:box.role,crownRows:crownRows.length,firstY:crownRows[0].y,
        fourthBottom:crownRows.at(-1).y+crownRows.at(-1).lineHeightPx,
        pitch:crownRows[0].lineHeightPx,rows:box.lines.length});
    }
    const mainTop=Math.min(...plan.mainBox.lines.map(l=>l.y));
    assert(mainTop>=Math.max(...summaries.map(s=>s.fourthBottom))+config.crownMainGapPx-.05,'main collides with a full crown');
    const positioned=page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line');
    const rects=[...positioned].map(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top),
      w:parseFloat(el.style.width),h:parseFloat(el.style.height)}));
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++) {
      const a=rects[i],b=rects[j];
      const overlapX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
      const overlapY=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
      assert(overlapX<.2 || overlapY<.2,'planned row boxes overlap');
    }
    if(size!==11 || richRuns) assert(page.querySelector('[style*="rgb(31, 47, 67)"]'),'rich source styling lost');
    return {columns:summaries,crownBottom:plan.crownBottomY,mainTop,
      replans:plan.splitCrownSizing?.passes||0,coverage:plan.streamCoverage};
  } finally { page.remove(); }
}

export function runSplitCrownChecks() {
  const results=[];
  const run=(name,fn)=>{try{results.push({name,pass:true,...fn()});}catch(error){results.push({name,pass:false,error:String(error)});}};
  for(const family of ['serif','sans-serif','monospace'])for(const size of [13,16,20])
  for(const side of ['right','left'])for(const gap of [0,11]) {
    run(`${family}/size=${size}/${side}/gap=${gap}`,()=>inspect({...base,sideFontFamily:family,crownMainGapPx:gap},{size,side}));
  }
  for(const rows of [2,3,4,5])for(const start of [.2,.5]) {
    run(`requested=${rows}/start=${start}`,()=>inspect({...base,crownLines:rows,crownMainGapPx:11},{size:16,start}));
  }
  for(const size of [11,13,20]) {
    run(`uniform-rich-prefix-${size}`,()=>inspect({...base,crownMainGapPx:11},{size,start:0}));
  }
  // The single-split correction must not change independent-stream selection.
  run('two-independent-streams',()=>inspect({...base,crownMainGapPx:11},{size:13,start:0,twoStreams:true}));
  return {total:results.length,passed:results.filter(r=>r.pass).length,
    failed:results.filter(r=>!r.pass).length,results};
}
