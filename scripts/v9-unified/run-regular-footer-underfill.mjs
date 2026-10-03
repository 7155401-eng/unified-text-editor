import fs from 'node:fs';
import { chromium } from 'playwright-chromium';
import { createServer } from 'vite';

const server=await createServer({
  root:process.cwd(),
  server:{host:'127.0.0.1',port:0,strictPort:false},
  logLevel:'error'
});
await server.listen();
const address=server.httpServer.address();
const port=typeof address==='object'&&address?address.port:null;
if(!port)throw new Error('Vite test server did not expose a port');

let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/tests/regular-footer-underfill-fixture.html`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>typeof window.runRegularFooterUnderfillProbe==='function');
  const result=await page.evaluate(()=>window.runRegularFooterUnderfillProbe());
  const report={...result,browserVersion:browser.version(),pageErrors:errors};
  fs.mkdirSync('test-results/v9-unified',{recursive:true});
  fs.writeFileSync('test-results/v9-unified/regular-footer-underfill.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(errors.length)throw new Error('Browser errors: '+errors.join(' | '));
  if(!Array.isArray(result.cases)||result.cases.length!==12)throw new Error('Expected 12 regular-layout cases');
  const short=result.cases.filter(c=>!c.fixtureLongEnough);
  const source=result.cases.filter(c=>!c.sourceExact);
  const overflow=result.cases.filter(c=>c.overflow);
  const underfill=result.cases.filter(c=>c.underfillReproduced);
  if(short.length)throw new Error('Some fixtures did not exceed 8 pages: '+short.map(c=>c.label).join(', '));
  if(source.length)throw new Error('Additional rebalance changed source: '+source.map(c=>c.label).join(', '));
  if(overflow.length)throw new Error('Additional rebalance overflowed pages: '+overflow.map(c=>c.label).join(', '));
  if(underfill.length)throw new Error('REGULAR_FOOTER_UNDERFILL: '+underfill.map(c=>
    `${c.label} gain=${c.improvement.toFixed(2)}px gap=${c.beforeGap.toFixed(2)}->${c.afterGap.toFixed(2)}`
  ).join(' | '));
}finally{
  await browser?.close();
  await server.close();
}
