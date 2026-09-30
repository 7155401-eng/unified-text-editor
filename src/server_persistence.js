// צוות האתר 2026-05-07: סנכרון תכולת המשתמש לשרת.
// משתמש מחובר → תוכן + הגדרות נשמרים ב-D1, נטענים בכניסה הבאה.
// משתמש אנונימי → אפמרי בלבד (גישה מקובלת A — מעודדת התחברות).
//
// זרימה:
// 1. בטעינת הדף, אם המשתמש מחובר → fetch /api/documents/current + /api/settings
// 2. אם השרת מחזיר תוכן/הגדרות → טוען לתוך הדפדפן
// 3. כל שינוי בעורך → debounce 2 שניות → שמירה ל-/api/documents/current + /api/settings

const DEBOUNCE_MS = 2000;
const DOC_SYNC_MAX_WAIT_MS = 10000;
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
  // Document recovery metadata is browser-local state, never a user setting.
  'ravtext.doc.serverStale.',
  'ravtext.panes.state.v1.',
];

function isBlacklisted(key) {
  if (SETTINGS_BLACKLIST.has(key)) return true;
  for (const prefix of SETTINGS_BLACKLIST_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

let _docDebounceTimer = null;
let _docMaxWaitTimer = null;
let _docPendingManager = null;
let _docSaveChain = Promise.resolve();
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

export function applyLocalSettings(settings, { preserveExisting = false } = {}) {
  if (typeof localStorage === 'undefined' || !settings || typeof settings !== 'object') return;
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (!key.startsWith(SETTINGS_PREFIX)) continue;
      if (isBlacklisted(key)) continue;
      if (value == null) continue;

      // A refresh must never roll a setting back to an older server snapshot.
      // Local controls write synchronously to localStorage; server sync is
      // debounced/best-effort and may lag behind. Therefore the browser-local
      // value is authoritative when it already exists, while server settings
      // still seed missing keys on a new browser/device.
      if (preserveExisting && localStorage.getItem(key) !== null) continue;

      localStorage.setItem(key, String(value));
    }
  } catch (e) {
    console.warn('[persistence] applyLocalSettings failed:', e);
  }
}

const STARTUP_FETCH_TIMEOUT_MS = 8000;

async function fetchStartupJson(url) {
  let timer = null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;

  const request = Promise.resolve()
    .then(() => controller ? fetch(url, { signal: controller.signal }) : fetch(url))
    .then(async (response) => ({
      data: response.ok ? await response.json() : null,
      timedOut: false,
      status: response.status || 0,
      error: null,
    }))
    .catch((error) => ({
      data: null,
      timedOut: false,
      status: 0,
      error,
    }));

  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({
      data: null,
      timedOut: true,
      status: 0,
      error: null,
    }), STARTUP_FETCH_TIMEOUT_MS);
  });

  const result = await Promise.race([request, timeout]);
  if (timer !== null) clearTimeout(timer);

  if (result.timedOut && controller && !controller.signal.aborted) {
    try { controller.abort(); } catch {}
  }

  return result;
}

