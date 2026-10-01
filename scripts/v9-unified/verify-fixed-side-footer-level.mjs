// Exercise the existing checkbox, persisted levels parser, page planner and
// multi-page planner. Do not execute the application's unrelated startup code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';
const root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const base=fs.realpathSync(process.env.PAIRED_LEVEL_BASELINE_DIR||path.join(root,'.paired-level-baseline'));
const pinned='ab24421e44262a9f52791a900598cfa7eb9879fc';
let baselineEntries;
if(process.env.PAIRED_LEVEL_BASELINE_MANIFEST){
 const manifest=JSON.parse(fs.readFileSync(process.env.PAIRED_LEVEL_BASELINE_MANIFEST,'utf8'));
 assert.equal(manifest.commit,pinned);baselineEntries=manifest.files;
}else{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:base,encoding:'utf8'}).trim(),pinned);
 baselineEntries=Object.fromEntries(execFileSync('git',['ls-tree','-r','--full-tree',pinned,'--','src'],{cwd:base,encoding:'utf8'}).trim().split('\n').map(row=>{const [meta,p]=row.split('\t');return[p,meta.split(' ')[2]];}));
}
const imports={},identities={};
const blob=raw=>crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
function collect(file){
 file=fs.realpathSync(file);const owner=file.startsWith(base+path.sep)?base:file.startsWith(root+path.sep)?root:null;
 if(!owner||!/\.m?js$/.test(file))throw Error('Nonlocal dependency');
 const relative=path.relative(owner,file).split(path.sep).join('/');
 const name=(owner===base?'baseline/':'candidate/')+relative,key='paired-level:'+name;
 if(Object.hasOwn(imports,key))return key;
 imports[key]=null;
 const raw=fs.readFileSync(file);identities[name]=blob(raw);
 if(owner===base)assert.equal(identities[name],baselineEntries[relative],'Baseline source changed: '+relative);
 const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{
  if(!ref.startsWith('.'))throw Error('Non-relative test dependency');
  return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;
 });
 imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const test=collect(path.join(root,'tests/v9-unified/fixed-side-footer-level.browser.js'));
const baselineApi=collect(path.join(base,'src/vilna_v9.js'));
assert(Object.values(imports).every(Boolean));
function declaration(file,pattern){
 const raw=fs.readFileSync(path.join(root,file));identities['candidate/'+file]=blob(raw);
 const matches=[...raw.toString('utf8').matchAll(pattern)];
 assert.equal(matches.length,1,'Ambiguous production declaration: '+file);return matches[0][1];
}
const wire=declaration('src/main.js',/(function wireOtherAsMishna\(\) \{[\s\S]*?\n\})(?=\nsetTimeout\(wireOtherAsMishna)/g);
const parser=declaration('src/vilna_v9_apply.js',/(function readLevelsFromLocalStorage\(\) \{[\s\S]*?\n\})/g);
const bootstrap=`const memory=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),clear:()=>memory.clear()}});window.storageSnapshot=()=>JSON.stringify([...memory]);window.installExactCheckbox=(settingRerenderPages)=>{${wire};wireOtherAsMishna()};${parser};window.readExactLevels=readLevelsFromLocalStorage;`;
const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' data:;style-src 'unsafe-inline';font-src data:;connect-src 'none'"><script>${bootstrap}</script><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import {createFixedSideFooterChecks} from '${test}';import * as baseline from '${baselineApi}';window.checks=createFixedSideFooterChecks(baseline);window.ready=true;</script>`;
const out=path.join(root,'test-results/fixed-side-footer-level');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PAIRED_LEVEL_BROWSER?{executablePath:process.env.PAIRED_LEVEL_BROWSER}:{})});
try{
 const results={},errors=[],requests=[];
 for(const [name,fn] of Object.entries({control:'runControlAndPageChecks',preservation:'runPreservationChecks',pagination:'runPaginationChecks'})){
  const page=await browser.newPage({viewport:{width:1300,height:1000}});
  page.on('pageerror',e=>errors.push(String(e)));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  await page.setContent(html);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);
  results[name]=await page.evaluate(fn=>window.checks[fn](),fn);await page.close();
 }
 const total=Object.values(results).reduce((n,r)=>n+r.total,0),failed=Object.values(results).reduce((n,r)=>n+r.failed,0);
 const report={baseline:pinned,browser:browser.version(),total,passed:total-failed,failed,results,identities,errors,requests,
  scope:'Original control declarations, isolated memory storage and neutral source. Exact comparison with the established expanded-level layout, not validation of the proprietary-font user export.'};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({total,passed:total-failed,failed,browser:report.browser},null,2));
 assert.equal(total,78);assert.equal(failed,0,JSON.stringify(results));assert.equal(errors.length,0);assert.equal(requests.length,0);
}finally{await browser.close();}
