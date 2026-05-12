export const DEMO_WATERMARK_TEXT = "טקסט זה הודפס מתוך מערכת רב טקסט לוורד AI";

// v33: pool of varied watermark phrasings — too many to find/replace away.
// On removal, a new mark spawns elsewhere using a DIFFERENT phrasing.
export const DEMO_WATERMARK_POOL = [
  "טקסט זה הודפס מתוך מערכת רב טקסט לוורד AI",
  "הופק במצב דמו במערכת רב טקסט לוורד AI",
  "מסמך לדוגמה — מערכת רב טקסט לוורד AI",
  "תוצר בדיקה במערכת רב טקסט לוורד AI",
  "טיוטת דמו — רב טקסט לוורד AI",
  "תצוגה מקדימה — רב טקסט לוורד AI",
  "גרסת ניסיון — רב טקסט לוורד AI",
  "RavText AI — מצב הדגמה",
  "הודפס בגרסת דמו של רב טקסט לוורד AI",
  "מצב דמו פעיל — רב טקסט לוורד AI",
  "אין להפיץ — מצב דמו במערכת רב טקסט",
  "תוצר ניסיוני — רב טקסט AI",
  "RavText AI — Demo Print",
  "RavText AI — Trial Mode",
  "RavText — Hebrew Word Engine, Demo",
  "פלט דמו — מערכת רב טקסט AI",
  "הדגמה בלבד — לא לשימוש מסחרי",
  "תוצר תצוגה — רב טקסט לוורד",
  "מסמך זה הודפס בגרסת דמו (RavText)",
  "סימן מים — מערכת רב טקסט AI",
];

function pickWatermarkText() {
  return DEMO_WATERMARK_POOL[Math.floor(Math.random() * DEMO_WATERMARK_POOL.length)];
}

const DEMO_RESET_MS = 1 * 60 * 1000;
const DEMO_BLOCK_MS = 5 * 60 * 1000;
const DEMO_BLOCK_KEY = "ravtext.demo.blockedUntil";
const DEMO_MODE_KEY = "ravtext.demoMode";

let monitorObserver = null;
let guardSuspended = 0;
let resetTimer = null;
let countdownTimer = null;
// משה 2026-05-06 (task #13): once demo is active, lock the flag so console
// tricks like `window.__RAVTEXT_DEMO_MODE__ = false` or
// `localStorage.setItem("ravtext.demoMode","0")` cannot turn it off mid-session.
let _demoLocked = false;
const PASTE_LIMIT_CHARS = 500;
const PASTE_BLOCK_MS = 800;
let _lastPasteWarnAt = 0;

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function isTruthyModeValue(value) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "" || normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isRegisteredUser() {
  const auth = typeof window !== "undefined" ? window.__RAVTEXT_AUTH__ : null;
  return !!(auth && auth.loggedIn);
}

export function isDemoMode() {
  if (typeof window === "undefined") return false;
  if (_demoLocked) return true;

  const params = new URLSearchParams(window.location.search || "");

  const explicitNormal =
    isTruthyModeValue(params.get("normal")) ||
    isTruthyModeValue(params.get("regular")) ||
    String(params.get("demo") || "").trim() === "0";

  if (explicitNormal) return false;

  if (window.__RAVTEXT_DEMO_MODE__ === false) return false;
  if (window.__RAVTEXT_DEMO_MODE__ === true) return true;

  if (
    isTruthyModeValue(params.get("demo")) ||
    isTruthyModeValue(params.get("sandbox")) ||
    isTruthyModeValue(params.get("trial"))
  ) {
    return true;
  }

  if (safeStorageGet(DEMO_MODE_KEY) === "0") return false;
  if (safeStorageGet(DEMO_MODE_KEY) === "1") return true;

  // משה 2026-05-08: ברירת המחדל = דמו דלוק (סימני מים) לכולם, *חוץ* ממנויים
  // משלמים. אם השרת הזריק window.__RAVTEXT_AUTH__ עם paid=true — ביטול דמו.
  // משתמש לא-מחובר או מחובר-לא-משלם → דמו עם סימני מים. (משה: "רק
  // למשתמשים בתשלום לבטל סימן מים".)
  const auth = window.__RAVTEXT_AUTH__;
  if (auth && auth.paid === true) return false;
  return true;
}

