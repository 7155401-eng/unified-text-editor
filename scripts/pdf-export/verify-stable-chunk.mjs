import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const label=String(process.argv[2]||'current').replace(/[^a-z0-9_-]/gi,'_');
const root=process.cwd(),assets=path.join(root,'dist','assets');
assert(fs.existsSync(assets),'dist/assets does not exist; build must run first');
const files=fs.readdirSync(assets).sort();
const stable='pdf_export.js';
assert(files.includes(stable),'stable assets/pdf_export.js was not emitted');
const stalePattern=files.filter(name=>/^pdf_export-[^.]+\.js$/i.test(name));
assert.deepEqual(stalePattern,[],'hashed pdf_export chunk still emitted');

const jsFiles=files.filter(name=>name.endsWith('.js'));
const references=[];
for(const name of jsFiles){
  if(name===stable)continue;
  const code=fs.readFileSync(path.join(assets,name),'utf8');
  if(code.includes(stable))references.push(name);
}
const html=fs.existsSync(path.join(root,'dist','index.html'))
  ? fs.readFileSync(path.join(root,'dist','index.html'),'utf8') : '';
if(html.includes(stable))references.push('index.html');
assert(references.length>0,'built entry graph does not reference stable pdf_export.js');

const pdfPath=path.join(assets,stable),pdf=fs.readFileSync(pdfPath,'utf8');
assert(pdf.length>100,'stable PDF chunk is unexpectedly empty');
const relativeImports=[...pdf.matchAll(/(?:from\s*|import\s*\()\s*["']\.\/([^"']+\.js)["']/g)].map(m=>m[1]);
const missing=[...new Set(relativeImports)].filter(name=>!files.includes(name));
assert.deepEqual(missing,[],'stable PDF chunk references missing sibling JS assets');

const report={
  label,
  stableAsset:'assets/'+stable,
  stableSHA256:crypto.createHash('sha256').update(pdf).digest('hex'),
  bytes:Buffer.byteLength(pdf),
  importerFiles:[...new Set(references)].sort(),
  siblingJsImports:[...new Set(relativeImports)].sort(),
  hashedPdfChunks:stalePattern,
  allAssets:files,
};
const out=path.join(root,'test-results','pdf-load-recovery');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,`stable-chunk-${label}.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
