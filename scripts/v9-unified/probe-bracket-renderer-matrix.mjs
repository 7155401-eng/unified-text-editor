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
    const {createV9TextLayoutContext}=await import('../../src/engine/v9_text_measurement.js');
    const {flowV9MeasuredStream,renderV9MeasuredStreamLine}=await import('../../src/engine/v9_stream_inline_layout.js');
    const {appendTextWithRuns}=await import('../../src/engine/runs_dom.js');

    const marks=["'","’","׳",":","-","/","123"];
    const scenarios=[];
    for(const mark of marks){
      scenarios.push({label:`before-${mark}`,text:`אבג ${mark}(דהו זח טי כל מנ) סע פצ קר שת`});
      scenarios.push({label:`spaced-${mark}`,text:`אבג ${mark} (דהו זח טי כל מנ) סע פצ קר שת`});
      scenarios.push({label:`inside-${mark}`,text:`אבג(${mark} דהו זח טי כל מנ ${mark}) סע פצ קר שת`});
    }

    const modes=['v9-stream','regular-inline'];
    const host=document.createElement('div');
    const rowHeight=280;
    const total=modes.length*scenarios.length;
    const auditHeight=Math.max(1200,total*rowHeight+300);
    host.style.cssText=`position:absolute;left:30px;top:30px;width:1280px;height:${auditHeight}px;background:#fff;`;
    document.body.style.minHeight=`${auditHeight+100}px`;
    document.documentElement.style.minHeight=`${auditHeight+100}px`;
    document.body.append(host);

    const results=[];
    let top=0;
    const styleBox=(el,width=150)=>{
      Object.assign(el.style,{
        position:'absolute',top:`${top}px`,width:`${width}px`,height:'250px',
        fontFamily:'serif',fontSize:'28px',lineHeight:'35px',direction:'rtl',
        background:'white',color:'black',whiteSpace:'normal',margin:'0',padding:'0'
      });
    };

    for(const mode of modes){
      for(let si=0;si<scenarios.length;si++){
        const {label,text}=scenarios[si];
        const parens=[];
        for(let i=0;i<text.length;i++) if(text[i]==='('||text[i]===')') parens.push(i);
        const runs=parens.map((at,j)=>({
          start:at,end:at+1,
          marks:{color:j%2?'rgb(3,4,5)':'rgb(1,2,3)',backgroundColor:'rgb(250,250,250)'}
        }));

        const actual=document.createElement('div');
        actual.style.left='0px'; styleBox(actual,150); host.append(actual);

        if(mode==='v9-stream'){
          actual.style.position='absolute';
          actual.style.whiteSpace='pre';
          const context=createV9TextLayoutContext({
            mainFontSize:28,mainFontFamily:'serif',lineHeightRatio:1.25,
            openingWordSettings:{enabled:false},
          });
          const flow=flowV9MeasuredStream(
            {text,runs},
            [{x:0,width:150,y_start:0,y_end:240}],
            context,240
          );
          for(const line of flow.lines){
            renderV9MeasuredStreamLine(line,{role:'stream',id:'01'},actual,0,'');
          }
          context.dispose();
        } else {
          // This is the exact text/run primitive used by the regular renderer.
          // Keep a normal RTL block wrapper so browser-native wrapping/BiDi is
          // the only layout mechanism, matching page-main paragraphs.
          actual.style.whiteSpace='normal';
          appendTextWithRuns(actual,text,runs);
        }

        const native=document.createElement('div');
        native.style.left='450px'; styleBox(native,150);
        // Baseline: preserve one continuous Unicode character stream while
        // wrapping only parentheses in neutral spans so Playwright can capture
        // their glyphs. These spans set no direction/unicode-bidi/style.
        let nativeCursor=0;
        for(const at of parens){
          if(at>nativeCursor) native.append(document.createTextNode(text.slice(nativeCursor,at)));
          const span=document.createElement('span');
          span.textContent=text[at];
          native.append(span);
          nativeCursor=at+1;
        }
        if(nativeCursor<text.length) native.append(document.createTextNode(text.slice(nativeCursor)));
        host.append(native);

        await new Promise(requestAnimationFrame);

        const actualParen=[...actual.querySelectorAll('span')].filter(el=>el.textContent==='('||el.textContent===')');
        const nativeParen=[...native.querySelectorAll('span')].filter(el=>el.textContent==='('||el.textContent===')');
        actualParen.forEach((el,i)=>el.dataset.matrixParen=`a-${mode}-${si}-${i}`);
        nativeParen.forEach((el,i)=>el.dataset.matrixParen=`n-${mode}-${si}-${i}`);
        results.push({
          mode,label,text,
          actualIds:actualParen.map((_,i)=>`a-${mode}-${si}-${i}`),
          nativeIds:nativeParen.map((_,i)=>`n-${mode}-${si}-${i}`),
          actualText:actual.textContent,
          sourceText:text,
        });
        top+=rowHeight;
      }
    }
    return results;
  });

  const glyphPixels=async id=>{
    const loc=page.locator(`[data-matrix-paren="${id}"]`);
    const png=await loc.screenshot({omitBackground:false});
    return page.evaluate(async b64=>{
      const img=new Image(); img.src='data:image/png;base64,'+b64; await img.decode();
      const c=document.createElement('canvas');c.width=64;c.height=64;
      const ctx=c.getContext('2d');
      ctx.drawImage(img,Math.floor((64-img.width)/2),Math.floor((64-img.height)/2));
      return Array.from(ctx.getImageData(0,0,64,64).data);
    },png.toString('base64'));
  };

  let trueMirrorCount=0;
  let sourceMutationCount=0;
  const failures=[];
  for(const item of setup){
    if(!item.actualText.includes(item.sourceText)) sourceMutationCount++;
    item.comparisons=[];
    for(let i=0;i<Math.min(item.actualIds.length,item.nativeIds.length);i++){
      const [a,n]=await Promise.all([glyphPixels(item.actualIds[i]),glyphPixels(item.nativeIds[i])]);
      let direct=0,mirror=0,count=0;
      for(let y=0;y<64;y++)for(let x=0;x<64;x++){
        const ai=(y*64+x)*4,ni=ai,mi=(y*64+(63-x))*4;
        for(let k=0;k<3;k++){
          const d=a[ai+k]-n[ni+k],m=a[ai+k]-n[mi+k];
          direct+=d*d;mirror+=m*m;count++;
        }
      }
      const cmp={directMse:direct/count,mirrorMse:mirror/count};
      cmp.mirrorWins=cmp.mirrorMse+0.01<cmp.directMse;
      if(cmp.mirrorWins){
        trueMirrorCount++;
        failures.push({mode:item.mode,label:item.label,index:i,...cmp});
      }
      item.comparisons.push(cmp);
    }
  }

  console.log(JSON.stringify({trueMirrorCount,sourceMutationCount,failures,setup},null,2));
  if(trueMirrorCount||sourceMutationCount)process.exitCode=2;
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
