// צוות האתר 2026-05-07: סנכרון תכולת המשתמש לשרת.
// משתמש מחובר → תוכן + הגדרות נשמרים ב-D1, נטענים בכניסה הבאה.
// משתמש אנונימי → אפמרי בלבד (גישה מקובלת A — מעודדת התחברות).
//
// זרימה:
// 1. בטעינת הדף, אם המשתמש מחובר → fetch /api/documents/current + /api/settings
// 2. אם השרת מחזיר תוכן/הגדרות → טוען לתוך הדפדפן
// 3. כל שינוי בעורך → debounce 2 שניות → שמירה ל-/api/documents/current + /api/settings

const DEBOUNCE_MS = 2000;
const SETTINGS_PREFIX = 'ravtext.';
// מפתחות שלא נסנכרן (סודיים / זמניים / מצביעי הגנה):
const SETTINGS_BLACKLIST = new Set([
  'ravtext.ai.apiKey',                 // legacy
  'ravtext.demo.blockedUntil',
  'ravtext.demoMode',
  // משה 2026-05-14: כל מפתחות גובה־בטיחות הם תוצאת מדידה מקומית של המנוע
  // החכם. אסור לסנכרן אותם בין מכשירים: מסך/גופן/דפדפן שונים → ערך אחר,
  // ואם השרת מחזיר ערך זר הוא חותך את גובה הדף ויוצר את הבאג שחוזר אצל
  // משתמשים מחוברים. נשארים מקומיים בלבד.
  'ravtext.layout.autoOverflowSafety',
  'ravtext.layout.autoOverflowAttempts.v1',
  'ravtext.layout.heightSafetyRegular',
  'ravtext.talmudLayout.heightSafety',
  'ravtext.talmudLayout.heightSafetyPerPage',
]);
// משה 2026-05-09: אסור לסנכרן מפתחות API של ספקי AI לשרת — הם פרטיים למשתמש.
// הוספתי תחילית כך שכל ravtext.ai.apiKey.<provider> נחסם.
// משה 2026-05-14: smart-packer cache לכל מסמך הוא תוצאת מדידה מקומית; אם
// יסונכרן בין מכשירים יגרום לקיטוע גובה לאחר login (הבאג של PR #233 חזר
// דרך הסנכרון). נשאר local-only.
const SETTINGS_BLACKLIST_PREFIXES = [
  'ravtext.ai.apiKey.',
  'ravtext.talmudLayout.smartCache.',
];

function isBlacklisted(key) {
  if (SETTINGS_BLACKLIST.has(key)) return true;
  for (const prefix of SETTINGS_BLACKLIST_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

let _docDebounceTimer = null;
let _settingsDebounceTimer = null;
let _lastDocSig = '';
let _lastSettingsSig = '';

function isLoggedIn() {
  const auth = (typeof window !== 'undefined' && window.__RAVTEXT_AUTH__) || null;
  return !!(auth && auth.loggedIn);
}

function collectLocalSettings() {
  const out = {};
  if (typeof localStorage === 'undefined') return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SETTINGS_PREFIX)) continue;
      if (isBlacklisted(key)) continue;
      out[key] = localStorage.getItem(key);
    }
  } catch (e) {
    console.warn('[persistence] collectLocalSettings failed:', e);
  }
  return out;
}

function applyLocalSettings(settings) {
  if (typeof localStorage === 'undefined' || !settings || typeof settings !== 'object') return;
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (!key.startsWith(SETTINGS_PREFIX)) continue;
      if (isBlacklisted(key)) continue;
      if (value == null) continue;
      localStorage.setItem(key, String(value));
    }
  } catch (e) {
    console.warn('[persistence] applyLocalSettings failed:', e);
  }
}

