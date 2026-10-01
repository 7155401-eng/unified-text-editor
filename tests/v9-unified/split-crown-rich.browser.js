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
  // Crown clearance around a main block must not alter pages that have no
  // main block, or where the crown was disabled. Preserve those existing paths.
  for(const size of [13,20]) for(const noMain of [false,true]) {
    run(`outside-split-crown/size=${size}/noMain=${noMain}`,()=>{
      const runs=[{start:Math.floor(text.length*.5),end:text.length,marks:{fontSize:size}}];
      const content={mainText:noMain?'':mainText,
        rightStream:{id:'01',items:[text],runs,rich:{text,runs}},leftStream:null,footerStreams:[]};
      const cfg={...base,crownLines:noMain?4:0,crownMainGapPx:11};
      const snapshot=JSON.stringify(content);
      const page=document.createElement('div');document.body.append(page);
      try {
        const plan=buildSinglePage(page,content,cfg);
        assert((plan.splitCrownSizing?.passes||0)===0,'crown replan ran outside a crown around main');
        assert(JSON.stringify(content)===snapshot,'control source changed');
        assert(plan.streamCoverage.every(s=>s.exact),'control source coverage mismatch');
        return {noMain,passes:plan.splitCrownSizing?.passes||0,coverage:plan.streamCoverage};
      } finally {page.remove();}
    });
  }
  return {total:results.length,passed:results.filter(r=>r.pass).length,
    failed:results.filter(r=>!r.pass).length,results};
}

