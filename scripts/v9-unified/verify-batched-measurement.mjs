import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-chromium';

const server=await createServer({root:process.cwd(),logLevel:'error',server:{host:'127.0.0.1',port:0,strictPort:false}});
let browser;
try{
  await server.listen();
  const address=server.httpServer.address();
  const port=typeof address==='object'&&address?address.port:null;
  assert(port,'Vite did not expose a port');
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'domcontentloaded'});
  const report=await page.evaluate(async()=>{
    const {createV9TextLayoutContext}=await import('/src/engine/v9_text_measurement.js');
    const cfg={mainFontFamily:'serif',mainFontSize:13,lineHeightRatio:1.55,openingWordSettings:{enabled:false}};
    const make=()=>createV9TextLayoutContext(cfg);
    const parts=[
      {text:'אבג דהו זחט',leadingText:'',trailingText:'',runs:[],refs:[]},
      {text:'שלום עולם',leadingText:'',trailingText:'',runs:[{start:0,end:4,marks:{bold:true}},{start:5,end:9,marks:{fontSize:'17px'}}],refs:[]},
      {text:'אבג דהו',leadingText:'',trailingText:'',runs:[],refs:[{localPos:3,formatted:'[12]',cssText:'font-size:8px',stream:'03',num:12,uid:'r1'}]},
      {text:'אבג\u00a0דהו\u2009זחט',leadingText:'',trailingText:'',runs:[],refs:[],style:{wordSpacing:'3px'}},
      {text:'ךָ קָמַץ שְׁלוֹם',leadingText:'',trailingText:'',runs:[],refs:[]},
      {text:'abc (12) אבג',leadingText:'\u200f',trailingText:'\u200e',runs:[{start:0,end:3,marks:{italic:true}}],refs:[]},
    ];
    const a=make(),b=make();
    try{
      const sequential=parts.map(part=>a.measure(part));
      const batched=b.measureMany(parts);
      const duplicate=b.measureMany([parts[0],parts[0],parts[2]]);
      return {sequential,batched,duplicate};
    }finally{a.dispose();b.dispose();}
  });
  assert.deepEqual(report.batched,report.sequential);
  assert.deepEqual(report.duplicate[0],report.sequential[0]);
  assert.deepEqual(report.duplicate[1],report.sequential[0]);
  assert.deepEqual(report.duplicate[2],report.sequential[2]);
  console.log(JSON.stringify({total:report.sequential.length,pass:true,metrics:report.sequential},null,2));
}finally{
  await browser?.close();
  await server.close();
}
