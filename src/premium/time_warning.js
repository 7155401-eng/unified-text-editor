// משה 2026-05-09: מנוע ספירת זמן + התראות.
// מתחיל ברגע שהאפליקציה עולה למשתמש מחובר עם מאזן זמן (שעות נרכשות / מנוי).
// 5 דק' לפני הסוף → טוסט אזהרה. 1 דק' לפני הסוף → טוסט אדום.
// בסיום → לוקר מסך עם CTA לעמוד התשלום + מעבר לדמו אם בוחר לסגור.

import { getAccountStatus } from "./payment_api.js";
import { openPremiumPage } from "./premium_page.js";

const POLL_INTERVAL_MS = 60 * 1000; // בדיקת שרת כל דקה
const TICK_INTERVAL_MS = 5 * 1000;  // טיק מקומי כל 5 שניות
const WARN_5MIN_KEY = "ravtext.timewarn.5min";
const WARN_1MIN_KEY = "ravtext.timewarn.1min";

let _expiresAtMs = null;        // זמן פקיעת חשבון (ms epoch)
let _planType = null;            // "subscription" | "hours" | null
let _balanceSeconds = 0;         // יתרת שעות נטו (שניות)
let _tickHandle = null;
let _pollHandle = null;
let _warned5 = false;
let _warned1 = false;
let _expiredHandled = false;
const _timerListeners = new Set();

function notifyTimerListeners() {
  const snap = getTimerSnapshot();
  for (const fn of _timerListeners) {
    try { fn(snap); } catch {}
  }
}

export function getTimerSnapshot() {
  if (!_expiresAtMs) {
    return { active: false, planType: _planType, remainMs: 0, balanceSeconds: _balanceSeconds };
  }
  const remainMs = Math.max(0, _expiresAtMs - Date.now());
  return {
    active: true,
    planType: _planType,
    remainMs,
    balanceSeconds: _balanceSeconds,
    expiresAtMs: _expiresAtMs,
  };
}

export function onTimerUpdate(fn) {
  _timerListeners.add(fn);
  // מסר ראשוני מיידי
  try { fn(getTimerSnapshot()); } catch {}
  return () => _timerListeners.delete(fn);
}

function ensureToastStack() {
  let stack = document.getElementById("rt-toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "rt-toast-stack";
    stack.className = "rt-toast-stack";
    stack.dir = "rtl";
    document.body.appendChild(stack);
  }
  return stack;
}

export function showToast({ kind = "info", title, msg, actionText, action, secondaryText, secondaryAction, autoCloseMs = 0 }) {
  const stack = ensureToastStack();
  const toast = document.createElement("div");
  toast.className = `rt-toast rt-toast-${kind}`;
  toast.dir = "rtl";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "rt-toast-close";
  close.setAttribute("aria-label", "סגור");
  close.innerHTML = "✕";
  toast.appendChild(close);

  if (title) {
    const t = document.createElement("div");
    t.className = "rt-toast-title";
    t.textContent = title;
    toast.appendChild(t);
  }
  if (msg) {
    const m = document.createElement("div");
    m.className = "rt-toast-msg";
    m.textContent = msg;
    toast.appendChild(m);
  }

  if (actionText || secondaryText) {
    const actions = document.createElement("div");
    actions.className = "rt-toast-actions";
    if (secondaryText) {
      const sb = document.createElement("button");
      sb.type = "button";
      sb.className = "rt-toast-btn rt-toast-btn-secondary";
      sb.textContent = secondaryText;
      sb.addEventListener("click", () => { try { secondaryAction && secondaryAction(); } finally { toast.remove(); } });
      actions.appendChild(sb);
    }
    if (actionText) {
      const ab = document.createElement("button");
      ab.type = "button";
      ab.className = "rt-toast-btn";
      ab.textContent = actionText;
      ab.addEventListener("click", () => { try { action && action(); } finally { toast.remove(); } });
      actions.appendChild(ab);
    }
    toast.appendChild(actions);
  }

  close.addEventListener("click", () => toast.remove());
  stack.appendChild(toast);

  if (autoCloseMs > 0) {
    setTimeout(() => { try { toast.remove(); } catch {} }, autoCloseMs);
  }
  return toast;
}

