// Actual product modules, exact DOM/geometry and raster comparison. No test
// prototype, server, font download or product-source rewrite is involved.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';
const root=fileURLToPath(new URL('../../',import.meta.url));
const imports={},identities={};
function collect(file){
 const rel=path.relative(root,file).split(path.sep).join('/'),key='hidden-check:'+rel;
 if(Object.hasOwn(imports,key))return key;
 if(rel.startsWith('../')||path.isAbsolute(rel)||!/\.m?js$/.test(file))throw new Error('Unsupported test dependency');
 imports[key]=null;
 const raw=fs.readFileSync(file);
 identities[rel]=crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
 const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{
  if(!ref.startsWith('.'))throw new Error('Nonlocal test dependency');
  return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;
 });
 imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const entry=collect(path.join(root,'tests/v9-unified/hidden-reference-shaping.browser.js'));
assert(Object.values(imports).every(Boolean),'Incomplete import map');
const html=`<!doctype html><html><meta charset="utf-8"><body style="margin:20px;background:white"><span id="sample"></span><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import * as checks from '${entry}';window.hiddenReferenceChecks=checks;</script></body></html>`;
const out=path.join(root,'test-results/hidden-reference-shaping');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.HIDDEN_REF_BROWSER?{executablePath:process.env.HIDDEN_REF_BROWSER}:{})});
try{
 const page=await browser.newPage({viewport:{width:900,height:320},deviceScaleFactor:1});
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 await page.setContent(html);await page.waitForFunction(()=>!!window.hiddenReferenceChecks);await page.evaluate(()=>document.fonts.ready);
 const report=await page.evaluate(()=>window.hiddenReferenceChecks.runHiddenReferenceChecks());
 const pixelCases=[];
 for(const family of ['serif','sans-serif','monospace'])for(const cluster of ['ךְ','ןִ','ףָ','ץֵ','קֻ','שָּׁ']){
  await page.evaluate(({family,cluster})=>window.hiddenReferenceChecks.showHiddenReferencePixelCase(family,cluster,true),{family,cluster});
  const actual=await page.locator('#sample').screenshot({animations:'disabled',scale:'css'});
  await page.evaluate(({family,cluster})=>window.hiddenReferenceChecks.showHiddenReferencePixelCase(family,cluster,false),{family,cluster});
  const expected=await page.locator('#sample').screenshot({animations:'disabled',scale:'css'});
  pixelCases.push({family,cluster,pass:actual.equals(expected),actualSHA256:crypto.createHash('sha256').update(actual).digest('hex'),expectedSHA256:crypto.createHash('sha256').update(expected).digest('hex')});
 }
 Object.assign(report,{browserVersion:browser.version(),pixelCases,pixelFailures:pixelCases.filter(x=>!x.pass).length,errors,requests,identities});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({total:report.total,passed:report.passed,failed:report.failed,pixelCases:pixelCases.length,pixelFailures:report.pixelFailures,browserVersion:report.browserVersion},null,2));
 assert.equal(errors.length,0,'Page errors');assert.equal(requests.length,0,'External requests');
 if(report.failed||report.pixelFailures)process.exitCode=1;
}finally{await browser.close();}
