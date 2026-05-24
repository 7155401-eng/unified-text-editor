const DB_NAME="ravtext-chapter-cache";
const DB_VERSION=1;

export const CHAPTER_CACHE_STATUS=Object.freeze({
  NOT_STARTED:"not_started",
  EXTRACTING:"extracting",
  EXTRACTED:"extracted",
  RENDERING:"rendering",
  RENDERED:"rendered",
  STALE:"stale",
  ERROR:"error",
});

const STORES={
  documents:"documents",
  chapters:"chapters",
  documentSource:"documentSource",
  documentPayload:"documentPayload",
  chapterExtraction:"chapterExtraction",
  chapterRender:"chapterRender",
};

let dbPromise=null;

const req=(request)=>new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error("IndexedDB request failed"));
});

const txDone=(tx)=>new Promise((resolve,reject)=>{
  tx.oncomplete=()=>resolve();
  tx.onabort=()=>reject(tx.error||new Error("IndexedDB transaction aborted"));
  tx.onerror=()=>reject(tx.error||new Error("IndexedDB transaction failed"));
});

function index(store,name,keyPath,options){
  if(!store.indexNames.contains(name)) store.createIndex(name,keyPath,options);
}

function ensureStores(db){
  if(!db.objectStoreNames.contains(STORES.documents)){
    const s=db.createObjectStore(STORES.documents,{keyPath:"docId"});
    index(s,"updatedAt","updatedAt");
    index(s,"fileName","fileName");
  }
  if(!db.objectStoreNames.contains(STORES.chapters)){
    const s=db.createObjectStore(STORES.chapters,{keyPath:["docId","chapterId"]});
    index(s,"docId","docId");
    index(s,"docIdStatus",["docId","status"]);
    index(s,"docIdLevel",["docId","level"]);
  }
  if(!db.objectStoreNames.contains(STORES.documentSource)){
    db.createObjectStore(STORES.documentSource,{keyPath:"docId"});
  }
  if(!db.objectStoreNames.contains(STORES.documentPayload)){
    db.createObjectStore(STORES.documentPayload,{keyPath:"docId"});
  }
  if(!db.objectStoreNames.contains(STORES.chapterExtraction)){
    const s=db.createObjectStore(STORES.chapterExtraction,{keyPath:["docId","chapterId"]});
    index(s,"docId","docId");
  }
  if(!db.objectStoreNames.contains(STORES.chapterRender)){
    const s=db.createObjectStore(STORES.chapterRender,{keyPath:["docId","chapterId","settingsHash"]});
    index(s,"docId","docId");
    index(s,"docIdChapterId",["docId","chapterId"]);
    index(s,"docIdSettingsHash",["docId","settingsHash"]);
  }
}

export function openChapterCacheDb(){
  if(typeof indexedDB==="undefined") return Promise.reject(new Error("IndexedDB is not available."));
  if(!dbPromise){
    dbPromise=new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_NAME,DB_VERSION);
      r.onupgradeneeded=()=>ensureStores(r.result);
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>{dbPromise=null;reject(r.error||new Error("Failed to open chapter cache DB"));};
      r.onblocked=()=>console.warn("[chapter_cache_db] upgrade blocked by another tab");
    });
  }
  return dbPromise;
}

async function withStores(names,mode,fn){
  const db=await openChapterCacheDb();
  const list=Array.isArray(names)?names:[names];
  const tx=db.transaction(list,mode);
  const stores=Object.fromEntries(list.map(name=>[name,tx.objectStore(name)]));
  const out=await fn(stores,tx);
  await txDone(tx);
  return out;
}

function joinBytes(chunks){
  const size=chunks.reduce((n,c)=>n+c.byteLength,0);
  const out=new Uint8Array(size);
  let offset=0;
  for(const c of chunks){
    const v=c instanceof Uint8Array?c:new Uint8Array(c);
    out.set(v,offset);
    offset+=v.byteLength;
  }
  return out;
}

