import{readFileSync as r,writeFileSync as w}from'node:fs';
const WI='worker/index.js',DW='cloudflare/docx_worker_entry.js';
const R=p=>r(p,'utf8').replace(/\r\n/g,'\n'),W=(p,s)=>w(p,s,'utf8');
const M=(s,a,b,l)=>{if(!s.includes(a))throw Error('[docx-uploadid-r2] '+l);return s.replace(a,b)};
let s=R(WI);s=s.replace('response = await handleDocxApi(request);','response = await handleDocxApi(request, env);');W(WI,s);
let d=R(DW);
d=d.replace('const VERSION = "2026-05-28-large-response-debug";','const VERSION = "2026-05-28-uploadid-r2-flow";')
   .replace('const VERSION = "2026-05-28-upload-debug";','const VERSION = "2026-05-28-uploadid-r2-flow";')
   .replace('const VERSION = "2026-05-26-server-extract";','const VERSION = "2026-05-28-uploadid-r2-flow";');
const H=`
function isDocxUploadOnlyPath(p){return p==="/api/word-chapters-upload"||p==="/api/word-chapters/upload"}
function isDocxScanUploadedPath(p){return p==="/api/word-chapters-scan-upload"||p==="/api/word-chapters/scan-upload"}
function isDocxExtractUploadedPath(p){return p==="/api/word-chapters-extract-upload"||p==="/api/word-chapters/extract-upload"}
function isDocxFullUploadedPath(p){return p==="/api/word-chapters-full-upload"||p==="/api/word-chapters/full-upload"}
function isDocxDeleteUploadPath(p){return p==="/api/word-chapters-delete-upload"||p==="/api/word-chapters/delete-upload"}
function docxUploadKey(id){const safe=String(id||"").replace(/[^a-zA-Z0-9_.:-]/g,"");if(!safe){const e=new Error("Missing uploadId.");e.status=400;throw e}return "uploads/"+safe+".docx"}
async function readJsonBody(request){try{return await request.json()}catch{return{}}}
function uploadIdFrom(request,url,body={}){return url.searchParams.get("uploadId")||request.headers.get("x-docx-upload-id")||body.uploadId||""}
async function readUploadedDocx(env,uploadId){if(!env?.DOCX_UPLOADS){const e=new Error("DOCX_UPLOADS R2 binding is not configured.");e.status=500;throw e}const obj=await env.DOCX_UPLOADS.get(docxUploadKey(uploadId));if(!obj){const e=new Error("Uploaded DOCX was not found.");e.status=404;throw e}return await obj.arrayBuffer()}
async function handleUploadOnly(request,env){const id=request.headers.get("x-docx-request-id")||requestId();if(request.method==="OPTIONS")return optionsResponse(id);if(request.method!=="POST")return jsonResponse({ok:false,requestId:id,error:"Method not allowed"},405,id);if(!env?.DOCX_UPLOADS)return jsonResponse({ok:false,requestId:id,error:"DOCX_UPLOADS R2 binding is not configured."},500,id);try{const arrayBuffer=await request.arrayBuffer();const bytes=arrayBuffer.byteLength;if(!bytes)return jsonResponse({ok:false,requestId:id,error:"Empty DOCX."},400,id);if(bytes>MAX_DOCX_BYTES)return jsonResponse({ok:false,requestId:id,error:"DOCX too large."},413,id);const fileHash=await sha256Hex(arrayBuffer);const uploadId=fileHash+"-"+Date.now().toString(36);await env.DOCX_UPLOADS.put(docxUploadKey(uploadId),arrayBuffer,{httpMetadata:{contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},customMetadata:{fileHash,bytes:String(bytes),createdAt:String(Date.now()),requestId:id,fileName:request.headers.get("x-file-name")||""}});log("log","upload_only_done",{requestId:id,uploadId,fileHash,bytes});return jsonResponse({ok:true,serverSide:true,requestId:id,uploadId,fileHash,bytes,uploadedAt:Date.now(),message:"upload_done"},200,id)}catch(error){return jsonResponse({ok:false,requestId:id,error:error?.message||String(error)},error?.status||500,id)}}
async function handleDeleteUpload(request,env){const id=request.headers.get("x-docx-request-id")||requestId();const url=new URL(request.url);if(request.method==="OPTIONS")return optionsResponse(id);if(!["POST","DELETE"].includes(request.method))return jsonResponse({ok:false,requestId:id,error:"Method not allowed"},405,id);if(!env?.DOCX_UPLOADS)return jsonResponse({ok:false,requestId:id,error:"DOCX_UPLOADS R2 binding is not configured."},500,id);const body=request.method==="POST"?await readJsonBody(request):{};const uploadId=uploadIdFrom(request,url,body);await env.DOCX_UPLOADS.delete(docxUploadKey(uploadId));return jsonResponse({ok:true,requestId:id,uploadId,deletedAt:Date.now()},200,id)}
`;
if(!d.includes('function isDocxUploadOnlyPath(p)'))d=M(d,'\nasync function handleDocxApi(',`\n${H}\nasync function handleDocxApi(`,'helpers');
d=d.replace('async function handleDocxApi(request) {','async function handleDocxApi(request, env) {');
if(!d.includes('handleUploadOnly(request,env)'))d=M(d,'  const url = new URL(request.url);\n','  const url = new URL(request.url);\n\n  if(isDocxUploadOnlyPath(url.pathname))return handleUploadOnly(request,env);\n  if(isDocxDeleteUploadPath(url.pathname))return handleDeleteUpload(request,env);\n','routes');
d=M(d,'    path === "/api/word-chapters-scan" ||\n    path === "/api/word-chapters/scan";','    path === "/api/word-chapters-scan" ||\n    path === "/api/word-chapters/scan" ||\n    isDocxUploadOnlyPath(path)||isDocxScanUploadedPath(path)||isDocxFullUploadedPath(path)||isDocxDeleteUploadPath(path);','import paths');
d=M(d,'  return path === "/api/word-chapters-extract" || path === "/api/word-chapters/extract";','  return path === "/api/word-chapters-extract" || path === "/api/word-chapters/extract" || isDocxExtractUploadedPath(path);','extract path');
d=d.replace('return handleDocxApi(request);','return handleDocxApi(request, env);');
if(!d.includes('const uploadId = url.searchParams.get("uploadId");')){
 d=M(d,'    const arrayBuffer = await request.arrayBuffer();','    const uploadId = url.searchParams.get("uploadId");\n    const arrayBuffer = uploadId ? await readUploadedDocx(env, uploadId) : await request.arrayBuffer();','read uploaded');
}
if(!d.includes('full_uploaded_extract_success')){
 d=M(d,'  const { partsMeta } = bodyParts(bodyXml, styles);\n\n  const levelHeads = [];',`  const { partsMeta } = bodyParts(bodyXml, styles);

  if (level === 0) {
    const mainHtml = partsMeta.map((part) => {
      const text = String(part.text || "").trim();
      if (!text) return "";
      if (part.level >= 1 && part.level <= 6) return \`<h\${part.level}>\${escHtml(text)}</h\${part.level}>\`;
      return \`<p>\${escHtml(text)}</p>\`;
    }).filter(Boolean).join("\\n") || "<p></p>";
    log("log", "full_uploaded_extract_success", { requestId: id, parts: partsMeta.length, elapsedMs: Date.now() - started });
    return { ok: true, serverSide: true, requestId: id, title: "מסמך Word מלא", result: { mainHtml, streams: [], streamsHtml: [] } };
  }

  const levelHeads = [];`,'full doc');
}
W(DW,d);
