// Offline, isolated experiment. No HTTP server, production writes or requests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-chromium';

const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=path.join(root,'tests/native-paragraph');
const out=path.join(root,'test-results/native-paragraph');
fs.mkdirSync(out,{recursive:true});
const imports={},identities={};
const rewrite=(code,parent)=>code.replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,quote,ref)=>{
  if(!ref.startsWith('.'))throw new Error(`Non-relative dependency: ${ref}`);
  const target=path.resolve(parent,ref),relative=path.relative(root,target);
  if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Dependency outside repository');
  return prefix+quote+collect(target)+quote;
});
function collect(file){
 const rel=path.relative(root,file).split(path.sep).join('/'),key='proof:'+rel;
 if(Object.hasOwn(imports,key))return key;
 if(!/\.m?js$/.test(file))throw new Error('Only JavaScript source is admitted');
 imports[key]=null;
 const raw=fs.readFileSync(file),code=rewrite(raw.toString('utf8'),path.dirname(file));
 identities[rel]={sha256:crypto.createHash('sha256').update(raw).digest('hex'),gitBlob:crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex')};
 imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
 return key;
}
let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const moduleTag=/<script type="module">([\s\S]*?)<\/script>/;
const match=html.match(moduleTag);assert(match,'entry module missing');
const entry=rewrite(match[1],dir);
assert(Object.values(imports).every(Boolean),'unresolved module');
html=html.replace(moduleTag,()=>`<script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">${entry}</script>`);
fs.writeFileSync(path.join(out,'native-paragraph-offline.html'),html);
fs.writeFileSync(path.join(out,'module-identities.json'),JSON.stringify(identities,null,2));
const browser=await chromium.launch({headless:true,...(process.env.NATIVE_PROOF_BROWSER?{executablePath:process.env.NATIVE_PROOF_BROWSER}:{})});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},deviceScaleFactor:1});
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 await page.setContent(html);await page.waitForFunction(()=>!!window.nativeParagraphProof);
 const report=await page.evaluate(()=>window.nativeParagraphProof.run());
 report.browserVersion=browser.version();report.pageErrors=errors;report.externalRequests=requests;
 fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(report,null,2));
 assert.equal(errors.length,0,'page errors');assert.equal(requests.length,0,'unexpected network access');
 assert.equal(report.counts.total,360,'fixture matrix changed');
 assert.equal(report.counts.sourceInvariantFailures,0,'source text lost');
 assert.equal(report.counts.acceptedForProduction,0,'experimental route promoted to production');
 console.log(JSON.stringify(report.counts,null,2));
}finally{await browser.close();}
