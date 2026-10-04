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
    res.setHeader('Content-Type',name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');
    res.end(data);
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/v9-unified/browser-fixture.html`);
  const result=await page.evaluate(async()=>{
    const {buildPages}=await import('../../src/vilna_v9.js');
    const {getStreamSettings}=await import('../../src/original_stream_columns.js');
    const neutral='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר אחד עשר שנים עשר';
    const sideText='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const anchorAt=(text,index)=>{
      const words=[...String(text).matchAll(/\S+/gu)];
      const w=words[Math.min(words.length-1,Math.max(0,index))];
      return w ? w.index+w[0].length : Math.max(0,text.length-1);
    };
    const input=Array.from({length:7},(_,pi)=>{
      const main=Array(3+(pi%3)).fill(neutral).join(' ');
      return {
        id:`focus-${pi}`,mainText:main,
        notes:[
          {stream:'01',uid:`focus-a-${pi}`,num:pi*3+1,anchor:anchorAt(main,5),anchorAffinity:'backward',text:Array(5+(pi%3)).fill(sideText).join(' ')},
          {stream:'02',uid:`focus-b-${pi}`,num:pi*3+2,anchor:anchorAt(main,12),anchorAffinity:'backward',text:Array(6+((pi+1)%3)).fill(sideText).join(' ')},
        ]
      };
    });
    const settings=getStreamSettings(),saved={};
    for(const id of ['01','02']){
      saved[id]=settings[id];
      settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false,titleShow:false};
    }
    const baseCfg={
      pageWidth:380,pageHeight:360,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
      mainFontFamily:'serif',sideFontFamily:'serif',talmudStreams:['01','02'],maxPages:120,
      crownLines:4,crownMainGapPx:0,mainBottomGapPx:0,mishnaWrapOn:false,
      streamSettings:{
        '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
        '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
      },
      openingWordSettings:{enabled:false},
    };
    const run=async(preventMidLineSplit)=>{
      const host=document.createElement('div');
      host.style.cssText='position:relative;width:400px;';
      document.body.appendChild(host);
      try{
        const built=await buildPages(host,input,{...baseCfg,preventMidLineSplit});
        return {
          complete:built.complete,
          pages:built.pages.map((p,index)=>{
            const lines=[...p.querySelectorAll('.v9-line')];
            const main=lines.filter(el=>el.dataset.v9Role==='main');
            const right=lines.filter(el=>el.dataset.v9Role==='right');
            const left=lines.filter(el=>el.dataset.v9Role==='left');
            const bottom=Math.max(0,...lines.map(el=>(parseFloat(el.style.top)||0)+(parseFloat(el.style.height)||0)));
            return {
              index,
              fill:Number(p.dataset.v9PageFill),
              bottom,
              mainLines:main.length,
              rightLines:right.length,
              leftLines:left.length,
              mainIds:[...new Set(main.map(el=>el.dataset.v9ParagraphId).filter(Boolean))],
              firstMain:(main[0]?.textContent||'').replace(/[\u200e\u200f\u2060]/g,''),
              lastMain:(main.at(-1)?.textContent||'').replace(/[\u200e\u200f\u2060]/g,''),
              mainPass:p.dataset.v9MainPass||'',
            };
          }).filter(p=>[1,2,3,5,6,7].includes(p.index)),
        };
      }finally{host.remove();}
    };
    try{
      return {
        protected:await run(true),
        free:await run(false),
      };
    }finally{
      for(const id of ['01','02']){
        if(saved[id]===undefined)delete settings[id];else settings[id]=saved[id];
      }
    }
  });
  console.log(JSON.stringify(result,null,2));
  fs.mkdirSync('test-results/v9-unified',{recursive:true});
  fs.writeFileSync('test-results/v9-unified/fill-focus.json',JSON.stringify(result,null,2));
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
