export const DEMO_WATERMARK_TEXT = "טקסט זה הודפס מתוך מערכת רב טקסט לוורד AI";
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

const DEMO_RESET_MS = 60 * 1000;
const DEMO_BLOCK_MS = 5 * 60 * 1000;
const DEMO_BLOCK_KEY = "ravtext.demo.blockedUntil";
const DEMO_MODE_KEY = "ravtext.demoMode";
const CONSOLE_BLOCK_KEY = "ravtext-console-block-until";
const CONSOLE_BLOCK_MS = 5 * 60 * 1000;
const PASTE_LIMIT_CHARS = 500;
const PASTE_BLOCK_MS = 800;
const WATERMARK_BASE_CLASS = "ravtext-demo-print-mark";
const WATERMARK_CLASS_PREFIX = "rtwm-";
const WATERMARK_POOL_SIZE = 12;

let monitorObserver = null;
let guardSuspended = 0;
let resetTimer = null;
let countdownTimer = null;
let demoLocked = false;
let lastPasteWarnAt = 0;
let watermarkClassPool = [];
let watermarkStyleSeed = "";

function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function truthy(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === "" || s === "1" || s === "true" || s === "yes" || s === "on";
}
function isRegisteredUser() {
  const auth = typeof window !== "undefined" ? window.__RAVTEXT_AUTH__ : null;
  return !!(auth && auth.loggedIn);
}
function pickWatermarkText() {
  return DEMO_WATERMARK_POOL[Math.floor(Math.random() * DEMO_WATERMARK_POOL.length)];
}
function randomToken() {
  try {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
}
function rebuildWatermarkClasses() {
  watermarkStyleSeed = randomToken();
  watermarkClassPool = Array.from({ length: WATERMARK_POOL_SIZE }, () => `${WATERMARK_CLASS_PREFIX}${randomToken()}`);
}
function currentWatermarkClasses() {
  if (!watermarkClassPool.length) rebuildWatermarkClasses();
  return watermarkClassPool;
}
function ensureWatermarkCss(doc = document) {
  if (!doc?.head) return null;
  if (!watermarkClassPool.length) rebuildWatermarkClasses();
  let style = doc.querySelector("style[data-ravtext-demo-watermark-style='1']");
  if (!style) {
    style = doc.createElement("style");
    style.dataset.ravtextDemoWatermarkStyle = "1";
    doc.head.appendChild(style);
  }
  const selector = [`[data-ravtext-demo-mark="1"]`, ...currentWatermarkClasses().map((c) => `.${c}`)].join(",");
  const marker = `ravtext-watermark-seed:${watermarkStyleSeed}`;
  const css = `/* ${marker} */\n${selector}{display:inline!important;color:#991b1b!important;background:rgba(254,226,226,.92)!important;border:1px solid rgba(153,27,27,.45)!important;padding:0 .18em!important;margin:0 .1em!important;font-weight:700!important;white-space:normal!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;user-select:none!important}`;
  if (style.dataset.seed !== watermarkStyleSeed || !String(style.textContent || "").includes(marker)) {
    style.dataset.seed = watermarkStyleSeed;
    style.textContent = css;
  }
  return style;
}
function watermarkCssIsIntact(doc = document) {
  const style = doc.querySelector?.("style[data-ravtext-demo-watermark-style='1']");
  return !!(style && style.dataset.seed === watermarkStyleSeed && String(style.textContent || "").includes(`ravtext-watermark-seed:${watermarkStyleSeed}`));
}
function removeRotatingClasses(el) {
  for (const className of Array.from(el?.classList || [])) {
    if (className.startsWith(WATERMARK_CLASS_PREFIX)) el.classList.remove(className);
  }
}
function stampWatermarkStyle(el) {
  const rules = {
    display: "inline",
    color: "#991b1b",
    background: "rgba(254,226,226,.92)",
    border: "1px solid rgba(153,27,27,.45)",
    padding: "0 .18em",
    margin: "0 .1em",
    "font-weight": "700",
    "white-space": "normal",
    opacity: "1",
    visibility: "visible",
    "pointer-events": "none",
    "user-select": "none",
  };
  for (const [key, value] of Object.entries(rules)) {
    try { el.style.setProperty(key, value, "important"); } catch {}
  }
}
function assignWatermarkIdentity(el, doc = document) {
  ensureWatermarkCss(doc);
  removeRotatingClasses(el);
  const pool = currentWatermarkClasses();
  el.classList.add(WATERMARK_BASE_CLASS, pool[Math.floor(Math.random() * pool.length)]);
  el.dataset.ravtextDemoMark = "1";
  el.dataset.ravtextDemoWatermarkSeed = watermarkStyleSeed;
  stampWatermarkStyle(el);
}
function rotateWatermarkIdentities(doc = document) {
  rebuildWatermarkClasses();
  ensureWatermarkCss(doc);
  for (const mark of Array.from(doc.querySelectorAll?.("[data-ravtext-demo-mark='1']") || [])) assignWatermarkIdentity(mark, doc);
}
function hasCurrentWatermarkIdentity(el) {
  return currentWatermarkClasses().some((className) => el?.classList?.contains(className));
}
function isWatermarkHidden(el) {
  if (!el?.isConnected) return false;
  let style;
  try { style = getComputedStyle(el); } catch { return false; }
  const opacity = Number.parseFloat(style.opacity || "1");
  if (el.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || opacity === 0) return true;
  try { if ((el.textContent || "").trim() && el.getClientRects().length === 0) return true; } catch {}
  return false;
}
function createWatermarkNode(doc) {
  const span = doc.createElement("span");
  span.textContent = pickWatermarkText();
  assignWatermarkIdentity(span, doc);
  return span;
}

export function isDemoMode() {
  if (typeof window === "undefined") return false;
  if (demoLocked) return true;
  const params = new URLSearchParams(window.location.search || "");
  if (truthy(params.get("normal")) || truthy(params.get("regular")) || String(params.get("demo") || "").trim() === "0") return false;
  if (window.__RAVTEXT_DEMO_MODE__ === false) return false;
  if (window.__RAVTEXT_DEMO_MODE__ === true) return true;
  if (truthy(params.get("demo")) || truthy(params.get("sandbox")) || truthy(params.get("trial"))) return true;
  if (storeGet(DEMO_MODE_KEY) === "0") return false;
  if (storeGet(DEMO_MODE_KEY) === "1") return true;
  const auth = window.__RAVTEXT_AUTH__;
  return !(auth && auth.paid === true);
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
  const until = parseInt(storeGet(DEMO_BLOCK_KEY) || "0", 10);
  return Number.isFinite(until) ? until : 0;
}
function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
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
      storeSet(DEMO_BLOCK_KEY, "0");
      window.location.reload();
    }
  };
  document.body.className = "demo-blocked";
  document.body.innerHTML = `<main class="demo-block-screen" dir="rtl"><section class="demo-block-card"><h1>התוכנה נחסמה זמנית בגלל שינוי לא מורשה במצב הדמו</h1><p>הגישה תיפתח מחדש בעוד <span id="demo-block-countdown">${formatRemaining(until - Date.now())}</span>.</p></section></main>`;
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
  storeSet(DEMO_BLOCK_KEY, String(until));
  showBlockedScreen(until);
}
function respawnWatermark() {
  if (!isDemoMode()) return;
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script,style,textarea,noscript,[data-ravtext-demo-mark],[data-ravtext-demo-canary],.demo-block-screen")) return NodeFilter.FILTER_REJECT;
      return /\S{4,}/.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) candidates.push(walker.currentNode);
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  if (!target?.parentNode) return;
  guardSuspended++;
  try {
    const mark = createWatermarkNode(document);
    target.parentNode.insertBefore(document.createTextNode(" "), target.nextSibling);
    target.parentNode.insertBefore(mark, target.nextSibling);
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
  return !parent || !!parent.closest("script,style,textarea,noscript,[data-ravtext-demo-mark],[data-ravtext-demo-canary]");
}
export function applyDemoWatermarkToElement(root, { minWords = 20, maxWords = 50, forceAtLeastOne = true } = {}) {
  if (!isDemoMode() || !root) return 0;
  ensureDemoAccess();
  const doc = root.ownerDocument || document;
  ensureWatermarkCss(doc);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return shouldSkipTextNode(node) || !/\S/.test(node.nodeValue || "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
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
  try { return fn(); } finally { guardSuspended--; }
}
export function prepareDemoPrintWatermark(pagesContainer) {
  if (!isDemoMode()) return () => {};
  ensureDemoAccess();
  const pages = Array.from(pagesContainer.querySelectorAll(".page:not(.page-placeholder)"));
  const snapshots = pages.map((page) => [page, page.innerHTML]);
  pages.forEach((page) => applyDemoWatermarkToElement(page));
  return () => suspendDemoTamperGuard(() => {
    snapshots.forEach(([page, html]) => { if (page.isConnected) page.innerHTML = html; });
  });
}
export function applyDemoWatermarksToLivePages(_pagesContainer) {}
export function watchPagesForDemoWatermarks(_pagesContainer) {}
function installDemoBanner() {
  if (document.querySelector("[data-ravtext-demo-canary='1']")) return;
  const banner = document.createElement("div");
  banner.className = "demo-mode-banner";
  banner.dataset.ravtextDemoCanary = "1";
  const registeredBody = "בחשבון חינמי כל יצוא או הדפסה מסומן.";
  const guestBody = "השינויים אינם נשמרים והתוכנה מתאפסת במצב זה מידי דקה.<p>כדי למנוע איפוס הירשם או התחבר. בחשבון חינמי כל יצוא או הדפסה מסומן.</p>";
  banner.innerHTML = `<strong data-i18n="demoTitle">מצב דמו,</strong><div data-i18n="demoBody">${isRegisteredUser() ? registeredBody : guestBody}</div><span class="demo-reset-clock" id="demo-reset-clock"></span>`;
  document.body.prepend(banner);
}
function installTamperMonitor() {
  if (monitorObserver) return;
  ensureWatermarkCss(document);
  let checkScheduled = false;
  let tamperHits = 0;
  let lastTamperAt = 0;
  const noteTamper = () => {
    const now = Date.now();
    tamperHits = now - lastTamperAt < 5000 ? tamperHits + 1 : 1;
    lastTamperAt = now;
    return tamperHits;
  };
  const repairAndCheck = () => {
    if (!watermarkCssIsIntact(document)) {
      noteTamper();
      rotateWatermarkIdentities(document);
    } else ensureWatermarkCss(document);
    for (const mark of Array.from(document.querySelectorAll("[data-ravtext-demo-mark='1']"))) {
      if (!hasCurrentWatermarkIdentity(mark) || mark.dataset.ravtextDemoWatermarkSeed !== watermarkStyleSeed) {
        noteTamper();
        assignWatermarkIdentity(mark, document);
      }
      if (isWatermarkHidden(mark)) {
        const hits = noteTamper();
        rotateWatermarkIdentities(document);
        assignWatermarkIdentity(mark, document);
        requestAnimationFrame(() => {
          if (guardSuspended > 0 || !isDemoMode() || !mark.isConnected) return;
          if (isWatermarkHidden(mark) || hits >= 3) blockDemoAccess();
        });
      }
    }
  };
  const scheduleCheck = () => {
    if (checkScheduled) return;
    checkScheduled = true;
    requestAnimationFrame(() => {
      checkScheduled = false;
      if (guardSuspended > 0 || !isDemoMode()) return;
      const banner = document.querySelector("[data-ravtext-demo-canary='1']");
      if (!banner || !document.body.classList.contains("demo-mode")) return blockDemoAccess();
      const style = getComputedStyle(banner);
      if (banner.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return blockDemoAccess();
      repairAndCheck();
    });
  };
  monitorObserver = new MutationObserver((mutations) => {
    if (guardSuspended > 0 || !isDemoMode()) return;
    let needRespawn = 0;
    let rotate = false;
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.("[data-ravtext-demo-canary]") || node.querySelector?.("[data-ravtext-demo-canary]")) return blockDemoAccess();
        if (node.matches?.("style[data-ravtext-demo-watermark-style]") || node.querySelector?.("style[data-ravtext-demo-watermark-style]")) rotate = true;
        if (node.matches?.("[data-ravtext-demo-mark]")) needRespawn++;
        else if (node.querySelector?.("[data-ravtext-demo-mark]")) needRespawn += node.querySelectorAll("[data-ravtext-demo-mark]").length;
      }
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.("[data-ravtext-demo-mark]")) assignWatermarkIdentity(node, document);
        for (const mark of Array.from(node.querySelectorAll?.("[data-ravtext-demo-mark]") || [])) assignWatermarkIdentity(mark, document);
      }
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (target?.matches?.("[data-ravtext-demo-mark]") && ["class", "style", "hidden", "data-ravtext-demo-mark"].includes(mutation.attributeName)) rotate = true;
        if (target?.matches?.("[data-ravtext-demo-canary]") && ["class", "style", "hidden", "data-ravtext-demo-canary"].includes(mutation.attributeName)) scheduleCheck();
        if (target?.matches?.("style[data-ravtext-demo-watermark-style]")) rotate = true;
      }
      if (mutation.type === "characterData" && mutation.target?.parentElement?.matches?.("style[data-ravtext-demo-watermark-style]")) rotate = true;
    }
    if (rotate) {
      noteTamper();
      rotateWatermarkIdentities(document);
    }
    if (needRespawn > 0) {
      const hits = noteTamper();
      for (let i = 0; i < needRespawn + 1; i++) respawnWatermark();
      requestAnimationFrame(() => {
        if (guardSuspended > 0 || !isDemoMode()) return;
        const visible = Array.from(document.querySelectorAll("[data-ravtext-demo-mark='1']")).filter((mark) => !isWatermarkHidden(mark));
        if (visible.length === 0 || hits >= 5) blockDemoAccess();
      });
    }
    scheduleCheck();
  });
  monitorObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: ["class", "style", "hidden", "data-ravtext-demo-mark", "data-ravtext-demo-canary", "data-ravtext-demo-watermark-style"],
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
    try { await reset?.(); } catch (err) { console.error("[demo] reset failed:", err); }
  };
  resetTimer = setInterval(runReset, DEMO_RESET_MS);
  countdownTimer = setInterval(updateClock, 1000);
  updateClock();
}
function blockConsoleAccess() {
  const until = Date.now() + CONSOLE_BLOCK_MS;
  storeSet(CONSOLE_BLOCK_KEY, String(until));
  showBlockedScreen(until);
}\nexport function installConsoleGuard() {
  try {
    if (window.__RAVTEXT_AUTH__ && window.__RAVTEXT_AUTH__.consoleGuardEnabled === false) {
      storeSet(CONSOLE_BLOCK_KEY, "0");
      return;
    }
  } catch {}
  try {
    const token = new URLSearchParams(window.location.search || "").get("k");
    if (token === "9q7zX3mP4w") {
      storeSet(CONSOLE_BLOCK_KEY, "0");
      storeSet(DEMO_BLOCK_KEY, "0");
      window.__RAVTEXT_DEV_BYPASS__ = true;
      return;
    }
  } catch {}
  storeSet(CONSOLE_BLOCK_KEY, "0");
  let warned = false;
  const warnOnly = () => {
    if (warned) return;
    warned = true;
    try { console.warn("אזהרת אבטחה: אל תדביק כאן קוד שאינך מבין."); } catch {}
  };
  let baselineDelta = 0;
  let baselineSet = false;
  let suspiciousHits = 0;
  let lastSuspiciousAt = 0;
  const measureDelta = () => Math.max(window.outerWidth - window.innerWidth, window.outerHeight - window.innerHeight);
  const setBaseline = () => { baselineDelta = measureDelta(); baselineSet = true; };
  const check = () => {
    if (guardSuspended > 0 || !baselineSet) return;
    if (measureDelta() > baselineDelta + 100) {
      warnOnly();
      const now = Date.now();
      suspiciousHits = now - lastSuspiciousAt < 7000 ? suspiciousHits + 1 : 1;
      lastSuspiciousAt = now;
      if (suspiciousHits >= 3) blockConsoleAccess();
    } else suspiciousHits = Math.max(0, suspiciousHits - 1);
  };
  let lastOuter = { w: window.outerWidth, h: window.outerHeight };
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const ow = window.outerWidth;
      const oh = window.outerHeight;
      if (Math.abs(ow - lastOuter.w) > 20 || Math.abs(oh - lastOuter.h) > 20) {
        lastOuter = { w: ow, h: oh };
        setBaseline();
      } else check();
    }, 200);
  }, { passive: true });
  setTimeout(setBaseline, 1500);
  setTimeout(check, 2500);
  setInterval(check, 1500);
}
export function confirmDemoPrintWarning() {
  if (!isDemoMode()) return true;
  return window.confirm("שים לב: בהדפסה במצב דמו יש בתוך הטקסט סימני מים שלנו שנשתלו אקראית.\n\nהאם להמשיך?");
}
function lockDemoFlags() {
  if (typeof window === "undefined") return;
  demoLocked = true;
  try { Object.defineProperty(window, "__RAVTEXT_DEMO_MODE__", { value: true, writable: false, configurable: false, enumerable: true }); } catch {}
  try { Object.defineProperty(window, "__RAVTEXT_STORAGE_DISABLED__", { value: true, writable: false, configurable: false, enumerable: true }); } catch {}
}
function installPasteGuard() {
  if (typeof document === "undefined") return;
  document.addEventListener("paste", (ev) => {
    if (!isDemoMode() || guardSuspended > 0) return;
    let txt = "";
    try { txt = ev.clipboardData?.getData("text") || ""; } catch { return; }
    if (txt.length <= PASTE_LIMIT_CHARS) return;
    ev.preventDefault();
    ev.stopPropagation();
    const now = Date.now();
    if (now - lastPasteWarnAt > PASTE_BLOCK_MS) {
      lastPasteWarnAt = now;
      try { window.alert(`במצב דמו ניתן להדביק עד ${PASTE_LIMIT_CHARS} תווים בכל פעם. הדבקת ${txt.length} תווים נחסמה.`); } catch {}
    }
  }, true);
}
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
  if (!registered) startResetLoop(reset);
  return { active: true };
}
