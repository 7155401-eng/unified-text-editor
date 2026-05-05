export const DEMO_WATERMARK_TEXT = "טקסט זה הודפס מתוך מערכת רב טקסט לוורד AI";

const DEMO_RESET_MS = 3 * 60 * 1000;
const DEMO_BLOCK_MS = 5 * 60 * 1000;
const DEMO_BLOCK_KEY = "ravtext.demo.blockedUntil";
const DEMO_MODE_KEY = "ravtext.demoMode";

let monitorObserver = null;
let guardSuspended = 0;
let resetTimer = null;
let countdownTimer = null;

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

export function isDemoMode() {
  if (typeof window === "undefined") return false;
  if (window.__RAVTEXT_DEMO_MODE__ === true) return true;
  const params = new URLSearchParams(window.location.search || "");
  if (isTruthyModeValue(params.get("demo")) || isTruthyModeValue(params.get("sandbox")) || isTruthyModeValue(params.get("trial"))) {
    return true;
  }
  return safeStorageGet(DEMO_MODE_KEY) === "1";
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
  span.textContent = DEMO_WATERMARK_TEXT;
  return span;
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

function installDemoBanner() {
  if (document.querySelector("[data-ravtext-demo-canary='1']")) return;
  const banner = document.createElement("div");
  banner.className = "demo-mode-banner";
  banner.dataset.ravtextDemoCanary = "1";
  banner.innerHTML = `
    <strong>מצב משתמש ניסיוני</strong>
    <span>השינויים אינם נשמרים. הדמו מתאפס כל 3 דקות, וכל יצוא או הדפסה מסומן.</span>
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
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.("[data-ravtext-demo-mark],[data-ravtext-demo-canary]") || node.querySelector?.("[data-ravtext-demo-mark],[data-ravtext-demo-canary]")) {
          blockDemoAccess();
          return;
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

export function setupDemoMode({ paneManager, reset } = {}) {
  if (!isDemoMode()) return { active: false };
  configureDemoGlobals();
  const until = demoBlockUntil();
  if (until > Date.now()) {
    showBlockedScreen(until);
    return { active: true, blocked: true };
  }
  document.body.classList.add("demo-mode");
  paneManager?.clearStorage?.();
  installDemoBanner();
  installTamperMonitor();
  startResetLoop(reset);
  return { active: true };
}
