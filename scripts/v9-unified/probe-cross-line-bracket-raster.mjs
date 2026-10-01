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

    const neutralMarks=["'","’","׳",":","-","/","123"];
    const samples=[];
    for(const mark of neutralMarks){
      samples.push({text:`אבג ${mark}(דהו זח טי כל מנ) סע פצ קר שת`,opening:false,label:`plain-before-${mark}`});
      samples.push({text:`אבג ${mark} (דהו זח טי כל מנ) סע פצ קר שת`,opening:false,label:`plain-spaced-${mark}`});
      samples.push({text:`אבג(${mark} דהו זח טי כל מנ ${mark}) סע פצ קר שת`,opening:false,label:`plain-inside-${mark}`});
      samples.push({text:`פתיח ${mark}(דהו זח טי כל מנ) סע פצ קר שת`,opening:true,label:`opening-before-${mark}`});
      samples.push({text:`פתיח ${mark} (דהו זח טי כל מנ) סע פצ קר שת`,opening:true,label:`opening-spaced-${mark}`});
    }
    samples.push({text:"אבג') דהו זח טי כל מנ (סע פצ' קר שת",opening:false,label:"reversed-order-apostrophe"});
    samples.push({text:"פתיח '(דהו זח טי כל מנ סע פצ קר שת) סוף",opening:true,label:"opening-long-pair"});

    const host=document.createElement('div');
    host.id='bidi-raster-host';
    // Every scenario is absolutely positioned. Absolute children do not grow
    // their parent/document scroll height, so the old fixed 800px host made
    // later probes physically outside the screenshotable page. Size the audit
    // canvas from the number of scenarios before painting anything.
    const auditHeight=Math.max(900,samples.length*230+320);
    host.style.cssText=`position:absolute;left:40px;top:40px;width:1200px;height:${auditHeight}px;background:white;`;
    document.body.style.minHeight=`${auditHeight+120}px`;
    document.documentElement.style.minHeight=`${auditHeight+120}px`;
    document.body.append(host);

    const results=[];
    let top=0;
    for(let si=0;si<samples.length;si++){
      const scenario=samples[si];
      const text=scenario.text;
      const parens=[];
      for(let i=0;i<text.length;i++)if(text[i]==='('||text[i]===')')parens.push(i);
      const runs=parens.map((at,j)=>({start:at,end:at+1,marks:{color:j%2?'rgb(3,4,5)':'rgb(1,2,3)',backgroundColor:'rgb(250,250,250)'}}));

      const context=createV9TextLayoutContext({
        mainFontSize:28,mainFontFamily:'serif',lineHeightRatio:1.25,
        openingWordSettings:scenario.opening ? {
          enabled:true,target:'word',count:1,font:'serif',size:160,weight:'bold',
          position:'dropped',dropLines:2,spaceAfter:0.25,scope:'all',
          skipHeadings:false,skipSingleLine:false,skipShortLine:false,skipFewerThanLines:false,minLines:1
        } : {enabled:false},
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
      if(!chosen){context.dispose();results.push({sample:text,label:scenario.label,opening:scenario.opening,found:false});continue;}

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
        sample:text,label:scenario.label,opening:scenario.opening,found:true,width:chosen.width,lineByParen:chosen.lineByParen,
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
    const raster=await page.evaluate(async({a64,n64})=>{
      const load=async b64=>{
        const img=new Image();
        img.src='data:image/png;base64,'+b64;
        await img.decode();
        const c=document.createElement('canvas');
        c.width=64;c.height=64;
        const x=Math.floor((64-img.width)/2),y=Math.floor((64-img.height)/2);
        c.getContext('2d').drawImage(img,x,y);
        return c.getContext('2d').getImageData(0,0,64,64).data;
      };
      const a=await load(a64),n=await load(n64);
      let direct=0,mirror=0,count=0;
      for(let y=0;y<64;y++){
        for(let x=0;x<64;x++){
          const ai=(y*64+x)*4;
          const ni=(y*64+x)*4;
          const mi=(y*64+(63-x))*4;
          for(let k=0;k<3;k++){
            const d=a[ai+k]-n[ni+k];
            const m=a[ai+k]-n[mi+k];
            direct+=d*d;mirror+=m*m;count++;
          }
        }
      }
      return {directMse:direct/count,mirrorMse:mirror/count};
    },{
      a64:apng.toString('base64'),
      n64:npng.toString('base64')
    });
    return {
      actualHash:ah,nativeHash:nh,equal:ah===nh,
      actualBytes:apng.length,nativeBytes:npng.length,
      ...raster,
      mirrorWins:raster.mirrorMse+0.01<raster.directMse,
      actualBox:ab,nativeBox:nb
    };
  };

  let trueMirrorCount=0;
  for(const item of setup){
    if(!item.found)continue;
    item.comparisons=[];
    for(let i=0;i<Math.min(item.actualIds.length,item.nativeIds.length);i++){
      const comparison=await compare(item.actualIds[i],item.nativeIds[i]);
      item.comparisons.push(comparison);
      if(comparison.mirrorWins)trueMirrorCount++;
    }
  }

  console.log(JSON.stringify({trueMirrorCount,setup},null,2));
  if(trueMirrorCount>0){
    console.error(`TRUE_BRACKET_MIRRORING_DETECTED=${trueMirrorCount}`);
    process.exitCode=2;
  }
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
