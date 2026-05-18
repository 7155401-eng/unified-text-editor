import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = (p) => path.resolve(root, p);
const read = (p) => fs.readFileSync(file(p), "utf8");
const write = (p, s) => fs.writeFileSync(file(p), s, "utf8");

function patch(rel, name, oldText, newText, marker) {
  let s = read(rel);
  if (s.includes(marker)) return console.log(`[perfect-render-safety] ${name}: already patched`);
  if (!s.includes(oldText)) throw new Error(`[perfect-render-safety] ${name}: source block not found in ${rel}`);
  s = s.replace(oldText, newText);
  write(rel, s);
  console.log(`[perfect-render-safety] ${name}: patched`);
}
function append(rel, name, text, marker) {
  let s = read(rel);
  if (s.includes(marker)) return console.log(`[perfect-render-safety] ${name}: already appended`);
  if (!s.endsWith("\n")) s += "\n";
  write(rel, s + text);
  console.log(`[perfect-render-safety] ${name}: appended`);
}

// 1) Real render cancellation: increment the private render token and expose a public cancel hook.
patch(
  "src/engine_bridge.js",
  "cancel render API",
`export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);
}

// Smart-tune state: prevent re-entry while a tune cycle is active.`,
`export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);
}

export function cancelEngineRender(reason = "user") {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _renderToken++;
  const statusEl = typeof document !== "undefined" ? document.getElementById("status") : null;
  if (statusEl) statusEl.textContent = "הרינדור נעצר. התצוגה הקודמת נשמרה.";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ravtext:engine-render-cancelled", { detail: { reason, token: _renderToken } }));
  }
}

if (typeof window !== "undefined") window.__ravtextCancelRender = cancelEngineRender;

// Smart-tune state: prevent re-entry while a tune cycle is active.`,
  "export function cancelEngineRender("
);
patch("src/engine_bridge.js", "cancel after preflight", `    }

    // v33: inject demo watermarks INTO source content BEFORE pagination —`, `    }
    if (myToken !== _renderToken) return;

    // v33: inject demo watermarks INTO source content BEFORE pagination —`, "// v33: inject demo watermarks INTO source content BEFORE pagination");
patch("src/engine_bridge.js", "cancel after beforeBuild", `    await firePackerHook("beforeBuild", { container: pagesContainer, pages });
    // משה 2026-05-08: שלב talmud_layout הוסר`, `    await firePackerHook("beforeBuild", { container: pagesContainer, pages });
    if (myToken !== _renderToken) return;
    // משה 2026-05-08: שלב talmud_layout הוסר`, "await firePackerHook(\"beforeBuild\", { container: pagesContainer, pages });\n    if (myToken !== _renderToken) return;");
patch("src/engine_bridge.js", "cancel after mishna wrap", `    await applyMishnaWrapToPages(pagesContainer);
    logEvent("balanced_columns");`, `    await applyMishnaWrapToPages(pagesContainer);
    if (myToken !== _renderToken) return;
    logEvent("balanced_columns");`, "await applyMishnaWrapToPages(pagesContainer);\n    if (myToken !== _renderToken) return;");
patch("src/engine_bridge.js", "cancel after balanced columns", `    await applyBalancedColumnsToPages(pagesContainer);
    logEvent("opening_word");`, `    await applyBalancedColumnsToPages(pagesContainer);
    if (myToken !== _renderToken) return;
    logEvent("opening_word");`, "await applyBalancedColumnsToPages(pagesContainer);\n    if (myToken !== _renderToken) return;");

// 2) Stop button inside V9 render progress dialog.
patch("src/render_progress_ui.js", "progress grid stop column", `      grid-template-columns: auto 1fr auto;`, `      grid-template-columns: auto 1fr auto auto;`, "grid-template-columns: auto 1fr auto auto;");
patch("src/render_progress_ui.js", "progress card pointer events", `      backdrop-filter: blur(18px) saturate(1.18);
      -webkit-backdrop-filter: blur(18px) saturate(1.18);`, `      backdrop-filter: blur(18px) saturate(1.18);
      -webkit-backdrop-filter: blur(18px) saturate(1.18);
      pointer-events: auto;`, "pointer-events: auto;");
