(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SNAP_KEY = 'ravtext.snapshots.v1';
  const resetKeys = ['ravtext.streamSettings.v1','ravtext.globalStreamOverrides.v1','ravtext.streamOrder.v1','ravtext.talmudLayout','ravtext.mishnaWrap','ravtext.mishnaWrap.levels','ravtext.spacing.v1','ravtext.pageSettings.v1','ravtext.documentStyle.v1','ravtext.outputBackground','ravtext.vilnaV9Beta','ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1','ravtext.renderPaused','ravtext.renderPaused.prevLiveRender'];
  const resetPrefixes = ['ravtext.talmudLayout.','ravtext.mishnaWrap.','ravtext.v9.','ravtext.layout.','ravtext.liveOverflow.'];
  const dangerous = new Set(['clear-all','word-import','word-import-streams','auto-parse','auto-parse-paste','split-to-panes','split-special-notes','split-notes-advanced','merge-toggle','toggle-merge','merge-from-panes','pane-clear-storage','pane-remove','reset-system-state']);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const parse = (v, fb) => { try { return JSON.parse(v); } catch (_) { return fb; } };

  function style() {
    if ($('render-safety-addons-style')) return;
    const s = document.createElement('style');
    s.id = 'render-safety-addons-style';
    s.textContent = '#btn-render-options-tab{font-weight:700}.render-safety-toolbar{direction:rtl}.render-safety-toolbar .tb-group button{white-space:nowrap}.render-safety-toast{position:fixed;left:18px;bottom:18px;z-index:2147483100;background:#111827;color:white;padding:10px 14px;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.24);direction:rtl}.render-safety-modal-backdrop{position:fixed;inset:0;z-index:2147483050;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px}.render-safety-modal{direction:rtl;width:min(780px,94vw);max-height:88vh;overflow:auto;background:white;color:#111827;border-radius:14px;box-shadow:0 12px 34px rgba(15,23,42,.24);padding:20px 22px;font-family:Segoe UI,system-ui,sans-serif;line-height:1.55}.render-safety-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.render-safety-head h2{margin:0;font-size:19px}.render-safety-close{border:0;background:transparent;cursor:pointer;font-size:24px;color:#64748b}.render-safety-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.render-safety-card{border:1px solid #dbeafe;border-radius:10px;padding:10px 12px;background:#f8fafc;margin:8px 0}.render-safety-pass{color:#166534}.render-safety-fail{color:#991b1b}';
    document.head.appendChild(s);
  }
  function toast(t){ $$('.render-safety-toast').forEach(e=>e.remove()); const e=document.createElement('div'); e.className='render-safety-toast'; e.textContent=t; document.body.appendChild(e); setTimeout(()=>e.remove(),3200); }
  function closeModal(){ $('render-safety-modal')?.remove(); }
  function modal(title, html, buttons=[]){
    closeModal(); const b=document.createElement('div'); b.id='render-safety-modal'; b.className='render-safety-modal-backdrop';
    b.innerHTML=`<div class="render-safety-modal"><div class="render-safety-head"><h2>${esc(title)}</h2><button type="button" class="render-safety-close">×</button></div><div>${html}</div><div class="render-safety-actions"></div></div>`;
    const actions=b.querySelector('.render-safety-actions'); buttons.forEach(x=>{const btn=document.createElement('button'); btn.type='button'; btn.textContent=x.label; btn.addEventListener('click',x.onClick); actions.appendChild(btn);});
    b.addEventListener('click',ev=>{if(ev.target===b)closeModal();}); b.querySelector('.render-safety-close')?.addEventListener('click',closeModal); document.body.appendChild(b);
  }
  function setTab(tab){
    const bar=$('ribbon-tabs'); const main=document.querySelector('.ribbon-toolbar')||document.querySelector('.source-format-toolbar')||document.querySelector('.toolbar'); if(!bar||!main)return;
    localStorage.setItem('ravtext.ribbonTab',tab);
    $$('.ribbon-tab',bar).forEach(x=>{const a=x.dataset.ribbonTab===tab; x.classList.toggle('active',a); x.setAttribute('aria-selected',a?'true':'false');});
    main.querySelectorAll('.tb-group').forEach(g=>{const list=(g.dataset.ribbonTab||'home').split(/\s+/); g.classList.toggle('ribbon-hidden',!list.includes(tab));});
    document.querySelectorAll('.ribbon-panel').forEach(p=>{const list=(p.dataset.ribbonTab||'home').split(/\s+/); p.classList.toggle('ribbon-hidden',!list.includes(tab));});
  }
  function btn(id, text, title, fn){
    let b=$(id); if(!b){b=document.createElement('button'); b.type='button'; b.id=id; b.textContent=text; b.title=title;}
    if(b.dataset.renderSafetyHook!=='1'){b.dataset.renderSafetyHook='1'; b.addEventListener('click',ev=>{ev.preventDefault();fn();});}
    return b;
  }
  function ensureTab(){
    const bar=$('ribbon-tabs'), render=$('btn-render'); if(!bar||!render)return;
    $('render-options-menu-wrap')?.remove();
    let tab=$('btn-render-options-tab');
    if(!tab){tab=document.createElement('button'); tab.type='button'; tab.id='btn-render-options-tab'; tab.className='ribbon-tab'; tab.dataset.ribbonTab='render'; tab.setAttribute('role','tab'); tab.setAttribute('aria-selected','false'); tab.title='אפשרויות רינדור'; tab.textContent='▾'; const collapse=$('ribbon-collapse-toggle'), slot=bar.querySelector('.ribbon-tab-render-slot'); if(collapse)bar.insertBefore(tab,collapse); else if(slot)bar.insertBefore(tab,slot); else bar.appendChild(tab); tab.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();setTab('render');});}
    let panel=$('render-safety-toolbar');
    if(!panel){panel=document.createElement('div'); panel.id='render-safety-toolbar'; panel.className='toolbar bottom-toolbar source-bottom-toolbar ribbon-panel render-safety-toolbar ribbon-hidden'; panel.dir='rtl'; panel.dataset.ribbonTab='render'; panel.innerHTML='<span class="tb-group" data-title="רינדור" id="render-safety-render-group"></span><span class="tb-group" data-title="אבחון ושחזור" id="render-safety-diagnostics-group"></span>'; const main=document.querySelector('.ribbon-toolbar')||document.querySelector('.source-format-toolbar')||document.querySelector('.toolbar'); if(main)main.after(panel); else render.parentElement?.after(panel);}
    const g1=$('render-safety-render-group'), g2=$('render-safety-diagnostics-group');
    const pause=$('btn-render-pause'); if(g1&&pause&&pause.parentElement!==g1)g1.appendChild(pause);
    if(g1&&!$('btn-render-stop-menu'))g1.appendChild(btn('btn-render-stop-menu','■ עצור רינדור','עצור את הרינדור הנוכחי',stopRender));
    if(g2&&!$('btn-render-diagnostics'))g2.appendChild(btn('btn-render-diagnostics','🔎 בדיקת רינדור','בדיקת מצב רינדור',diagnostics));
    if(g2&&!$('btn-ravtext-snapshots'))g2.appendChild(btn('btn-ravtext-snapshots','⏪ שחזור','שחזור מגיבויים',snapshots));
    if(g2&&!$('btn-reset-display-only'))g2.appendChild(btn('btn-reset-display-only','🧹 אפס תצוגה','איפוס הגדרות תצוגה',resetDisplay));
    if(localStorage.getItem('ravtext.ribbonTab')==='render')setTab('render');
  }
  function stopRender(){try{window.__ravtextRenderCancelRequested=true;}catch(_){} try{window.__ravtextCancelRender?.('render-tab');}catch(_){} const r=$('btn-render'); if(r&&/עצור|stop/i.test(r.textContent||''))r.click(); const st=$('status'); if(st)st.textContent='נשלחה בקשת עצירת רינדור.';}
  function snaps(){const v=parse(localStorage.getItem(SNAP_KEY)||'[]',[]); return Array.isArray(v)?v:[];}
  function saveSnaps(v){localStorage.setItem(SNAP_KEY,JSON.stringify(v.slice(0,6)));}
  function snapshot(reason){const s={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),reason,local:{},session:{}}; try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k&&k!==SNAP_KEY&&(k.startsWith('ravtext.')||k.includes('pane')||k.includes('editor')))s.local[k]=localStorage.getItem(k);}}catch(_){} try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); if(k&&k.startsWith('ravtext.'))s.session[k]=sessionStorage.getItem(k);}}catch(_){} const a=snaps(); a.unshift(s); saveSnaps(a); return s;}
  function snapshots(){const rows=snaps().map((s,i)=>`<div class="render-safety-card"><b>${i+1}. ${esc(new Date(s.at).toLocaleString('he-IL'))}</b><br>סיבה: ${esc(s.reason||'')}<div class="render-safety-actions"><button data-snap="${esc(s.id)}">שחזר</button></div></div>`).join('')||'<p>אין עדיין גיבויים.</p>'; modal('⏪ שחזור מגיבוי',rows,[{label:'צור גיבוי עכשיו',onClick:()=>{snapshot('גיבוי ידני');snapshots();}},{label:'נקה גיבויים',onClick:()=>{if(confirm('למחוק גיבויים?')){localStorage.removeItem(SNAP_KEY);snapshots();}}}]); $('render-safety-modal')?.addEventListener('click',ev=>{const b=ev.target.closest('[data-snap]'); if(!b)return; const s=snaps().find(x=>x.id===b.dataset.snap); if(!s||!confirm('לשחזר? העמוד יתרענן.'))return; Object.entries(s.local||{}).forEach(([k,v])=>localStorage.setItem(k,v)); Object.entries(s.session||{}).forEach(([k,v])=>sessionStorage.setItem(k,v)); location.reload();});}
  function hookSnapshots(){if(document.documentElement.dataset.renderSafetySnapshot==='1')return; document.documentElement.dataset.renderSafetySnapshot='1'; document.addEventListener('click',ev=>{const b=ev.target.closest('button[data-cmd]'), c=b?.dataset?.cmd; if(c&&dangerous.has(c)){snapshot('לפני פעולה: '+((b.textContent||c).trim()));toast('נוצר גיבוי אוטומטי.');}},true);}
  function resetDisplay(){if(!confirm('לאפס רק הגדרות תצוגה ורינדור?\n\nהטקסט לא יימחק.'))return; snapshot('לפני איפוס תצוגה'); let n=0; const rem=st=>{resetKeys.forEach(k=>{if(st.getItem(k)!==null){st.removeItem(k);n++;}}); const keys=[]; for(let i=0;i<st.length;i++)keys.push(st.key(i)); keys.forEach(k=>{if(k&&resetPrefixes.some(p=>k.startsWith(p))){st.removeItem(k);n++;}});}; try{rem(localStorage);rem(sessionStorage);}catch(_){} toast('אופסו '+n+' הגדרות תצוגה.'); $('btn-render')?.click();}
  function diagnostics(){const pg=$('pages-container')||document.querySelector('.pages-container'); const pc=pg?pg.querySelectorAll('.page:not(.page-placeholder)').length:0; const tal=localStorage.getItem('ravtext.talmudLayout')==='1'; const paused=localStorage.getItem('ravtext.renderPaused')==='1'; const stale=['ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1'].filter(k=>localStorage.getItem(k)!==null||sessionStorage.getItem(k)!==null); const checks=[['מנוע',true,tal?'גפ״ת / V9':'רגיל'],['רינדור',true,paused?'מושהה':(localStorage.getItem('ravtext.liveRender')==='0'?'כבוי':'פעיל')],['עמודים',pc>0,String(pc)],['פונטים',true,document.fonts?.status||'לא ידוע'],['ביטול רינדור אמיתי',typeof window.__ravtextCancelRender==='function',typeof window.__ravtextCancelRender==='function'?'מותקן':'לא זוהה'],['מפתחות ישנים',stale.length===0,stale.length?stale.join(', '):'נקי'],['גיבויים',true,String(snaps().length)]]; modal('🔎 בדיקת רינדור',checks.map(([a,ok,d])=>`<div class="render-safety-card ${ok?'render-safety-pass':'render-safety-fail'}">${ok?'✓':'✗'} <b>${esc(a)}</b> — ${esc(d)}</div>`).join(''),[{label:'רנדר עכשיו',onClick:()=>{closeModal();$('btn-render')?.click();}},{label:'אפס תצוגה בלבד',onClick:()=>{closeModal();resetDisplay();}}]);}
  function boot(){style(); ensureTab(); hookSnapshots();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else setTimeout(boot,0);
  new MutationObserver(boot).observe(document.documentElement,{childList:true,subtree:true});
})();
