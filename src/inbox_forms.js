// טפסי דיווח באג + יצירת קשר + עדכוני פיתוח + פתרון בעיות.
// הנתונים של דיווחים/פניות נשלחים ל-Worker ונשמרים ב-D1.
// פתרון בעיות מציג ברירת מחדל קבועה, ויכול להציג רשומות מנהל עם סטטוס troubleshooting.

const TOAST_TIMEOUT = 2800;
const TROUBLESHOOTING_STATUS_VALUES = new Set([
  'troubleshooting',
  'פתרון בעיות',
  'פתרון-בעיות',
  'solutions',
]);

const DEFAULT_TROUBLESHOOTING_INTRO = 'להלן כמה דברים שאנו יודעים עליהם שיש בהם מגבלות מערכת והפתרון שלהם הוא ידני. יתכן שבהמשך נטפל בבעיות דלהלן שלא יצטרכו עבודה ידנית, לאחר שנסיים את הפיתוחים והתיקונים הדחופים יותר.';

const DEFAULT_TROUBLESHOOTING_ITEMS = [
  {
    title: 'טקסטים עולים על טקסטים',
    body: 'נסו לבצע רענון (רנדור) חוזר.',
  },
  {
    title: 'שינויים באמצע רענון',
    body: 'שינויים עשויים להיות לא תקפים/ לא חלים אם התוכנה באמצע רענון, נסו שוב לאחר רענון (נכון לעכשיו אין מעקף רשמי למגבלה זו).',
  },
  {
    title: 'הדגשות לזרם',
    body: 'אם ברצונכם להדגיש זרם שלם במצב גפ"ת, נכון לעכשיו הפתרון הוא דרך הדגשת כל הזרם, אין כרגע פתרון רשמי להדגשת זרם דרך סגנונות.',
  },
  {
    title: 'באג ידוע בהחלת סגנון',
    body: 'אם עוברים על המקלדת על הסגנונות בחצים למעלה ולמטה כרגע זה נתקע בגלל שהוא מתעכב בכל אחד מהם בהחלת הסגנון, הפתרון להשתמש בסימון הגלילה בצד בלבד.',
  },
  {
    title: 'חיתוך דינמי',
    body: 'אין כרגע דרך מובטחת לחיתוך דינמי של הזרמים ב100% הצלחה לכל סוג מסמך (שלא יהיו שום עמודים עם רווחים ועם חריגה), ניתן לנסות באמצעות מנוע רינדור חכם (לנסות עם המנוע ובלי המנוע) וכן לשנות את גובה כרית העמוד, ובמידת הצורך לפנות אלינו ונעדכן את הקוד של האתר שיתאים גם למסמך שלכם.',
  },
  {
    title: 'הערה ראשונה ככותרת',
    body: 'כשמכניסים הערה ראשונה בזרם מסויים ככותרת הזרם של ההערות (שיכנס אוטומטית למסמך ככותרת הזרם, צריך להגדיר זאת בממשק), אין להכניס את ההערה הראשונה  בתחילת המסמך אלא במיקום ההערה הראשונה האמיתית, על מנת לפתור קונפליקט שקיים במערכת כרגע (שהוא מזיז את ההערה הראשונה ה"אמיתית" למיקום ההערה הראשונה המשמשת לכותרת.',
  },
];

let toastEl = null;
let activeBackdrop = null;

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'inbox-toast';
  toastEl.style.cssText = `
    position: fixed; bottom: 24px; left: 24px; z-index: 9999;
    background: #047857; color: white; padding: 12px 18px;
    border-radius: 8px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
    transform: translateY(20px); opacity: 0;
    transition: transform 0.2s, opacity 0.2s;
    pointer-events: none; max-width: 360px;
  `;
  document.body.appendChild(toastEl);
  return toastEl;
}

function showToast(msg, isError = false) {
  const el = ensureToast();
  el.textContent = msg;
  el.style.background = isError ? '#b91c1c' : '#047857';
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
  }, TOAST_TIMEOUT);
}

