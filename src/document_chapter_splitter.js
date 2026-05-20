const CARD_ID="we-static-connection-probe";
const MODAL_ID="word-extractor-modal";
const MARKS=/[\u0591-\u05C7]/g;
let wired=false,lastFile=null,token=0,lastStats=null;

const $=(r,s)=>r?.querySelector?.(s)||null;
const $$=(r,s)=>Array.from(r?.querySelectorAll?.(s)||[]);
const fmt=n=>Number(n||0).toLocaleString("he-IL");
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const norm=s=>String(s||"").normalize("NFD").replace(MARKS,"").trim().toLowerCase();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
const modal=()=>document.getElementById(MODAL_ID);

function removeCard(){document.getElementById(CARD_ID)?.remove()}

function ensureCard(){
  const m=modal();
  if(!m?.classList.contains("active")||!lastFile){removeCard();return null}
  let c=document.getElementById(CARD_ID);
  if(c)return c;
  c=document.createElement("section");
  c.id=CARD_ID;c.dir="rtl";
  c.style.cssText="margin:12px 0;padding:12px;border:1px solid #7c3aed;border-radius:10px;background:#faf5ff;color:#111827;box-sizing:border-box";
  const sw=$(".we-streams-wrap",m), me=$(".we-meta",m);
  if(sw?.parentElement)sw.parentElement.insertBefore(c,sw);
  else if(me?.parentElement)me.parentElement.insertBefore(c,me.nextSibling);
  else ($(".we-modal",m)||m).appendChild(c);
  return c;
}

function loading(msg){
  const c=ensureCard(); if(!c)return;
  c.innerHTML=`<b style="color:#312e81">כותרות / פרקים במסמך</b>
  <div style="font-size:12px;color:#64748b">מצב קל: מציג מונה תווים, מילים וכמות כותרות בלבד. רשימת פרקים לא נבנית אוטומטית.</div>
  <div style="margin-top:8px;color:#475569">${esc(msg)}</div>`;
}

function stat(v,label){return `<div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px;text-align:center"><b style="display:block;font-size:18px">${fmt(v)}</b><span>${label}</span></div>`}