export function configureDemoGlobals() {
  const active = isDemoMode();
  if (active && typeof window !== "undefined") {
    window.__RAVTEXT_DEMO_MODE__ = true;
    window.__RAVTEXT_STORAGE_DISABLED__ = true;
  }
  return active;
}

function demoBlockUntil() {
  const until = parseInt(safeStorageGet(DEMO_BLOCK_KEY) || "0", 10);
  return Number.isFinite(until) ? until : 0;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function showBlockedScreen(until) {
  if (monitorObserver) {
    monitorObserver.disconnect();
    monitorObserver = null;
  }
  const render = () => {
    const remaining = Math.max(0, until - Date.now());
    const timer = document.getElementById("demo-block-countdown");
    if (timer) timer.textContent = formatRemaining(remaining);
    if (remaining <= 0) {
      safeStorageSet(DEMO_BLOCK_KEY, "0");
      window.location.reload();
    }
  };

  document.body.className = "demo-blocked";
  document.body.innerHTML = `
    <main class="demo-block-screen" dir="rtl">
      <section class="demo-block-card">
        <h1>נראה שניסית לפרוץ את המערכת, המערכת נחסמה לחמש דקות</h1>
        <p>הגישה תיפתח מחדש בעוד <span id="demo-block-countdown">${formatRemaining(until - Date.now())}</span>.</p>
      </section>
    </main>
  `;
  render();
  setInterval(render, 1000);
}

export function ensureDemoAccess() {
  if (!isDemoMode()) return true;
  const until = demoBlockUntil();
  if (until > Date.now()) {
    showBlockedScreen(until);
    throw new Error("מצב הדמו חסום זמנית");
  }
  return true;
}

export function blockDemoAccess() {
  if (!isDemoMode()) return;
  const until = Date.now() + DEMO_BLOCK_MS;
  safeStorageSet(DEMO_BLOCK_KEY, String(until));
  showBlockedScreen(until);
}

function createWatermarkNode(doc) {
  const span = doc.createElement("span");
  span.className = "ravtext-demo-print-mark";
  span.dataset.ravtextDemoMark = "1";
  span.textContent = pickWatermarkText();
  return span;
}

// v33: respawn a removed watermark elsewhere with a different phrasing.
// Picks a random visible text node in the body to attach to.
function respawnWatermark() {
  if (!isDemoMode()) return;
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script,style,textarea,noscript,[data-ravtext-demo-mark],[data-ravtext-demo-canary],.demo-banner,.demo-block-screen")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!/\S{4,}/.test(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) candidates.push(walker.currentNode);
  if (candidates.length === 0) return;
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  guardSuspended++;
  try {
    const mark = createWatermarkNode(document);
    const parent = target.parentNode;
    if (!parent) return;
    parent.insertBefore(mark, target.nextSibling);
    parent.insertBefore(document.createTextNode(" "), mark);
  } finally {
    setTimeout(() => { guardSuspended--; }, 50);
  }
}

function nextWatermarkInterval(minWords, maxWords) {
  const min = Math.max(1, minWords);
  const max = Math.max(min, maxWords);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return !!parent.closest("script,style,textarea,noscript,[data-ravtext-demo-mark],[data-ravtext-demo-canary]");
}

export function applyDemoWatermarkToElement(root, { minWords = 20, maxWords = 50, forceAtLeastOne = true } = {}) {
  if (!isDemoMode() || !root) return 0;
  ensureDemoAccess();

  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipTextNode(node) || !/\S/.test(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  let inserted = 0;
  let totalWords = 0;
  let wordsSinceMark = 0;
  let wordsUntilMark = nextWatermarkInterval(minWords, maxWords);

  for (const node of textNodes) {
    if (!node.isConnected || shouldSkipTextNode(node)) continue;
    const parts = String(node.nodeValue || "").match(/\s+|\S+/g) || [];
    const frag = doc.createDocumentFragment();
    let changed = false;

    for (const part of parts) {
      frag.appendChild(doc.createTextNode(part));
      if (!/\S/.test(part)) continue;
      totalWords++;
      wordsSinceMark++;
      if (wordsSinceMark >= wordsUntilMark) {
        frag.appendChild(doc.createTextNode(" "));
        frag.appendChild(createWatermarkNode(doc));
        frag.appendChild(doc.createTextNode(" "));
        inserted++;
        changed = true;
        wordsSinceMark = 0;
        wordsUntilMark = nextWatermarkInterval(minWords, maxWords);
      }
    }

    if (changed) node.replaceWith(frag);
  }

  if (forceAtLeastOne && inserted === 0 && totalWords > 0) {
    const target = textNodes.find((node) => node.isConnected && !shouldSkipTextNode(node) && /\S/.test(node.nodeValue || ""));
    if (target) {
      const frag = doc.createDocumentFragment();
      frag.appendChild(doc.createTextNode(target.nodeValue || ""));
      frag.appendChild(doc.createTextNode(" "));
      frag.appendChild(createWatermarkNode(doc));
      target.replaceWith(frag);
      inserted++;
    }
  }

  return inserted;
}

export function applyDemoWatermarkToHtml(html) {
  if (!isDemoMode() || !html) return html;
  ensureDemoAccess();
  const template = document.createElement("template");
  template.innerHTML = html;
  applyDemoWatermarkToElement(template.content);
  return template.innerHTML;
}

export function suspendDemoTamperGuard(fn) {
  guardSuspended++;
  try {
    return fn();
  } finally {
    guardSuspended--;
  }
}

export function prepareDemoPrintWatermark(pagesContainer) {
  if (!isDemoMode()) return () => {};
  ensureDemoAccess();
  const pages = Array.from(pagesContainer.querySelectorAll(".page:not(.page-placeholder)"));
  const snapshots = pages.map((page) => [page, page.innerHTML]);
  pages.forEach((page) => applyDemoWatermarkToElement(page));
  return () => suspendDemoTamperGuard(() => {
    snapshots.forEach(([page, html]) => {
      if (page.isConnected) page.innerHTML = html;
    });
  });
}

// v33: live-screen watermark functions kept as no-op exports for compat —
// per Moshe 2026-05-06: watermarks must be in source content (engine_bridge
// injection), not added post-render to DOM. Post-render breaks pagination
// and creates overlapping red-bordered spans on top of regular text.
export function applyDemoWatermarksToLivePages(_pagesContainer) { /* noop */ }
export function watchPagesForDemoWatermarks(_pagesContainer) { /* noop */ }

function installDemoBanner() {
  if (document.querySelector("[data-ravtext-demo-canary='1']")) return;
  const banner = document.createElement("div");
  banner.className = "demo-mode-banner";
  banner.dataset.ravtextDemoCanary = "1";
  const registeredBody = "בחשבון חינמי כל יצוא או הדפסה מסומן.";
  const guestBody = "השינויים אינם נשמרים והתוכנה מתאפסת במצב זה מידי דקה.<p>כדי למנוע איפוס הירשם או התחבר. בחשבון חינמי כל יצוא או הדפסה מסומן.</p>";
  banner.innerHTML = `
    <strong data-i18n="demoTitle">מצב דמו,</strong>
    <div data-i18n="demoBody">${isRegisteredUser() ? registeredBody : guestBody}</div>
    <span class="demo-reset-clock" id="demo-reset-clock"></span>
  `;
  document.body.prepend(banner);
}

function installTamperMonitor() {
  if (monitorObserver) return;
  let checkScheduled = false;
  const scheduleCheck = () => {
    if (checkScheduled) return;
    checkScheduled = true;
    requestAnimationFrame(() => {
      checkScheduled = false;
      if (guardSuspended > 0 || !isDemoMode()) return;
      const banner = document.querySelector("[data-ravtext-demo-canary='1']");
      if (!banner || !document.body.classList.contains("demo-mode")) {
        blockDemoAccess();
        return;
      }
      const style = getComputedStyle(banner);
      if (banner.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        blockDemoAccess();
      }
    });
  };

  monitorObserver = new MutationObserver((mutations) => {
    if (guardSuspended > 0 || !isDemoMode()) return;
    let needRespawn = 0;
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Canary banner removed → still block (cannot be tampered).
        if (node.matches?.("[data-ravtext-demo-canary]") || node.querySelector?.("[data-ravtext-demo-canary]")) {
          blockDemoAccess();
          return;
        }
        // Watermark removed → respawn with different phrasing elsewhere.
        if (node.matches?.("[data-ravtext-demo-mark]")) {
          needRespawn++;
        } else if (node.querySelector?.("[data-ravtext-demo-mark]")) {
          needRespawn += node.querySelectorAll("[data-ravtext-demo-mark]").length;
        }
      }
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (
          target?.matches?.("[data-ravtext-demo-mark],[data-ravtext-demo-canary]") &&
          ["class", "style", "hidden", "data-ravtext-demo-mark", "data-ravtext-demo-canary"].includes(mutation.attributeName)
        ) {
          scheduleCheck();
        }
      }
    }
    if (needRespawn > 0) {
      // Spawn one extra for stubbornness so deletion costs you more.
      const spawnCount = needRespawn + 1;
      for (let i = 0; i < spawnCount; i++) respawnWatermark();
    }
    scheduleCheck();
  });

  monitorObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "data-ravtext-demo-mark", "data-ravtext-demo-canary"],
  });
  scheduleCheck();
}

