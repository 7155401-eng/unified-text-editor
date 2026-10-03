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
// A hung document PUT must never hold the serialized save queue forever.
// 30s is deliberately much longer than the normal debounce/deadline while
// still bounding recovery on broken mobile/Wi-Fi connections.
export const DOCUMENT_SAVE_TIMEOUT_MS = 30000;
const SETTINGS_SYNC_MAX_WAIT_MS = 10000;
export const SETTINGS_SAVE_TIMEOUT_MS = 30000;
export const SETTINGS_FALLBACK_POLL_MS = 5000;
const SETTINGS_PREFIX = 'ravtext.';
// משה 2026-05-17: הגנת נפח לסנכרון הגדרות. /api/settings לא אמור לקבל את
// תוכן המסמך עצמו; אם משהו בכל זאת מנפח את payload ההגדרות, לא שולחים אותו
// שוב ושוב ויוצרים לולאת 413.
const MAX_SETTINGS_SYNC_BYTES = 200 * 1024;
// Beacon/keepalive requests share a 64 KiB body quota per fetch group. Keep
// one explicit pagehide budget so document + settings never exceed our own
// share of that quota. The document gets first priority; local recovery still
// protects it when it is too large to beacon at all.
export const PAGEHIDE_BEACON_BUDGET_BYTES = 64 * 1024;

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
let _docSaveRunning = false;
let _docQueuedSnapshot = null;
let _settingsDebounceTimer = null;
let _settingsMaxWaitTimer = null;
let _settingsSaveChain = Promise.resolve();
let _settingsSaveRunning = false;
let _settingsQueuedSnapshot = null;
let _lastDocSig = '';
let _lastSettingsSig = '';
let _lastFailedSettingsSig = '';
let _settingsServerKnown = false;

// Autosync bootstrap can be retried by the main startup promise chain. Track
// installation per PaneManager at step granularity so a partial failure can be
// retried without duplicating listeners that were already installed.
const _autoSyncInstallStates = new WeakMap();
const _wrappedSettingsStorages = new WeakSet();
const _settingsFallbackMonitors = new WeakMap();

function autoSyncInstallState(paneManager) {
  let state = _autoSyncInstallStates.get(paneManager);
  if (!state) {
    state = {
      attaching: false,
      attached: false,
      initialRetry: false,
      documentIntent: false,
      localDocumentSaved: false,
      pagehide: false,
    };
    _autoSyncInstallStates.set(paneManager, state);
  }
  return state;
}

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

export function planPagehideBeaconBodies({
  documentBody = null,
  settingsBody = null,
  budgetBytes = PAGEHIDE_BEACON_BUDGET_BYTES,
} = {}) {
  let remainingBytes = Math.max(0, Number(budgetBytes) || 0);
  const documentBytes = documentBody == null ? 0 : byteSize(documentBody);
  const settingsBytes = settingsBody == null ? 0 : byteSize(settingsBody);

  const documentFits = documentBody != null && documentBytes <= remainingBytes;
  if (documentFits) remainingBytes -= documentBytes;

  const settingsFits = settingsBody != null && settingsBytes <= remainingBytes;
  if (settingsFits) remainingBytes -= settingsBytes;

  return {
    documentBody: documentFits ? documentBody : null,
    settingsBody: settingsFits ? settingsBody : null,
    documentBytes,
    settingsBytes,
    documentFits,
    settingsFits,
    remainingBytes,
  };
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

function collectLocalSettings() {
  const out = {};
  if (typeof localStorage === 'undefined') return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SETTINGS_PREFIX)) continue;
      if (isBlacklisted(key)) continue;
      out[key] = localStorage.getItem(key);
    }
    return out;
  } catch (e) {
    // PUT /api/settings replaces the complete server snapshot. A partial
    // collection is therefore unsafe: fail closed rather than wiping keys that
    // happened to sit after the storage read that threw.
    console.warn('[persistence] collectLocalSettings failed:', e);
    return null;
  }
}

