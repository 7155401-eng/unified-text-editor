import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-chromium';
const root=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const baseline=fs.realpathSync(process.env.EXACT_ALIGNMENT_BASELINE||path.join(root,'.exact-alignment-baseline'));
const pinned='9c4738e1063d4692398091e2b10bae87de365487';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),pinned);
const expected=Object.fromEntries(execFileSync('git',['ls-tree','-r','--full-tree',pinned,'--','src'],{cwd:baseline,encoding:'utf8'}).trim().split('\n').map(row=>{const [meta,file]=row.split('\t');return[file,meta.split(' ')[2]];}));
const imports={},identities={};
function collect(file){
 file=fs.realpathSync(file);
 const owner=file.startsWith(baseline+path.sep)?baseline:file.startsWith(root+path.sep)?root:null;
 if(!owner||!/\.m?js$/.test(file))throw Error('Nonlocal test dependency');
 const rel=path.relative(owner,file).split(path.sep).join('/'),name=(owner===baseline?'baseline/':'candidate/')+rel,key='alignment:'+name;
 if(Object.hasOwn(imports,key))return key;imports[key]=null;
 const raw=fs.readFileSync(file),hash=crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');identities[name]=hash;
 if(owner===baseline)assert.equal(hash,expected[rel],'Altered baseline module '+rel);
 const code=raw.toString('utf8').replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_,prefix,q,ref)=>{
  if(!ref.startsWith('.'))throw Error('Nonrelative module');
  return prefix+q+collect(path.resolve(path.dirname(file),ref))+q;
 });
 imports[key]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');return key;
}
const checks=collect(path.join(root,'tests/v9-unified/exact-paragraph-alignment.browser.js'));
const pagination=collect(path.join(root,'tests/v9-unified/exact-paragraph-pagination.browser.js'));
const measure=collect(path.join(baseline,'src/engine/v9_text_measurement.js'));
const planner=collect(path.join(baseline,'src/engine/v9_main_inline_layout.js'));
const pages=collect(path.join(baseline,'src/vilna_v9.js'));
const settings=collect(path.join(baseline,'src/original_stream_columns.js'));
assert(Object.values(imports).every(Boolean));
const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' data:;style-src 'unsafe-inline';font-src data:;connect-src 'none'"><body><script>const memory=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)}});</script><script type="importmap">${JSON.stringify({imports}).replaceAll('</','<\\/')}</script><script type="module">import * as m from '${measure}';import * as p from '${planner}';import * as pages from '${pages}';import * as settings from '${settings}';import {runExactParagraphAlignmentChecks} from '${checks}';import {runExactParagraphPaginationChecks} from '${pagination}';window.runAlignment=async()=>({alignment:runExactParagraphAlignmentChecks({m,p}),pagination:await runExactParagraphPaginationChecks(pages,settings)});</script>`;
const out=path.join(root,'test-results/exact-paragraph-alignment');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
 await page.setContent(html);await page.waitForFunction(()=>!!window.runAlignment);await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(()=>window.runAlignment());
 const report={baseline:pinned,browser:browser.version(),identities,errors,requests,...result,
  total:result.alignment.total+result.pagination.total,failed:result.alignment.failed+result.pagination.failed,
  originalDocumentValidated:false,remainingUnderfilledRows:result.alignment.afterUnderfilled};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({total:report.total,failed:report.failed,remainingUnderfilledRows:report.remainingUnderfilledRows}));
 assert.equal(report.total,312);assert.equal(report.failed,0,JSON.stringify([...result.alignment.records,...result.pagination.records].filter(r=>!r.pass)));
 assert.equal(errors.length,0);assert.equal(requests.length,0);
}finally{await browser.close()}