export async function loadInitialState(paneManager) {
  if (!isLoggedIn() || !paneManager) return { loaded: false };

  try {
    const [docRes, settingsRes] = await Promise.all([
      fetch('/api/documents/current').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/settings').then((r) => (r.ok ? r.json() : null)),
    ]);

    if (settingsRes && settingsRes.settings) {
      applyLocalSettings(settingsRes.settings);
    }

    if (docRes && docRes.document && docRes.document.content) {
      const content = docRes.document.content;
      try {
        if (typeof paneManager.load === 'function') {
          paneManager.load(content);
          _lastDocSig = JSON.stringify(content);
          return { loaded: true, source: 'server' };
        }
      } catch (e) {
        console.warn('[persistence] paneManager.load failed:', e);
      }
    }

    return { loaded: false, hadServerSettings: !!settingsRes?.settings };
  } catch (e) {
    console.warn('[persistence] loadInitialState failed:', e);
    return { loaded: false, error: e.message };
  }
}

async function saveDocumentNow(paneManager) {
  if (!isLoggedIn() || !paneManager || typeof paneManager.serialize !== 'function') return;
  try {
    const content = paneManager.serialize();
    const sig = JSON.stringify(content);
    if (sig === _lastDocSig) return;
    const res = await fetch('/api/documents/current', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, title: '' }),
    });
    if (res.ok) {
      _lastDocSig = sig;
    } else {
      console.warn('[persistence] save document failed:', res.status);
    }
  } catch (e) {
    console.warn('[persistence] saveDocumentNow error:', e);
  }
}

async function saveSettingsNow() {
  if (!isLoggedIn()) return;
  try {
    const settings = collectLocalSettings();
    const sig = JSON.stringify(settings);
    if (sig === _lastSettingsSig) return;
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (res.ok) {
      _lastSettingsSig = sig;
    } else {
      console.warn('[persistence] save settings failed:', res.status);
    }
  } catch (e) {
    console.warn('[persistence] saveSettingsNow error:', e);
  }
}

export function scheduleDocumentSync(paneManager) {
  if (!isLoggedIn()) return;
  if (_docDebounceTimer) clearTimeout(_docDebounceTimer);
  _docDebounceTimer = setTimeout(() => saveDocumentNow(paneManager), DEBOUNCE_MS);
}

export function scheduleSettingsSync() {
  if (!isLoggedIn()) return;
  if (_settingsDebounceTimer) clearTimeout(_settingsDebounceTimer);
  _settingsDebounceTimer = setTimeout(saveSettingsNow, DEBOUNCE_MS);
}

export function attachAutoSync(paneManager) {
  if (!isLoggedIn() || !paneManager) return;

  // Document sync — listen for the engine-rendered event which fires on each
  // (debounced) editor change after pagination completes.
  if (typeof window !== 'undefined') {
    window.addEventListener('ravtext:engine-rendered', () => {
      scheduleDocumentSync(paneManager);
    });
  }

  // Settings sync — wrap localStorage.setItem to detect changes to ravtext.* keys.
  if (typeof localStorage !== 'undefined') {
    const origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      origSet(key, value);
      if (
        typeof key === 'string' &&
        key.startsWith(SETTINGS_PREFIX) &&
        !isBlacklisted(key)
      ) {
        scheduleSettingsSync();
      }
    };
  }

  // Save on page hide (best-effort, sendBeacon for reliability).
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      try {
        const content = paneManager.serialize ? paneManager.serialize() : null;
        if (content && JSON.stringify(content) !== _lastDocSig && navigator.sendBeacon) {
          navigator.sendBeacon(
            '/api/documents/current',
            new Blob(
              [JSON.stringify({ content, title: '' })],
              { type: 'application/json' }
            )
          );
        }
        const settings = collectLocalSettings();
        if (JSON.stringify(settings) !== _lastSettingsSig && navigator.sendBeacon) {
          navigator.sendBeacon(
            '/api/settings',
            new Blob(
              [JSON.stringify({ settings })],
              { type: 'application/json' }
            )
          );
        }
      } catch (e) { /* best effort */ }
    });
  }
}