function createSettingsSnapshot() {
  if (!isLoggedIn()) return null;
  const settings = collectLocalSettings();
  if (!settings) return null;

  const sig = JSON.stringify(settings);
  if (sig === _lastFailedSettingsSig) return null;

  const body = JSON.stringify({ settings });
  const bytes = byteSize(body);
  if (bytes > MAX_SETTINGS_SYNC_BYTES) {
    _lastFailedSettingsSig = sig;
    console.warn('[persistence] skip settings sync: payload too large', {
      bytes,
      maxBytes: MAX_SETTINGS_SYNC_BYTES,
    });
    return null;
  }

  // Do not drop sig===_lastSettingsSig here. A different snapshot may already
  // be in flight and can overwrite that confirmed server state before this
  // snapshot reaches the head of the queue.
  return { settings, sig, body };
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

  // Start the endpoint immediately. Document and settings are independent
  // startup reads; a fast settings response must be able to seed localStorage
  // while the document request is still hung.
  let fetchPromise;
  try {
    fetchPromise = controller ? fetch(url, { signal: controller.signal }) : fetch(url);
  } catch (error) {
    fetchPromise = Promise.reject(error);
  }

  const request = Promise.resolve(fetchPromise)
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

export async function loadInitialState(paneManager, { mayApplyDocument = null } = {}) {
  if (!isLoggedIn() || !paneManager) return { loaded: false };

  // The server request is asynchronous while the editor is already usable.
  // Remember the real-editor revision now so a slow response can never
  // overwrite typing/formatting that happened while the request was in flight.
  const contentRevisionAtStart =
    typeof paneManager.getContentRevision === 'function'
      ? paneManager.getContentRevision()
      : null;

  try {
    const docFetchPromise = fetchStartupJson('/api/documents/current');
    const settingsFetchPromise = fetchStartupJson('/api/settings').then((settingsFetch) => {
      if (settingsFetch.timedOut) {
        console.warn('[persistence] startup settings fetch timed out; continuing with local settings');
      } else if (settingsFetch.error) {
        console.warn('[persistence] startup settings fetch failed:', settingsFetch.error);
      } else if (settingsFetch.data?.settings) {
        // Remember exactly what the server confirmed before preserving newer
        // browser-local choices. attachAutoSync() can then reconcile a real
        // local/server difference without guessing after a failed startup GET.
        _lastSettingsSig = JSON.stringify(settingsFetch.data.settings);
        _settingsServerKnown = true;

        // Settings are independent of the document GET. Seed missing settings
        // immediately instead of making a fast endpoint wait for a hung one.
        applyLocalSettings(settingsFetch.data.settings, { preserveExisting: true });
      }
      return settingsFetch;
    });

    const [docFetch, settingsFetch] = await Promise.all([
      docFetchPromise,
      settingsFetchPromise,
    ]);
    const docRes = docFetch.data;
    const settingsRes = settingsFetch.data;
    const startupTimedOut = docFetch.timedOut || settingsFetch.timedOut;

    if (docFetch.timedOut) {
      console.warn('[persistence] startup document fetch timed out; continuing with browser-local state');
    } else if (docFetch.error) {
      console.warn('[persistence] startup document fetch failed:', docFetch.error);
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
        return { loaded: false, skipped: 'local-edit-during-server-load', startupTimedOut };
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
        if (typeof mayApplyDocument === 'function') {
          let allowed = false;
          try {
            allowed = (await mayApplyDocument({ content, startupTimedOut })) !== false;
          } catch (gateError) {
            console.warn('[persistence] startup document authority gate failed — keeping browser-local state', gateError);
            allowed = false;
          }
          if (!allowed) {
            return {
              loaded: false,
              skipped: 'browser-local-startup-authoritative',
              serverDocumentAvailable: true,
              startupTimedOut,
            };
          }
        }
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
    if (!paneManager) return false;
    const wanted = typeof paneManager.serializeForPersistenceString === 'function'
      ? paneManager.serializeForPersistenceString()
      : (() => {
          const content = typeof paneManager.serializeForPersistence === 'function'
            ? paneManager.serializeForPersistence()
            : (typeof paneManager.serialize === 'function' ? paneManager.serialize() : null);
          return content ? JSON.stringify(content) : null;
        })();
    return !!wanted && localStorage.getItem(DOC_KEY) === wanted;
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
      : status === 'network-timeout'
        ? 'השמירה לשרת נתקעה זמן רב מדי ובוטלה. העותק המקומי נשאר הקובע, והשמירה הבאה תנסה שוב.'
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

export function documentPayloadFromContentJson(contentJson) {
  const json = String(contentJson ?? 'null');
  return `{"content":${json},"title":""}`;
}

function createDocumentSnapshot(paneManager) {
  const canSerialize = paneManager && (
    typeof paneManager.serializeForPersistenceString === 'function' ||
    typeof paneManager.serializeForPersistence === 'function' ||
    typeof paneManager.serialize === 'function'
  );
  if (!isLoggedIn() || !canSerialize) return null;

  if (typeof paneManager.serializeForPersistenceString === 'function') {
    const sig = paneManager.serializeForPersistenceString();
    return sig ? { sig } : null;
  }

  const content = typeof paneManager.serializeForPersistence === 'function'
    ? paneManager.serializeForPersistence()
    : paneManager.serialize();
  const sig = JSON.stringify(content);
  return { sig };
}

async function saveDocumentSnapshot(snapshot) {
  if (!isLoggedIn() || !snapshot) return;
  const { sig } = snapshot;

  if (sig === _lastDocSig) {
    clearServerStaleIfConfirmed(sig);
    return;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;
  let timedOut = false;

  if (controller) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try { controller.abort(); } catch {}
    }, DOCUMENT_SAVE_TIMEOUT_MS);
  }

  try {
    const init = {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: documentPayloadFromContentJson(sig),
    };
    if (controller) init.signal = controller.signal;

    const res = await fetch('/api/documents/current', init);
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
    const failure = timedOut ? 'network-timeout' : 'network-error';
    console.warn('[persistence] saveDocumentSnapshot error:', failure, e);
    if (sig !== _lastDocSig) {
      _lastSaveError = failure;
      markServerStale(failure, sig.length);
      showSaveProblem(failure, sig.length);
    }
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function saveDocumentNow(paneManager) {
  return saveDocumentSnapshot(createDocumentSnapshot(paneManager));
}

async function saveSettingsSnapshot(snapshot) {
  if (!isLoggedIn() || !snapshot) return;
  const { settings, sig, body } = snapshot;

  // Evaluate this only at the head of the serialized queue. See
  // createSettingsSnapshot(): a fast revert to the last confirmed state still
  // has to wait behind an older in-flight PUT that may change the server.
  if (sig === _lastSettingsSig) return;
  if (sig === _lastFailedSettingsSig) return;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;
  let timedOut = false;

  if (controller) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try { controller.abort(); } catch {}
    }, SETTINGS_SAVE_TIMEOUT_MS);
  }

  try {
    const init = {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    };
    if (controller) init.signal = controller.signal;

    const res = await fetch('/api/settings', init);
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
    console.warn(
      '[persistence] save settings failed:',
      timedOut ? 'network-timeout' : 'network-error',
      e
    );
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function queueSettingsSnapshot(snapshot) {
  // A failed/oversized latest collection also supersedes an older waiting
  // snapshot. Sending that stale waiter would move the server farther away
  // from the browser-authoritative state.
  _settingsQueuedSnapshot = snapshot;
  if (!snapshot) return _settingsSaveChain;
  if (_settingsSaveRunning) return _settingsSaveChain;

  _settingsSaveRunning = true;
  const drain = async () => {
    try {
      while (_settingsQueuedSnapshot) {
        const next = _settingsQueuedSnapshot;
        _settingsQueuedSnapshot = null;
        await saveSettingsSnapshot(next);
      }
    } finally {
      _settingsSaveRunning = false;
    }
  };

  _settingsSaveChain = _settingsSaveChain.then(drain, drain);
  return _settingsSaveChain;
}

function queueSettingsSave() {
  return queueSettingsSnapshot(createSettingsSnapshot());
}

function installSettingsPollingFallback(storage) {
  if (
    !storage ||
    typeof window === 'undefined' ||
    typeof window.setInterval !== 'function'
  ) {
    return false;
  }
  if (_settingsFallbackMonitors.has(storage)) return true;

  const initial = createSettingsSnapshot();
  const monitor = {
    lastObservedSig: initial?.sig ?? null,
    timer: null,
  };

  monitor.timer = window.setInterval(() => {
    const snapshot = createSettingsSnapshot();
    if (!snapshot) return;
    if (snapshot.sig === monitor.lastObservedSig) return;
    monitor.lastObservedSig = snapshot.sig;
    queueSettingsSnapshot(snapshot);
  }, SETTINGS_FALLBACK_POLL_MS);

  _settingsFallbackMonitors.set(storage, monitor);

  // Only reconcile immediately when startup GET actually told us what the
  // server has. If startup failed/timed out, the local snapshot is not enough
  // evidence to safely replace the full server settings object.
  if (
    _settingsServerKnown &&
    initial &&
    initial.sig !== _lastSettingsSig
  ) {
    queueSettingsSnapshot(initial);
  }

  return true;
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

  // Keep at most one waiting snapshot. While one immutable PUT is in flight,
  // intermediate editor states have no recovery value: only the newest state
  // should follow it. This prevents a slow connection from building an
  // unbounded queue of stale full-document uploads.
  _docQueuedSnapshot = snapshot;
  if (_docSaveRunning) return _docSaveChain;

  _docSaveRunning = true;
  const drain = async () => {
    try {
      while (_docQueuedSnapshot) {
        const next = _docQueuedSnapshot;
        _docQueuedSnapshot = null;
        await saveDocumentSnapshot(next);
      }
    } finally {
      _docSaveRunning = false;
    }
  };

  _docSaveChain = _docSaveChain.then(drain, drain);
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

function clearSettingsSyncTimers() {
  if (_settingsDebounceTimer) clearTimeout(_settingsDebounceTimer);
  if (_settingsMaxWaitTimer) clearTimeout(_settingsMaxWaitTimer);
  _settingsDebounceTimer = null;
  _settingsMaxWaitTimer = null;
}

function flushScheduledSettingsSync() {
  clearSettingsSyncTimers();
  queueSettingsSave();
}

export function scheduleSettingsSync() {
  if (!isLoggedIn()) return;

  if (_settingsDebounceTimer) clearTimeout(_settingsDebounceTimer);
  _settingsDebounceTimer = setTimeout(flushScheduledSettingsSync, DEBOUNCE_MS);

  // A user dragging/repeating a setting must not postpone cross-device
  // persistence forever.
  if (!_settingsMaxWaitTimer) {
    _settingsMaxWaitTimer = setTimeout(flushScheduledSettingsSync, SETTINGS_SYNC_MAX_WAIT_MS);
  }
}

export function attachAutoSync(paneManager) {
  if (!isLoggedIn() || !paneManager) return;

  const install = autoSyncInstallState(paneManager);
  if (install.attached || install.attaching) return;
  install.attaching = true;

  try {
    // If startup kept a recovery-authoritative local document instead of a
    // stale server copy, the local-save event may already have fired before
    // this async setup completed. Run this once per manager.
    if (!install.initialRetry) {
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
      install.initialRetry = true;
    }

    // Document sync follows PaneManager persistence intent, not rendering.
    // Mark the step only after listener registration succeeds. If registration
    // throws, a later startup retry may safely try this step again.
    if (!install.documentIntent) {
      if (typeof paneManager.on === 'function') {
        paneManager.on('persist', () => scheduleDocumentSync(paneManager));
      } else if (typeof window !== 'undefined') {
        // Compatibility fallback for an older manager implementation only.
        window.addEventListener('ravtext:engine-rendered', () => {
          scheduleDocumentSync(paneManager);
        });
      }
      install.documentIntent = true;
    }

    // A successful localStorage snapshot is recovery-authoritative until the
    // server confirms that exact JSON signature. This is also step-idempotent:
    // if a later installation step fails, retry will not duplicate this hook.
    if (!install.localDocumentSaved && typeof window !== 'undefined') {
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
      install.localDocumentSaved = true;
    }

    // Settings sync — wrap each concrete Storage object at most once.
    // Storage methods are host objects in some browsers/webviews and may reject
    // reassignment. That optional failure must never abort document autosync or
    // the pagehide recovery hook below.
    if (typeof localStorage !== 'undefined' && localStorage) {
      const storage = localStorage;
      if (!_wrappedSettingsStorages.has(storage)) {
        try {
          const origSet = storage.setItem.bind(storage);
          const wrappedSetItem = function (key, value) {
            origSet(key, value);
            if (
              typeof key === 'string' &&
              key.startsWith(SETTINGS_PREFIX) &&
              !isBlacklisted(key)
            ) {
              scheduleSettingsSync();
            }
          };
          storage.setItem = wrappedSetItem;
          if (storage.setItem === wrappedSetItem) {
            _wrappedSettingsStorages.add(storage);
          } else {
            const polling = installSettingsPollingFallback(storage);
            console.warn(
              '[persistence] localStorage.setItem could not be wrapped; ' +
              (polling ? 'using settings polling fallback' : 'settings autosync fallback unavailable')
            );
          }
        } catch (e) {
          const polling = installSettingsPollingFallback(storage);
          console.warn(
            '[persistence] could not wrap localStorage.setItem for settings autosync; ' +
            (polling ? 'using polling fallback:' : 'no polling fallback available:'),
            e
          );
        }
      }
    }

    // Startup preserves existing browser-local choices. When the server GET
    // succeeded, reconcile those choices now instead of waiting for another
    // setting edit. This is safe only when the server signature is known.
    if (_settingsServerKnown) {
      const currentSettings = createSettingsSnapshot();
      if (currentSettings && currentSettings.sig !== _lastSettingsSig) {
        queueSettingsSnapshot(currentSettings);
      }
    }

    // Save on page hide (best-effort). Beacon/keepalive bodies share one
    // 64 KiB quota, so budget document + settings together instead of issuing
    // requests that the browser is required to reject.
    if (!install.pagehide && typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        try {
          // Make the browser-local copy authoritative before attempting any
          // best-effort network write. This also makes stale-server recovery
          // independent of listener registration order.
          paneManager.flushSave?.();

          let documentBody = null;
          const snapshot = createDocumentSnapshot(paneManager);
          if (snapshot && snapshot.sig !== _lastDocSig) {
            // sendBeacon has no response channel: mark the server copy
            // provisionally stale before queueing. On the next load the flag
            // is cleared automatically if server and local are identical.
            markServerStale('pagehide-pending', snapshot.sig.length);
            documentBody = documentPayloadFromContentJson(snapshot.sig);
          }

          let settingsBody = null;
          const settings = collectLocalSettings();
          if (settings) {
            const sig = JSON.stringify(settings);
            const body = JSON.stringify({ settings });
            if (
              sig !== _lastSettingsSig &&
              sig !== _lastFailedSettingsSig &&
              byteSize(body) <= MAX_SETTINGS_SYNC_BYTES
            ) {
              settingsBody = body;
            }
          }

          const plan = planPagehideBeaconBodies({
            documentBody,
            settingsBody,
          });
          const canBeacon =
            typeof navigator !== 'undefined' &&
            typeof navigator.sendBeacon === 'function';

          if (documentBody && !plan.documentFits) {
            console.warn(
              '[persistence] pagehide document exceeds beacon keepalive budget; local recovery remains authoritative',
              { bytes: plan.documentBytes, budgetBytes: PAGEHIDE_BEACON_BUDGET_BYTES }
            );
          } else if (plan.documentBody && canBeacon) {
            const queued = navigator.sendBeacon(
              '/api/documents/current?beacon=1',
              new Blob([plan.documentBody], { type: 'application/json' })
            );
            if (!queued) {
              console.warn('[persistence] pagehide document beacon was not queued');
            }
          }

          if (settingsBody && !plan.settingsFits) {
            console.warn(
              '[persistence] pagehide settings skipped because document/settings exceed shared beacon budget',
              {
                documentBytes: plan.documentFits ? plan.documentBytes : 0,
                settingsBytes: plan.settingsBytes,
                budgetBytes: PAGEHIDE_BEACON_BUDGET_BYTES,
              }
            );
          } else if (plan.settingsBody && canBeacon) {
            const queued = navigator.sendBeacon(
              '/api/settings?beacon=1',
              new Blob([plan.settingsBody], { type: 'application/json' })
            );
            if (!queued) {
              console.warn('[persistence] pagehide settings beacon was not queued');
            }
          }
        } catch (e) { /* best effort */ }
      });
      install.pagehide = true;
    }

    install.attached = true;
  } finally {
    install.attaching = false;
  }
}