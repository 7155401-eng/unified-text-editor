import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import worker, { cleanupExpiredDocxUploads } from '../../cloudflare/docx_worker_entry.js';

async function fixtureDocx(){
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>
<w:p><w:r><w:t>Alpha beta gamma.</w:t></w:r></w:p>
<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter Two</w:t></w:r></w:p>
<w:p><w:r><w:t>Delta epsilon zeta.</w:t></w:r></w:p>
</w:body></w:document>`);
  return await zip.generateAsync({type:'arraybuffer'});
}

function fakeR2(){
  const map=new Map();
  return {
    async put(key,value,opts={}){
      const buf=value instanceof ArrayBuffer?value.slice(0):await new Response(value).arrayBuffer();
      map.set(key,{buf,customMetadata:opts.customMetadata||{},uploaded:new Date()});
    },
    async get(key){
      const v=map.get(key); if(!v)return null;
      return {customMetadata:v.customMetadata,uploaded:v.uploaded,arrayBuffer:async()=>v.buf.slice(0)};
    },
    async delete(key){map.delete(key);},
    async list({prefix='',cursor,limit=1000}={}){
      const objects=[...map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit)
        .map(([key,v])=>({key,customMetadata:v.customMetadata,uploaded:v.uploaded}));
      return {objects,truncated:false,cursor:null};
    },
    _map:map,
  };
}

const envFor=(bucket)=>({
  DOCX_UPLOADS:bucket,
  DB:null,
  ASSETS:{fetch:async()=>new Response('asset')},
});

test('DOCX uploadId flow uploads once, scans and extracts from R2, then deletes',async()=>{
  const bucket=fakeR2(),env=envFor(bucket),ctx={waitUntil(){}};
  const bytes=await fixtureDocx();

  const uploadReq=new Request('https://app.ravtext.com/api/word-chapters-upload',{
    method:'POST',
    headers:{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','x-file-name':'fixture.docx','x-docx-request-id':'test-upload-123456789'},
    body:bytes,
  });
  const uploadRes=await worker.fetch(uploadReq,env,ctx);
  assert.equal(uploadRes.status,200);
  const uploaded=await uploadRes.json();
  assert.equal(uploaded.ok,true);
  assert.match(uploaded.uploadId,/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,220}$/);
  assert.equal(bucket._map.size,1);

  const scanRes=await worker.fetch(new Request(`https://app.ravtext.com/api/word-chapters-scan-upload?uploadId=${encodeURIComponent(uploaded.uploadId)}`,{method:'POST'}),env,ctx);
  assert.equal(scanRes.status,200);
  const scan=await scanRes.json();
  assert.equal(scan.ok,true);
  assert.equal(scan.uploadId,uploaded.uploadId);
  assert.equal(scan.heads['1'].length,2);
  assert.equal(scan.heads['1'][0].title,'Chapter One');

  const extractRes=await worker.fetch(new Request(`https://app.ravtext.com/api/word-chapters-extract-upload?uploadId=${encodeURIComponent(uploaded.uploadId)}&level=1&index=1`,{method:'POST'}),env,ctx);
  assert.equal(extractRes.status,200);
  const extracted=await extractRes.json();
  assert.equal(extracted.ok,true);
  assert.equal(extracted.uploadId,uploaded.uploadId);
  assert.match(extracted.result.mainHtml,/Chapter Two/);
  assert.match(extracted.result.mainHtml,/Delta epsilon zeta/);
  assert.doesNotMatch(extracted.result.mainHtml,/Chapter One/);

  const deleteRes=await worker.fetch(new Request(`https://app.ravtext.com/api/word-chapters-delete-upload?uploadId=${encodeURIComponent(uploaded.uploadId)}`,{method:'POST'}),env,ctx);
  assert.equal(deleteRes.status,200);
  assert.equal(bucket._map.size,0);

  const missingRes=await worker.fetch(new Request(`https://app.ravtext.com/api/word-chapters-scan-upload?uploadId=${encodeURIComponent(uploaded.uploadId)}`,{method:'POST'}),env,ctx);
  assert.equal(missingRes.status,404);
});

test('expired DOCX R2 uploads are cleaned while recent files remain',async()=>{
  const bucket=fakeR2();
  const now=Date.now();
  await bucket.put('uploads/old123456789012345.docx',new Uint8Array([1]).buffer,{customMetadata:{createdAt:String(now-20*24*60*60*1000)}});
  await bucket.put('uploads/new123456789012345.docx',new Uint8Array([2]).buffer,{customMetadata:{createdAt:String(now-2*24*60*60*1000)}});
  const result=await cleanupExpiredDocxUploads({DOCX_UPLOADS:bucket},{now,ttlMs:14*24*60*60*1000});
  assert.deepEqual(result,{scanned:2,deleted:1});
  assert.equal(bucket._map.has('uploads/old123456789012345.docx'),false);
  assert.equal(bucket._map.has('uploads/new123456789012345.docx'),true);
});

test('salvaged client uses uploadId for single and bulk server chapter extraction',async()=>{
  const splitter=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../../src/document_chapter_splitter.js',import.meta.url),'utf8'));
  const stateApi=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../../src/chapter_cache/chapter_server_api.js',import.meta.url),'utf8'));
  assert.match(splitter,/uploadWordChapterFileOnlySafe\(fileObj/);
  assert.match(splitter,/scanUploadedWordChaptersSafe\(uploaded\.uploadId\)/);
  assert.match(splitter,/state\?\.uploadId\s*\?\s*await extractUploadedWordChapterSafe/);
  assert.match(splitter,/if \(state\?\.serverSide && state\?\.uploadId\)/);
  assert.match(stateApi,/uploadId: serverScan\.uploadId \|\| null/);
});