function startResetLoop(reset) {
  if (resetTimer) clearInterval(resetTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  let nextResetAt = Date.now() + DEMO_RESET_MS;
  const updateClock = () => {
    const clock = document.getElementById("demo-reset-clock");
    if (clock) clock.textContent = `איפוס בעוד ${formatRemaining(nextResetAt - Date.now())}`;
  };

  const runReset = async () => {
    nextResetAt = Date.now() + DEMO_RESET_MS;
    updateClock();
    try {
      await reset?.();
    } catch (err) {
      console.error("[demo] reset failed:", err);
    }
  };

  resetTimer = setInterval(runReset, DEMO_RESET_MS);
  countdownTimer = setInterval(updateClock, 1000);
  updateClock();
}

// v33: detect open devtools (estimate via window dimensions delta).
// When devtools open → instant block. Active in BOTH demo and non-demo
// modes per Moshe's request 2026-05-06.
const CONSOLE_BLOCK_KEY = "ravtext-console-block-until";
const CONSOLE_BLOCK_MS = 5 * 60 * 1000;

function blockConsoleAccess() {
  const until = Date.now() + CONSOLE_BLOCK_MS;
  // משה 2026-05-07: שומרים את החסימה ב-localStorage כדי שrefresh לא יבריח
  // את החסימה. (התיקון הקודם הסיר את ההתמדה — אבל זה איפשר לעקוף ע"י reload.)
  // בעיית false-positive נפתרת עכשיו ע"י זיהוי baseline-delta, לא ע"י הקלה.
  safeStorageSet(CONSOLE_BLOCK_KEY, String(until));
  showBlockedScreen(until);
}

export function installConsoleGuard() {
  // משה 2026-05-10: דגל ניהולי גלובלי. ב-/admin אפשר לכבות את כל המגן
  // (consoleGuardEnabled=false). השרת מזריק את הדגל לתוך window.__RAVTEXT_AUTH__
  // לפני שה-JS עולה, כך שהבדיקה כאן אמינה ברגע הטעינה.
  // אם המגן כבוי — מנקים גם חסימה שנשארה מסשנים קודמים (אחרת המשתמש
  // ייתקע במסך הירוק עד שתפוג החסימה הישנה).
  try {
    if (window.__RAVTEXT_AUTH__ && window.__RAVTEXT_AUTH__.consoleGuardEnabled === false) {
      safeStorageSet(CONSOLE_BLOCK_KEY, "0");
      return;
    }
  } catch (_) {}

  // משה 2026-05-06: טוקן סודי בכתובת מבטל את חוסם הקונסול. קשה לנחש.
  try {
    const params = new URLSearchParams(window.location.search || "");
    const token = params.get("k");
    if (token === "9q7zX3mP4w") {
      safeStorageSet(CONSOLE_BLOCK_KEY, "0");
      safeStorageSet(DEMO_BLOCK_KEY, "0");
      window.__RAVTEXT_DEV_BYPASS__ = true;
      return;
    }
  } catch (_) {}

  safeStorageSet(CONSOLE_BLOCK_KEY, "0");
  let warned = false;
  const warnOnly = () => {
    if (warned) return;
    warned = true;
    try {
      console.warn("אזהרת אבטחה: אל תדביק כאן קוד שאינך מבין. צוות רב טקסט לא יבקש ממך להריץ פקודות בקונסול.");
    } catch (_) {}
  };

  // משה 2026-05-07: זיהוי devtools חכם — לא ע"י סף קבוע (שגרם ל-false-positives
  // עם בר-סימניות / DPI גבוה / ולעקיפה כשהסף הוגדל יותר מדי), אלא ע"י השוואה
  // ל-baseline שנמדד בטעינה.
  // מהלך:
  //   1. אחרי 1.5 שניות — מודדים את ה-delta הנוכחי (outer-inner) כ-baseline.
  //      זה תופס את ה-chrome הרגיל של הדפדפן (URL bar, tabs, bookmarks).
  //   2. בכל בדיקה — אם ה-delta הנוכחי גדול מ-baseline + 100 → devtools נפתחו.
  //   3. הסף 100 הוא יותר מאיפיון של resize רגיל אבל פחות מ-devtools panel.
  //
  // מקרי קצה:
  //   - משתמש שטוען עם devtools כבר פתוחים → baseline כולל את ה-devtools,
  //     לא יחסם. זה לא אידיאלי אבל זה התסריט פחות סביר (רוב פתיחות
  //     ה-devtools קורות אחרי הטעינה).
  //   - שינוי גודל חלון בכוונה → גורם לעדכון baseline (ראה onResize).
  let baselineDelta = 0;
  let baselineSet = false;
  const ABOVE_BASELINE = 100;

  const measureDelta = () => Math.max(
    window.outerWidth - window.innerWidth,
    window.outerHeight - window.innerHeight
  );

  const setBaseline = () => {
    baselineDelta = measureDelta();
    baselineSet = true;
  };

  const check = () => {
    if (guardSuspended > 0 || !baselineSet) return;
    const current = measureDelta();
    if (current > baselineDelta + ABOVE_BASELINE) {
      warnOnly();
    }
  };

  // עדכון baseline על שינוי-גודל אמיתי של חלון (debounced) — מבדילים בין
  // resize של המשתמש (שמותר) לפתיחת devtools (שאסור): resize משנה גם את
  // outerWidth/Height, devtools משנה רק את inner.
  let lastOuter = { w: window.outerWidth, h: window.outerHeight };
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const ow = window.outerWidth;
      const oh = window.outerHeight;
      if (Math.abs(ow - lastOuter.w) > 20 || Math.abs(oh - lastOuter.h) > 20) {
        // outer השתנה ממשית → resize אמיתי של חלון → לקבוע baseline חדש
        lastOuter = { w: ow, h: oh };
        setBaseline();
      } else {
        // outer לא השתנה משמעותית, רק inner → devtools פתחו/נסגרו
        check();
      }
    }, 200);
  }, { passive: true });

  // baseline נמדד אחרי 1.5 שניות — לאפשר ל-chrome של הדפדפן להתייצב
  setTimeout(setBaseline, 1500);
  // בדיקה ראשונה אחרי שנקבע baseline + עוד שנייה
  setTimeout(check, 2500);
  // בדיקה תקופתית לתפוס פתיחת devtools בלי resize event
  setInterval(check, 1500);
}