function showLockScreen() {
  if (document.getElementById("rt-prem-demo-lock")) return;
  const lock = document.createElement("div");
  lock.id = "rt-prem-demo-lock";
  lock.className = "rt-prem-demo-lock";
  lock.dir = "rtl";
  lock.innerHTML = `
    <div class="rt-prem-demo-lock-card">
      <div class="rt-prem-demo-lock-icon">⏰</div>
      <div class="rt-prem-demo-lock-title">הזמן בחשבונך הסתיים</div>
      <div class="rt-prem-demo-lock-msg">
        אנא הטען את יתרתך כדי להמשיך לעבוד עם הכלים המלאים. עד אז העורך
        חוזר למצב דמו עם סימני מים. הקבצים שלך מאוחסנים ויחזרו ברגע שתחדש.
      </div>
      <button type="button" class="rt-prem-demo-lock-cta" id="rt-prem-demo-lock-cta">לעמוד התשלום</button>
      <div style="margin-top:12px"><button type="button" id="rt-prem-demo-lock-back" style="background:transparent;color:#cbd5e1;border:0;font-size:13px;cursor:pointer;">חזרה למצב דמו</button></div>
    </div>
  `;
  document.body.appendChild(lock);
  document.getElementById("rt-prem-demo-lock-cta")?.addEventListener("click", () => {
    lock.remove();
    openPremiumPage();
  });
  document.getElementById("rt-prem-demo-lock-back")?.addEventListener("click", () => {
    lock.remove();
    forceDemoMode();
  });
}

function forceDemoMode() {
  // המשתמש בחר לחזור לדמו אף שהוא מחובר. נדליק את הדגל המקומי כפי שעשה demo_mode.js
  try { localStorage.setItem("ravtext.demoMode", "1"); } catch {}
  if (typeof window !== "undefined") {
    window.__RAVTEXT_DEMO_MODE__ = true;
    // השער ב-demo_mode.js נעול לאחר הפעלה ראשונה (_demoLocked) — דורש refresh
    setTimeout(() => location.reload(), 300);
  }
}

function tick() {
  if (!_expiresAtMs) { notifyTimerListeners(); return; }
  const now = Date.now();
  const remainMs = _expiresAtMs - now;
  notifyTimerListeners();

  if (remainMs <= 0) {
    if (_expiredHandled) return;
    _expiredHandled = true;
    showLockScreen();
    return;
  }

  if (remainMs <= 60 * 1000 && !_warned1) {
    _warned1 = true;
    sessionStorage.setItem(WARN_1MIN_KEY, "1");
    showToast({
      kind: "danger",
      title: "⏰ נותרה דקה",
      msg: "בעוד דקה הזמן בחשבונך נגמר ולא תהיה לך גישה למסמכים. הטען עכשיו את יתרתך או גבה את המסמכים שלך.",
      actionText: "הטענת יתרה",
      action: openPremiumPage,
      secondaryText: "אזכיר אחר כך",
    });
  } else if (remainMs <= 5 * 60 * 1000 && !_warned5) {
    _warned5 = true;
    sessionStorage.setItem(WARN_5MIN_KEY, "1");
    const minutes = Math.ceil(remainMs / 60000);
    showToast({
      kind: "warn",
      title: `נותרו ${minutes} דקות`,
      msg: "בעוד מעט הזמן בחשבונך נגמר ולא תהיה לך גישה למסמכים. הטען את יתרתך או גבה את המסמכים שלך.",
      actionText: "הטענת יתרה",
      action: openPremiumPage,
      secondaryText: "אזכיר אחר כך",
    });
  }
}

async function poll() {
  try {
    const status = await getAccountStatus();
    if (!status) return;
    // status: { planType: "subscription"|"hours"|null, expiresAt: ms epoch | null, paid: bool }
    _planType = status.planType || null;
    _balanceSeconds = Number(status.balanceSeconds) || 0;
    if (status.expiresAt && Number.isFinite(status.expiresAt)) {
      _expiresAtMs = status.expiresAt;
      // אם השרת חידש לטווח רחוק → איפוס דגלי אזהרה
      if (_expiresAtMs - Date.now() > 6 * 60 * 1000) {
        _warned5 = false;
        _warned1 = false;
        _expiredHandled = false;
        sessionStorage.removeItem(WARN_5MIN_KEY);
        sessionStorage.removeItem(WARN_1MIN_KEY);
      }
    } else {
      _expiresAtMs = null;
    }
    notifyTimerListeners();
  } catch {}
}

export function startTimeWarningEngine() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const auth = window.__RAVTEXT_AUTH__;
  if (!auth || !auth.loggedIn) return;
  // משאבי השרת יחליטו אם המשתמש על מנוי תקין/שעות נטענות; ללא יתרה — לא נריץ ספירה.

  // restore session warning flags so we don't double-warn after refresh
  if (sessionStorage.getItem(WARN_5MIN_KEY) === "1") _warned5 = true;
  if (sessionStorage.getItem(WARN_1MIN_KEY) === "1") _warned1 = true;

  poll().then(() => {
    if (_tickHandle) clearInterval(_tickHandle);
    if (_pollHandle) clearInterval(_pollHandle);
    _tickHandle = setInterval(tick, TICK_INTERVAL_MS);
    _pollHandle = setInterval(poll, POLL_INTERVAL_MS);
    tick();
  });
}

export function stopTimeWarningEngine() {
  if (_tickHandle) { clearInterval(_tickHandle); _tickHandle = null; }
  if (_pollHandle) { clearInterval(_pollHandle); _pollHandle = null; }
}
