(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SNAP_KEY = 'ravtext.snapshots.v1';
  const resetExactKeys = [
    'ravtext.streamSettings.v1','ravtext.globalStreamOverrides.v1','ravtext.streamOrder.v1',
    'ravtext.talmudLayout','ravtext.mishnaWrap','ravtext.mishnaWrap.levels','ravtext.spacing.v1',
    'ravtext.pageSettings.v1','ravtext.documentStyle.v1','ravtext.outputBackground',
    'ravtext.vilnaV9Beta','ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1',
    'ravtext.renderPaused','ravtext.renderPaused.prevLiveRender'
  ];
  const resetPrefixes = ['ravtext.talmudLayout.','ravtext.mishnaWrap.','ravtext.v9.','ravtext.layout.','ravtext.liveOverflow.'];
  const dangerous = new Set([
    'clear-all','word-import','word-import-streams','auto-parse','auto-parse-paste',
    'split-to-panes','split-special-notes','split-notes-advanced','merge-toggle','toggle-merge',
    'merge-from-panes','pane-clear-storage','pane-remove','reset-system-state'
  ]);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const parseJson = (v, fb) => { try { return JSON.parse(v); } catch (_) { return fb; } };

  function addStyle() {
    if (byId('render-safety-addons-style')) return;
    const s = document.createElement('style');
    s.id = 'render-safety-addons-style';
    s.textContent = `
      .render-safety-addon-btn{white-space:nowrap;text-align:right;width:100%;justify-content:flex-start}
      .render-safety-menu-wrap{display:inline-block;position:relative;margin-inline-start:4px;vertical-align:middle}
      #btn-render-options-toggle{min-width:32px;padding-inline:8px;font-weight:800;line-height:1;white-space:nowrap}
      #btn-render-options-toggle[aria-expanded="true"]{background:#e0ecff;border-color:#93b4e8;color:#173b72}
      .render-safety-menu{position:absolute;top:calc(100% + 6px);inset-inline-start:0;z-index:2147483045;min-width:210px;padding:7px;background:#fff;border:1px solid rgba(44,90,160,.22);border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.18);direction:rtl;display:none}
      .render-safety-menu.open{display:flex;flex-direction:column;gap:5px}
      .render-safety-menu .btn-render-pause,.render-safety-menu button{display:block;width:100%;margin:0;text-align:right;white-space:nowrap;border-radius:8px}
      .render-safety-menu-separator{height:1px;background:rgba(148,163,184,.35);margin:3px 2px}
      .render-safety-toast{position:fixed;left:18px;bottom:18px;z-index:2147483100;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.24);direction:rtl;max-width:460px}
      .render-safety-modal-backdrop{position:fixed;inset:0;z-index:2147483050;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px}
      .render-safety-modal{direction:rtl;width:min(780px,94vw);max-height:88vh;overflow:auto;background:#fff;color:#111827;border-radius:14px;box-shadow:0 12px 34px rgba(15,23,42,.24);padding:20px 22px;font-family:Segoe UI,system-ui,sans-serif;line-height:1.55}
      .render-safety-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.render-safety-head h2{margin:0;font-size:19px}.render-safety-close{border:0;background:transparent;cursor:pointer;font-size:24px;color:#64748b}.render-safety-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.render-safety-card{border:1px solid #dbeafe;border-radius:10px;padding:10px 12px;background:#f8fafc;margin:8px 0}.render-safety-pass{color:#166534}.render-safety-fail{color:#991b1b}
      .ravtext-stream-section{border:1px solid var(--rt-line,#d7d0be);border-radius:8px;margin:4px 6px;padding:4px 6px;background:var(--rt-surface-2,#fbf8ef);vertical-align:top}.ravtext-stream-section>summary{cursor:pointer;font-weight:700;color:var(--rt-ink,#222);padding:2px 0}.stream-settings-block.ravtext-grouped{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:flex-start;max-width:100%}.stream-settings-help{display:inline-block;max-width:560px;padding:4px 8px;border:1px solid var(--rt-line,#d7d0be);border-radius:7px;background:var(--rt-surface-2,#fbf8ef);color:var(--rt-ink-2,#5a4d3a);font-size:12px;line-height:1.35}
      .render-safety-applied-pop{position:fixed;z-index:2147483040;max-width:340px;background:#0f172a;color:#fff;direction:rtl;padding:10px 12px;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.3);font-size:12px;line-height:1.55;pointer-events:none}.render-safety-applied-pop b{color:#fde68a}
      #ravtext-render-progress-ui .rtp-cancel-addon{margin-inline-start:8px;border:1px solid rgba(153,27,27,.24);border-radius:999px;background:rgba(255,255,255,.84);color:#991b1b;font-size:12px;font-weight:800;padding:7px 10px;cursor:pointer;pointer-events:auto}
    `;
    document.head.appendChild(s);
  }
  function toast(text) { all('.render-safety-toast').forEach((el) => el.remove()); const el = document.createElement('div'); el.className = 'render-safety-toast'; el.textContent = text; document.body.appendChild(el); setTimeout(() => el.remove(), 3200); }
  function closeModal() { byId('render-safety-modal')?.remove(); }
  function openModal(title, html, buttons = []) {
    closeModal();
    const b = document.createElement('div');
    b.id = 'render-safety-modal';
    b.className = 'render-safety-modal-backdrop';
    b.innerHTML = `<div class="render-safety-modal"><div class="render-safety-head"><h2>${esc(title)}</h2><button class="render-safety-close" type="button">×</button></div><div>${html}</div><div class="render-safety-actions"></div></div>`;
    const actions = b.querySelector('.render-safety-actions');
    buttons.forEach((x) => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = x.label; btn.addEventListener('click', x.onClick); actions.appendChild(btn); });
    b.addEventListener('click', (ev) => { if (ev.target === b) closeModal(); });
    b.querySelector('.render-safety-close')?.addEventListener('click', closeModal);
    document.body.appendChild(b);
  }
  function closeRenderMenu() {
    const menu = byId('render-options-menu');
    const toggle = byId('btn-render-options-toggle');
    if (menu) menu.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded','false');
  }
  function ensureRenderMenu() {
    const render = byId('btn-render');
    if (!render) return null;
    let wrap = byId('render-options-menu-wrap');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.id = 'render-options-menu-wrap';
      wrap.className = 'render-safety-menu-wrap';
      wrap.innerHTML = `<button type="button" id="btn-render-options-toggle" title="אפשרויות רינדור" aria-haspopup="menu" aria-expanded="false">▾</button><div id="render-options-menu" class="render-safety-menu" role="menu"></div>`;
      render.insertAdjacentElement('afterend', wrap);
      const toggle = byId('btn-render-options-toggle');
      const menu = byId('render-options-menu');
      toggle?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const open = !menu.classList.contains('open');
        menu.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', (ev) => {
        if (!wrap.contains(ev.target)) closeRenderMenu();
      }, true);
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeRenderMenu(); });
    }
    const menu = byId('render-options-menu');
    const pause = byId('btn-render-pause');
    if (menu && pause && pause.parentElement !== menu) {
      pause.classList.add('render-safety-addon-btn');
      menu.appendChild(pause);
    }
    return menu;
  }
  function ensureMenuSeparator(menu, id) {
    if (!menu || byId(id)) return;
    const sep = document.createElement('div');
    sep.id = id;
    sep.className = 'render-safety-menu-separator';
    menu.appendChild(sep);
  }
  function ensureButton(id, text, title, menu, onClick) {
    let btn = byId(id);
    if (!btn && menu) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = 'render-safety-addon-btn';
      btn.textContent = text;
      btn.title = title;
      menu.appendChild(btn);
    } else if (btn && menu && btn.parentElement !== menu) {
      btn.classList.add('render-safety-addon-btn');
      menu.appendChild(btn);
    }
    if (btn && btn.dataset.renderSafetyHook !== '1' && btn.dataset.perfectHook !== '1') {
      btn.dataset.renderSafetyHook = '1';
      btn.addEventListener('click', (ev) => { ev.preventDefault(); closeRenderMenu(); onClick(); });
    }
    return btn;
  }
  function stopRenderFromMenu() {
    try { window.__ravtextRenderCancelRequested = true; } catch (_) {}
    try { window.__ravtextCancelRender?.('render-menu'); } catch (_) {}
    const render = byId('btn-render');
    if (render && /עצור|stop/i.test(render.textContent || '')) render.click();
    const status = byId('status');
    if (status) status.textContent = 'נשלחה בקשת עצירת רינדור.';
  }
  function installButtons() {
    const menu = ensureRenderMenu();
    if (!menu) return;
    ensureButton('btn-render-stop-menu','■ עצור רינדור','עצור את הרינדור הנוכחי',menu,stopRenderFromMenu);
    ensureMenuSeparator(menu, 'render-options-separator-1');
    ensureButton('btn-render-diagnostics','🔎 בדיקת רינדור','בדיקת מצב רינדור, פונטים, הגדרות ועמודים',menu,diagnostics);
    ensureButton('btn-ravtext-snapshots','⏪ שחזור','שחזור מגיבויים אוטומטיים',menu,snapshotManager);
    ensureButton('btn-reset-display-only','🧹 אפס תצוגה','איפוס הגדרות תצוגה ורינדור בלבד — בלי למחוק טקסט',menu,resetDisplayOnly);
  }
  function snaps(){ const v=parseJson(localStorage.getItem(SNAP_KEY)||'[]',[]); return Array.isArray(v)?v:[]; }
  function saveSnaps(v){ localStorage.setItem(SNAP_KEY,JSON.stringify(v.slice(0,6))); }
  function snapshot(reason){
    const s={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),reason,local:{},session:{}};
    try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k&&k!==SNAP_KEY&&(k.startsWith('ravtext.')||k.includes('pane')||k.includes('editor')))s.local[k]=localStorage.getItem(k);}}catch(_){}
    try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); if(k&&k.startsWith('ravtext.'))s.session[k]=sessionStorage.getItem(k);}}catch(_){}
    const arr=snaps(); arr.unshift(s); saveSnaps(arr); return s;
  }
  function snapshotManager(){
    const rows=snaps().map((s,i)=>`<div class="render-safety-card"><b>${i+1}. ${esc(new Date(s.at).toLocaleString('he-IL'))}</b><br>סיבה: ${esc(s.reason||'')}<div class="render-safety-actions"><button data-snap="${esc(s.id)}">שחזר</button></div></div>`).join('')||'<p>אין עדיין גיבויים.</p>';
    openModal('⏪ שחזור מגיבוי', rows, [{label:'צור גיבוי עכשיו', onClick:()=>{snapshot('גיבוי ידני'); snapshotManager();}}, {label:'נקה גיבויים', onClick:()=>{if(confirm('למחוק גיבויים?')){localStorage.removeItem(SNAP_KEY); snapshotManager();}}}]);
    byId('render-safety-modal')?.addEventListener('click',(ev)=>{ const b=ev.target.closest('[data-snap]'); if(!b)return; const s=snaps().find(x=>x.id===b.dataset.snap); if(!s||!confirm('לשחזר? העמוד יתרענן.'))return; Object.entries(s.local||{}).forEach(([k,v])=>localStorage.setItem(k,v)); Object.entries(s.session||{}).forEach(([k,v])=>sessionStorage.setItem(k,v)); location.reload(); });
  }
  function hookSnapshots(){ if(document.documentElement.dataset.renderSafetySnapshot==='1')return; document.documentElement.dataset.renderSafetySnapshot='1'; document.addEventListener('click',(ev)=>{ const b=ev.target.closest('button[data-cmd]'); const c=b?.dataset?.cmd; if(c&&dangerous.has(c)){snapshot('לפני פעולה: '+((b.textContent||c).trim())); toast('נוצר גיבוי אוטומטי.');} },true); }
  function resetDisplayOnly(){
    if(!confirm('לאפס רק הגדרות תצוגה ורינדור?\n\nהטקסט לא יימחק.'))return;
    snapshot('לפני איפוס תצוגה'); let n=0;
    const rem=(st)=>{ resetExactKeys.forEach(k=>{if(st.getItem(k)!==null){st.removeItem(k);n++;}}); const ks=[]; for(let i=0;i<st.length;i++)ks.push(st.key(i)); ks.forEach(k=>{if(k&&resetPrefixes.some(p=>k.startsWith(p))){st.removeItem(k);n++;}}); };
    try{rem(localStorage); rem(sessionStorage);}catch(_){}
    toast('אופסו '+n+' הגדרות תצוגה.'); byId('btn-render')?.click();
  }
  function diagnostics(){
    const pg=byId('pages-container')||document.querySelector('.pages-container'); const pc=pg?pg.querySelectorAll('.page:not(.page-placeholder)').length:0; const tal=localStorage.getItem('ravtext.talmudLayout')==='1'; const paused=localStorage.getItem('ravtext.renderPaused')==='1'; const stale=['ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1'].filter(k=>localStorage.getItem(k)!==null||sessionStorage.getItem(k)!==null);
    const checks=[['מנוע',true,tal?'גפ״ת / V9':'רגיל'],['רינדור',true,paused?'מושהה':(localStorage.getItem('ravtext.liveRender')==='0'?'כבוי':'פעיל')],['עמודים',pc>0,String(pc)],['פונטים',true,document.fonts?.status||'לא ידוע'],['ביטול רינדור אמיתי',typeof window.__ravtextCancelRender==='function',typeof window.__ravtextCancelRender==='function'?'מותקן':'לא זוהה — כפתור עצור ינסה לעצור דרך הכפתור הראשי'],['מפתחות ישנים',stale.length===0,stale.length?stale.join(', '):'נקי'],['גיבויים',true,String(snaps().length)]];
    openModal('🔎 בדיקת רינדור', checks.map(([a,ok,d])=>`<div class="render-safety-card ${ok?'render-safety-pass':'render-safety-fail'}">${ok?'✓':'✗'} <b>${esc(a)}</b> — ${esc(d)}</div>`).join(''), [{label:'רנדר עכשיו',onClick:()=>{closeModal(); byId('btn-render')?.click();}}, {label:'אפס תצוגה בלבד',onClick:()=>{closeModal(); resetDisplayOnly();}}]);
  }
  function boot(){ addStyle(); installButtons(); hookSnapshots(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else setTimeout(boot,0);
  new MutationObserver(boot).observe(document.documentElement,{childList:true,subtree:true});
})();
