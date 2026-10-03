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
  fs.mkdirSync('test-results/regular-footer-underfill',{recursive:true});
  fs.writeFileSync('test-results/regular-footer-underfill/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(errors.length)throw new Error('Browser errors: '+errors.join(' | '));
  if(!result.fixtureLongEnough)throw new Error('Fixture did not exceed 8 pages');
  if(!result.sourceExact)throw new Error('Additional rebalance changed source');
  if(result.overflow)throw new Error('Additional rebalance overflowed a page');
  if(result.underfillReproduced)throw new Error(`REGULAR_FOOTER_UNDERFILL: additional legal passes reduce gap by ${result.improvement.toFixed(2)}px (${result.beforeGap.toFixed(2)} -> ${result.afterGap.toFixed(2)})`);
}finally{
  await browser?.close();
  await server.close();
}
