(() => {
  const TAB_ID = 'ravtext-admin-troubleshooting-tab';
  const BODY_ID = 'tab-body';
  const STATUS = 'troubleshooting';
  const PASSTHROUGH_PARAM = 'ravtextAdminTroubleshooting';
  const STATUS_ALIASES = new Set(['troubleshooting', 'פתרון בעיות', 'פתרון-בעיות', 'solutions']);
  const originalFetch = window.fetch.bind(window);

  function isTroubleshootingStatus(status) {
    return STATUS_ALIASES.has(String(status || '').trim());
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function fmtDateTime(unixSec) {
    if (!unixSec) return '—';
    const d = new Date(unixSec * 1000);
    return d.toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function toast(message, isError = false) {
    let el = document.getElementById('ravtext-admin-troubleshooting-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ravtext-admin-troubleshooting-toast';
      el.style.cssText = `
        position:fixed;bottom:22px;left:22px;z-index:10000;
        padding:12px 18px;border-radius:8px;color:#fff;
        background:#047857;box-shadow:0 4px 12px rgba(15,23,42,.2);
        font-size:14px;opacity:0;transform:translateY(16px);
        transition:opacity .18s,transform .18s;
      `;
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = isError ? '#b91c1c' : '#047857';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
    }, 2600);
  }

  function patchBugFetchForAdminTabSeparation() {
    if (window.__ravtextAdminTroubleshootingFetchPatch) return;
    window.__ravtextAdminTroubleshootingFetchPatch = true;
    window.fetch = async (input, init) => {
      const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      let url;
      try {
        url = new URL(typeof input === 'string' ? input : input?.url, location.href);
      } catch {
        return originalFetch(input, init);
      }
      const isAdminBugList = url.pathname === '/api/admin/bug-reports';
      const isOwnTroubleshootingRequest = url.searchParams.has(PASSTHROUGH_PARAM);
      const asksSpecificStatus = url.searchParams.has('status');
      if (!isAdminBugList || method !== 'GET' || isOwnTroubleshootingRequest || asksSpecificStatus) {
        return originalFetch(input, init);
      }
      const res = await originalFetch(input, init);
      if (!res.ok) return res;
      let data;
      try { data = await res.clone().json(); } catch { return res; }
      if (Array.isArray(data.items)) {
        data.items = data.items.filter((item) => !isTroubleshootingStatus(item?.status));
      }
      if (data.counts && typeof data.counts === 'object') {
        for (const key of Object.keys(data.counts)) {
          if (isTroubleshootingStatus(key)) delete data.counts[key];
        }
      }
      data.totalCount = Array.isArray(data.items) ? data.items.length : (data.totalCount || 0);
      const headers = new Headers(res.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');
      return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers });
    };
  }

  async function api(path, opts = {}) {
    const res = await originalFetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function loadItems(search = '') {
    const params = new URLSearchParams();
    params.set('status', STATUS);
    params.set('source', 'admin');
    params.set('limit', '500');
    params.set('offset', '0');
    params.set(PASSTHROUGH_PARAM, '1');
    if (search) params.set('search', search);
    const data = await api(`/api/admin/bug-reports?${params}`);
    return data.items || [];
  }

  function setActiveTab() {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    document.getElementById(TAB_ID)?.classList.add('active');
  }

  async function renderTroubleshootingTab(search = '') {
    setActiveTab();
    const body = document.getElementById(BODY_ID);
    if (!body) return;
    body.innerHTML = `
      <div class="panel">
        <div class="toolbar">
          <strong>🛠️ פתרון בעיות</strong>
          <input type="search" id="trouble-search" placeholder="חיפוש בכותרת או פתרון..." value="${escapeAttr(search)}" />
          <button id="trouble-add">+ הוסף פתרון</button>
          <span class="right info">רשומות אלו מוצגות בכפתור פתרון בעיות באתר</span>
        </div>
        <div id="trouble-list"><div class="empty">טוען...</div></div>
      </div>
    `;
    document.getElementById('trouble-add')?.addEventListener('click', () => openEditor(null, search));
    const searchEl = document.getElementById('trouble-search');
    let timer;
    searchEl?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderTroubleshootingTab(searchEl.value.trim()), 250);
    });
    try {
      renderList(await loadItems(search), search);
    } catch (err) {
      const list = document.getElementById('trouble-list');
      if (list) list.innerHTML = `<div class="empty" style="color:#b91c1c;">שגיאה בטעינה: ${escapeHtml(err.message || err)}</div>`;
    }
  }

  function renderList(items, search = '') {
    const list = document.getElementById('trouble-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="empty">אין עדיין פתרונות בעיות. לחץ “+ הוסף פתרון”.</div>';
      return;
    }
    list.innerHTML = `
      <div style="padding:14px 16px;">
        ${items.map((item) => `
          <div class="bug-card" data-trouble-id="${item.id}">
            <div class="bug-card-head">
              <div class="bug-card-title">${escapeHtml(item.title)}</div>
              <span class="status-tag status-tag-custom">פתרון בעיות</span>
            </div>
            <div class="bug-card-meta">
              <span>📅 ${fmtDateTime(item.created_at)}</span>
              ${item.updated_at && item.updated_at !== item.created_at ? `<span>✎ ${fmtDateTime(item.updated_at)}</span>` : ''}
              <span>מוצג באתר</span>
            </div>
            <div class="bug-card-body">${escapeHtml(item.body)}</div>
            <div class="bug-card-actions">
              <button class="btn-small" data-trouble-action="edit" data-id="${item.id}">עריכה</button>
              <button class="btn-small delete" data-trouble-action="delete" data-id="${item.id}">מחק</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    list.querySelectorAll('[data-trouble-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openEditor(items.find((item) => String(item.id) === String(btn.dataset.id)), search));
    });
    list.querySelectorAll('[data-trouble-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('למחוק את פתרון הבעיה?')) return;
        try {
          await api(`/api/admin/bug-reports/${btn.dataset.id}`, { method: 'DELETE' });
          toast('נמחק');
          renderTroubleshootingTab(search);
        } catch (err) {
          toast('מחיקה נכשלה: ' + (err.message || err), true);
        }
      });
    });
  }

  function openEditor(item, search = '') {
    const old = document.getElementById('trouble-editor-backdrop');
    if (old) old.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'trouble-editor-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    backdrop.innerHTML = `
      <div class="modal" style="display:block;max-width:92vw;">
        <h2>${item ? 'עריכת פתרון בעיות' : 'הוספת פתרון בעיות'}</h2>
        <label><span>כותרת הבעיה</span><input type="text" id="trouble-title" value="${escapeAttr(item?.title || '')}" /></label>
        <label><span>הפתרון שיוצג למשתמש</span><textarea class="field" id="trouble-body" rows="8">${escapeHtml(item?.body || '')}</textarea></label>
        <p style="font-size:12px;color:#64748b;margin:0 0 12px;">נשמר כסטטוס פנימי: troubleshooting, ומוצג בכפתור “פתרון בעיות” באתר.</p>
        <div class="modal-actions">
          <button type="button" class="btn-small" id="trouble-cancel">ביטול</button>
          <button type="button" class="btn-small activate" id="trouble-save">שמור</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });
    document.getElementById('trouble-cancel')?.addEventListener('click', close);
    document.getElementById('trouble-save')?.addEventListener('click', async () => {
      const title = document.getElementById('trouble-title')?.value.trim() || '';
      const body = document.getElementById('trouble-body')?.value.trim() || '';
      if (!title || !body) { toast('כותרת ופתרון חובה', true); return; }
      try {
        if (item?.id) {
          await api(`/api/admin/bug-reports/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title, body, status: STATUS }),
          });
          toast('נשמר');
        } else {
          await api('/api/admin/bug-reports', {
            method: 'POST',
            body: JSON.stringify({ title, body, status: STATUS }),
          });
          toast('נוסף');
        }
        close();
        renderTroubleshootingTab(search);
      } catch (err) {
        toast('שמירה נכשלה: ' + (err.message || err), true);
      }
    });
    setTimeout(() => document.getElementById('trouble-title')?.focus(), 30);
  }

  function installTab() {
    const tabs = document.querySelector('.tabs');
    const body = document.getElementById(BODY_ID);
    if (!tabs || !body) return false;
    if (document.getElementById(TAB_ID)) return true;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = TAB_ID;
    tab.className = 'tab';
    tab.textContent = 'פתרון בעיות';
    tab.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      renderTroubleshootingTab();
    }, true);
    const bugs = tabs.querySelector('[data-tab="bugs"]');
    if (bugs) bugs.after(tab);
    else tabs.appendChild(tab);
    return true;
  }

  function boot() {
    patchBugFetchForAdminTabSeparation();
    installTab();
    let count = 0;
    const timer = setInterval(() => {
      installTab();
      if (++count > 80) clearInterval(timer);
    }, 250);
    const root = document.getElementById('root');
    if (root && window.MutationObserver) {
      new MutationObserver(() => installTab()).observe(root, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
