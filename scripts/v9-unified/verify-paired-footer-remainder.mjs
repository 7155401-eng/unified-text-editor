// Actual page and multi-page planners, on an immutable pre-fix baseline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-chromium';
const root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const base=fs.realpathSync(process.env.PAIRED_REMAINDER_BASELINE_DIR||path.join(root,'.paired-remainder-baseline'));
const pinned='86edae1d46747f229d16e0a1398111ee41084da4';
const imports={},identities={};
const blob=b=>crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
let baselineFiles;
if(process.env.PAIRED_REMAINDER_BASELINE_MANIFEST){const m=JSON.parse(fs.readFileSync(process.env.PAIRED_REMAINDER_BASELINE_MANIFEST));assert.equal(m.commit,pinned);baselineFiles=m.files;}
else{assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:base,encoding:'utf8'}).trim(),pinned);baselineFiles=Object.fromEntries(execFileSync('git',['ls-tree','-r',pinned,'--','src'],{cwd:base,encoding:'utf8'}).trim().split('\n').map(r=>{const [meta,p]=r.split('\t');return[p,meta.split(' ')[2]];}));}
assert.equal(blob(fs.readFileSync(path.join(base,'src/vilna_v9.js'))),'198363417b642fae4eb85e8561f543f7367adad5');
function collect(file){
 file=fs.realpathSync(file);const owner=file.startsWith(base+path.sep)?base:file.startsWith(root+path.sep)?root:null;
 if(!owner||!/\.m?js$/.test(file))throw Error('Dependency outside approved roots');
 const rel=path.relative(owner,file).split(path.sep).join('/'),name=(owner===base?'baseline/':'candidate/')+rel,key='carry:'+name;
 if(Object.hasOwn(imports,key))return key;
 imports[key]=null;const raw=fs.readFileSync(file);identities[name]=blob(raw);
 if(owner===base)assert.equal(identities[name],baselineFiles[rel],'Baseline changed: '+rel);
 const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{if(!ref.startsWith('.'))throw Error('Nonlocal dependency');return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;});
 imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const test=collect(path.join(root,'tests/v9-unified/paired-footer-empty-remainder.browser.js')),baseline=collect(path.join(base,'src/vilna_v9.js'));
assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><meta charset="utf-8"><script>const memory=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),clear:()=>memory.clear()}});</script><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import {runPairedFooterRemainderChecks} from '${test}';import * as baseline from '${baseline}';window.runChecks=()=>runPairedFooterRemainderChecks(baseline);</script>`;
const out=path.join(root,'test-results/paired-footer-remainder');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PAIRED_REMAINDER_BROWSER?{executablePath:process.env.PAIRED_REMAINDER_BROWSER}:{})});
try{
 const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
 await page.setContent(html);await page.waitForFunction(()=>window.runChecks);await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(()=>window.runChecks());const report={baseline:pinned,browserVersion:browser.version(),...result,identities,errors,requests,originalUserDocumentValidated:false};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,failures:result.results.filter(r=>!r.pass)},null,2));
 assert.equal(result.total,51);assert.equal(result.failed,0);assert.equal(errors.length,0);assert.equal(requests.length,0);
}finally{await browser.close();}