function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateShort(unixSec) {
  if (!unixSec) return '';
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function buildEnvMeta() {
  return {
    ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    lang: (typeof navigator !== 'undefined' && navigator.language) || '',
    screen: (typeof window !== 'undefined' && window.innerWidth)
      ? `${window.innerWidth}x${window.innerHeight}`
      : '',
    url: (typeof location !== 'undefined' && location.href) || '',
  };
}

function isLoggedIn() {
  const auth = window.__RAVTEXT_AUTH__;
  return !!(auth && auth.loggedIn);
}

function isTroubleshootingStatus(status) {
  return TROUBLESHOOTING_STATUS_VALUES.has(String(status || '').trim());
}

function closeActiveModal() {
  if (activeBackdrop) {
    activeBackdrop.remove();
    activeBackdrop = null;
  }
  document.removeEventListener('keydown', escHandler);
}

function escHandler(ev) {
  if (ev.key === 'Escape') closeActiveModal();
}

function openModal({ title, body, footer, width = 540 }) {
  closeActiveModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'inbox-modal-backdrop';
  backdrop.style.cssText = `
    position: fixed; inset: 0; background: rgba(15,23,42,0.55);
    z-index: 9998; display: flex; align-items: center; justify-content: center;
  `;

  const modal = document.createElement('div');
  modal.className = 'inbox-modal';
  modal.dir = 'rtl';
  modal.style.cssText = `
    background: white; padding: 22px 24px; border-radius: 12px;
    width: ${width}px; max-width: 92vw; max-height: 88vh;
    box-shadow: 0 8px 28px rgba(0,0,0,0.22);
    display: flex; flex-direction: column; gap: 14px;
    font-family: 'Segoe UI', system-ui, sans-serif;
  `;

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 12px;';
  const titleEl = document.createElement('h2');
  titleEl.textContent = title;
  titleEl.style.cssText = 'margin: 0; font-size: 18px; color: #0f172a;';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
    border: none; background: transparent; cursor: pointer;
    font-size: 24px; line-height: 1; color: #64748b;
    padding: 0 6px;
  `;
  closeBtn.addEventListener('click', closeActiveModal);
  titleRow.appendChild(titleEl);
  titleRow.appendChild(closeBtn);

  const bodyWrap = document.createElement('div');
  bodyWrap.style.cssText = 'flex: 1; overflow-y: auto;';
  bodyWrap.appendChild(body);

  modal.appendChild(titleRow);
  modal.appendChild(bodyWrap);
  if (footer) modal.appendChild(footer);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeActiveModal();
  });
  document.addEventListener('keydown', escHandler);
  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;
  return { backdrop, modal };
}

function buildLoginPrompt() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding: 8px 0;';
  wrap.innerHTML = `
    <div style="margin-bottom: 14px; font-size: 14px; color: #475569;">
      כדי לשלוח דיווח או פנייה צריך להיות מחובר. ההתחברות מאפשרת לנו לחזור אליך.
    </div>
    <div style="display: flex; gap: 8px;">
      <a href="/api/auth/login" class="btn-primary" style="flex: 1;
         padding: 10px 14px; background: #1e3a8a; color: white;
         text-align: center; text-decoration: none; border-radius: 6px;
         font-weight: 600;">התחבר עם גוגל</a>
    </div>`;
  return wrap;
}

function makeFooter({ submitText, submitColor, onSubmit }) {
  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'ביטול';
  cancel.style.cssText = `
    padding: 9px 16px; border: 1px solid #cbd5e1; background: white;
    color: #334155; border-radius: 6px; cursor: pointer; font-size: 14px;
  `;
  cancel.addEventListener('click', closeActiveModal);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = submitText;
  submit.style.cssText = `
    padding: 9px 18px; border: none; background: ${submitColor};
    color: white; border-radius: 6px; cursor: pointer; font-size: 14px;
    font-weight: 600;
  `;
  submit.addEventListener('click', () => onSubmit(submit));

  footer.appendChild(cancel);
  footer.appendChild(submit);
  return footer;
}

export function openBugReportModal() {
  if (!isLoggedIn()) {
    openModal({ title: '🐞 דיווח באג', body: buildLoginPrompt() });
    return;
  }

  const body = document.createElement('div');
  body.innerHTML = `
    <p style="margin: 0 0 12px; font-size: 13px; color: #475569;">
      תאר את הבאג בקצרה. הדיווח נשמר בלוח הניהול ואנחנו רואים אותו ישר.
    </p>
    <label style="display: block; margin-bottom: 12px;">
      <span style="display: block; margin-bottom: 4px; font-size: 13px; color: #334155; font-weight: 500;">כותרת</span>
      <input type="text" id="bug-title" placeholder="לדוגמה: לחיצה על 'רנדר' לא עושה כלום"
             style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1;
                    border-radius: 6px; font-size: 14px; font-family: inherit;
                    box-sizing: border-box;" />
    </label>
    <label style="display: block;">
      <span style="display: block; margin-bottom: 4px; font-size: 13px; color: #334155; font-weight: 500;">פירוט</span>
      <textarea id="bug-body" rows="7" placeholder="מה ניסיתי לעשות / מה קרה / מה ציפיתי שיקרה"
             style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1;
                    border-radius: 6px; font-size: 14px; font-family: inherit;
                    resize: vertical; box-sizing: border-box;"></textarea>
    </label>
    <p style="margin: 8px 0 0; font-size: 12px; color: #64748b;">
      פרטי דפדפן ומסך נשלחים אוטומטית כדי שנוכל לשחזר את הבעיה.
    </p>`;

  const footer = makeFooter({
    submitText: '📤 שלח דיווח',
    submitColor: '#1e3a8a',
    onSubmit: async (submit) => {
      const title = document.getElementById('bug-title').value.trim();
      const text = document.getElementById('bug-body').value.trim();
      if (!title) { showToast('יש להזין כותרת', true); return; }
      if (!text) { showToast('יש לפרט את הבאג', true); return; }
      submit.disabled = true;
      submit.textContent = 'שולח...';
      try {
        const res = await fetch('/api/bug-reports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, body: text, meta: buildEnvMeta() }),
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        closeActiveModal();
        showToast('הדיווח נשלח. תודה!');
      } catch (err) {
        submit.disabled = false;
        submit.textContent = '📤 שלח דיווח';
        showToast('שליחה נכשלה: ' + (err.message || err), true);
      }
    },
  });

  openModal({ title: '🐞 דיווח באג', body, footer });
  setTimeout(() => document.getElementById('bug-title')?.focus(), 50);
}

export function openContactModal() {
  if (!isLoggedIn()) {
    openModal({ title: '✉️ צור קשר', body: buildLoginPrompt() });
    return;
  }

  const body = document.createElement('div');
  body.innerHTML = `
    <p style="margin: 0 0 12px; font-size: 13px; color: #475569;">
      פתק קצר אלינו — שאלה, בקשה, הצעה לשיפור. נחזור אליך במייל הרשום.
    </p>
    <textarea id="contact-body" rows="6" placeholder="כתוב כאן את הפנייה..."
           style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1;
                  border-radius: 6px; font-size: 14px; font-family: inherit;
                  resize: vertical; box-sizing: border-box;"></textarea>
    <details id="my-contacts-section" style="margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
      <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: #1e3a8a; user-select: none;">
        📬 הפניות הקודמות שלי
      </summary>
      <div id="my-contacts-list" style="margin-top: 10px;">
        <div style="text-align: center; color: #64748b; padding: 12px; font-size: 13px;">טוען...</div>
      </div>
    </details>`;

  const footer = makeFooter({
    submitText: '📨 שלח',
    submitColor: '#047857',
    onSubmit: async (submit) => {
      const text = document.getElementById('contact-body').value.trim();
      if (!text) { showToast('הפתק ריק', true); return; }
      submit.disabled = true;
      submit.textContent = 'שולח...';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: text, meta: buildEnvMeta() }),
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        closeActiveModal();
        showToast('הפתק נשלח. תודה!');
      } catch (err) {
        submit.disabled = false;
        submit.textContent = '📨 שלח';
        showToast('שליחה נכשלה: ' + (err.message || err), true);
      }
    },
  });

  openModal({ title: '✉️ צור קשר', body, footer });
  setTimeout(() => document.getElementById('contact-body')?.focus(), 50);

  const details = document.getElementById('my-contacts-section');
  let loadedOnce = false;
  details?.addEventListener('toggle', async () => {
    if (!details.open || loadedOnce) return;
    loadedOnce = true;
    await renderMyContactsInto(document.getElementById('my-contacts-list'));
  });
}

async function renderMyContactsInto(target) {
  if (!target) return;
  try {
    const res = await fetch('/api/contact/mine');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) {
      target.innerHTML = '<div style="text-align:center;color:#64748b;padding:14px;font-size:13px;">עוד לא שלחת אף פנייה.</div>';
      return;
    }
    target.innerHTML = items.map(c => `
      <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#f8fafc;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:6px;">
          <span>📅 ${formatDateShort(c.created_at)}</span>
          <span style="${c.read_at ? 'color:#047857;' : 'color:#b45309;font-weight:600;'}">
            ${c.read_at ? '✓ נקרא על ידינו' : '⏳ ממתין למענה'}
          </span>
        </div>
        <div style="font-size:13px;color:#334155;white-space:pre-wrap;line-height:1.45;">${escapeText(c.body)}</div>
      </div>`).join('');
  } catch (err) {
    target.innerHTML = `<div style="text-align:center;color:#b91c1c;padding:12px;font-size:13px;">טעינה נכשלה: ${escapeText(err.message || err)}</div>`;
  }
}

let trackInflight = false;
const trackQueue = [];

async function flushTrackQueue() {
  if (trackInflight || trackQueue.length === 0) return;
  trackInflight = true;
  const next = trackQueue.shift();
  try {
    await fetch('/api/usage/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
      keepalive: true,
    });
  } catch (_) {
    // לוג שימוש לא חובה — שגיאות נבלעות בשקט.
  } finally {
    trackInflight = false;
    if (trackQueue.length > 0) flushTrackQueue();
  }
}

export function trackUsage(event, detail = null) {
  if (!isLoggedIn()) return;
  if (!event || typeof event !== 'string') return;
  trackQueue.push({ event, detail });
  flushTrackQueue();
}

const STATUS_LABELS = {
  new: 'חדש',
  planning: 'בתכנון',
  in_dev: 'בפיתוח',
  done: 'הסתיים',
};
const STATUS_COLORS = {
  new: { bg: '#fee2e2', fg: '#991b1b' },
  planning: { bg: '#ede9fe', fg: '#5b21b6' },
  in_dev: { bg: '#fef3c7', fg: '#92400e' },
  done: { bg: '#d1fae5', fg: '#065f46' },
};
const STATUS_ORDER = ['in_dev', 'planning', 'done', 'new'];

function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusBadgeStyle(s) {
  const c = STATUS_COLORS[s] || { bg: '#dbeafe', fg: '#1e3a8a' };
  return `background:${c.bg};color:${c.fg};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;`;
}

function buildDevUpdatesList(items) {
  items = (items || []).filter(item => !isTroubleshootingStatus(item.status));
  if (items.length === 0) {
    return '<div style="text-align:center;color:#64748b;padding:30px 10px;font-size:14px;">עוד אין עדכונים — חזרו בהמשך.</div>';
  }

  const groups = new Map();
  for (const item of items) {
    const key = item.status || 'new';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const orderedKeys = [
    ...STATUS_ORDER.filter(k => groups.has(k)),
    ...[...groups.keys()].filter(k => !STATUS_ORDER.includes(k)),
  ];

  return orderedKeys.map(key => {
    const list = groups.get(key);
    const badge = `<span style="${statusBadgeStyle(key)}">${escapeText(statusLabel(key))}</span>`;
    const cards = list.map(it => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px;background:white;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="font-size:14px;font-weight:600;color:#0f172a;">${escapeText(it.title)}</div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;">${formatDateShort(it.updated_at || it.created_at)}</div>
        </div>
        <div style="font-size:13px;color:#334155;white-space:pre-wrap;line-height:1.5;">${escapeText(it.body)}</div>
      </div>
    `).join('');
    return `
      <section style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          ${badge}
          <span style="font-size:13px;color:#64748b;">(${list.length})</span>
        </div>
        ${cards}
      </section>`;
  }).join('');
}

