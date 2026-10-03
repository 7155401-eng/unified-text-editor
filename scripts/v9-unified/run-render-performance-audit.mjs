import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-chromium';

const args=process.argv.slice(2);
const arg=(name,fallback=null)=>{const i=args.indexOf(name);return i>=0&&args[i+1]?args[i+1]:fallback;};
const root=path.resolve(arg('--root',process.cwd()));
const outFile=path.resolve(arg('--out',path.join(process.cwd(),'test-results/render-performance.json')));
const probePath=path.join(root,'tests','.render-performance-probe.html');
fs.mkdirSync(path.dirname(probePath),{recursive:true});

const probe=String.raw`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<body><div id="host"></div><script type="module">
import { buildPages } from '/src/vilna_v9.js';

const phrase='אבג דהו זחט יכל מנס עפצ קרש תאב גדו הזח טיכ למנ סעפ צקר שתא';
const notePhrase='הערה בדיקה ארוכה שנועדה למדוד עימוד אמיתי עם כמה שורות והמשך טבעי של הטקסט';
function words(n){const base=phrase.split(' '),out=[];for(let i=0;i<n;i++)out.push(base[i%base.length]);return out.join(' ');}
function makeInput(count,mode){
  return Array.from({length:count},(_,i)=>{
    const n=mode==='gap-heavy'?[18,37,64,29,78][i%5]:56+(i%4)*7;
    const mainText=words(n);
    const matches=[...mainText.matchAll(/\S+/gu)];
    const noteCount=mode==='gap-heavy'?2+(i%3):4;
    const notes=Array.from({length:noteCount},(_,j)=>{
      const w=matches[Math.min(matches.length-1,4+j*Math.max(3,Math.floor(matches.length/(noteCount+1))))];
      return {stream:String((j%4)+1).padStart(2,'0'),uid:mode+'-'+i+'-'+j,num:i*10+j+1,
        anchor:w.index+w[0].length,anchorAffinity:'backward',
        text:Array(2+((i+j)%4)).fill(notePhrase).join(' ')};
    });
    return {id:mode+'-p-'+i,mainText,notes};
  });
}
function config(){
 return {
  pageWidth:559,pageHeight:794,padding:18,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,
  mainFontFamily:'serif',sideFontFamily:'serif',mainWidthRatio:.42,crownLines:4,streamHorizontalGap:8,
  talmudStreams:['01','02'],levels:[['01','02'],['03','04']],maxPages:180,preventMidLineSplit:true,
  streamSettings:{
   '01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}},
   '03':{inlineStyle:{fontSize:11}},'04':{inlineStyle:{fontSize:11}}
  },
  openingWordSettings:{enabled:true,target:'word',count:1,font:'inherit',size:180,weight:'bold',
   position:'dropped',dropLines:2,spaceAfter:.3,scope:'all',skipHeadings:false,skipShortLine:false,
   skipSingleLine:false,skipFewerThanLines:false,minLines:1},
  isCurrent:()=>true,
 };
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function one(name,count){
 const host=document.querySelector('#host');host.replaceChildren();
 const longTasks=[];
 let observer=null;
 try{
  observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push(e.duration);});
  observer.observe({entryTypes:['longtask']});
 }catch{}
 await document.fonts.ready;
 const input=makeInput(count,name);
 const sourceChars=input.reduce((n,p)=>n+p.mainText.length+p.notes.reduce((s,x)=>s+x.text.length,0),0);
 window.__ravtextPerfTrace=true;
 window.__ravtextV9Perf=null;
 const t0=performance.now();
 const result=await buildPages(host,input,config());
 const ms=performance.now()-t0;
 const perf=structuredClone(window.__ravtextV9Perf||{});
 await sleep(0);
 observer?.disconnect();
 const html=host.innerHTML;
 const text=host.textContent||'';
 return {name,ms,pages:result.pages.length,complete:result.complete===true,sourceChars,
   renderedChars:text.length,html,longTasks,longTaskTotal:longTasks.reduce((a,b)=>a+b,0),
   maxLongTask:longTasks.length?Math.max(...longTasks):0,perf};
}
window.runRenderPerformance=async()=>{
 const cases=[await one('long-notes',24),await one('gap-heavy',32)];
 return {cases};
};
</script></body></html>`;
fs.writeFileSync(probePath,probe);

const server=await createServer({root,logLevel:'error',server:{host:'127.0.0.1',port:0,strictPort:false}});
let browser;
try{
 await server.listen();
 const address=server.httpServer.address();
 const port=typeof address==='object'&&address?address.port:null;
 if(!port)throw new Error('No Vite port');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${port}/tests/.render-performance-probe.html`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>typeof window.runRenderPerformance==='function');
 const raw=await page.evaluate(()=>window.runRenderPerformance());
 const cases=raw.cases.map(c=>{
  const domSha256=crypto.createHash('sha256').update(c.html).digest('hex');
  const {html,...rest}=c;return {...rest,domSha256};
 });
 const report={root,chromium:browser.version(),errors,cases};
 fs.mkdirSync(path.dirname(outFile),{recursive:true});
 fs.writeFileSync(outFile,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(errors.length||cases.some(c=>!c.complete))process.exitCode=1;
}finally{
 await browser?.close();
 await server.close();
 try{fs.unlinkSync(probePath);}catch{}
}