function hex(buffer){
  return Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function fallbackDocId(file){
  return ["docx",String(file?.name||"document").replace(/[^\w.-]+/g,"_"),file?.size||0,file?.lastModified||0].join("-");
}

export async function sha256Hex(value){
  if(typeof crypto==="undefined"||!crypto.subtle) throw new Error("WebCrypto is not available.");
  const buffer=value instanceof ArrayBuffer?value:new TextEncoder().encode(String(value??"")).buffer;
  return hex(await crypto.subtle.digest("SHA-256",buffer));
}

export async function computeChapterDocId(file,{chunkSize=65536,fullHashLimit=8388608}={}){
  if(!file?.arrayBuffer) return fallbackDocId(file);
  const meta=new TextEncoder().encode([file.name||"",file.size||0,file.lastModified||0].join("\0"));
  try{
    if(file.size<=fullHashLimit){
      return `docx-${await sha256Hex(joinBytes([meta,new Uint8Array(await file.arrayBuffer())]).buffer)}`;
    }
    const first=new Uint8Array(await file.slice(0,chunkSize).arrayBuffer());
    const lastStart=Math.max(0,file.size-chunkSize);
    const last=new Uint8Array(await file.slice(lastStart).arrayBuffer());
    return `docx-${await sha256Hex(joinBytes([meta,first,last]).buffer)}`;
  }catch(e){
    console.warn("[chapter_cache_db] docId fallback:",e);
    return fallbackDocId(file);
  }
}

export function createChapterId(level,index){
  return `${Number(level)||0}:${Number(index)||0}`;
}

export function buildChapterRecords(docId,heads={}){
  const out=[];
  for(const rawLevel of Object.keys(heads||{})){
    const level=Number(rawLevel);
    const rows=Array.isArray(heads[rawLevel])?heads[rawLevel]:[];
    for(let i=0;i<rows.length;i+=1){
      const head=rows[i]||{};
      const next=rows[i+1]||null;
      out.push({
        docId,chapterId:createChapterId(level,i),level,index:i,
        title:head.title||`פרק ${i+1}`,
        start:Number(head.start||0),
        end:next?Number(next.start||0):null,
        status:CHAPTER_CACHE_STATUS.NOT_STARTED,
        importedAt:null,renderedAt:null,error:null,
      });
    }
  }
  return out;
}

export async function saveDocumentManifest(manifest){
  const now=Date.now();
  const docId=manifest?.docId;
  if(!docId) throw new Error("saveDocumentManifest requires docId.");
  const file=manifest.file||null;
  const chapters=manifest.chapters||buildChapterRecords(docId,manifest.heads||{});

  await withStores([STORES.documents,STORES.chapters,STORES.documentSource,STORES.documentPayload],"readwrite",async s=>{
    const prev=await req(s.documents.get(docId)).catch(()=>null);
    s.documents.put({
      ...(prev||{}),docId,
      fileName:manifest.fileName||file?.name||prev?.fileName||"מסמך Word",
      fileSize:manifest.fileSize??file?.size??prev?.fileSize??0,
      fileModified:manifest.fileModified??file?.lastModified??prev?.fileModified??0,
      fileHash:manifest.fileHash||docId,
      createdAt:prev?.createdAt||now,
      updatedAt:now,
      selectedLevel:manifest.selectedLevel||prev?.selectedLevel||1,
      chapterCount:chapters.length,
      settingsHash:manifest.settingsHash||prev?.settingsHash||null,
      renderEngineVersion:manifest.renderEngineVersion||prev?.renderEngineVersion||"v9-2026-05-chapter-cache-1",
      h:manifest.h||prev?.h||{},
      chars:manifest.chars??prev?.chars??0,
      words:manifest.words??prev?.words??0,
      total:manifest.total??prev?.total??0,
    });
    s.documentPayload.put({docId,heads:manifest.heads||{},h:manifest.h||{},partsMeta:manifest.partsMeta||[],savedAt:now});
    if(file){
      s.documentSource.put({docId,fileBlob:file,fileName:file.name||manifest.fileName||"מסמך Word",fileSize:file.size||0,fileModified:file.lastModified||0,savedAt:now});
    }
    for(const chapter of chapters){
      const prevChapter=await req(s.chapters.get([docId,chapter.chapterId])).catch(()=>null);
      s.chapters.put({
        ...(prevChapter||{}),...chapter,
        status:prevChapter?.status||chapter.status||CHAPTER_CACHE_STATUS.NOT_STARTED,
        importedAt:prevChapter?.importedAt||chapter.importedAt||null,
        renderedAt:prevChapter?.renderedAt||chapter.renderedAt||null,
        error:prevChapter?.error||chapter.error||null,
        updatedAt:now,
      });
    }
  });
  return {docId,chapterCount:chapters.length};
}

export async function getDocument(docId){
  if(!docId) return null;
  return withStores(STORES.documents,"readonly",s=>req(s.documents.get(docId)));
}

export async function getDocumentSource(docId){
  if(!docId) return null;
  return withStores(STORES.documentSource,"readonly",s=>req(s.documentSource.get(docId)));
}

export async function getDocumentPayload(docId){
  if(!docId) return null;
  return withStores(STORES.documentPayload,"readonly",s=>req(s.documentPayload.get(docId)));
}

export async function getChapters(docId){
  if(!docId) return [];
  return withStores(STORES.chapters,"readonly",async s=>{
    const rows=await req(s.chapters.index("docId").getAll(docId));
    return rows.sort((a,b)=>(a.level-b.level)||(a.index-b.index));
  });
}

export async function getDocumentManifest(docId){
  const [documentRecord,payload,chapters]=await Promise.all([getDocument(docId),getDocumentPayload(docId),getChapters(docId)]);
  if(!documentRecord) return null;
  return {...documentRecord,heads:payload?.heads||{},partsMeta:payload?.partsMeta||[],chapters};
}

export async function setChapterStatus(docId,chapterId,status,patch={}){
  const now=Date.now();
  return withStores(STORES.chapters,"readwrite",async s=>{
    const prev=await req(s.chapters.get([docId,chapterId])).catch(()=>null);
    const next={...(prev||{docId,chapterId}),...patch,status,updatedAt:now};
    s.chapters.put(next);
    return next;
  });
}

export async function saveChapterExtraction(docId,chapterId,extraction){
  const now=Date.now();
  await withStores([STORES.chapterExtraction,STORES.chapters],"readwrite",async s=>{
    s.chapterExtraction.put({...extraction,docId,chapterId,extractedAt:extraction?.extractedAt||now});
    const prev=await req(s.chapters.get([docId,chapterId])).catch(()=>null);
    s.chapters.put({...(prev||{docId,chapterId}),status:CHAPTER_CACHE_STATUS.EXTRACTED,importedAt:now,error:null,updatedAt:now});
  });
}

export async function getChapterExtraction(docId,chapterId){
  if(!docId||!chapterId) return null;
  return withStores(STORES.chapterExtraction,"readonly",s=>req(s.chapterExtraction.get([docId,chapterId])));
}

export async function saveChapterRender(docId,chapterId,renderResult){
  const now=Date.now();
  const settingsHash=renderResult?.settingsHash||"default";
  await withStores([STORES.chapterRender,STORES.chapters],"readwrite",async s=>{
    s.chapterRender.put({...renderResult,docId,chapterId,settingsHash,renderedAt:renderResult?.renderedAt||now});
    const prev=await req(s.chapters.get([docId,chapterId])).catch(()=>null);
    s.chapters.put({...(prev||{docId,chapterId}),status:CHAPTER_CACHE_STATUS.RENDERED,renderedAt:now,error:null,updatedAt:now});
  });
}

export async function getChapterRender(docId,chapterId,settingsHash="default"){
  if(!docId||!chapterId) return null;
  return withStores(STORES.chapterRender,"readonly",s=>req(s.chapterRender.get([docId,chapterId,settingsHash])));
}

export const chapterDb={
  open:openChapterCacheDb,
  computeDocId:computeChapterDocId,
  createChapterId,
  buildChapterRecords,
  saveDocumentManifest,
  getDocument,
  getDocumentSource,
  getDocumentPayload,
  getDocumentManifest,
  getChapters,
  setChapterStatus,
  saveChapterExtraction,
  getChapterExtraction,
  saveChapterRender,
  getChapterRender,
};
