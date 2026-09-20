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
// משה 2026-05-17: הגנת נפח לסנכרון הגדרות. /api/settings לא אמור לקבל את
// תוכן המסמך עצמו; אם משהו בכל זאת מנפח את payload ההגדרות, לא שולחים אותו
// שוב ושוב ויוצרים לולאת 413.
const MAX_SETTINGS_SYNC_BYTES = 200 * 1024;

// מפתחות שלא נסנכרן (סודיים / זמניים / מצב מסמך שאינו הגדרה):
const SETTINGS_BLACKLIST = new Set([
  'ravtext.ai.apiKey',                 // legacy
  'ravtext.demo.blockedUntil',
  'ravtext.demoMode',

  // תוכן/מצב מסמך נשמר דרך /api/documents/current, לא דרך /api/settings.
  // בלוג 2026-05-17 נמצא שהמפתח הזה לבד הגיע לכ-527KB וגרם ל-413.
  'ravtext.panes.state.v1',

  // autosave/תוכן עבודה זמני — לא הגדרות גלובליות.
  'ravtext.nikud_merger.autosave',
  'ravtext.cssInject.css',

  // מפתחות/קונפיגורציות שעלולים להכיל API keys או מידע רגיש.
  'ravtext.caricature.gemini_api_key',
  'ravtext.torah_transcription.config',

  // משה 2026-05-14: PR #233 הכניס מפתח שמקטין את גובה הדף; PR #234 הסיר את
  // הכתיבה, אבל המפתח עדיין מסונכרן מהשרת למשתמשים מחוברים — וגרם לבאג
  // לחזור אצל מחוברים לאחר שכבר תיקנו אותו אצל אורחים. לא לסנכרן ולא לשחזר.
  'ravtext.layout.autoOverflowSafety',
  'ravtext.layout.autoOverflowAttempts.v1',
  // מפתחות מצב זמני של live overflow corrector — לא רוצים שיגיעו לשרת
  'ravtext.layout.overflowReserve.v1',
  'ravtext.layout.overflowReserve.v1.iter',
]);
// משה 2026-05-09: אסור לסנכרן מפתחות API של ספקי AI לשרת — הם פרטיים למשתמש.
// הוספתי תחילית כך שכל ravtext.ai.apiKey.<provider> נחסם.
// משה 2026-05-17: חסימת prefixes נוספים שמייצרים payload מיותר או רגיש.
const SETTINGS_BLACKLIST_PREFIXES = [
  'ravtext.ai.apiKey.',
  'ravtext.caricature.',
  'ravtext.torah_transcription.',
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
let _lastFailedSettingsSig = '';

function isLoggedIn() {
  const auth = (typeof window !== 'undefined' && window.__RAVTEXT_AUTH__) || null;
  return !!(auth && auth.loggedIn);
}

function byteSize(value) {
  const text = String(value == null ? '' : value);
  if (typeof Blob !== 'undefined') return new Blob([text]).size;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}

function summarizeSettings(settings, limit = 20) {
  return Object.entries(settings || {})
    .map(([key, value]) => ({
      key,
      bytes: byteSize(value),
      chars: String(value == null ? '' : value).length,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

function shouldSkipSettingsPayload(sig, payload) {
  if (sig === _lastSettingsSig) return true;
  if (sig === _lastFailedSettingsSig) return true;

  const bytes = byteSize(payload);
  if (bytes > MAX_SETTINGS_SYNC_BYTES) {
    _lastFailedSettingsSig = sig;
    console.warn('[persistence] skip settings sync: payload too large', {
      bytes,
      maxBytes: MAX_SETTINGS_SYNC_BYTES,
    });
    return true;
  }

  return false;
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
      // משה 2026-09-20: כאן נולד התסמין "האתר שוכח". אם השמירה האחרונה
      // לשרת נכשלה (בדרך כלל 413 — מסמך גדול), בשרת יושב עותק **ישן**.
      // עד עכשיו הוא נטען בכל פתיחה ודרס את העבודה החדשה תוך שתי שניות,
      // והמשתמש ראה את המסמך הקודם חוזר שוב ושוב.
      // הדימוי: המזכיר מקבל דף מעודכן, לא מצליח לתייק אותו, ובכל בוקר
      // מניח על השולחן את הדף הישן שכן מתויק.
      // מעכשיו: עותק שנדחה בשרת אינו דורס עבודה מקומית חדשה יותר.
      const stale = staleServerCopy();
      if (stale && hasNewerLocalDocument(content)) {
        console.warn('[persistence] server copy is stale (last save failed ' +
                     `${stale.status}) — keeping the local document`);
        showStaleServerNotice(stale);
        return { loaded: false, skipped: 'stale-server-copy' };
      }
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

// משה 2026-09-20: הודעה אחת ברורה כשהשמירה לשרת נכשלת. בלי קודי שגיאה
// ובלי האשמות — מה קרה, ומה לעשות עכשיו.
let _lastSaveError = 0;

// דגל "בשרת יושב עותק ישן". נשמר בדפדפן ולא בזיכרון בלבד, כי הבעיה
// מתגלה דווקא **אחרי** רענון — וזה בדיוק הרגע שבו הזיכרון מתאפס.
const STALE_KEY = 'ravtext.doc.serverStale.v1';
const DOC_KEY = 'ravtext.panes.state.v1';

function markServerStale(status, chars) {
  try {
    localStorage.setItem(STALE_KEY, JSON.stringify({
      status, chars, at: Date.now(),
    }));
  } catch {}
}

function clearServerStale() {
  try { localStorage.removeItem(STALE_KEY); } catch {}
}

function staleServerCopy() {
  try {
    const raw = localStorage.getItem(STALE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // דגל ישן מאוד כבר אינו רלוונטי — אולי המסמך כבר הוקטן או נמחק.
    if (!v || (Date.now() - (v.at || 0)) > 14 * 24 * 3600 * 1000) {
      clearServerStale();
      return null;
    }
    return v;
  } catch { return null; }
}

/** האם מה ששמור בדפדפן שונה ממה שהשרת מחזיר — כלומר יש עבודה שלא עלתה. */
function hasNewerLocalDocument(serverContent) {
  try {
    const local = localStorage.getItem(DOC_KEY);
    if (!local) return false;
    return local !== JSON.stringify(serverContent);
  } catch { return false; }
}

function showStaleServerNotice(stale) {
  const size = `${Math.round((stale.chars || 0) / 1000)} אלף תווים`;
  const msg = stale.status === 413
    ? `נטען העותק שלך מהמחשב. בשרת יושבת גרסה ישנה יותר, כי המסמך ` +
      `(${size}) גדול מכדי להישמר שם — לכן הוא לא נדרס.`
    : `נטען העותק שלך מהמחשב. השמירה האחרונה לשרת נכשלה ` +
      `(תקלה ${stale.status}), ולכן הגרסה שבשרת לא נדרסה על שלך.`;
  try {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('ravtext:server-stale',
      { detail: stale }));
  } catch {}
}

export function lastSaveError() {
  return _lastSaveError;
}

function showSaveProblem(status, chars) {
  const size = `${Math.round(chars / 1000)} אלף תווים`;
  const msg = status === 413
    ? `המסמך (${size}) גדול מכדי להישמר בשרת. הוא נשאר אצלך בדפדפן, ` +
      `אבל לא יישמר לפעם הבאה — כדאי לפצל אותו לשני מסמכים.`
    : status === 401 || status === 403
      ? 'החיבור לחשבון פג — המסמך לא נשמר. כדאי להתחבר מחדש.'
      : `המסמך לא נשמר בשרת (תקלה ${status}). הוא נשאר אצלך בדפדפן.`;
  try {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('ravtext:save-failed',
      { detail: { status, chars } }));
  } catch {}
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
      _lastSaveError = 0;
      clearServerStale();
    } else {
      // משה 2026-09-20: עד כאן הכישלון היה **שקט** — רק שורה ביומן.
      // התוצאה: המסמך החדש לא נשמר בשרת, ובכל רענון חזר המסמך הישן
      // תוך שתי שניות, והמשתמש חשב שהאתר "מתעלם" ממנו. עכשיו הוא רואה.
      _lastSaveError = res.status;
      markServerStale(res.status, sig.length);
      console.warn('[persistence] save document failed:', res.status,
                   { chars: sig.length });
      showSaveProblem(res.status, sig.length);
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
    const body = JSON.stringify({ settings });

    if (shouldSkipSettingsPayload(sig, body)) return;

    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (res.ok) {
      _lastSettingsSig = sig;
      _lastFailedSettingsSig = '';
    } else {
      if (res.status === 413) _lastFailedSettingsSig = sig;
      console.warn('[persistence] save settings failed:', res.status, {
        bytes: byteSize(body),
        largestKeys: summarizeSettings(settings),
      });
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
        const sig = JSON.stringify(settings);
        const body = JSON.stringify({ settings });
        if (
          sig !== _lastSettingsSig &&
          sig !== _lastFailedSettingsSig &&
          byteSize(body) <= MAX_SETTINGS_SYNC_BYTES &&
          navigator.sendBeacon
        ) {
          navigator.sendBeacon(
            '/api/settings',
            new Blob(
              [body],
              { type: 'application/json' }
            )
          );
        }
      } catch (e) { /* best effort */ }
    });
  }
}