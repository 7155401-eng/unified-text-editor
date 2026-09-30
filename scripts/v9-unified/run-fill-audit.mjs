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
    const mod=await import('./browser-fill-audit.js');
    return mod.runV9FillAudit();
  });
  console.log(JSON.stringify(result,null,2));
  fs.mkdirSync('test-results/v9-unified',{recursive:true});
  fs.writeFileSync('test-results/v9-unified/fill-audit.json',JSON.stringify(result,null,2));
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
