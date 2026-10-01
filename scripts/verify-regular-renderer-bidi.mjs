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
const page=await browser.newPage({viewport:{width:900,height:600}});
const samples=[
  {text:"אב'(גד)",runs:[]},
  {text:"אב')גד(",runs:[]},
  {text:"אב' (גד)",runs:[]},
  {text:"אב’(גד)",runs:[]},
  {text:"אב׳(גד)",runs:[]},
  {text:"אב'123(גד)",runs:[]},
  {text:"אב'(גד)",runs:[
    {start:2,end:3,marks:{color:'rgb(1, 2, 3)'}},
    {start:3,end:4,marks:{color:'rgb(4, 5, 6)'}},
  ]},
];

try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async(samples)=>{
    const {renderPages}=await import('/src/engine/renderer.js');

    const charOrder=(el)=>{
      const root=el.getBoundingClientRect();
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      const chars=[];let node,logical=0;
      while((node=walker.nextNode())){
        const value=node.nodeValue||'';
        for(let i=0;i<value.length;i++,logical++){
          const range=document.createRange();
          range.setStart(node,i);range.setEnd(node,i+1);
          const r=range.getBoundingClientRect();
          if(r.width>.01||r.height>.01) chars.push({
            logical,ch:value[i],center:(r.left+r.right)/2-root.left
          });
        }
      }
      return chars.sort((a,b)=>a.center-b.center||a.logical-b.logical).map(x=>x.logical);
    };

    const failures=[];
    const oldSync=window.__FORCE_SYNC_RENDER__;
    window.__FORCE_SYNC_RENDER__=true;
    document.body.replaceChildren();

    try{
      for(const sample of samples){
        const host=document.createElement('div');
        host.style.cssText='position:relative;width:380px;';
        document.body.appendChild(host);
        const meta={mainRuns:sample.runs,mainRefs:[],fullMainText:sample.text};
        renderPages([{main:[[0,sample.text,0,sample.text.length,meta]],streams:{}}],host);

        const regular=host.querySelector('.page-main > *');
        if(!regular){
          failures.push({sample:sample.text,error:'regular renderer fixture missing'});
          host.remove();
          continue;
        }

        const native=document.createElement('div');
        native.dir='rtl';
        const cs=getComputedStyle(regular);
        native.style.cssText='position:absolute;left:0;top:560px;white-space:pre;';
        native.style.width=cs.width;
        native.style.font=cs.font;
        native.style.letterSpacing=cs.letterSpacing;
        native.style.wordSpacing=cs.wordSpacing;
        native.style.lineHeight=cs.lineHeight;
        native.textContent=sample.text;
        document.body.appendChild(native);

        const regularText=regular.textContent||'';
        const regularOrder=charOrder(regular);
        const nativeOrder=charOrder(native);
        if(regularText!==sample.text || JSON.stringify(regularOrder)!==JSON.stringify(nativeOrder)){
          failures.push({
            sample:sample.text,
            regularText,
            regularOrder,
            nativeOrder,
            html:regular.outerHTML,
          });
        }
        native.remove();host.remove();
      }
    }finally{
      if(oldSync===undefined)delete window.__FORCE_SYNC_RENDER__;
      else window.__FORCE_SYNC_RENDER__=oldSync;
    }
    return {ok:failures.length===0,failures};
  },samples);

  console.log(JSON.stringify(result,null,2));
  if(!result.ok) process.exitCode=1;
}finally{
  await browser.close();
  await server.close();
}
