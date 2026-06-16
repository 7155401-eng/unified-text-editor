const BTN_ID="nested-notes-open-stream-menu-btn";
const POP_ID="nested-notes-stream-menu-popover";
const INPUT_ID="talmud-streams-input";
const MAX=2;
let installed=false;

const $=(id)=>document.getElementById(id);
const all=(s,root=document)=>Array.from(root.querySelectorAll(s));
const txt=(el)=>[el?.textContent,el?.value,el?.title,el?.getAttribute?.("aria-label"),el?.id,typeof el?.className==="string"?el.className:""].filter(Boolean).join(" ").replace(/\s+/g," ").trim();

function visible(el){
  if(!(el instanceof HTMLElement)||!el.isConnected) return false;
  try{
    const s=getComputedStyle(el);
    if(s.display==="none"||s.visibility==="hidden"||Number(s.opacity)===0) return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0;
  }catch(_){return true;}
}
function inside(el){
  return !!($(POP_ID)?.contains(el)||$(BTN_ID)?.contains(el));
}
function candidates(){
  return all("button,[role='button'],input[type='button'],input[type='submit'],input[type='checkbox'],input[type='radio'],select,label,summary,a[href]")
    .filter(el=>el instanceof HTMLElement && !inside(el) && visible(el));
}
function anchor(){
  return candidates().find(el=>{
    const t=txt(el);
    return t.includes("הערות להערות")||/הצג.*הערות.*להערות/.test(t)||/תמיכה.*הערות.*להערות/.test(t);
  })||$("talmud-stream-picker")||$("talmud-add-stream-btn")||$(INPUT_ID);
}
function selected(){
  const input=$(INPUT_ID);
  return input?(input.value.match(/\d{2}/g)||[]):[];
}
function codes(){
  const set=new Set();
  all(".stream[data-stream],[data-stream]").forEach(el=>{
    const c=el.getAttribute("data-stream");
    if(/^\d{2}$/.test(c||"")) set.add(c);
  });
  if(!set.size) for(let i=1;i<=10;i++) set.add(String(i).padStart(2,"0"));
  return Array.from(set).sort();
}
function setSelected(list){
  const input=$(INPUT_ID);
  if(!input) return false;
  input.value=list.slice(0,MAX).sort().join(",");
  input.dispatchEvent(new Event("change",{bubbles:true}));
  input.dispatchEvent(new Event("input",{bubbles:true}));
  return true;
}
function open(){
  const p=$(POP_ID);
  return !!(p&&p.style.display!=="none");
}

const GROUPS=[
  ["חלונית",[
    ["+ חלונית",["talmud-add-stream-btn","add-pane-btn","add-pane","pane-add-btn","new-pane-btn"],[/^\+?\s*חלונית$/,/הוסף.*חלונית/,/חלונית.*חדשה/,/add.*pane/i,/new.*pane/i]],
    ["✕ הסר חלונית",["remove-pane-btn","delete-pane-btn","pane-remove-btn"],[/הסר.*חלונית/,/מחק.*חלונית/,/remove.*pane/i,/delete.*pane/i]],
    ["✂ פצל לחלוניות",["split-panes-btn","split-to-panes-btn","split-pane-btn"],[/פצל.*חלוניות/,/פצל.*חלונית/,/split.*pane/i]],
    ["✂ הפרד הערות",["separate-notes-btn","split-notes-btn","extract-notes-btn"],[/הפרד.*הערות/,/פצל.*הערות/,/separat.*notes/i,/split.*notes/i]],
    ["🔗 מזג / פרק",["merge-unmerge-btn","merge-toggle-btn","unlink-notes-btn"],[/מזג/,/פרק/,/merge/i,/unlink/i]],
    ["⤺ אחד",["single-pane-btn","one-pane-btn","collapse-panes-btn"],[/^אחד$/,/חלונית אחת/,/single.*pane/i,/one.*pane/i]]
  ]],
  ["תצוגה וכלים",[
    ["תצוגה",["view-menu-btn","display-menu-btn","layout-menu-btn"],[/^תצוגה$/,/תצוגה/,/view/i,/display/i]],
    ["⚙ כלים",["tools-menu-btn","settings-menu-btn"],[/^כלים$/,/כלים/,/tools/i]],
    ["🔗 גלילה",["scroll-sync-toggle","sync-scroll-toggle","linked-scroll-toggle"],[/גלילה/,/סנכרון.*גלילה/,/scroll/i]],
    ["▥ זרמים לרוחב",["horizontal-streams-toggle","streams-horizontal-toggle","talmud-side-mode-select"],[/זרמים.*לרוחב/,/לרוחב.*זרמים/,/horizontal.*streams/i]],
    ["☷ שורות",["talmud-crown-lines-input","crown-lines-input","rows-input"],[/שורות/,/crown.*lines/i,/rows/i]],
    ["↺ איפוס",["reset-layout-btn","layout-reset-btn","reset-btn"],[/איפוס/,/אפס/,/reset/i]]
  ]]
];