function render(){
  const c=ensureCard(); if(!c||!lastStats)return;
  const s=lastStats;
  c.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
    <div><b style="color:#312e81">כותרות / פרקים במסמך</b>
    <div style="font-size:12px;color:#64748b">החישוב הקל הושלם. מונה התווים והמילים נשמר, והפרקים לא נטענים כדי לא להכביד.</div></div>
    <button type="button" data-r style="border:1px solid #cbd5e1;border-radius:8px;background:white;padding:6px 10px;cursor:pointer">רענן</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0">
    ${stat(s.chars,"תווים")}
    ${stat(s.words,"מילים")}
    ${stat(s.total,"כותרות")}
    ${stat(s.h[1]||0,"H1")}
    ${stat(s.h[2]||0,"H2")}
  </div>
  <div style="font-size:12px;color:#475569">
    זוהו כותרות H1/H2 בלי לבנות רשימת פרקים מלאה. השלב הבא יהיה כפתור “הצג פרקים” שיבנה רשימה רק לפי בקשה.
  </div>`;
  $$(c,"[data-r]").forEach(b=>b.onclick=()=>lastFile&&scan(lastFile,++token));
}

function error(msg){
  const c=ensureCard(); if(!c)return;
  c.innerHTML=`<b style="color:#312e81">כותרות / פרקים במסמך</b>
  <button type="button" data-r style="float:left;border:1px solid #cbd5e1;border-radius:8px;background:white;padding:5px 9px">רענן</button>
  <div style="clear:both;margin-top:8px;color:#b91c1c">לא הצלחתי לסרוק: ${esc(msg)}</div>`;
  $$(c,"[data-r]").forEach(b=>b.onclick=()=>lastFile&&scan(lastFile,++token));
}

function kids(n,l){
  if(!n)return [];
  const a=Array.from(n.getElementsByTagNameNS?.("*",l)||[]);
  const b=Array.from(n.getElementsByTagName?.(`w:${l}`)||[]);
  return a.concat(b).filter((x,i,arr)=>arr.indexOf(x)===i);
}
const first=(n,l)=>kids(n,l)[0]||null;
function attr(n,a){return n?(n.getAttribute(`w:${a}`)||n.getAttribute(a)||n.getAttributeNS?.("http://schemas.openxmlformats.org/wordprocessingml/2006/main",a)||""):""}
const ptext=p=>kids(p,"t").map(t=>t.textContent||"").join("");

function parseStyles(xml){
  const out={}; if(!xml)return out;
  const d=new DOMParser().parseFromString(xml,"application/xml");
  for(const s of kids(d,"style")){
    const id=attr(s,"styleId"); if(!id)continue;
    out[id]={name:attr(first(s,"name"),"val"),outline:attr(first(s,"outlineLvl"),"val")};
  }
  return out;
}

function levelOf(p,styles){
  const pr=first(p,"pPr"), ps=first(pr,"pStyle"), ol=first(pr,"outlineLvl");
  let v=attr(ol,"val");
  if(v!==""&&Number.isFinite(+v))return +v+1;
  const id=attr(ps,"val"), st=styles[id]||{};
  v=st.outline;
  if(v!==""&&v!=null&&Number.isFinite(+v))return +v+1;
  const m=`${norm(id)} ${norm(st.name)}`;
  for(let i=1;i<=6;i++)if(norm(id)===String(i)||m.includes(`heading ${i}`)||m.includes(`heading${i}`)||m.includes(`כותרת ${i}`)||m.includes(`כותרת${i}`))return i;
  return 0;
}

function countWords(t){
  const x=String(t||"").trim();if(!x)return 0;
  try{return (x.match(/[\p{L}\p{N}]+(?:['׳״”\-][\p{L}\p{N}]+)*/gu)||[]).length}
  catch{return x.split(/\s+/).filter(Boolean).length}
}

async function waitNative(T){
  const start=Date.now();
  while(T===token&&Date.now()-start<15000){
    const m=modal(), meta=$(".we-meta",m), streams=$(".we-streams-wrap",m), st=$(".we-status",m);
    const ok=(meta&&meta.hidden===false)||(streams&&streams.hidden===false);
    const scanning=st&&st.hidden===false&&/סורק|Scanning|scan/i.test(st.textContent||"");
    if(ok&&!scanning)return;
    await wait(300);
  }
}

async function loadZip(){
  if(window.JSZip)return window.JSZip;
  const mod=await import("jszip");
  return mod.default||mod;
}

async function scan(file,T){
  if(!file||T!==token)return;
  loading("הקובץ נקלט. ממתין לסיום הסריקה הרגילה...");
  await waitNative(T); await frame();
  if(T!==token)return;
  loading("סופר תווים, מילים וכותרות במצב קל...");
  try{
    const JSZip=await loadZip(); await frame();
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    const df=zip.file("word/document.xml");
    if(!df)throw new Error("לא נמצא word/document.xml");
    const [dx,sx]=await Promise.all([df.async("text"),zip.file("word/styles.xml")?.async("text")||Promise.resolve("")]);
    if(T!==token)return;
    const styles=parseStyles(sx||"");
    const doc=new DOMParser().parseFromString(dx,"application/xml");
    const ps=kids(doc,"p");
    const h={1:0,2:0,3:0,4:0,5:0,6:0};
    const parts=[];
    for(let i=0;i<ps.length;i++){
      const text=ptext(ps[i]);
      const L=levelOf(ps[i],styles);
      if(L>=1&&L<=6&&text.trim())h[L]++;
      parts.push(text);
      if(i%700===0)await frame();
      if(T!==token)return;
    }
    const full=parts.join("\n");
    lastStats={chars:full.length,words:countWords(full),h,total:Object.values(h).reduce((a,b)=>a+b,0)};
    render();
  }catch(e){error(e?.message||String(e))}
}

function onFile(e){
  const input=e.target?.closest?.(`#${MODAL_ID} .we-file-input`);
  if(!input)return;
  const file=input.files?.[0];
  if(!file){lastFile=null;lastStats=null;removeCard();return}
  lastFile=file; lastStats=null;
  const T=++token;
  loading("הקובץ נקלט. הספירה תתחיל אחרי הסריקה הרגילה...");
  setTimeout(()=>scan(file,T),800);
}

export function wireChapterSplitter(paneManager){
  void paneManager;
  if(typeof window==="undefined||typeof document==="undefined"||wired)return;
  wired=true;
  const run=()=>{
    const m=modal();
    if(!m?.classList.contains("active"))return;
    if(!lastFile)removeCard();
    else if(lastStats&&!document.getElementById(CARD_ID))render();
    else if(!lastStats)ensureCard();
  };
  document.addEventListener("change",onFile,false);
  [0,100,300,800,1500].forEach(ms=>setTimeout(run,ms));
  new MutationObserver(run).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["class","hidden"]});
  window.ravtextRefreshWordDocumentDiagnostics=()=>{if(lastFile)scan(lastFile,++token)};
  window.ravtextRefreshWordHeadingMap=window.ravtextRefreshWordDocumentDiagnostics;
}
