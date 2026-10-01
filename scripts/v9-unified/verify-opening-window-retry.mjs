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
  const rel=path.relative(root,file).split(path.sep).join('/'),key='opening-retry-check:'+rel;
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
const entry=collect(path.join(root,'tests/v9-unified/opening-window-retry.browser.js'));
const tailEntry=collect(path.join(root,'tests/v9-unified/opening-tail-source.browser.js'));
const crownEntry=collect(path.join(root,'tests/v9-unified/measured-crown-decision.browser.js'));
const coexistEntry=collect(path.join(root,'tests/v9-unified/opening-crown-coexistence.browser.js'));
const leadingEntry=collect(path.join(root,'tests/v9-unified/inherited-inline-leading.browser.js'));
assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><html dir="rtl"><meta charset="utf-8"><body><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import {runOpeningWindowRetryChecks} from '${entry}';import {runOpeningTailSourceChecks} from '${tailEntry}';import {runMeasuredCrownDecisionChecks} from '${crownEntry}';import {runOpeningCrownCoexistenceChecks} from '${coexistEntry}';import {runInheritedInlineLeadingChecks} from '${leadingEntry}';window.runOpeningWindowRetryChecks=()=>{
  const previous=runOpeningWindowRetryChecks(),tail=runOpeningTailSourceChecks(),crown=runMeasuredCrownDecisionChecks(),coexist=runOpeningCrownCoexistenceChecks(),leading=runInheritedInlineLeadingChecks();
  return {total:previous.total+tail.total+crown.total+coexist.total+leading.total,passed:previous.passed+tail.passed+crown.passed+coexist.passed+leading.passed,failed:previous.failed+tail.failed+crown.failed+coexist.failed+leading.failed,
    groups:{...previous.groups,openingTailSource:tail.total,measuredCrownDecision:crown.total,openingCrownCoexistence:coexist.total,inheritedInlineLeading:leading.total},rebalancedTailSourceCases:tail.rebalancedCases,
    results:[...previous.results,...tail.results,...crown.results,...coexist.results,...leading.results]};
};</script></body></html>`;
const out=path.join(root,'test-results/opening-window-retry');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.OPENING_RETRY_BROWSER?{executablePath:process.env.OPENING_RETRY_BROWSER}:{})});
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  await page.setContent(html);await page.waitForFunction(()=>!!window.runOpeningWindowRetryChecks);
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>window.runOpeningWindowRetryChecks());
  Object.assign(result,{browserVersion:browser.version(),errors,requests,identities});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,browserVersion:result.browserVersion}));
  assert.equal(result.total,878);assert.equal(errors.length,0);assert.equal(requests.length,0);
  assert.equal(result.failed,0,JSON.stringify(result.results.filter(r=>!r.pass)));
} finally {await browser.close();}
