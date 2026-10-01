import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-chromium';

const root=process.cwd();
const server=http.createServer((req,res)=>{
  const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!name.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(name,(err,data)=>{
    if(err){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8');
    res.end(data);
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/v9-unified/browser-fixture.html`);

  const setup=await page.evaluate(async()=>{
    const {layoutV9MainParagraphs}=await import('../../src/engine/v9_main_inline_layout.js');
    const {createV9TextLayoutContext,renderV9PlannedMainLine}=await import('../../src/engine/v9_text_measurement.js');
    const {appendTextWithRuns}=await import('../../src/engine/runs_dom.js');

    const samples=[
      "אבג '(דהו זח טי כל מנ) סע פצ קר שת",
      "אבג ' (דהו זח טי כל מנ) סע פצ קר שת",
      "אבג') דהו זח טי כל מנ (סע פצ' קר שת",
      "אבג '(דהו זח טי כל מנ סע פצ קר שת) סוף",
      "אבג '123(דהו זח טי כל מנ) סע פצ קר שת",
    ];

    const host=document.createElement('div');
    host.id='bidi-raster-host';
    host.style.cssText='position:absolute;left:40px;top:40px;width:1200px;height:800px;background:white;';
    document.body.append(host);

    const results=[];
    let top=0;
    for(let si=0;si<samples.length;si++){
      const text=samples[si];
      const parens=[];
      for(let i=0;i<text.length;i++)if(text[i]==='('||text[i]===')')parens.push(i);
      const runs=parens.map((at,j)=>({start:at,end:at+1,marks:{color:j%2?'rgb(3,4,5)':'rgb(1,2,3)',backgroundColor:'rgb(250,250,250)'}}));

      const context=createV9TextLayoutContext({
        mainFontSize:28,mainFontFamily:'serif',lineHeightRatio:1.25,
        openingWordSettings:{enabled:false},
      });

      let chosen=null;
      for(let width=120;width<=300;width+=2){
        const entry=context.prepareEntry({id:`bidi-${si}`,index:1,text,runs,mainRefs:[],continues:false});
        const plan=layoutV9MainParagraphs([entry],[{x:0,width,y_start:0,y_end:500}],context,500);
        const lineByParen=parens.map(at=>plan.lines.findIndex(l=>at>=l.source.start&&at<l.source.end));
        if(lineByParen.length>=2&&lineByParen[0]>=0&&lineByParen[1]>=0&&lineByParen[0]!==lineByParen[1]){
          chosen={width,plan,lineByParen};
          break;
        }
      }
      if(!chosen){context.dispose();results.push({sample:text,found:false});continue;}

      const actual=document.createElement('div');
      actual.className='probe-actual';
      actual.style.cssText=`position:absolute;left:0;top:${top}px;width:${chosen.width}px;height:220px;background:white;`;
      host.append(actual);
      for(const line of chosen.plan.lines)renderV9PlannedMainLine(line,actual,0);

      const native=document.createElement('div');
      native.className='probe-native';
      native.style.cssText=`position:absolute;left:500px;top:${top}px;width:650px;height:70px;background:white;direction:rtl;white-space:pre;font-family:serif;font-size:28px;line-height:35px;`;
      appendTextWithRuns(native,text,runs);
      host.append(native);

      const actualParen=[...actual.querySelectorAll('span')].filter(el=>el.textContent==='('||el.textContent===')');
      const nativeParen=[...native.querySelectorAll('span')].filter(el=>el.textContent==='('||el.textContent===')');
      actualParen.forEach((el,i)=>el.dataset.probeParen=`a-${si}-${i}`);
      nativeParen.forEach((el,i)=>el.dataset.probeParen=`n-${si}-${i}`);

      results.push({
        sample:text,found:true,width:chosen.width,lineByParen:chosen.lineByParen,
        actualCount:actualParen.length,nativeCount:nativeParen.length,
        actualIds:actualParen.map((_,i)=>`a-${si}-${i}`),
        nativeIds:nativeParen.map((_,i)=>`n-${si}-${i}`),
      });
      top+=230;
      context.dispose();
    }
    return results;
  });

  const compare=async(aSel,nSel)=>{
    const a=page.locator(`[data-probe-paren="${aSel}"]`);
    const n=page.locator(`[data-probe-paren="${nSel}"]`);
    const [ab,nb]=await Promise.all([a.boundingBox(),n.boundingBox()]);
    if(!ab||!nb)return {error:'missing bbox'};
    // Element screenshots scroll into view and crop exactly the glyph's inline
    // box, avoiding viewport/clip failures for samples placed lower on page.
    const [apng,npng]=await Promise.all([
      a.screenshot({omitBackground:false}),
      n.screenshot({omitBackground:false}),
    ]);
    const ah=crypto.createHash('sha256').update(apng).digest('hex');
    const nh=crypto.createHash('sha256').update(npng).digest('hex');
    return {
      actualHash:ah,nativeHash:nh,equal:ah===nh,
      actualBytes:apng.length,nativeBytes:npng.length,
      actualBox:ab,nativeBox:nb
    };
  };

  for(const item of setup){
    if(!item.found)continue;
    item.comparisons=[];
    for(let i=0;i<Math.min(item.actualIds.length,item.nativeIds.length);i++){
      item.comparisons.push(await compare(item.actualIds[i],item.nativeIds[i]));
    }
  }

  console.log(JSON.stringify(setup,null,2));
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