// v33: warn before demo print/download. Returns true if user confirmed.
export function confirmDemoPrintWarning() {
  if (!isDemoMode()) return true;
  return window.confirm(
    "שים לב: בהדפסה במצב דמו יש בתוך הטקסט סימני מים שלנו שנשתלו אקראית.\n\n" +
    "האם להמשיך?"
  );
}

function lockDemoFlags() {
  if (typeof window === "undefined") return;
  _demoLocked = true;
  // Lock the global so console writes silently fail. Use defineProperty
  // with writable:false; subsequent assignments throw in strict mode and
  // are no-ops in sloppy mode (the script harness loads as module = strict).
  try {
    Object.defineProperty(window, "__RAVTEXT_DEMO_MODE__", {
      value: true, writable: false, configurable: false, enumerable: true,
    });
  } catch (_) { /* property may already be defined; isDemoMode still returns true via _demoLocked */ }
  try {
    Object.defineProperty(window, "__RAVTEXT_STORAGE_DISABLED__", {
      value: true, writable: false, configurable: false, enumerable: true,
    });
  } catch (_) {}
}

function installPasteGuard() {
  // Block big pastes — common bypass: paste an entire book to render free.
  if (typeof document === "undefined") return;
  document.addEventListener("paste", (ev) => {
    if (!isDemoMode() || guardSuspended > 0) return;
    let txt = "";
    try { txt = ev.clipboardData?.getData("text") || ""; } catch (_) { return; }
    if (txt.length <= PASTE_LIMIT_CHARS) return;
    ev.preventDefault();
    ev.stopPropagation();
    const now = Date.now();
    if (now - _lastPasteWarnAt > PASTE_BLOCK_MS) {
      _lastPasteWarnAt = now;
      try {
        window.alert(`במצב דמו ניתן להדביק עד ${PASTE_LIMIT_CHARS} תווים בכל פעם. הדבקת ${txt.length} תווים נחסמה.`);
      } catch (_) {}
    }
  }, true);
}

