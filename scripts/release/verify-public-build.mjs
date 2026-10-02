// Read-only post-deployment check. No account, stored document or browser state.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SITE='https://app.ravtext.com/';
const MAX_BYTES=8*1024*1024;
const attr=(text,name)=>new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`,'i').exec(text)?.[2]||'';
async function read(url,kind,fetchImpl){
  const response=await fetchImpl(url,{redirect:'error',cache:'no-store',
    headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`${kind}: HTTP ${response.status}`);
  if(response.url&&new URL(response.url).origin!==new URL(SITE).origin)throw Error('Unexpected response origin');
  const mime=response.headers.get('content-type')||'';
  if(!(kind==='html'?/text\/html/i:/javascript|ecmascript/i).test(mime))throw Error(`${kind}: unexpected MIME ${mime}`);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>MAX_BYTES)throw Error('Response exceeds size limit');chunks.push(Buffer.from(value));}
  }finally{await reader.cancel().catch(()=>{});}
  return {text:Buffer.concat(chunks).toString('utf8'),bytes:size,mime};
}
export async function inspectPublicBuild(commit,fetchImpl=fetch){
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('An exact lowercase Git commit SHA is required');
  const short=commit.slice(0,7),html=await read(SITE+'?release-check='+commit,'html',fetchImpl);
  const scripts=[...html.text.matchAll(/<script\b([^>]*)>/gi)]
    .filter(m=>attr(m[1],'type').toLowerCase()==='module').map(m=>attr(m[1],'src')).filter(Boolean);
  const entries=[...new Set(scripts.map(src=>new URL(src,SITE).href))].filter(raw=>{
    const u=new URL(raw);return u.origin===new URL(SITE).origin&&!u.username&&!u.password&&/^\/assets\/[^/]+\.js$/.test(u.pathname);
  });
  if(!entries.length)throw Error('No first-party built module entry found');
  if(entries.length>16)throw Error('Too many module entries');
  const assets=[];
  for(const url of entries){
    const js=await read(url,'javascript',fetchImpl);
    const stamp=new RegExp(`["']${short}[a-f0-9]{0,33}["']`).test(js.text);
    const versionLabel=js.text.includes('app-version-display');
    assets.push({url,bytes:js.bytes,stamp,versionLabel});
  }
  return {site:SITE,expectedCommit:commit,expectedShort:short,
    matched:assets.some(a=>a.stamp&&a.versionLabel),assets};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const commit=process.env.EXPECTED_COMMIT||process.env.GITHUB_SHA||'';
  const attempts=[];
  for(let i=0;i<16;i++){
    try{attempts.push({attempt:i+1,...await inspectPublicBuild(commit)});}
    catch(error){attempts.push({attempt:i+1,matched:false,error:String(error)});}
    if(attempts.at(-1).matched)break;
    if(i<15)await new Promise(resolve=>setTimeout(resolve,15000));
  }
  const report={matched:attempts.at(-1)?.matched===true,expectedCommit:commit,attempts,
    scope:'Public HTML and version-stamped module bytes only; not user-document or signed-in UI acceptance.'};
  fs.mkdirSync('test-results/public-release',{recursive:true});
  fs.writeFileSync('test-results/public-release/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(!report.matched)process.exitCode=1;
}