function findControl(action){
  const ids=action[1], pats=action[2];
  for(const id of ids){
    const el=$(id);
    if(el&&!inside(el)&&visible(el)) return el;
    const label=document.querySelector(`label[for="${id}"]`);
    if(label&&visible(label)) return label;
  }
  return candidates().find(el=>{
    const t=txt(el);
    return t&&pats.some(p=>p.test(t));
  })||null;
}
function activate(el){
  if(!el) return false;
  const target=el instanceof HTMLLabelElement&&el.control?el.control:el;
  if(target.disabled||target.getAttribute?.("aria-disabled")==="true") return false;
  if(target instanceof HTMLSelectElement||(target instanceof HTMLInputElement&&!["button","submit","checkbox","radio"].includes(target.type))){
    target.focus();
    target.click?.();
    return true;
  }
  target.click?.();
  target.dispatchEvent?.(new Event("input",{bubbles:true}));
  target.dispatchEvent?.(new Event("change",{bubbles:true}));
  return true;
}
function status(msg){
  const p=$(POP_ID);
  if(!p) return;
  let s=p.querySelector("[data-stream-menu-status]");
  if(!s){
    s=document.createElement("div");
    s.dataset.streamMenuStatus="1";
    s.style.cssText="margin-top:8px;opacity:.74;font-size:11px;min-height:1.4em";
    p.appendChild(s);
  }
  s.textContent=msg||"";
}

