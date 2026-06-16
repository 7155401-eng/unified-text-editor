const B="nested-notes-open-stream-menu-btn",P="nested-notes-stream-menu-popover",I="talmud-streams-input",MAX=2;
let installed=0;
const groups=[
["חלוניות",[["+ חלונית","pane-add"],["✕ הסר חלונית","pane-remove"],["✂ פצל לחלוניות","split-to-panes"],["✂ הפרד הערות","split-special-notes"],["🔗 מזג / פרק","merge-toggle"],["⤺ אחד","merge-from-panes"]]],
["תצוגה וכלים",[["תצוגה","tab:view"],["⚙ כלים","tools-toggle"],["🔗 גלילה","sync-toggle"],["▥ זרמים לרוחב","pane-layout-toggle"],["☷ שורות","lines-toggle"],["↺ איפוס","pane-clear-storage"]]]
];
const $=id=>document.getElementById(id),qa=s=>Array.from(document.querySelectorAll(s));
function txt(e){return[e?.textContent,e?.value,e?.title,e?.getAttribute?.("aria-label"),e?.id].filter(Boolean).join(" ").replace(/\s+/g," ").trim()}
function vis(e){try{if(!(e instanceof HTMLElement)||!e.isConnected)return 0;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity)!==0&&r.width>0&&r.height>0}catch(_){return 1}}
function mine(e){return !!($(B)?.contains(e)||$(P)?.contains(e))}
function controls(){return qa("button,[role='button'],input[type='button'],input[type='submit'],input[type='checkbox'],input[type='radio'],select,label,summary,a[href]").filter(e=>vis(e)&&!mine(e))}
function anchor(){return controls().find(e=>{const t=txt(e);return t.includes("הערות להערות")||/הצג.*הערות.*להערות/.test(t)||/תמיכה.*הערות.*להערות/.test(t)})||$("talmud-stream-picker")||$("talmud-add-stream-btn")||$(I)||document.querySelector(".source-stream-toolbar")||document.querySelector(".panes-toolbar")}
function msg(s){const m=$("stream-menu-status");if(m)m.textContent=s||""}
function runCmd(cmd,label){
  if(cmd.startsWith("tab:")){
    const tab=cmd.slice(4),b=document.querySelector(`.ribbon-tab[data-ribbon-tab="${tab}"]`);
    if(b){b.click();msg(`נפתח: ${label}`);return 1}
    msg(`כרטיסיית ${label} עדיין לא זמינה`);return 0;
  }
  const b=document.createElement("button");
  b.type="button";b.dataset.cmd=cmd;b.textContent=label;b.style.cssText="position:fixed;right:-9999px;bottom:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(b);
  try{b.click();msg(`נשלח: ${label}`);return 1}finally{setTimeout(()=>b.remove(),0)}
}
function codes(){const s=new Set;qa(".stream[data-stream],[data-stream]").forEach(e=>{const c=e.getAttribute("data-stream");if(/^\d{2}$/.test(c||""))s.add(c)});if(!s.size)for(let i=1;i<=10;i++)s.add(String(i).padStart(2,"0"));return[...s].sort()}
function selected(){const i=$(I);return i?(i.value.match(/\d{2}/g)||[]):[]}
function setSel(a){const i=$(I);if(!i)return;i.value=a.slice(0,MAX).sort().join(",");i.dispatchEvent(new Event("change",{bubbles:true}));i.dispatchEvent(new Event("input",{bubbles:true}));msg(i.value?`נבחרו זרמים: ${i.value}`:"לא נבחרו זרמים")}
function open(){const p=$(P);return !!(p&&p.style.display!=="none")}
function placeBtn(){const b=$(B);if(!b)return;let top=88,right=12,pad=10,a=anchor();if(a&&vis(a)){const r=a.getBoundingClientRect();top=r.top+Math.max(0,(r.height-(b.offsetHeight||28))/2);right=Math.max(pad,innerWidth-r.left+6)}top=Math.max(pad,Math.min(innerHeight-(b.offsetHeight||28)-pad,top));right=Math.max(pad,Math.min(innerWidth-(b.offsetWidth||150)-pad,right));b.style.top=Math.round(top)+"px";b.style.right=Math.round(right)+"px";b.style.left="auto"}
function button(){let b=$(B);if(!b){b=document.createElement("button");b.id=B;b.type="button";b.onclick=e=>{e.preventDefault();e.stopPropagation();toggle()};document.body.appendChild(b)}b.innerHTML="<span>🌊</span><span>פתח תפריט זרמים</span>";b.setAttribute("aria-haspopup","dialog");b.setAttribute("aria-expanded",open()?"true":"false");b.style.cssText="position:fixed;z-index:10020;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;border:1px solid rgba(44,90,160,.38);background:linear-gradient(180deg,rgba(44,90,160,.13),rgba(44,90,160,.06));color:inherit;font:inherit;font-size:12px;font-weight:600;line-height:1.35;cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.12);pointer-events:auto";placeBtn()}
function pop(){let p=$(P);if(!p){p=document.createElement("div");p.id=P;p.dir="rtl";p.setAttribute("role","dialog");p.setAttribute("aria-label","תפריט זרמים");document.body.appendChild(p)}p.style.cssText="position:fixed;z-index:10030;display:none;flex-direction:column;width:min(760px,calc(100vw - 16px));max-height:min(82vh,680px);overflow:hidden;border:1px solid rgba(0,0,0,.16);border-radius:14px;background:var(--rt-surface,#fff);color:var(--rt-text,#222);box-shadow:0 12px 32px rgba(0,0,0,.22);font-size:12px;pointer-events:auto;box-sizing:border-box";return p}
function closeBtn(t){const b=document.createElement("button");b.type="button";b.textContent=t;b.style.cssText="border:1px solid rgba(0,0,0,.14);border-radius:10px;background:rgba(0,0,0,.045);color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:7px 12px;min-height:32px";b.onclick=e=>{e.preventDefault();e.stopPropagation();close()};return b}
function title(t){const d=document.createElement("div");d.textContent=t;d.style.cssText="font-weight:700;font-size:12px;opacity:.78;margin:10px 0 6px";return d}
function grid(){const g=document.createElement("div");g.style.cssText="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px";return g}
function act(a){const b=document.createElement("button");b.type="button";b.textContent=a[0];b.style.cssText="display:inline-flex;align-items:center;justify-content:center;min-height:31px;padding:6px 8px;border-radius:9px;border:1px solid rgba(0,0,0,.12);background:rgba(0,0,0,.035);color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap";b.onclick=e=>{e.preventDefault();e.stopPropagation();runCmd(a[1],a[0]);setTimeout(render,120)};return b}
function render(){
  const p=pop();p.innerHTML="";
  const head=document.createElement("div");head.style.cssText="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.10);background:var(--rt-surface,#fff)";head.innerHTML="<strong style='font-size:13px'>🌊 תפריט זרמים</strong><span style='flex:1'></span>";head.appendChild(closeBtn("× סגור"));
  const body=document.createElement("div");body.style.cssText="flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:10px 12px 12px;scrollbar-gutter:stable";body.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});body.addEventListener("touchmove",e=>e.stopPropagation(),{passive:true});
  groups.forEach(g=>{body.appendChild(title(g[0]));const gr=grid();g[1].forEach(a=>gr.appendChild(act(a)));body.appendChild(gr)});
  body.appendChild(title("זרמים"));const input=$(I),hint=document.createElement("div");hint.textContent=input?`בחר עד ${MAX} זרמים להצגה בחלוניות.`:"בקר הזרמים עדיין לא נטען במסך הזה.";hint.style.cssText="opacity:.72;margin:0 0 8px;font-size:11px";body.appendChild(hint);
  if(input){const cur=selected(),w=document.createElement("div");w.style.cssText="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px";codes().forEach(c=>{const on=cur.includes(c),x=document.createElement("button");x.type="button";x.textContent=on?`✓ ${c}`:c;x.style.cssText=`min-width:38px;padding:5px 9px;border-radius:999px;border:1px solid rgba(0,0,0,.12);${on?"background:var(--rt-accent,#2c5aa0);color:#fff":"background:rgba(0,0,0,.035);color:inherit"};font:inherit;font-size:12px;cursor:pointer`;x.onclick=e=>{e.preventDefault();e.stopPropagation();setSel(on?cur.filter(v=>v!==c):(cur.length>=MAX?[...cur.slice(1),c]:[...cur,c]));render()};w.appendChild(x)});body.appendChild(w)}
  body.appendChild(title("זיהוי וקיצורים"));const help=document.createElement("div");help.textContent="@01 בכל מקום מזוהה אוטומטית • Tab בתוך @NN לקפיצה • הערה על הערה: @02 בתוך הערת @01";help.style.cssText="border:1px solid rgba(0,0,0,.10);border-radius:10px;padding:7px 8px;background:rgba(0,0,0,.025);font-size:11px;line-height:1.45;opacity:.82";body.appendChild(help);
  const st=document.createElement("div");st.id="stream-menu-status";st.style.cssText="margin-top:9px;opacity:.74;font-size:11px;min-height:1.4em";body.appendChild(st);
  const foot=document.createElement("div");foot.style.cssText="flex:0 0 auto;display:flex;justify-content:flex-start;padding:9px 12px;border-top:1px solid rgba(0,0,0,.10);background:var(--rt-surface,#fff)";foot.appendChild(closeBtn("סגור תפריט"));p.append(head,body,foot)
}
function pos(){const p=pop(),b=$(B),r=b?.getBoundingClientRect?.(),pad=8;p.style.display="flex";p.style.visibility="hidden";let h=p.offsetHeight||520,w=p.offsetWidth||720,top=r?r.bottom+8:pad,right=r?innerWidth-r.right:pad;if(r&&top+h>innerHeight-pad)top=r.top-h-8;top=Math.max(pad,Math.min(innerHeight-h-pad,top));right=Math.max(pad,Math.min(innerWidth-w-pad,right));p.style.top=Math.round(top)+"px";p.style.right=Math.round(right)+"px";p.style.left="auto";p.style.visibility="visible"}
function show(){render();pos();$(B)?.setAttribute("aria-expanded","true");document.addEventListener("keydown",key,true);addEventListener("resize",repos)}
function close(){const p=$(P);if(p)p.style.display="none";$(B)?.setAttribute("aria-expanded","false");document.removeEventListener("keydown",key,true);removeEventListener("resize",repos)}
function toggle(){open()?close():show()}
function key(e){if(e.key==="Escape")close()}
function repos(){placeBtn();if(open())pos()}
export function installCompactStreamMenuButton(){if(installed||typeof document==="undefined")return;installed=1;const run=()=>button();document.readyState==="loading"?document.addEventListener("DOMContentLoaded",run,{once:true}):run();[0,300,1000,2500,5000].forEach(ms=>setTimeout(run,ms));addEventListener("resize",placeBtn);addEventListener("scroll",placeBtn,true)}
installCompactStreamMenuButton();
