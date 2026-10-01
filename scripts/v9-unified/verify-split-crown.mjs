// Offline browser acceptance for the actual page planner, not a parallel engine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';
const root=fileURLToPath(new URL('../../',import.meta.url));
const imports={},identities={};
function collect(file){
  const rel=path.relative(root,file).split(path.sep).join('/'),key='crown-check:'+rel;
  if(Object.hasOwn(imports,key))return key;
  if(rel.startsWith('../')||path.isAbsolute(rel)||!/\.m?js$/.test(file))throw new Error('Unsupported dependency');
  imports[key]=null;
  const raw=fs.readFileSync(file);
  identities[rel]=crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
  const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{
    if(!ref.startsWith('.'))throw new Error('Nonlocal dependency');
    return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;
  });
  imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const entry=collect(path.join(root,'tests/v9-unified/split-crown-rich.browser.js'));
assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><html dir="rtl"><meta charset="utf-8"><body><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import {runSplitCrownChecks} from '${entry}';window.runSplitCrownChecks=runSplitCrownChecks;</script></body></html>`;
const out=path.join(root,'test-results/split-crown');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CROWN_TEST_BROWSER?{executablePath:process.env.CROWN_TEST_BROWSER}:{})});
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  await page.setContent(html);await page.waitForFunction(()=>!!window.runSplitCrownChecks);
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>window.runSplitCrownChecks());
  Object.assign(result,{browserVersion:browser.version(),errors,requests,identities});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,browserVersion:result.browserVersion}));
  assert.equal(result.total,52);assert.equal(errors.length,0);assert.equal(requests.length,0);
  assert.equal(result.failed,0,JSON.stringify(result.results.filter(r=>!r.pass)));
} finally {await browser.close();}