patch("src/render_progress_ui.js", "progress stop style", `    #ravtext-render-progress-ui .rtp-track {`, `    #ravtext-render-progress-ui .rtp-cancel {
      border: 1px solid rgba(153, 27, 27, .24);
      border-radius: 999px;
      background: rgba(255,255,255,.75);
      color: #991b1b;
      font-size: 12px;
      font-weight: 800;
      padding: 8px 10px;
      cursor: pointer;
      pointer-events: auto;
    }
    #ravtext-render-progress-ui .rtp-cancel:hover { background: #fee2e2; }

    #ravtext-render-progress-ui .rtp-track {`, ".rtp-cancel");
patch("src/render_progress_ui.js", "progress stop markup", `          <div class="rtp-percent" data-rtp="percent">0%</div>`, `          <div class="rtp-percent" data-rtp="percent">0%</div>
          <button type="button" class="rtp-cancel" data-rtp-action="cancel" title="עצור רינדור">עצור</button>`, "data-rtp-action=\"cancel\"");
patch("src/render_progress_ui.js", "progress stop behavior", `  document.body.appendChild(host);
  return host;`, `  document.body.appendChild(host);
  const cancelBtn = host.querySelector('[data-rtp-action="cancel"]');
  if (cancelBtn && cancelBtn.dataset.bound !== "1") {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { window.__ravtextCancelRender?.("progress-dialog"); } catch (_) {}
      hideVilnaRenderProgressImmediately();
      const statusEl = document.getElementById("status");
      if (statusEl) statusEl.textContent = "הרינדור נעצר מתוך חלון ההתקדמות.";
    });
  }
  return host;`, "progress-dialog");

// 3) Connect existing toolbar stop to real cancellation.
patch("template-picker.js", "toolbar stop calls real cancel", `  function stopRender() {
    state.running = false;`, `  function stopRender() {
    try { window.__ravtextCancelRender?.('toolbar'); } catch (_) {}
    state.running = false;`, "window.__ravtextCancelRender?.('toolbar')");

