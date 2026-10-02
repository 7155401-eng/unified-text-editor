import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';

const root=fileURLToPath(new URL('../../',import.meta.url)),imports={},identities={};
function collect(file){
  const rel=path.relative(root,file).split(path.sep).join('/'),key='native-opening:'+rel;
  if(Object.hasOwn(imports,key))return key;
  if(rel.startsWith('../')||path.isAbsolute(rel)||!/\.m?js$/.test(file))throw Error('Nonlocal dependency');
  imports[key]=null;const raw=fs.readFileSync(file);identities[rel]=crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
  const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,p,q,ref)=>{
    if(!ref.startsWith('.'))throw Error('Nonrelative import');return p+q+collect(path.resolve(path.dirname(file),ref))+q;
  });
  imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const entry=collect(path.join(root,'tests/v9-unified/native-opening-flow.browser.js'));assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:20px;background:#f5f5f5}#stage{white-space:nowrap}</style><div id="stage"></div><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import * as p from '${entry}';window.proof=p;</script>`;
const out=path.join(root,'test-results/native-opening-flow');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1100,height:750},deviceScaleFactor:1});const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  await page.setContent(html);await page.waitForFunction(()=>!!window.proof);await page.evaluate(()=>document.fonts.ready);
  const report=await page.evaluate(()=>window.proof.runNativeOpeningProof());
  Object.assign(report,{browserVersion:browser.version(),errors,requests,identities,
    interpretation:{nativeFlowCanOwnLineBreaking:true,
      pureNativeMeetsFullParagraphFinalCenter:report.nativeFinalOffCenter===0,
      currentV9MeetsFullParagraphFinalCenter:report.v9FinalOffCenter===0}});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await page.evaluate(()=>window.proof.renderComparisonCase({family:'serif',width:220,count:10,dropLines:2}));
  await page.locator('#stage').screenshot({path:path.join(out,'comparison.png'),animations:'disabled',scale:'css'});
  console.log(JSON.stringify({total:report.total,nativeLeftMisses:report.nativeLeftMisses,v9LeftMisses:report.v9LeftMisses,
    nativeFinalOffCenter:report.nativeFinalOffCenter,v9FinalOffCenter:report.v9FinalOffCenter,wordBreakDiffs:report.wordBreakDiffs}));
  assert.equal(errors.length,0);assert.equal(requests.length,0);assert.equal(report.total,72);
}finally{await browser.close()}
