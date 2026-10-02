import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPublicBuild} from '../../scripts/release/verify-public-build.mjs';
const commit='0123456789abcdef0123456789abcdef01234567';
const entry='<script type="module" src="/assets/index-example.js"></script>';
const code='document.getElementById("app-version-display"); const sha="0123456";';
function fixture({html=entry,js=code,status=200,mime='text/javascript'}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return url.includes('?release-check=')?new Response(html,{headers:{'content-type':'text/html'}})
      :new Response(js,{status,headers:{'content-type':mime}});
  };
  return {calls,fetchImpl};
}
test('finds exact release in first-party stamped entry',async()=>{
  const f=fixture(),r=await inspectPublicBuild(commit,f.fetchImpl);assert(r.matched);
  assert.equal(f.calls.length,2);assert(f.calls.every(c=>c.options.redirect==='error'&&c.options.cache==='no-store'));
});
test('old deployed build is not reported as updated',async()=>{
  const f=fixture({js:code.replace('0123456','cd30653')});assert.equal((await inspectPublicBuild(commit,f.fetchImpl)).matched,false);
});
test('unrelated hash without app version label is not enough',async()=>{
  const f=fixture({js:'const x="0123456";'});assert.equal((await inspectPublicBuild(commit,f.fetchImpl)).matched,false);
});
test('a SHA substring inside a different value is not accepted',async()=>{
  const f=fixture({js:code.replace('"0123456"','"prefix0123456"')});assert.equal((await inspectPublicBuild(commit,f.fetchImpl)).matched,false);
});
test('does not fetch cross-origin script even if its path looks valid',async()=>{
  const f=fixture({html:entry+'<script type="module" src="https://other.example/assets/index.js"></script>'});
  assert((await inspectPublicBuild(commit,f.fetchImpl)).matched);assert.equal(f.calls.length,2);
});
test('accepts relative entry and reversed attribute order',async()=>{
  const f=fixture({html:"<script src='./assets/index-example.js' type='module'></script>"});assert((await inspectPublicBuild(commit,f.fetchImpl)).matched);
});
for(const status of [404,503])test(`HTTP ${status} is failure, not stale-build success`,async()=>{
  const f=fixture({status});await assert.rejects(inspectPublicBuild(commit,f.fetchImpl),/HTTP/);
});
test('HTML fallback instead of JS is rejected',async()=>{
  const f=fixture({mime:'text/html'});await assert.rejects(inspectPublicBuild(commit,f.fetchImpl),/MIME/);
});
test('missing entry is an explicit failure',async()=>{
  const f=fixture({html:'<html></html>'});await assert.rejects(inspectPublicBuild(commit,f.fetchImpl),/No first-party/);
});
test('invalid commit makes no network request',async()=>{
  const f=fixture();await assert.rejects(inspectPublicBuild('main',f.fetchImpl),/exact lowercase/);assert.equal(f.calls.length,0);
});