function placeButton(){
  const b=$(BTN_ID);
  if(!b) return;
  const a=anchor(), pad=10;
  let top=88,right=12;
  if(a instanceof HTMLElement&&visible(a)){
    const r=a.getBoundingClientRect();
    top=r.top+Math.max(0,(r.height-(b.offsetHeight||28))/2);
    right=Math.max(pad,window.innerWidth-r.left+6);
  }
  const w=b.offsetWidth||150,h=b.offsetHeight||28;
  top=Math.max(pad,Math.min(window.innerHeight-h-pad,top));
  right=Math.max(pad,Math.min(window.innerWidth-w-pad,right));
  b.style.top=Math.round(top)+"px";
  b.style.right=Math.round(right)+"px";
  b.style.left="auto";
}
function button(){
  let b=$(BTN_ID);
  if(!b){
    b=document.createElement("button");
    b.id=BTN_ID;
    b.type="button";
    b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();toggle();});
    document.body.appendChild(b);
  }
  b.innerHTML='<span aria-hidden="true">🌊</span><span>פתח תפריט זרמים</span>';
  b.setAttribute("aria-label","פתח תפריט זרמים");
  b.setAttribute("aria-haspopup","dialog");
  b.setAttribute("aria-expanded",open()?"true":"false");
  b.style.cssText="position:fixed;z-index:10020;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;border:1px solid rgba(44,90,160,.38);background:linear-gradient(180deg,rgba(44,90,160,.13),rgba(44,90,160,.06));color:inherit;font:inherit;font-size:12px;font-weight:600;line-height:1.35;cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.12);pointer-events:auto";
  placeButton();
  return b;
}
function pop(){
  let p=$(POP_ID);
  if(!p){
    p=document.createElement("div");
    p.id=POP_ID;
    p.dir="rtl";
    p.setAttribute("role","dialog");
    p.setAttribute("aria-label","תפריט זרמים");
    document.body.appendChild(p);
  }
  p.style.cssText="position:fixed;z-index:10030;display:none;min-width:320px;max-width:min(440px,calc(100vw - 16px));max-height:min(72vh,560px);overflow:auto;box-sizing:border-box;padding:10px;border:1px solid rgba(0,0,0,.16);border-radius:12px;background:var(--rt-surface,#fff);color:var(--rt-text,#222);box-shadow:0 10px 28px rgba(0,0,0,.20);font-size:12px;pointer-events:auto";
  return p;
}
function title(text){
  const d=document.createElement("div");
  d.textContent=text;
  d.style.cssText="font-weight:700;font-size:11px;opacity:.76;margin:9px 0 5px";
  return d;
}
function actionBtn(action){
  const b=document.createElement("button");
  b.type="button";
  b.textContent=action[0];
  b.style.cssText="display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:5px 8px;border-radius:9px;border:1px solid rgba(0,0,0,.12);background:rgba(0,0,0,.035);color:inherit;font:inherit;font-size:12px;cursor:pointer";
  b.addEventListener("click",e=>{
    e.preventDefault();
    e.stopPropagation();
    if(activate(findControl(action))){
      status(`בוצע: ${action[0]}`);
      setTimeout(render,120);
    }else{
      status(`לא נמצא כרגע בקר פעיל עבור: ${action[0]}`);
    }
  });
  return b;
}
function renderActions(parent){
  GROUPS.forEach(group=>{
    parent.appendChild(title(group[0]));
    const grid=document.createElement("div");
    grid.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px";
    group[1].forEach(a=>grid.appendChild(actionBtn(a)));
    parent.appendChild(grid);
  });
}
function renderStreams(parent){
  parent.appendChild(title("זרמים"));
  const input=$(INPUT_ID);
  const hint=document.createElement("div");
  hint.textContent=input?`בחר עד ${MAX} זרמים להצגה בחלוניות.`:"בקר הזרמים עדיין לא נטען במסך הזה.";
  hint.style.cssText="opacity:.72;margin:0 0 8px;font-size:11px";
  parent.appendChild(hint);
  if(!input) return;
  const cur=selected(), wrap=document.createElement("div");
  wrap.style.cssText="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px";
  codes().forEach(code=>{
    const on=cur.includes(code), c=document.createElement("button");
    c.type="button";
    c.textContent=on?`✓ ${code}`:code;
    c.title=on?`הסר זרם ${code}`:`בחר זרם ${code}`;
    c.style.cssText=`min-width:34px;padding:4px 8px;border-radius:999px;border:1px solid rgba(0,0,0,.12);${on?"background:var(--rt-accent,#2c5aa0);color:#fff":"background:rgba(0,0,0,.035);color:inherit"};font:inherit;font-size:12px;cursor:pointer`;
    c.addEventListener("click",e=>{
      e.preventDefault();
      e.stopPropagation();
      const next=on?cur.filter(v=>v!==code):(cur.length>=MAX?[...cur.slice(1),code]:[...cur,code]);
      setSelected(next);
      render();
    });
    wrap.appendChild(c);
  });
  parent.appendChild(wrap);
  const line=document.createElement("div");
  line.textContent=cur.length?`נבחרו: ${cur.join(", ")}`:"לא נבחרו זרמים";
  line.style.cssText="border-top:1px solid rgba(0,0,0,.10);padding-top:7px;opacity:.72;font-size:11px";
  parent.appendChild(line);
}
function renderHelp(parent){
  parent.appendChild(title("זיהוי וקיצורים"));
  const h=document.createElement("div");
  h.textContent="@01 בכל מקום מזוהה אוטומטית • Tab בתוך @NN לקפיצה • הערה על הערה: @02 בתוך הערת @01";
  h.style.cssText="border:1px solid rgba(0,0,0,.10);border-radius:9px;padding:6px 7px;background:rgba(0,0,0,.025);font-size:11px;line-height:1.45;opacity:.82";
  parent.appendChild(h);
}
function render(){
  const p=pop();
  p.innerHTML="";
  const head=document.createElement("div");
  head.style.cssText="display:flex;align-items:center;gap:6px;margin-bottom:8px";
  const h=document.createElement("strong");
  h.textContent="🌊 תפריט זרמים";
  const sp=document.createElement("span");
  sp.style.flex="1";
  const x=document.createElement("button");
  x.type="button";
  x.textContent="×";
  x.title="סגור";
  x.style.cssText="border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:inherit;padding:0 2px";
  x.addEventListener("click",close);
  head.append(h,sp,x);
  p.appendChild(head);
  const body=document.createElement("div");
  renderActions(body);
  renderStreams(body);
  renderHelp(body);
  p.appendChild(body);
  status("");
}
function pos(){
  const p=pop(), b=$(BTN_ID), r=b?.getBoundingClientRect?.(), pad=8;
  p.style.display="block";
  p.style.visibility="hidden";
  let top=r?r.bottom+8:pad, right=r?window.innerWidth-r.right:pad;
  const h=p.offsetHeight||360, w=p.offsetWidth||340;
  if(r&&top+h>window.innerHeight-pad) top=r.top-h-8;
  top=Math.max(pad,Math.min(window.innerHeight-h-pad,top));
  right=Math.max(pad,Math.min(window.innerWidth-w-pad,right));
  p.style.top=Math.round(top)+"px";
  p.style.right=Math.round(right)+"px";
  p.style.left="auto";
  p.style.visibility="visible";
}
function show(){
  render();
  pos();
  $(BTN_ID)?.setAttribute("aria-expanded","true");
  document.addEventListener("keydown",key,true);
  window.addEventListener