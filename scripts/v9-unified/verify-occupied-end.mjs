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
  const rel=path.relative(root,file).split(path.sep).join('/'),key='occupied-end-check:'+rel;
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
// This is a read-only checkout of the exact pre-fix product, not a competing
// implementation or an inlined approximation. It never enters the product build.
const baselineRoot=path.join(root,'.occupied-baseline');
const baselineLayout=path.join(baselineRoot,'src/engine/v9_main_inline_layout.js');
const original=fs.readFileSync(baselineLayout);
assert.equal(crypto.createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex'),
 '32ec3c1839173c6461005f4e68697c52cfa8d672','Wrong baseline layout source');
const basePlan=collect(baselineLayout);
const baseMeasure=collect(path.join(baselineRoot,'src/engine/v9_text_measurement.js'));
const basePage=collect(path.join(baselineRoot,'src/vilna_v9.js'));
const entry=collect(path.join(root,'tests/v9-unified/occupied-end.browser.js'));
assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><html dir="rtl"><meta charset="utf-8"><body><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import {runOccupiedEndChecks} from '${entry}';import {layoutV9MainParagraphs} from '${basePlan}';import {createV9TextLayoutContext} from '${baseMeasure}';import {buildSinglePage} from '${basePage}';window.runOccupiedEndChecks=()=>runOccupiedEndChecks({layoutV9MainParagraphs,createV9TextLayoutContext,buildSinglePage});</script></body></html>`;
const out=path.join(root,'test-results/occupied-end');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.OCCUPIED_END_BROWSER?{executablePath:process.env.OCCUPIED_END_BROWSER}:{})});
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  await page.setContent(html);await page.waitForFunction(()=>!!window.runOccupiedEndChecks);
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>window.runOccupiedEndChecks());
  Object.assign(result,{browserVersion:browser.version(),errors,requests,identities});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,browserVersion:result.browserVersion,remainingIssues:result.remainingIssues}));
  assert.equal(result.total,314);assert.equal(errors.length,0);assert.equal(requests.length,0);
  assert.equal(result.failed,0,JSON.stringify(result.results.filter(r=>!r.pass)));
} finally {await browser.close();}
