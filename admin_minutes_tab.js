(() => {
  const TAB_ID = 'ravtext-admin-minutes-tab';
  const BODY_ID = 'tab-body';
  const originalFetch = window.fetch.bind(window);

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

  function minutes(seconds) {
    const n = Math.max(0, Number(seconds || 0));
    return (n / 60).toFixed(n % 60 ? 1 : 0);
  }

  async function api(path) {
    const res = await originalFetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function setActiveTab() {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    document.getElementById(TAB_ID)?.classList.add('active');
  }

  async function renderMinutesTab(search = '') {
    setActiveTab();
    const body = document.getElementById(BODY_ID);
    if (!body) return;

    body.innerHTML = `
      <div class="panel">
        <div class="toolbar">
          <strong>⏱️ דקות חינם</strong>
          <input type="search" id="minute-search" placeholder="חיפוש משתמש..." value="${escapeAttr(search)}" />
          <button id="minute-refresh">רענן</button>
          <span class="right info">מציג לכל משתמש כמה דקות מתנה נוצלו וכמה נשארו</span>
        </div>
        <div id="minute-list"><div class="empty">טוען...</div></div>
      </div>
    `;

    const searchEl = document.getElementById('minute-search');
    let timer;
    searchEl?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderMinutesTab(searchEl.value.trim()), 250);
    });
    document.getElementById('minute-refresh')?.addEventListener('click', () => renderMinutesTab(searchEl?.value.trim() || search));

    try {
      const params = new URLSearchParams({ limit: '500', offset: '0' });
      if (search) params.set('search', search);
      const data = await api(`/api/admin/minute-usage?${params}`);
      renderRows(data.users || []);
    } catch (err) {
      const list = document.getElementById('minute-list');
      if (list) list.innerHTML = `<div class="empty" style="color:#b91c1c;">שגיאה בטעינה: ${escapeHtml(err.message || err)}</div>`;
    }
  }

  function renderRows(users) {
    const list = document.getElementById('minute-list');
    if (!list) return;
    if (!users.length) {
      list.innerHTML = '<div class="empty">אין נתונים להצגה.</div>';
      return;
    }

    list.innerHTML = `
      <div style="overflow:auto;padding:14px 16px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">משתמש</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">סטטוס</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">יתרת דקות כוללת</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">דקות חינם שקיבל</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">דקות חינם שנוצלו</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">דקות חינם שלא נוצלו</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${escapeHtml(u.email || u.id)}</td>
                <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${escapeHtml(u.status || '')}${u.plan_type ? ` / ${escapeHtml(u.plan_type)}` : ''}</td>
                <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${minutes(u.balance_seconds)}</td>
                <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${minutes(u.gift_seconds_granted)}</td>
                <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${minutes(u.gift_seconds_used)}</td>
                <td style="border-bottom:1px solid #f1f5f9;padding:8px;font-weight:700;">${minutes(u.gift_seconds_unused)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
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
    tab.textContent = 'דקות חינם';
    tab.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      renderMinutesTab();
    }, true);
    const users = tabs.querySelector('[data-tab="users"]');
    if (users) users.after(tab);
    else tabs.appendChild(tab);
    return true;
  }

  function boot() {
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