export async function loadInitialState(paneManager) {
  if (!isLoggedIn() || !paneManager) return { loaded: false };

  // The server request is asynchronous while the editor is already usable.
  // Remember the real-editor revision now so a slow response can never
  // overwrite typing/formatting that happened while the request was in flight.
  const contentRevisionAtStart =
    typeof paneManager.getContentRevision === 'function'
      ? paneManager.getContentRevision()
      : null;

  try {
    const [docFetch, settingsFetch] = await Promise.all([
      fetchStartupJson('/api/documents/current'),
      fetchStartupJson('/api/settings'),
    ]);
    const docRes = docFetch.data;
    const settingsRes = settingsFetch.data;
    const startupTimedOut = docFetch.timedOut || settingsFetch.timedOut;

    if (docFetch.timedOut) {
      console.warn('[persistence] startup document fetch timed out; continuing with browser-local state');
    } else if (docFetch.error) {
      console.warn('[persistence] startup document fetch failed:', docFetch.error);
    }
    if (settingsFetch.timedOut) {
      console.warn('[persistence] startup settings fetch timed out; continuing with local settings');
    } else if (settingsFetch.error) {
      console.warn('[persistence] startup settings fetch failed:', settingsFetch.error);
    }

    if (settingsRes && settingsRes.settings) {
      applyLocalSettings(settingsRes.settings, { preserveExisting: true });
    }

    if (docRes && docRes.document && docRes.document.content) {
      const content = docRes.document.content;

      if (
        contentRevisionAtStart !== null &&
        typeof paneManager.getContentRevision === 'function' &&
        paneManager.getContentRevision() !== contentRevisionAtStart
      ) {
        // Persist the in-memory edit synchronously before declaring the local
        // copy authoritative. attachAutoSync() may not be installed yet at
        // this point, so do not rely on ravtext:local-document-saved to create
        // the recovery marker.
        paneManager.flushSave?.();
        let chars = 0;
        try { chars = (localStorage.getItem(DOC_KEY) || '').length; } catch {}
        const localAhead = { status: 'local-ahead', chars, at: Date.now() };
        markServerStale(localAhead.status, localAhead.chars);
        console.warn('[persistence] local editor changed while startup server request was in flight — keeping local document');
        showStaleServerNotice(localAhead);
        return { loaded: false, skipped: 'local-edit-during-server-load' };
      }

      // משה 2026-09-20: כאן נולד התסמין "האתר שוכח". אם השמירה האחרונה
      // לשרת נכשלה (בדרך כלל 413 — מסמך גדול), בשרת יושב עותק **ישן**.
      // עד עכשיו הוא נטען בכל פתיחה ודרס את העבודה החדשה תוך שתי שניות,
      // והמשתמש ראה את המסמך הקודם חוזר שוב ושוב.
      // הדימוי: המזכיר מקבל דף מעודכן, לא מצליח לתייק אותו, ובכל בוקר
      // מניח על השולחן את הדף הישן שכן מתויק.
      // מעכשיו: עותק שנדחה בשרת אינו דורס עבודה מקומית חדשה יותר.
      const stale = staleServerCopy();
      if (stale) {
        if (hasNewerLocalDocument(content)) {
          console.warn('[persistence] server copy is stale (last save not confirmed ' +
                       `${stale.status}) — keeping the local document`);
          showStaleServerNotice(stale);
          return { loaded: false, skipped: 'stale-server-copy', startupTimedOut };
        }
        // A pagehide beacon has no response channel. If the server now matches
        // the local snapshot, the queued write did in fact arrive and the
        // provisional stale flag must not linger for later sessions.
        clearServerStale();
      }
      try {
        if (typeof paneManager.load === 'function') {
          paneManager.load(content);
          _lastDocSig = JSON.stringify(content);
          return { loaded: true, source: 'server', startupTimedOut };
        }
      } catch (e) {
        console.warn('[persistence] paneManager.load failed:', e);
      }
    }

    return {
      loaded: false,
      hadServerSettings: !!settingsRes?.settings,
      startupTimedOut,
      startupFetchFailed: !!docFetch.error || !!settingsFetch.error,
    };
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

function clearServerStaleIfConfirmed(documentSig) {
  try {
    // A successful response for an older queued snapshot must never clear the
    // recovery marker protecting newer browser-local work.
    if (localStorage.getItem(DOC_KEY) === documentSig) clearServerStale();
  } catch {}
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

function shouldRetryStaleServerCopy(stale) {
  if (!stale) return false;
  // A known over-limit document will deterministically fail again until the
  // user changes/splits it. Every other stale reason is worth one startup
  // retry because the network/session may have recovered.
  return stale.status !== 413 && stale.status !== '413';
}

/** האם מה ששמור בדפדפן שונה ממה שהשרת מחזיר — כלומר יש עבודה שלא עלתה. */
function hasNewerLocalDocument(serverContent) {
  try {
    const local = localStorage.getItem(DOC_KEY);
    if (!local) return false;
    return local !== JSON.stringify(serverContent);
  } catch { return false; }
}

// ★ משה, 24/09/2026: "עשיתי בדיקת יבוא JSON פשוט ושוב אותה תקלה — בזמן
// יבוא הוא חוזר מיד לטקסט שהיה לפני היבוא".
//
// השורש השני (הראשון הוא הרענון של היבוא עצמו): אחרי יבוא, העותק שבשרת
// עדיין מחזיק את המסמך **הישן**, כי הסנכרון לשרת מושהה. בטעינה שאחרי
// הרענון `loadInitialState` מושך את העותק הזה ודורס את מה שיובא.
// ההגנה הקיימת פועלת רק כשהשמירה לשרת **נכשלה** — ואחרי יבוא היא לא
// נכשלה, היא פשוט טרם קרתה.
//
// לכן היבוא מסמן במפורש: "העותק המקומי הוא הקובע". הסימון נשאר
// עד שהשרת מאשר בדיוק את אותו snapshot מקומי. אם אירוע השמירה המקומית
// קרה לפני ש-auto-sync הספיק להירשם, attachAutoSync יוזם retry בעצמו.
// כך אין חלון שבו רענון שני יכול להחזיר את עותק השרת הישן.
export function protectLocalDocumentAfterImport(chars = 0) {
  try {
    localStorage.setItem(STALE_KEY, JSON.stringify({
      status: 'local-import', chars, at: Date.now(),
    }));
  } catch {}
}

/** האם מה שנשמר בדפדפן זהה למה שיושב עכשיו בחלוניות. */
export function localDocumentIsSaved(paneManager) {
  try {
    if (!paneManager || typeof paneManager.serialize !== 'function') return false;
    const wanted = JSON.stringify(paneManager.serialize());
    return localStorage.getItem(DOC_KEY) === wanted;
  } catch { return false; }
}

function showStaleServerNotice(stale) {
  if (stale.status === 'local-import') {
    try {
      const el = document.getElementById('status');
      if (el) {
        el.textContent =
          'נטען מה שיובא זה עתה. הגרסה שבשרת לא דרסה אותו, והעותק המקומי יישלח שוב לשרת.';
      }
    } catch {}
    // Do NOT clear the recovery marker here. The server has not confirmed
    // this imported snapshot yet. attachAutoSync() retries it after listeners
    // are installed, and the marker is cleared only by exact confirmation.
    return;
  }
  const size = `${Math.round((stale.chars || 0) / 1000)} אלף תווים`;
  const msg = stale.status === 'local-ahead'
    ? 'נטען העותק המקומי החדש. הוא נשמר בדפדפן לפני שהשרת אישר את אותה גרסה, ולכן הגרסה הישנה שבשרת לא דרסה אותו.'
    : stale.status === 'pagehide-pending'
      ? 'נטען העותק המקומי החדש. לא התקבל אישור שהשמירה לשרת הושלמה לפני סגירת הדף, ולכן הגרסה שבשרת לא דרסה אותו.'
      : stale.status === 413
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
      : status === 'network-error'
        ? 'לא התקבל אישור מהשרת שהמסמך נשמר. העותק המקומי נשאר הקובע עד שהשמירה לשרת תאושר.'
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

function createDocumentSnapshot(paneManager) {
  const canSerialize = paneManager && (
    typeof paneManager.serializeForPersistence === 'function' ||
    typeof paneManager.serialize === 'function'
  );
  if (!isLoggedIn() || !canSerialize) return null;
  const content = typeof paneManager.serializeForPersistence === 'function'
    ? paneManager.serializeForPersistence()
    : paneManager.serialize();
  const sig = JSON.stringify(content);
  return { content, sig };
}

async function saveDocumentSnapshot(snapshot) {
  if (!isLoggedIn() || !snapshot) return;
  const { content, sig } = snapshot;

  if (sig === _lastDocSig) {
    clearServerStaleIfConfirmed(sig);
    return;
  }

  try {
    const res = await fetch('/api/documents/current', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, title: '' }),
    });
    if (res.ok) {
      _lastDocSig = sig;
      _lastSaveError = 0;
      clearServerStaleIfConfirmed(sig);
    } else {
      _lastSaveError = res.status;
      markServerStale(res.status, sig.length);
      console.warn('[persistence] save document failed:', res.status,
                   { chars: sig.length });
      showSaveProblem(res.status, sig.length);
    }
  } catch (e) {
    console.warn('[persistence] saveDocumentSnapshot error:', e);
    if (sig !== _lastDocSig) {
      _lastSaveError = 'network-error';
      markServerStale('network-error', sig.length);
      showSaveProblem('network-error', sig.length);
    }
  }
}

async function saveDocumentNow(paneManager) {
  return saveDocumentSnapshot(createDocumentSnapshot(paneManager));
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

function clearDocumentSyncTimers() {
  if (_docDebounceTimer) clearTimeout(_docDebounceTimer);
  if (_docMaxWaitTimer) clearTimeout(_docMaxWaitTimer);
  _docDebounceTimer = null;
  _docMaxWaitTimer = null;
}

function queueDocumentSave(paneManager) {
  const snapshot = createDocumentSnapshot(paneManager);
  if (!snapshot) return _docSaveChain;

  // Snapshot NOW, network later. This makes queue order deterministic: an old
  // save cannot silently turn into newer editor state while waiting its turn.
  const run = () => saveDocumentSnapshot(snapshot);
  _docSaveChain = _docSaveChain.then(run, run);
  return _docSaveChain;
}

function flushScheduledDocumentSync() {
  const paneManager = _docPendingManager;
  _docPendingManager = null;
  clearDocumentSyncTimers();
  if (paneManager) queueDocumentSave(paneManager);
}

export function scheduleDocumentSync(paneManager) {
  if (!isLoggedIn() || !paneManager) return;
  _docPendingManager = paneManager;

  // Normal case: two seconds after the user pauses.
  if (_docDebounceTimer) clearTimeout(_docDebounceTimer);
  _docDebounceTimer = setTimeout(flushScheduledDocumentSync, DEBOUNCE_MS);

  // Continuous editing must not postpone server persistence forever. This
  // deadline is deliberately non-sliding until a snapshot is flushed.
  if (!_docMaxWaitTimer) {
    _docMaxWaitTimer = setTimeout(flushScheduledDocumentSync, DOC_SYNC_MAX_WAIT_MS);
  }
}

export function scheduleSettingsSync() {
  if (!isLoggedIn()) return;
  if (_settingsDebounceTimer) clearTimeout(_settingsDebounceTimer);
  _settingsDebounceTimer = setTimeout(saveSettingsNow, DEBOUNCE_MS);
}

export function attachAutoSync(paneManager) {
  if (!isLoggedIn() || !paneManager) return;

  // If startup kept a recovery-authoritative local document instead of a
  // stale server copy, the local-save event may already have fired before
  // this async setup completed. Schedule one explicit retry now so recovery
  // does not depend on network timing or on the user typing another key.
  try {
    const stale = staleServerCopy();
    if (
      shouldRetryStaleServerCopy(stale) &&
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(DOC_KEY)
    ) {
      scheduleDocumentSync(paneManager);
    }
  } catch {}

  // Document sync follows PaneManager persistence intent, not rendering.
  // This covers text, structure and pane metadata even when live render is off.
  if (typeof paneManager.on === 'function') {
    paneManager.on('persist', () => scheduleDocumentSync(paneManager));
  } else if (typeof window !== 'undefined') {
    // Compatibility fallback for an older manager implementation only.
    window.addEventListener('ravtext:engine-rendered', () => {
      scheduleDocumentSync(paneManager);
    });
  }

  // A successful localStorage snapshot is recovery-authoritative until the
  // server confirms that exact JSON signature. PaneManager only emits the
  // generic event; server recovery ownership stays in this module.
  if (typeof window !== 'undefined') {
    window.addEventListener('ravtext:local-document-saved', (ev) => {
      try {
        const localSig = localStorage.getItem(DOC_KEY);
        if (localSig && localSig !== _lastDocSig) {
          markServerStale('local-ahead', ev?.detail?.chars || localSig.length);
        } else if (localSig && localSig === _lastDocSig) {
          clearServerStaleIfConfirmed(localSig);
        }
      } catch {}
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
        // Make the browser-local copy authoritative before attempting any
        // best-effort network write. This also makes stale-server recovery
        // independent of listener registration order.
        paneManager.flushSave?.();

        const content = typeof paneManager.serializeForPersistence === 'function'
          ? paneManager.serializeForPersistence()
          : (paneManager.serialize ? paneManager.serialize() : null);
        if (content) {
          const docSig = JSON.stringify(content);
          if (docSig !== _lastDocSig) {
            // sendBeacon has no response channel: mark the server copy
            // provisionally stale before queueing. On the next load the flag
            // is cleared automatically if server and local are identical.
            markServerStale('pagehide-pending', docSig.length);
            if (navigator.sendBeacon) {
              const queued = navigator.sendBeacon(
                '/api/documents/current?beacon=1',
                new Blob(
                  [JSON.stringify({ content, title: '' })],
                  { type: 'application/json' }
                )
              );
              if (!queued) {
                console.warn('[persistence] pagehide document beacon was not queued');
              }
            }
          }
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
            '/api/settings?beacon=1',
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