export async function openDevUpdatesModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <p style="margin:0 0 12px;font-size:13px;color:#475569;">
      מה אנחנו עובדים עליו עכשיו, מה בתכנון, ומה כבר מוכן.
    </p>
    <div id="dev-updates-list" style="font-family:'Segoe UI',system-ui,sans-serif;">
      <div style="text-align:center;color:#64748b;padding:20px;">טוען...</div>
    </div>`;

  openModal({ title: '📰 עדכוני פיתוח', body });

  try {
    const res = await fetch('/api/bug-reports/public');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const target = document.getElementById('dev-updates-list');
    if (target) target.innerHTML = buildDevUpdatesList(data.items || []);
  } catch (err) {
    const target = document.getElementById('dev-updates-list');
    if (target) {
      target.innerHTML = `<div style="text-align:center;color:#b91c1c;padding:20px;">טעינה נכשלה: ${escapeText(err.message || err)}</div>`;
    }
  }
}

function buildTroubleshootingItems(items) {
  const managed = (items || [])
    .filter(item => isTroubleshootingStatus(item.status))
    .map(item => ({ title: item.title, body: item.body }))
    .filter(item => String(item.title || '').trim() && String(item.body || '').trim());
  return managed.length ? managed : DEFAULT_TROUBLESHOOTING_ITEMS;
}

function renderTroubleshootingItems(items) {
  return items.map(item => `
    <div style="border:1px solid #dbeafe;border-radius:10px;padding:12px 14px;background:#f8fafc;margin-bottom:10px;line-height:1.65;color:#1f2937;font-size:14px;">
      <strong style="color:#0f172a;">${escapeText(item.title)}:</strong>
      <span>${escapeText(item.body)}</span>
    </div>`).join('');
}

export async function openTroubleshootingModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div style="margin:0 0 14px;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${escapeText(DEFAULT_TROUBLESHOOTING_INTRO)}</div>
    <div id="troubleshooting-list">
      ${renderTroubleshootingItems(DEFAULT_TROUBLESHOOTING_ITEMS)}
    </div>`;

  openModal({ title: '🛠️ פתרון בעיות', body, width: 700 });

  try {
    const res = await fetch('/api/bug-reports/public?limit=500');
    if (!res.ok) return;
    const data = await res.json();
    const items = buildTroubleshootingItems(data.items || []);
    const target = document.getElementById('troubleshooting-list');
    if (target) target.innerHTML = renderTroubleshootingItems(items);
  } catch (_) {
    // ברירת המחדל כבר מוצגת, ולכן אין צורך להפריע למשתמש.
  }
}

