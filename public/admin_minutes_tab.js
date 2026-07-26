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

  function asErrorMessage(text, status) {
    const raw = String(text || '').trim();
    if (!raw) return `HTTP ${status}`;
    if (/^\s*<!doctype html/i.test(raw) || raw.includes('Worker threw exception')) {
      return `שגיאת Worker בענן (HTTP ${status}). הנתיב החזיר HTML במקום JSON.`;
    }
    try {
      const obj = JSON.parse(raw);
      return obj.detail ? `${obj.error || 'שגיאה'}: ${obj.detail}` : (obj.error || raw);
    } catch (_) {
      return raw.slice(0, 500);
    }
  }

  async function api(path, opts = {}) {
    const res = await originalFetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(asErrorMessage(text, res.status));
    }
    return res.json();
  }

  function setActiveTab() {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    document.getElementById(TAB_ID)?.classList.add('active');
  }

  async function adjustMinutes(userId, email, deltaMinutes) {
    const amount = Number(deltaMinutes);
    if (!Number.isFinite(amount) || amount === 0) return;
    await api(`/api/admin/users/${userId}/minutes`, {
      method: 'POST',
      body: JSON.stringify({ deltaMinutes: amount }),
    });
    await renderMinutesTab(document.getElementById('minute-search')?.value?.trim() || '');
  }

  async function promptAdjust(userId, email) {
    const raw = prompt(`כמה דקות להוסיף/להוריד עבור ${email}?\nמספר חיובי מוסיף, מספר שלילי מוריד.`, '20');
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value === 0) {
      alert('מספר דקות לא חוקי');
      return;
    }
    await adjustMinutes(userId, email, value);
  }

  window.ravtextAdminAdjustMinutes = async function(userId, encodedEmail, deltaMinutes) {
    const email = decodeURIComponent(encodedEmail || '');
    try {
      await adjustMinutes(userId, email, deltaMinutes);
    } catch (err) {
      alert(`שגיאה בהוספת דקות: ${err.message || err}`);
    }
  };

  window.ravtextAdminPromptMinutes = async function(userId, encodedEmail) {
    const email = decodeURIComponent(encodedEmail || '');
    try {
      await promptAdjust(userId, email);
    } catch (err) {
      alert(`שגיאה בהוספת דקות: ${err.message || err}`);
    }
  };

  async function renderMinutesTab(search = '') {
    setActiveTab();
    const body = document.getElementById(BODY_ID);
    if (!body) return;

    body.innerHTML = `
      <div class="panel">
        <div class="toolbar">
          <strong>⏱️ דקות חינם ודקות ידניות</strong>
          <input type="search" id="minute-search" placeholder="חיפוש משתמש..." value="${escapeAttr(search)}" />
          <button id="minute-refresh">רענן</button>
          <span class="right info">מציג יתרה כוללת וגם פירוט דקות מתנה שנוצלו.</span>
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
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">דקות מתנה שקיבל</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">דקות מתנה שנוצלו</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">דקות מתנה שלא נוצלו</th>
              <th style="text-align:right;border-bottom:1px solid #e2e8f0;padding:8px;">פעולות</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => {
              const email = String(u.email || u.id || '');
              const enc = encodeURIComponent(email);
              return `
                <tr>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${escapeHtml(email)}</td>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${escapeHtml(u.status || '')}${u.plan_type ? ` / ${escapeHtml(u.plan_type)}` : ''}</td>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;font-weight:700;">${minutes(u.balance_seconds)}</td>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${minutes(u.gift_seconds_granted)}</td>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;">${minutes(u.gift_seconds_used)}</td>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;font-weight:700;">${minutes(u.gift_seconds_unused)}</td>
                  <td style="border-bottom:1px solid #f1f5f9;padding:8px;white-space:nowrap;">
                    <button class="btn-small" onclick="ravtextAdminAdjustMinutes(${Number(u.id)}, '${enc}', 20)">+20</button>
                    <button class="btn-small" onclick="ravtextAdminAdjustMinutes(${Number(u.id)}, '${enc}', -20)">−20</button>
                    <button class="btn-small" onclick="ravtextAdminPromptMinutes(${Number(u.id)}, '${enc}')">מותאם</button>
                  </td>
                </tr>
              `;
            }).join('')}
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
