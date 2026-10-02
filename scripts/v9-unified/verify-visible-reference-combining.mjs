// Test product modules offline. Pixel equality is required, since detached
// marks can leave the overall text width unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';

export async function verifyVisibleReferenceCombining() {
const root=fileURLToPath(new URL('../../',import.meta.url));
const imports={},identities={};
function collect(file) {
  const rel=path.relative(root,file).split(path.sep).join('/'),key='visible-reference:'+rel;
  if(Object.hasOwn(imports,key))return key;
  if(rel.startsWith('../')||path.isAbsolute(rel)||!/\.m?js$/.test(file))throw new Error('Nonlocal test dependency');
  imports[key]=null;
  const bytes=fs.readFileSync(file);
  identities[rel]=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const code=bytes.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{
    if(!ref.startsWith('.'))throw new Error('Nonlocal module');
    return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;
  });
  imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const entry=collect(path.join(root,'tests/v9-unified/visible-reference-combining.browser.js'));
assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><html><meta charset="utf-8"><body style="margin:20px;background:white"><span id="sample"></span><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import * as checks from '${entry}';window.referenceCombiningChecks=checks;</script></body></html>`;
const out=path.join(root,'test-results/visible-reference-combining');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.VISIBLE_REF_BROWSER?{executablePath:process.env.VISIBLE_REF_BROWSER}:{})});
try {
  const page=await browser.newPage({viewport:{width:900,height:600},deviceScaleFactor:1});
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.setContent(html);await page.waitForFunction(()=>!!window.referenceCombiningChecks);
  await page.evaluate(()=>document.fonts.ready);
  const report=await page.evaluate(()=>window.referenceCombiningChecks.runVisibleReferenceChecks());
  const fixtures=await page.evaluate(()=>({clusters:window.referenceCombiningChecks.referenceClusters,styles:window.referenceCombiningChecks.referenceStyles}));
  const pixelCases=[];
  for(const family of ['serif','sans-serif','monospace'])for(const cluster of fixtures.clusters)for(const style of fixtures.styles) {
    await page.evaluate(args=>window.referenceCombiningChecks.showReferenceRaster(...args),[family,cluster,style,false]);
    const actual=await page.locator('#sample').screenshot({animations:'disabled',scale:'css'});
    await page.evaluate(args=>window.referenceCombiningChecks.showReferenceRaster(...args),[family,cluster,style,true]);
    const expected=await page.locator('#sample').screenshot({animations:'disabled',scale:'css'});
    pixelCases.push({family,cluster,style,pass:actual.equals(expected),
      actualSHA256:crypto.createHash('sha256').update(actual).digest('hex'),expectedSHA256:crypto.createHash('sha256').update(expected).digest('hex')});
  }
  Object.assign(report,{pixelCases,pixelFailures:pixelCases.filter(result=>!result.pass).length,
    errors,requests,identities,browserVersion:browser.version()});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({total:report.total,failed:report.failed,pixelCases:pixelCases.length,pixelFailures:report.pixelFailures}));
  assert.equal(report.total,162);assert.equal(pixelCases.length,54);
  assert.equal(errors.length,0);assert.equal(requests.length,0);
  assert.equal(report.failed,0);assert.equal(report.pixelFailures,0);
  return report;
} finally {await browser.close();}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyVisibleReferenceCombining();
}