function ensureTroubleshootingHeaderButton() {
  const actions = document.querySelector('.app-header-actions');
  if (!actions) return document.getElementById('btn-troubleshooting');

  let btn = document.getElementById('btn-troubleshooting');
  if (btn) return btn;

  btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btn-troubleshooting';
  btn.className = 'header-action-btn header-action-btn-icon';
  btn.title = 'פתרון בעיות ומגבלות ידועות';
  btn.setAttribute('aria-label', 'פתרון בעיות ומגבלות ידועות');
  btn.innerHTML = '<span class="header-action-icon">🛠️</span><span class="header-action-text">פתרון בעיות</span>';

  const afterDevUpdates = document.getElementById('btn-dev-updates');
  if (afterDevUpdates && afterDevUpdates.parentNode === actions) {
    afterDevUpdates.after(btn);
  } else {
    actions.insertBefore(btn, actions.firstElementChild || null);
  }
  return btn;
}

export function wireInboxButtons() {
  const troubleshootingBtn = ensureTroubleshootingHeaderButton();
  if (troubleshootingBtn) {
    troubleshootingBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openTroubleshootingModal();
    });
  }

  const bugBtn = document.getElementById('btn-report-bug');
  if (bugBtn) {
    bugBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openBugReportModal();
    });
  }

  const contactBtn = document.getElementById('btn-contact');
  if (contactBtn) {
    contactBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openContactModal();
    });
  }

  const devUpdatesBtn = document.getElementById('btn-dev-updates');
  if (devUpdatesBtn) {
    devUpdatesBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openDevUpdatesModal();
    });
  }
}
