// Native-browser failure tests of the actual toolbar, not a copied loader.
// Only the fake HTTP origin, user choice, and print-dialog boundary are modeled.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'test-results/pdf-load-recovery');fs.mkdirSync(out,{recursive:true});
const origin='https://pdf-recovery.test';
const cases=[];
const identities={};
const browser=await chromium.launch({headless:true,...(process.env.PDF_TEST_BROWSER?{executablePath:process.env.PDF_TEST_BROWSER}:{})});
const scenarios=[
 {name:'missing-chunk-accept',mode:'404',accept:true,expectedPrint:1,saveNativePdf:true},
 {name:'missing-chunk-decline',mode:'404',accept:false,expectedPrint:0},
 {name:'network-failure-accept',mode:'network',accept:true,expectedPrint:1},
 {name:'html-instead-of-module',mode:'html',accept:true,expectedPrint:1},
 {name:'module-syntax-failure',mode:'syntax',accept:true,expectedPrint:1},
 {name:'missing-chunk-no-print-control',mode:'404',accept:true,omitPrint:true,expectedAlert:true,expectedPrint:0},
 {name:'disabled-print-control',mode:'404',accept:true,disabledPrint:true,expectedAlert:true,expectedPrint:0},
 {name:'module-success',mode:'success',accept:true,expectedExport:1,expectedPrint:0},
 {name:'export-error-is-not-load-error',mode:'export-error',accept:true,expectedExport:1,expectedAlert:true,expectedPrint:0},
 {name:'demo-still-blocks-export',mode:'404',demo:true,accept:true,expectedAlert:true,expectedPrint:0},
 {name:'background-choice-preserved',mode:'404',accept:true,background:true,expectedPrint:1,saveNativePdf:true},
 {name:'repeat-declined-load-failure',mode:'404',accept:false,clicks:2,expectedPrint:0},
 {name:'native-print-independent-of-pdf-module',mode:'404',accept:true,directPrint:true,expectedPrint:1},
];
try {
 for(const s of scenarios) {
  console.log('START',s.name);
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage({viewport:{width:900,height:900}});page.setDefaultTimeout(5000);const requests=[],errors=[],navigations=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('framenavigated',f=>{if(f===page.mainFrame())navigations.push(f.url())});
  const html=`<!doctype html><html><meta charset="utf-8"><base href="${origin}/"><style>:root{--ravtext-page-width:380px;--ravtext-page-height:537px;--ravtext-page-margin-top:12px;--ravtext-page-margin-right:12px;--ravtext-page-margin-bottom:12px;--ravtext-page-margin-left:12px}.page{width:380px;height:537px;position:relative;box-sizing:border-box;font:16px serif;background:white}.page p{margin:0;padding:12px}</style><body>
  <textarea id="unsaved">UNSAVED LOCAL WORK</textarea><button id="pdf-download">PDF</button>${s.omitPrint?'':`<button id="pdf-print" ${s.disabledPrint?'disabled':''}>Print</button>`}<span id="pdf-page-total"></span>
  <div id="pages-container"><div class="page" data-page-index="0"><p>PDF recovery sample 1</p></div><div class="page" data-page-index="1"><p>PDF recovery sample 2</p></div><div class="page page-placeholder"></div><div class="page ravtext-empty-page"></div></div>
  <script>const memory=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key),clear:()=>memory.clear()}});window.storageSnapshot=()=>Object.fromEntries(memory);window.__RAVTEXT_AUTH__={loggedIn:true,paid:${!s.demo}};window.state={prompts:[],alerts:[],prints:[],exports:[],settingsBefore:''};
  localStorage.setItem('ravtext.output.includeBackground',${JSON.stringify(s.background?'1':'0')});window.confirm=message=>(state.prompts.push(message),${!!s.accept});window.alert=message=>state.alerts.push(message);
  window.print=()=>{const r=document.getElementById('ravtext-print-root');state.prints.push({pages:r?r.querySelectorAll('.page').length:0,source:r?.textContent,background:document.body.classList.contains('print-with-background')});};
  </script><script type="module">import {setupPdfToolbar} from '/src/engine_toolbar.js';setupPdfToolbar(document.getElementById('pages-container'));window.ready=true;</script></body></html>`;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());requests.push(url.pathname);
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/')return route.fulfill({headers:{'access-control-allow-origin':'*'},status:200,contentType:'text/html',body:html});
   if(url.pathname==='/src/pdf_export.js'&&s.mode!=='real') {
    if(s.mode==='network')return route.abort('failed');
    if(s.mode==='404')return route.fulfill({headers:{'access-control-allow-origin':'*'},status:404,contentType:'text/plain',body:'Old deployment asset is no longer available'});
    if(s.mode==='html')return route.fulfill({headers:{'access-control-allow-origin':'*'},status:200,contentType:'text/html',body:'<!doctype html><title>SPA fallback</title>'});
    if(s.mode==='syntax')return route.fulfill({headers:{'access-control-allow-origin':'*'},status:200,contentType:'application/javascript',body:'export const = INVALID'});
    return route.fulfill({headers:{'access-control-allow-origin':'*'},status:200,contentType:'application/javascript',body:`export async function downloadPagesAsPdf(container,options){window.state.exports.push({pages:container.querySelectorAll('.page:not(.page-placeholder):not(.ravtext-empty-page)').length,filename:options.filename,background:options.includeBackgrounds,fallback:options.fallbackToPrint});options.onProgress(1,2);${s.mode==='export-error'?`throw new Error('PDF_RENDER_FAILURE');`:''}}`});
   }
   const file=path.resolve(root,'.'+url.pathname);
   if(!file.startsWith(root)||!url.pathname.startsWith('/src/')||!file.endsWith('.js')||!fs.existsSync(file))return route.abort();
   const raw=fs.readFileSync(file);identities[path.relative(root,file)]=crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
   return route.fulfill({headers:{'access-control-allow-origin':'*'},status:200,contentType:'application/javascript',body:raw});
  });
  try {
   await page.setContent(html,{waitUntil:'load'});await page.waitForFunction(()=>window.ready);
   assert(!requests.includes('/src/pdf_export.js'),'PDF exporter was fetched during toolbar startup');
   const before=await page.evaluate(()=>({source:document.querySelector('#pages-container').innerHTML,unsaved:document.querySelector('#unsaved').value,storage:JSON.stringify(window.storageSnapshot())}));
   let pdfInfo=null;
   if(s.real){
    const downloadPromise=page.waitForEvent('download',{timeout:30000});await page.locator('#pdf-download').click();
    const download=await downloadPromise;assert.equal(await download.failure(),null);
    const pdf=fs.readFileSync(await download.path());assert(pdf.subarray(0,8).toString().startsWith('%PDF-'));
    const count=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;assert.equal(count,3,'Two pages plus the existing cover expected');
    fs.writeFileSync(path.join(out,'actual-export.pdf'),pdf);pdfInfo={bytes:pdf.length,pageCount:count,sha256:crypto.createHash('sha256').update(pdf).digest('hex')};
   }else{
    for(let click=0;click<(s.clicks||1);click++) {
     await page.locator(s.directPrint?'#pdf-print':'#pdf-download').click();
     await page.waitForTimeout(160);
     await page.waitForFunction(()=>!document.querySelector('#pdf-download').disabled);
    }
   }
   const state=await page.evaluate(()=>window.state);
   assert.equal(state.prints.length,s.expectedPrint,'Fallback did not respect the explicit user choice');
   assert.equal(state.exports.length,s.expectedExport||0);
   const needsChoice=!s.demo&&!s.directPrint&&!s.omitPrint&&!s.disabledPrint&&!['success','real','export-error'].includes(s.mode);
   assert.equal(state.prompts.length,needsChoice?(s.clicks||1):0,'Prompt was shown in the wrong stage');
   assert.equal(state.alerts.length,s.expectedAlert?1:0,'Unexpected or lost error message');
   if(s.expectedPrint){assert.equal(state.prints[0].pages,2,'Print must reuse the prepared-pages path and exclude placeholders');assert.equal(state.prints[0].background,!!s.background);}
   if(s.saveNativePdf) {
    // Save via Chromium's real print-to-PDF engine while the product's native
    // print root and CSS are active. Only the OS dialog itself is a test double.
    const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
    assert(pdf.subarray(0,8).toString().startsWith('%PDF-'));
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,2,'Native PDF must contain exactly the two prepared pages');
    fs.writeFileSync(path.join(out,`${s.name}.pdf`),pdf);
    pdfInfo={kind:'native-print-to-pdf',bytes:pdf.length,pageCount:2,sha256:crypto.createHash('sha256').update(pdf).digest('hex')};
   }
   if(s.expectedExport)assert.deepEqual(state.exports[0],{pages:2,filename:'ravtext-preview.pdf',background:!!s.background,fallback:true});
   if(s.demo||s.directPrint)assert(!requests.includes('/src/pdf_export.js'),'Guarded/native-print operation loaded optional PDF code');
   await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
   const after=await page.evaluate(()=>({source:document.querySelector('#pages-container').innerHTML,unsaved:document.querySelector('#unsaved').value,storage:JSON.stringify(window.storageSnapshot())}));
   assert.deepEqual(after,before,'Recovery changed document text, live page DOM or storage');
   assert.equal(await page.locator('#pdf-download').textContent(),'PDF');
   assert.equal(await page.locator('#pdf-download').isEnabled(),true);
   assert.equal(navigations.length,0,'Recovery refreshed or navigated away from the editor');
   assert.equal(errors.length,0,JSON.stringify(errors));
   cases.push({name:s.name,pass:true,pdf:pdfInfo,pdfRequests:requests.filter(p=>p==='/src/pdf_export.js').length,prints:state.prints.length,prompts:state.prompts.length});
  }catch(error){cases.push({name:s.name,pass:false,error:String(error),pageErrors:errors,requests});console.log('FAIL',s.name,String(error),errors,requests);}
  finally{await context.close();}
 }
}finally{await browser.close();}
const report={browserVersion:browser.version(),scope:'Toolbar load-failure recovery. Native HTTP/import failures; isolated in-memory storage and user/print-dialog boundary doubles. PDF-generation implementation is unchanged and not certified by this suite.',pdfGenerationProbe:'Two PDFs are generated by Chromium from the actual native-print root after a missing-module error. The dynamic exporter itself is unchanged; the OS print dialog is modeled and the live-site asset failure is not diagnosed by this offline test.',total:cases.length,passed:cases.filter(c=>c.pass).length,failed:cases.filter(c=>!c.pass).length,cases,identities};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.equal(report.failed,0);
