import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root=process.cwd();
const server=http.createServer((req,res)=>{
  const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!name.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(name,(err,data)=>{
    if(err){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
    res.end(data);
  });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/v9-unified/browser-fixture.html`);
  const report=await page.evaluate(async()=>{
    window.__ravtextCaptureV9SelectedPlans=true;
    const {buildPages}=await import('../../src/vilna_v9.js?ll='+Date.now());
    const {getStreamSettings}=await import('../../src/original_stream_columns.js');
    const mainUnit='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר אחד עשר שנים עשר';
    const sideUnit='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const anchorAt=(text,index)=>{
      const words=[...String(text).matchAll(/\S+/gu)];
      const w=words[Math.min(words.length-1,Math.max(0,index))];
      return w ? w.index+w[0].length : Math.max(0,text.length-1);
    };
    const input=Array.from({length:7},(_,pi)=>{
      const main=Array(3+(pi%3)).fill(mainUnit).join(' ');
      const notes=[
        {stream:'01',uid:`a-${pi}`,num:pi*3+1,anchor:anchorAt(main,5),anchorAffinity:'backward',text:Array(5+(pi%3)).fill(sideUnit).join(' ')},
        {stream:'02',uid:`b-${pi}`,num:pi*3+2,anchor:anchorAt(main,12),anchorAffinity:'backward',text:Array(6+((pi+1)%3)).fill(sideUnit).join(' ')},
      ];
      return {id:`p-${pi}`,mainText:main,notes};
    });
    const settings=getStreamSettings(),saved={};
    for(const id of ['01','02']){
      saved[id]=settings[id];
      settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false,titleShow:false};
    }
    const classify=(line,kind,id='')=>{
      if(!line)return {kind,id,exists:false};
      const width=Number(line.width)||0,natural=Number(line.naturalWidth)||0;
      const fillRatio=width>0?natural/width:1;
      return {
        kind,id,exists:true,fillRatio:+fillRatio.toFixed(4),
        acceptable:!!line.isLast||!!line.forcedBreak||!!line.tailRebalanced||fillRatio>=.82,
        isLast:!!line.isLast,forcedBreak:!!line.forcedBreak,tailRebalanced:!!line.tailRebalanced,
        width:+width.toFixed(2),naturalWidth:+natural.toFixed(2),
        source:line.source||null,text:String(line.sourceText??line.render?.body?.text??''),
        words:Array.isArray(line.wordTokens)?line.wordTokens.length:null,
      };
    };
    const scenarios=[];
    try{
      for(const crownLines of [2,4])for(const crownMainGapPx of [0,7,11,16])
      for(const opening of [false,true])for(const includeFooter of [false,true]){
        window.__ravtextSelectedV9Plans=[];
        const host=document.createElement('div');document.body.appendChild(host);
        try{
          const cfg={
            pageWidth:380,pageHeight:360,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
            mainFontFamily:'serif',sideFontFamily:'serif',talmudStreams:['01','02'],maxPages:120,
            crownLines,crownMainGapPx,mainBottomGapPx:includeFooter?24:0,mishnaWrapOn:false,
            streamSettings:{
              '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
              '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
            },
            openingWordSettings:opening
              ? {enabled:true,target:'word',count:1,font:'inherit',size:150,position:'dropped',dropLines:2,spaceAfter:.3,scope:'all'}
              : {enabled:false},
          };
          const built=await buildPages(host,input,cfg);
          const plans=window.__ravtextSelectedV9Plans||[];
          const pages=plans.map((rec,i)=>{
            const plan=rec.plan||{};
            const main=classify((plan.mainBox?.lines||[]).at(-1),'main','main');
            const streams=[...(plan.streamBoxes||[]),...(plan.footerBoxes||[])].map(box=>
              classify((box?.lines||[]).at(-1),'stream',String(box?.id||box?.stream||'')));
            return {
              index:i,pageIdx:rec.pageIdx,isFinal:i===plans.length-1,
              fill:Number(host.querySelectorAll('.v9-page')[i]?.dataset?.v9PageFill||0),
              main,streams,
              mainOverflow:!!plan.overflow?.mainText,
              streamOverflow:Object.keys(plan.overflow?.streams||{}).filter(k=>plan.overflow.streams[k]),
            };
          });
          scenarios.push({crownLines,crownMainGapPx,opening,includeFooter,complete:built.complete,pages});
        }finally{host.remove();}
      }
    }finally{
      for(const id of ['01','02']){if(saved[id]===undefined)delete settings[id];else settings[id]=saved[id];}
      window.__ravtextCaptureV9SelectedPlans=false;
    }
    const findings=[];
    for(const sc of scenarios)for(const p of sc.pages){
      if(p.isFinal)continue;
      if(p.main.exists&&!p.main.acceptable)findings.push({crownLines:sc.crownLines,crownMainGapPx:sc.crownMainGapPx,opening:sc.opening,includeFooter:sc.includeFooter,page:p.index,pageFill:p.fill,target:p.main,mainOverflow:p.mainOverflow,streamOverflow:p.streamOverflow});
      for(const st of p.streams)if(st.exists&&!st.acceptable)findings.push({crownLines:sc.crownLines,crownMainGapPx:sc.crownMainGapPx,opening:sc.opening,includeFooter:sc.includeFooter,page:p.index,pageFill:p.fill,target:st,mainOverflow:p.mainOverflow,streamOverflow:p.streamOverflow});
    }
    return {scenarioCount:scenarios.length,findingCount:findings.length,findings,scenarios};
  });
  fs.mkdirSync('test-results/v9-unified',{recursive:true});
  fs.writeFileSync('test-results/v9-unified/last-line-audit.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({scenarioCount:report.scenarioCount,findingCount:report.findingCount,findings:report.findings.slice(0,80)},null,2));
}finally{
  await browser?.close();
  await new Promise(r=>server.close(r));
}
