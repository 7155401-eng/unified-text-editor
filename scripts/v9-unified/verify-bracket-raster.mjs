import { createServer } from 'vite';
import { chromium } from 'playwright-chromium';

const server=await createServer({
  logLevel:'error',
  server:{host:'127.0.0.1',port:0,strictPort:false},
});
await server.listen();

const urls=server.resolvedUrls?.local || server.resolvedUrls?.network || [];
const base=urls[0];
if(!base) throw new Error('Vite did not expose a local URL');

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});

const samples=[
  "אבג '(דהו זח טי כל מנ) סוף",
  "אבג ’(דהו זח טי כל מנ) סוף",
  "אבג ׳(דהו זח טי כל מנ) סוף",
  "אבג ' (דהו זח טי כל מנ) סוף",
  "אבג '123(דהו זח טי כל מנ) סוף",
  "אבג \u200f'(דהו זח טי כל מנ) סוף",
  "אבג '\u200e(דהו זח טי כל מנ) סוף",
  "אבג (דהו זח טי כל מנ) 'סוף",
];

try{
  await page.goto(new URL('/tests/v9-unified/browser-fixture.html',base).href,{waitUntil:'domcontentloaded'});
  await page.addStyleTag({url:new URL('/styles.css',base).href});

  const setup=await page.evaluate(async(samples)=>{
    const {createV9TextLayoutContext,renderV9PlannedMainLine}=await import('/src/engine/v9_text_measurement.js');
    const {layoutV9MainParagraphs}=await import('/src/engine/v9_main_inline_layout.js');
    const host=document.createElement('div');
    host.style.cssText='position:absolute;left:30px;top:30px;width:1100px;min-height:5000px;background:white;';
    document.body.replaceChildren(host);

    const rows=[];
    let top=0;
    for(let si=0;si<samples.length;si++){
      const text=samples[si];
      const parens=[];
      for(let i=0;i<text.length;i++) if(text[i]==='('||text[i]===')') parens.push(i);
      const runs=parens.map((at,j)=>({
        start:at,end:at+1,
        marks:{color:j%2?'rgb(3,4,5)':'rgb(1,2,3)'}
      }));

      let chosen=null;
      for(let width=130;width<=240;width+=2){
        const context=createV9TextLayoutContext({
          mainFontSize:28,
          mainFontFamily:'serif',
          lineHeightRatio:1.25,
          openingWordSettings:{enabled:false},
        });
        const entry=context.prepareEntry({id:'raster-'+si,text,runs,mainRefs:[],continues:false});
        const plan=layoutV9MainParagraphs([entry],[{x:0,width,y_start:0,y_end:500}],context,500);
        const lineByParen=parens.map(at=>plan.lines.findIndex(l=>at>=l.source.start&&at<l.source.end));
        if(plan.lines.length>=2 && lineByParen.every(i=>i>=0) && new Set(lineByParen).size>=2){
          chosen={width,plan,context,lineByParen};
          break;
        }
        context.dispose();
      }
      if(!chosen) throw new Error('Could not create cross-line bracket fixture for '+JSON.stringify(text));

      const actual=document.createElement('div');
      actual.style.cssText=`position:absolute;left:0;top:${top}px;width:${chosen.width}px;height:300px;background:white;direction:rtl;`;
      host.appendChild(actual);
      for(const line of chosen.plan.lines) renderV9PlannedMainLine(line,actual,0);

      const native=document.createElement('div');
      native.dir='rtl';
      native.style.cssText=`position:absolute;left:500px;top:${top}px;width:${chosen.width}px;background:white;white-space:normal;font-family:serif;font-size:28px;line-height:35px;`;
      let cursor=0;
      for(let pi=0;pi<parens.length;pi++){
        const at=parens[pi];
        if(at>cursor)native.append(document.createTextNode(text.slice(cursor,at)));
        const span=document.createElement('span');
        span.textContent=text[at];
        span.dataset.nativeParen=`${si}-${pi}`;
        native.append(span);
        cursor=at+1;
      }
      if(cursor<text.length)native.append(document.createTextNode(text.slice(cursor)));
      host.appendChild(native);

      const actualParens=[...actual.querySelectorAll('span')].filter(el=>el.textContent==='('||el.textContent===')');
      if(actualParens.length!==parens.length) {
        throw new Error(`actual paren count ${actualParens.length} != ${parens.length} for ${JSON.stringify(text)}`);
      }
      actualParens.forEach((el,pi)=>el.dataset.actualParen=`${si}-${pi}`);

      rows.push({
        sample:text,
        width:chosen.width,
        lineByParen:chosen.lineByParen,
        pairs:parens.map((_,pi)=>({
          actual:`${si}-${pi}`,
          native:`${si}-${pi}`,
        })),
      });
      chosen.context.dispose();
      top+=360;
    }
    return rows;
  },samples);

  const raster=async(selector)=>{
    const loc=page.locator(selector);
    const png=await loc.screenshot({omitBackground:false});
    return page.evaluate(async b64=>{
      const img=new Image();
      img.src='data:image/png;base64,'+b64;
      await img.decode();
      const c=document.createElement('canvas');
      c.width=64;c.height=64;
      const ctx=c.getContext('2d');
      ctx.fillStyle='white';ctx.fillRect(0,0,64,64);
      ctx.drawImage(img,Math.floor((64-img.width)/2),Math.floor((64-img.height)/2));
      return Array.from(ctx.getImageData(0,0,64,64).data);
    },png.toString('base64'));
  };

  const failures=[];
  for(const row of setup){
    for(let i=0;i<row.pairs.length;i++){
      const pair=row.pairs[i];
      const [a,n]=await Promise.all([
        raster(`[data-actual-paren="${pair.actual}"]`),
        raster(`[data-native-paren="${pair.native}"]`),
      ]);
      let direct=0,mirror=0,count=0;
      for(let y=0;y<64;y++)for(let x=0;x<64;x++){
        const ai=(y*64+x)*4, ni=ai, mi=(y*64+(63-x))*4;
        for(let k=0;k<3;k++){
          const d=a[ai+k]-n[ni+k];
          const m=a[ai+k]-n[mi+k];
          direct+=d*d;mirror+=m*m;count++;
        }
      }
      const directMse=direct/count, mirrorMse=mirror/count;
      if(mirrorMse+0.01<directMse){
        failures.push({sample:row.sample,width:row.width,index:i,directMse,mirrorMse,lineByParen:row.lineByParen});
      }
    }
  }

  const report={samples:setup.length,comparisons:setup.reduce((n,r)=>n+r.pairs.length,0),failures};
  console.log(JSON.stringify(report,null,2));
  if(failures.length)process.exitCode=1;
}finally{
  await browser.close();
  await server.close();
}