// Equal-pitch streams must join the same row grid when only the long stream
// owns the full-width crown. Unequal/variable-height controls are preservation
// checks, NOT claims that those different-grid knees have been synchronized.
export function runShortStreamGridChecks() {
  const phrase='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
  const longText=Array(24).fill(phrase).join(' ');
  const main='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר';
  const results=[];
  function inspect({family='serif',side='left',titles=false,gap=11,ratio=1.55,kind='uniform'}={}) {
    const mk=(id,text)=>({id,items:[text],rich:{text,runs:[]}});
    const right=mk('01',side==='right'?phrase:longText);
    const left=mk('02',side==='left'?phrase:longText);
    const short=side==='right'?right:left;
    if(kind==='rich')short.rich.runs=[{start:6,end:25,marks:{fontSize:20,color:'rgb(31,47,67)'}}];
    if(kind==='color')for(const stream of [right,left])stream.rich.runs=[{start:6,end:25,marks:{color:'rgb(31,47,67)',underline:true}}];
    if(kind==='multiline')short.rich.text=short.items[0]=phrase.replace('delta ','delta\n');
    const content={mainText:main,rightStream:right,leftStream:left,footerStreams:[]};
    const config={pageWidth:380,pageHeight:760,padding:12,mainFontSize:13,sideFontSize:11,
      lineHeightRatio:ratio,mainFontFamily:'serif',sideFontFamily:family,crownLines:4,crownMainGapPx:gap,
      openingWordSettings:{enabled:false},titles:titles?{'01':'First','02':'Second'}:{},
      streamSettings:kind==='mixed'?{[short.id]:{inlineStyle:{fontSize:12,lineHeight:1.63}}}:{}};
    const original=JSON.stringify({content,config});
    const page=document.createElement('div');page.className='v9-page';page.style.position='relative';document.body.append(page);
    try {
      const plan=buildSinglePage(page,content,config);
      assert(JSON.stringify({content,config})===original,'grid check changed source or caller settings');
      assert(plan.crownScenario.name==='one_full_one_short','fixture did not reach the short-stream crown path');
      assert(plan.streamCoverage.every(s=>s.exact),'grid check lost or reordered source text');
      assert(plan.mainBox.lines.map(l=>l.sourceText??l.text).join('')+plan.overflow.mainText===main,'main source changed');
      const boxes=plan.streamBoxes.filter(b=>['right','left'].includes(b.role));
      assert(boxes.length===2,'fixture lost a side stream');
      const mainBottom=Math.max(...plan.mainBox.lines.map(l=>l.y+l.lineHeightPx));
      const knees=boxes.map(box=>{
        const i=box.lines.findIndex((l,i)=>i>0&&l.y>=mainBottom-.02&&l.width>box.lines[i-1].width+1);
        assert(i>0,`${box.role} fixture has no actual narrow-to-wide knee`);
        for(let k=1;k<box.lines.length;k++) {
          assert(Math.abs(box.lines[k].y-box.lines[k-1].y-box.lines[k-1].lineHeightPx)<.05,
            `${box.role} inserted a gap before row ${k}`);
        }
        if(kind!=='mixed'&&kind!=='rich') {
          assert(box.lines.every(l=>Math.abs(l.lineHeightPx-11*ratio)<.02),'configured line spacing was changed');
        }
        if(box.bodyStartGrid) {
          const g=box.bodyStartGrid,shift=g.alignedTop-g.requiredTop;
          assert(shift>0&&shift<g.pitch+.02,'short stream moved by a whole row or upward into its title');
          assert(Math.abs(box.lines[0].y-g.alignedTop)<.02,'rendered start ignores the measured allocation');
        }
        return {role:box.role,y:box.lines[i].y,previousY:box.lines[i-1].y,
          previousHeight:box.lines[i-1].lineHeightPx,startY:box.lines[0].y,grid:box.bodyStartGrid||null};
      });
      const preservationOnly=kind==='mixed'||kind==='rich';
      const delta=Math.abs(knees[0].y-knees[1].y);
      if(preservationOnly)assert(boxes.every(b=>!b.bodyStartGrid),'unequal/variable pitches forced onto one grid');
      else assert(delta<.05,`equal-pitch knees are ${delta}px apart`);
      const long=boxes.find(b=>b.role!==side);
      const crownRows=long.lines.filter(l=>l.width>=plan.pageBox.innerWidth-.02&&
        l.y+l.lineHeightPx<=plan.crownBottomY+.02);
      assert(crownRows.length===4,'full crown no longer has exactly four complete rows');
      const lines=[...plan.mainBox.lines,...boxes.flatMap(b=>b.lines)];
      const rects=[...page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')].map(el=>({
        x:parseFloat(el.style.left)-config.padding,y:parseFloat(el.style.top),
        width:parseFloat(el.style.width),lineHeightPx:parseFloat(el.style.height)}));
      assert(rects.length===lines.length,'painted/planned row counts differ');
      for(let i=0;i<lines.length;i++) {
        const a=lines[i],r=rects[i];
        assert(['x','y','width','lineHeightPx'].every(k=>Math.abs(a[k]-r[k])<.02),'paint changed planned row geometry');
        assert(a.y+a.lineHeightPx<=config.pageHeight-config.padding+.05,'row escaped the page');
        for(let j=i+1;j<lines.length;j++) {
          const b=lines[j],dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
          const dy=Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y);
          assert(dx<.2||dy<.2,'row boxes overlap after grid alignment');
        }
      }
      return {acceptance:preservationOnly?'preservation-only':'synchronized-knees',mainBottom,delta,knees};
    } finally {page.remove();}
  }
  function run(options) {
    const name='short-stream-grid/'+JSON.stringify(options);
    try {results.push({name,pass:true,...inspect(options)});}
    catch(error){results.push({name,pass:false,error:String(error)});}
  }
  for(const family of ['serif','sans-serif','monospace'])for(const side of ['left','right'])
  for(const titles of [false,true])for(const gap of [0,1,11,27])run({family,side,titles,gap});
  for(const ratio of [1.35,1.47,1.75])for(const side of ['left','right'])
  for(const titles of [false,true])for(const gap of [0,11])run({ratio,side,titles,gap});
  for(const kind of ['color','multiline','mixed','rich'])for(const side of ['left','right'])
  for(const titles of [false,true])run({kind,side,titles});
  return {total:results.length,passed:results.filter(r=>r.pass).length,
    failed:results.filter(r=>!r.pass).length,results};
}
