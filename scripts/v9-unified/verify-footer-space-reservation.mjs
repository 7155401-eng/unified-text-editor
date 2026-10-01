// Read-only, network-free browser acceptance of the current source against the
// exact pre-fix product. Create the baseline worktree as explained in the report.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';
const root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const base=fs.realpathSync(process.env.FOOTER_BASELINE_DIR||path.join(root,'.footer-space-baseline'));
const pinned='ab24421e44262a9f52791a900598cfa7eb9879fc';
let baselineEntries;
if(process.env.FOOTER_BASELINE_MANIFEST){
 const manifest=JSON.parse(fs.readFileSync(process.env.FOOTER_BASELINE_MANIFEST,'utf8'));
 assert.equal(manifest.commit,pinned,'Wrong archived baseline');baselineEntries=manifest.files;
 assert(baselineEntries&&typeof baselineEntries==='object','Missing baseline identities');
}else{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:base,encoding:'utf8'}).trim(),pinned,'Wrong baseline checkout');
 baselineEntries=Object.fromEntries(execFileSync('git',['ls-tree','-r','--full-tree',pinned,'--','src'],{cwd:base,encoding:'utf8'}).trim().split('\n').map(row=>{const [meta,p]=row.split('\t');return [p,meta.split(' ')[2]];}));
}
const source=fs.readFileSync(path.join(base,'src/vilna_v9.js'));
const blob=b=>crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
assert.equal(blob(source),'657e6618a77cf11edade858b1bad377df3da5b5a','Baseline source was changed');
const imports={},identities={};
function collect(file){
 file=fs.realpathSync(file);
 const owner=file.startsWith(base+path.sep)?base:file.startsWith(root+path.sep)?root:null;
 if(!owner||!/\.m?js$/.test(file))throw Error('Source outside the two admitted checkouts');
 const name=(owner===base?'baseline/':'candidate/')+path.relative(owner,file).split(path.sep).join('/'),key='footer-check:'+name;
 if(Object.hasOwn(imports,key))return key;
 imports[key]=null;
 const raw=fs.readFileSync(file);identities[name]=blob(raw);
 if(owner===base)assert.equal(identities[name],baselineEntries[path.relative(base,file).split(path.sep).join('/')],'Changed baseline module '+name);
 const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{
  if(!ref.startsWith('.'))throw Error('Non-local dependency');
  return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;
 });
 imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const unit=collect(path.join(root,'tests/v9-unified/footer-space-reservation.browser.js'));
const pages=collect(path.join(root,'tests/v9-unified/footer-space-pagination.browser.js'));
const baseline=collect(path.join(base,'src/vilna_v9.js'));
const settings=collect(path.join(base,'src/original_stream_columns.js'));
assert(Object.values(imports).every(Boolean),'Unresolved local module');
const html=`<!doctype html><html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' data:;style-src 'unsafe-inline';font-src data:;connect-src 'none'"><body><script>
 const memory=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)}});
 </script><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">
 import {runFooterReservationChecks} from '${unit}';import {runFooterPaginationChecks} from '${pages}';
 import {buildSinglePage as baselineBuildSinglePage,buildPages as baselineBuildPages} from '${baseline}';
 import {getStreamSettings as baselineGetStreamSettings} from '${settings}';
 window.runFooterAcceptance=async()=>{const allocation=runFooterReservationChecks({baselineBuildSinglePage}),pagination=await runFooterPaginationChecks({baselineBuildPages,baselineGetStreamSettings});return {total:allocation.total+pagination.total,passed:allocation.passed+pagination.passed,failed:allocation.failed+pagination.failed,allocation,pagination};};
 </script></body></html>`;
const out=path.join(root,'test-results/footer-space-reservation');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.FOOTER_TEST_BROWSER?{executablePath:process.env.FOOTER_TEST_BROWSER}:{})});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 await page.setContent(html);await page.waitForFunction(()=>!!window.runFooterAcceptance);
 await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(()=>window.runFooterAcceptance());
 const report={baseline:pinned,browserVersion:browser.version(),result,identities,errors,requests,
  originalDocumentValidated:false,productionEligible:false};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,browser:report.browserVersion},null,2));
 assert.equal(result.total,66);assert.equal(errors.length,0,'Page errors');assert.equal(requests.length,0,'Network request');
 assert.equal(result.failed,0,JSON.stringify([...result.allocation.results,...result.pagination.results].filter(r=>!r.pass)));
}finally{await browser.close();}