// 4) Add missing UI safety tools without replacing the existing dynamic troubleshooting.
append("template-picker.js", "perfect supplementary UI", `

// perfect-render-safety: supplementary UI; keeps existing troubleshooting/pause-stop behavior.
(() => {
  const SNAP_KEY = 'ravtext.snapshots.v1';
  const byId = (id) => document.getElementById(id);
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const exactResetKeys = ['ravtext.streamSettings.v1','ravtext.globalStreamOverrides.v1','ravtext.streamOrder.v1','ravtext.talmudLayout','ravtext.mishnaWrap','ravtext.mishnaWrap.levels','ravtext.spacing.v1','ravtext.pageSettings.v1','ravtext.documentStyle.v1','ravtext.outputBackground','ravtext.vilnaV9Beta','ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1','ravtext.renderPaused','ravtext.renderPaused.prevLiveRender'];
  const resetPrefixes = ['ravtext.talmudLayout.','ravtext.mishnaWrap.','ravtext.v9.','ravtext.layout.','ravtext.liveOverflow.'];
  const dangerous = new Set(['clear-all','word-import','word-import-streams','auto-parse','auto-parse-paste','split-to-panes','split-special-notes','split-notes-advanced','merge-toggle','toggle-merge','merge-from-panes','pane-clear-storage','pane-remove','reset-system-state']);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const json = (v, fb) => { try { return JSON.parse(v); } catch (_) { return fb; } };
  function addStyle(){ if(byId('perfect-render-safety-style')) return; const s=document.createElement('style'); s.id='perfect-render-safety-style'; s.textContent=[
    '.perfect-btn{margin-inline-start:6px;white-space:nowrap}',
    '.perfect-toast{position:fixed;left:18px;bottom:18px;z-index:2147483100;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.24);direction:rtl;max-width:460px}',
    '.perfect-modal-backdrop{position:fixed;inset:0;z-index:2147483050;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px}',
    '.perfect-modal{direction:rtl;width:min(780px,94vw);max-height:88vh;overflow:auto;background:#fff;color:#111827;border-radius:14px;box-shadow:0 12px 34px rgba(15,23,42,.24);padding:20px 22px;font-family:Segoe UI,system-ui,sans-serif;line-height:1.55}',
    '.perfect-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.perfect-head h2{margin:0;font-size:19px}.perfect-close{border:0;background:transparent;cursor:pointer;font-size:24px;color:#64748b}.perfect-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.perfect-card{border:1px solid #dbeafe;border-radius:10px;padding:10px 12px;background:#f8fafc;margin:8px 0}.pass{color:#166534}.fail{color:#991b1b}',
    '.ravtext-stream-section{border:1px solid var(--rt-line,#d7d0be);border-radius:8px;margin:4px 6px;padding:4px 6px;background:var(--rt-surface-2,#fbf8ef);vertical-align:top}.ravtext-stream-section>summary{cursor:pointer;font-weight:700;color:var(--rt-ink,#222);padding:2px 0}.stream-settings-block.ravtext-grouped{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:flex-start;max-width:100%}.stream-settings-help{display:inline-block;max-width:560px;padding:4px 8px;border:1px solid var(--rt-line,#d7d0be);border-radius:7px;background:var(--rt-surface-2,#fbf8ef);color:var(--rt-ink-2,#5a4d3a);font-size:12px;line-height:1.35}',
    '.applied-pop{position:fixed;z-index:2147483040;max-width:340px;background:#0f172a;color:#fff;direction:rtl;padding:10px 12px;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.3);font-size:12px;line-height:1.55;pointer-events:none}.applied-pop b{color:#fde68a}'
  ].join('\n'); document.head.appendChild(s); }
  function toast(t){ all('.perfect-toast').forEach(e=>e.remove()); const el=document.createElement('div'); el.className='perfect-toast'; el.textContent=t; document.body.appendChild(el); setTimeout(()=>el.remove(),3200); }
  function closeModal(){ byId('perfect-modal')?.remove(); }
  function openModal(title, html, buttons=[]){ closeModal(); const b=document.createElement('div'); b.id='perfect-modal'; b.className='perfect-modal-backdrop'; b.innerHTML='<div class="perfect-modal"><div class="perfect-head"><h2>'+esc(title)+'</h2><button class="perfect-close" type="button">×</button></div><div>'+html+'</div><div class="perfect-actions"></div></div>'; const a=b.querySelector('.perfect-actions'); buttons.forEach(x=>{const btn=document.createElement('button');btn.type='button';btn.textContent=x.label;btn.addEventListener('click',x.onClick);a.appendChild(btn);}); b.addEventListener('click',ev=>{if(ev.target===b)closeModal();}); b.querySelector('.perfect-close')?.addEventListener('click',closeModal); document.body.appendChild(b); }
  function ensureBtn(id,text,title,after,fn){ let btn=byId(id); if(!btn&&after){btn=document.createElement('button');btn.type='button';btn.id=id;btn.className='perfect-btn';btn.textContent=text;btn.title=title;after.insertAdjacentElement('afterend',btn);} if(btn&&btn.dataset.perfectHook!=='1'){btn.dataset.perfectHook='1';btn.addEventListener('click',ev=>{ev.preventDefault();fn();});} return btn; }
  function installBtns(){ const render=byId('btn-render'); if(!render)return; let a=byId('btn-render-pause')||render; a=ensureBtn('btn-render-diagnostics','🔎 בדיקת רינדור','בדיקת מצב רינדור',a,diag)||a; a=ensureBtn('btn-ravtext-snapshots','⏪ שחזור','שחזור מגיבויים',a,snapManager)||a; ensureBtn('btn-reset-display-only','🧹 אפס תצוגה','איפוס הגדרות תצוגה בלבד',a,resetDisplay); }
  function snaps(){ const v=json(localStorage.getItem(SNAP_KEY)||'[]',[]); return Array.isArray(v)?v:[]; }
  function saveSnaps(v){ localStorage.setItem(SNAP_KEY,JSON.stringify(v.slice(0,6))); }
  function snapshot(reason){ const s={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),reason,local:{},session:{}}; try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k&&k!==SNAP_KEY&&(k.startsWith('ravtext.')||k.includes('pane')||k.includes('editor')))s.local[k]=localStorage.getItem(k);}}catch(_){} try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); if(k&&k.startsWith('ravtext.'))s.session[k]=sessionStorage.getItem(k);}}catch(_){} const arr=snaps(); arr.unshift(s); saveSnaps(arr); return s; }
  function snapManager(){ const rows=snaps().map((s,i)=>'<div class="perfect-card"><b>'+(i+1)+'. '+esc(new Date(s.at).toLocaleString('he-IL'))+'</b><br>סיבה: '+esc(s.reason||'')+'<div class="perfect-actions"><button data-snap="'+esc(s.id)+'">שחזר</button></div></div>').join('')||'<p>אין עדיין גיבויים.</p>'; openModal('⏪ שחזור מגיבוי',rows,[{label:'צור גיבוי עכשיו',onClick:()=>{snapshot('גיבוי ידני');snapManager();}},{label:'נקה גיבויים',onClick:()=>{if(confirm('למחוק גיבויים?')){localStorage.removeItem(SNAP_KEY);snapManager();}}}]); byId('perfect-modal')?.addEventListener('click',ev=>{const b=ev.target.closest('[data-snap]'); if(!b)return; const s=snaps().find(x=>x.id===b.dataset.snap); if(!s||!confirm('לשחזר? העמוד יתרענן.'))return; Object.entries(s.local||{}).forEach(([k,v])=>localStorage.setItem(k,v)); Object.entries(s.session||{}).forEach(([k,v])=>sessionStorage.setItem(k,v)); location.reload();}); }
  function resetDisplay(){ if(!confirm('לאפס רק הגדרות תצוגה ורינדור?\n\nהטקסט לא יימחק.'))return; snapshot('לפני איפוס תצוגה'); let n=0; const rem=(st)=>{exactResetKeys.forEach(k=>{if(st.getItem(k)!==null){st.removeItem(k);n++;}}); const ks=[]; for(let i=0;i<st.length;i++)ks.push(st.key(i)); ks.forEach(k=>{if(k&&resetPrefixes.some(p=>k.startsWith(p))){st.removeItem(k);n++;}});}; try{rem(localStorage);rem(sessionStorage);}catch(_){} toast('אופסו '+n+' הגדרות תצוגה.'); window.__ravtextRerender?.(); }
  function diag(){ const pg=byId('pages-container')||document.querySelector('.pages-container'); const pc=pg?pg.querySelectorAll('.page:not(.page-placeholder)').length:0; const tal=localStorage.getItem('ravtext.talmudLayout')==='1'; const paused=localStorage.getItem('ravtext.renderPaused')==='1'; const stale=['ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1'].filter(k=>localStorage.getItem(k)!==null||sessionStorage.getItem(k)!==null); const checks=[['מנוע',true,tal?'גפ״ת / V9':'רגיל'],['רינדור',true,paused?'מושהה':(localStorage.getItem('ravtext.liveRender')==='0'?'כבוי':'פעיל')],['עמודים',pc>0,String(pc)],['פונטים',true,document.fonts?.status||'לא ידוע'],['ביטול אמיתי',typeof window.__ravtextCancelRender==='function',typeof window.__ravtextCancelRender==='function'?'מותקן':'לא זוהה'],['מפתחות ישנים',stale.length===0,stale.length?stale.join(', '):'נקי'],['גיבויים',true,String(snaps().length)]]; openModal('🔎 בדיקת רינדור',checks.map(([a,ok,d])=>'<div class="perfect-card '+(ok?'pass':'fail')+'">'+(ok?'✓':'✗')+' <b>'+esc(a)+'</b> — '+esc(d)+'</div>').join(''),[{label:'רנדר עכשיו',onClick:()=>{closeModal();window.__ravtextRerender?.();}},{label:'אפס תצוגה בלבד',onClick:()=>{closeModal();resetDisplay();}}]); }
  function hookSnapshots(){ if(document.documentElement.dataset.perfectSnapshot==='1')return; document.documentElement.dataset.perfectSnapshot='1'; document.addEventListener('click',ev=>{const b=ev.target.closest('button[data-cmd]'); const c=b?.dataset?.cmd; if(c&&dangerous.has(c)){snapshot('לפני פעולה: '+((b.textContent||c).trim())); toast('נוצר גיבוי אוטומטי.');}},true); }
  function bucket(el){ const t=(el.textContent||el.getAttribute?.('title')||'').trim(); if(/כותרת|טורים|רצופות|שורה אחרונה|הערה ראשונה/.test(t))return'בסיס'; if(/סגנון זרם|סגנון כותרת|בולד|מודגש|דיבור המתחיל/.test(t))return'עיצוב ובולד'; if(/מספר|פתיחה|סגירה|פורמט|סוגר גוף|תת-הערה/.test(t))return'מספרים וסוגריים'; if(/פס|צבע פס|עובי פס/.test(t))return'פסים וקווים'; if(/פריסה|מיקום|משנ"ב|משנה|גמרא|אונקלוס|הערות צד/.test(t))return'פריסה'; return'מתקדם'; }
  function groupBlock(block){ if(!block||block.dataset.ravtextGrouped==='1')return; const kids=Array.from(block.children); if(kids.some(c=>c.classList?.contains('ravtext-stream-section')))return; block.innerHTML=''; const map=new Map(); const help=document.createElement('span'); help.className='stream-settings-help'; help.textContent='הבהרה: בולד אמיתי הוא סימון B בעורך. דיבור המתחיל הוא הדגשה אוטומטית. “סגנון לבולד” רק מחליף איך טקסט שכבר מודגש נראה.'; block.appendChild(help); kids.forEach(el=>{ if(el.classList?.contains('stream-settings-code')||el.classList?.contains('stream-order-controls')){block.appendChild(el);return;} const k=bucket(el); if(!map.has(k)){const d=document.createElement('details');d.className='ravtext-stream-section';d.open=k==='בסיס'||k==='עיצוב ובולד';const s=document.createElement('summary');s.textContent=k;d.appendChild(s);map.set(k,d);} map.get(k).appendChild(el);}); map.forEach(d=>block.appendChild(d)); block.classList.add('ravtext-grouped'); block.dataset.ravtextGrouped='1'; }
  function groupSettings(){ const p=byId('stream-columns-panel'); if(!p)return; all('.stream-settings-block',p).forEach(groupBlock); if(p.dataset.perfectObs!=='1'){p.dataset.perfectObs='1'; new MutationObserver(()=>all('.stream-settings-block',p).forEach(groupBlock)).observe(p,{childList:true,subtree:false});} }
  let pop=null; function info(el){ const se=el.closest?.('[data-stream]'); const code=se?.getAttribute('data-stream')||el.getAttribute?.('data-stream')||''; const s=json(localStorage.getItem('ravtext.streamSettings.v1')||'{}',{})[code]||{}; const cs=getComputedStyle(el); return [['זרם',code||'לא זוהה'],['משקל פונט',cs.fontWeight],['גופן',cs.fontFamily],['גודל',cs.fontSize],['סגנון זרם',s.styleId||'—'],['סגנון שמחליף בולד',s.boldOverrideEnabled?(s.boldOverrideStyleId||'מופעל בלי סגנון'):'כבוי'],['דיבור המתחיל',s.lemmaBold===false?'כבוי':'פעיל']]; }
  function inspect(){ const root=byId('pages-container')||document.querySelector('.pages-container'); if(!root||root.dataset.perfectInspect==='1')return; root.dataset.perfectInspect='1'; const sel='.note,.note-part,.note-number,.note-lemma,.stream-ref,.stream[data-stream],.v9-line,[data-stream][data-note-num]'; root.addEventListener('mouseover',ev=>{const el=ev.target.closest(sel); if(!el||!root.contains(el))return; if(!pop){pop=document.createElement('div');pop.className='applied-pop';document.body.appendChild(pop);} pop.innerHTML=info(el).map(([k,v])=>'<div><b>'+esc(k)+':</b> '+esc(v)+'</div>').join(''); move(ev);}); root.addEventListener('mousemove',move); root.addEventListener('mouseout',ev=>{if(!ev.relatedTarget||!ev.relatedTarget.closest?.(sel)){pop?.remove();pop=null;}}); }
  function move(ev){ if(!pop)return; pop.style.left=Math.min(window.innerWidth-360,ev.clientX+16)+'px'; pop.style.top=Math.min(window.innerHeight-240,ev.clientY+16)+'px'; }
  function boot(){ addStyle(); installBtns(); hookSnapshots(); groupSettings(); inspect(); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else setTimeout(boot,0); let n=0; const retry=()=>{boot(); if(++n<80)setTimeout(retry,250);}; setTimeout(retry,250);
})();
`, "perfect-render-safety: supplementary UI");

console.log("[perfect-render-safety] done");