// משה 2026-05-06 (task #13): hooks window.print so that an unconfirmed
// print in demo mode is aborted entirely rather than producing un-watermarked
// output. confirmDemoPrintWarning is also still exported for callers that
// trigger their own print pipelines.
function installPrintGuard() {
  if (typeof window === "undefined" || typeof window.print !== "function") return;
  const origPrint = window.print.bind(window);
  window.print = function guardedPrint(...args) {
    if (isDemoMode() && !confirmDemoPrintWarning()) return;
    return origPrint(...args);
  };
}

export function setupDemoMode({ paneManager, reset } = {}) {
  if (!isDemoMode()) return { active: false };
  if (typeof window !== "undefined" && window.__RAVTEXT_DEV_BYPASS__) return { active: false };
  configureDemoGlobals();
  const until = demoBlockUntil();
  if (until > Date.now()) {
    showBlockedScreen(until);
    return { active: true, blocked: true };
  }
  document.body.classList.add("demo-mode");
  const registered = isRegisteredUser();
  if (!registered) paneManager?.clearStorage?.();
  installDemoBanner();
  installTamperMonitor();
  installPasteGuard();
  installPrintGuard();
  lockDemoFlags();
  // installConsoleGuard now called from main.js for all modes.
  if (!registered) startResetLoop(reset);
  return { active: true };
}
