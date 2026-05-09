// משה 2026-05-09: 3 אייקונים בכותרת ליד הפרופיל:
//   ✦ כוכב — פרמיום (פותח מסך תשלום)
//   🎁 מתנה — מימוש 20 דק' חינם בחודש
//   🔧 מפתח שוודי — הגדרות (מעביר את "הגדרות" מתוך התפריט הישן)
// סדר ב-RTL: appendChild שם אותם משמאל לפרופיל, כך שהאייקונים יושבים
// בקצה החיצוני של הכותרת והאווטאר נשאר ליד הקצה ביותר.

import { openPremiumPage } from "./premium_page.js";
import { claimMonthlyGift } from "./payment_api.js";
import { showToast } from "./time_warning.js";

const GIFT_LOCAL_KEY = "ravtext.gift.lastClaim";  // YYYY-MM "2026-05"

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isGiftAlreadyClaimed() {
  try {
    return localStorage.getItem(GIFT_LOCAL_KEY) === thisMonth();
  } catch {
    return false;
  }
}

function markGiftClaimedLocally() {
  try { localStorage.setItem(GIFT_LOCAL_KEY, thisMonth()); } catch {}
}

// משה 2026-05-09: פופ-אובר הגדרות. לשונית הריבון "הגדרות" הוסרה (main.js),
// וכל ההגדרות נפתחות מהאייקון מפתח-שוודי כמודאל מרכזי. המקור של תוכן ההגדרות
// (#settings-panel + #settings-panel-wrap) נשאר במקום ב-DOM כדי לשמור על כל
// ה-listeners והקישורים. אנחנו רק מציגים את ההורה שלהם כמודאל בעל position:fixed.

const SETTINGS_OVERLAY_ID = "rt-prem-settings-overlay";
const SETTINGS_HOST_ID = "rt-prem-settings-host";

function openSettings() {
  if (document.getElementById(SETTINGS_OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = SETTINGS_OVERLAY_ID;
  overlay.className = "rt-prem-settings-overlay";
  overlay.dir = "rtl";

  const sheet = document.createElement("div");
  sheet.className = "rt-prem-settings-sheet";

  const header = document.createElement("div");
  header.className = "rt-prem-settings-header";
  header.innerHTML = `
    <div class="rt-prem-settings-title">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      <span>הגדרות מערכת</span>
    </div>
    <button type="button" class="rt-prem-settings-close" aria-label="סגור">✕</button>
  `;
  sheet.appendChild(header);

  const host = document.createElement("div");
  host.id = SETTINGS_HOST_ID;
  host.className = "rt-prem-settings-host";
  sheet.appendChild(host);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.documentElement.classList.add("rt-prem-locked");

  // העברת תוכן ההגדרות (settings-panel + settings-panel-wrap) לתוך ה-host.
  // שומרים מצביע למקום המקורי כדי להחזיר בעת סגירה.
  const wrap = document.getElementById("settings-panel-wrap");
  const panel = document.getElementById("settings-panel");
  const wrapAnchor = wrap ? document.createComment("settings-panel-wrap-anchor") : null;
  const panelAnchor = panel ? document.createComment("settings-panel-anchor") : null;
  if (wrap && wrap.parentNode) {
    wrap.parentNode.insertBefore(wrapAnchor, wrap);
    host.appendChild(wrap);
    wrap.hidden = false;
  }
  if (panel && panel.parentNode) {
    panel.parentNode.insertBefore(panelAnchor, panel);
    host.appendChild(panel);
    panel.hidden = false;
    panel.classList.add("rt-prem-settings-shown");
  }

  function close() {
    // החזרת התוכן למקום המקורי כדי לא לשבור את העץ
    if (panel && panelAnchor && panelAnchor.parentNode) {
      panelAnchor.parentNode.insertBefore(panel, panelAnchor);
      panelAnchor.remove();
      panel.classList.remove("rt-prem-settings-shown");
    }
    if (wrap && wrapAnchor && wrapAnchor.parentNode) {
      wrapAnchor.parentNode.insertBefore(wrap, wrapAnchor);
      wrapAnchor.remove();
    }
    overlay.remove();
    document.documentElement.classList.remove("rt-prem-locked");
    document.removeEventListener("keydown", escHandler);
  }

  function escHandler(e) {
    if (e.key === "Escape") close();
  }
  header.querySelector(".rt-prem-settings-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);
}

function buildIconButton({ id, cls, title, label, html }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.className = `rt-prem-icon-btn ${cls}`;
  btn.title = title;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = html;
  return btn;
}

export function installHeaderPremiumIcons() {
  if (typeof document === "undefined") return;
  if (document.getElementById("rt-prem-icon-diamond")) return;

  const actions = document.querySelector(".app-header .app-header-actions");
  if (!actions) return;

  const auth = window.__RAVTEXT_AUTH__ || { loggedIn: false, paid: false };

  // Wrench (settings) — תמיד מוצג
  const wrench = buildIconButton({
    id: "rt-prem-icon-wrench",
    cls: "rt-prem-icon-wrench",
    title: "הגדרות",
    label: "פתח הגדרות",
    html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  });
  wrench.addEventListener("click", openSettings);

  // Gift — מתנה חודשית
  const gift = buildIconButton({
    id: "rt-prem-icon-gift",
    cls: "rt-prem-icon-gift",
    title: isGiftAlreadyClaimed()
      ? "המתנה החודשית כבר מומשה. תחזור בחודש הבא :)"
      : "מתנה חודשית: 20 דקות שימוש חינם — לחץ למימוש",
    label: "מימוש מתנה חודשית",
    html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
  });
  if (isGiftAlreadyClaimed()) gift.disabled = true;
  gift.addEventListener("click", async () => {
    if (gift.disabled) return;
    if (!auth.loggedIn) {
      showToast({
        kind: "info",
        title: "מתנה חודשית",
        msg: "כדי לממש את המתנה צריך להתחבר עם גוגל.",
        actionText: "התחברות",
        action: () => { window.location.href = "/api/auth/login"; },
      });
      return;
    }
    gift.disabled = true;
    try {
      const res = await claimMonthlyGift();
      if (res && res.granted) {
        markGiftClaimedLocally();
        showToast({
          kind: "info",
          title: "🎁 המתנה התקבלה",
          msg: "20 דקות שימוש חינם נוספו לחשבונך לחודש הזה. נצל בחוכמה!",
          autoCloseMs: 6000,
        });
      } else {
        markGiftClaimedLocally();
        showToast({
          kind: "info",
          title: "כבר מומש החודש",
          msg: "המתנה החודשית כבר נוצלה. תוכל לממש שוב בתחילת החודש הבא.",
          autoCloseMs: 5000,
        });
      }
    } catch (err) {
      gift.disabled = false;
      showToast({
        kind: "danger",
        title: "תקלה זמנית",
        msg: (err && err.message) || "לא הצלחנו להפעיל את המתנה כרגע. נסה שוב בעוד דקה.",
        autoCloseMs: 5000,
      });
    }
  });

  // Premium diamond — יהלום מהבהב מתחלף צבעים
  const diamond = buildIconButton({
    id: "rt-prem-icon-diamond",
    cls: "rt-prem-icon-diamond" + (auth.paid ? " rt-prem-paid" : " rt-prem-shine"),
    title: auth.paid
      ? "המנוי שלך פעיל. לחץ לניהול"
      : "שדרג לפרמיום — שימוש מלא ללא הגבלה",
    label: "פרמיום",
    html: `
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" class="rt-prem-diamond-svg">
        <defs>
          <linearGradient id="rt-prem-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="currentColor" stop-opacity="1"/>
            <stop offset="50%" stop-color="currentColor" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="currentColor" stop-opacity="1"/>
          </linearGradient>
        </defs>
        <path d="M6 3 H18 L22 9 L12 22 L2 9 Z" fill="url(#rt-prem-grad)" stroke="rgba(255,255,255,0.65)" stroke-width="0.6" stroke-linejoin="round"/>
        <path d="M6 3 L9 9 L2 9 Z M18 3 L15 9 L22 9 Z M9 9 L15 9 L12 22 Z M9 9 L12 3 L15 9 Z" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.4)" stroke-width="0.4" stroke-linejoin="round"/>
        <path d="M8 5 L10 8" stroke="rgba(255,255,255,0.85)" stroke-width="0.7" stroke-linecap="round" class="rt-prem-diamond-spark"/>
      </svg>
    `,
  });
  diamond.addEventListener("click", openPremiumPage);

  // סדר הוספה ל-flex-RTL: append מוסיף לשמאל. הסדר הוויזואלי משמאל לימין:
  // [wrench] [gift] [diamond] [avatar]. אנחנו רוצים [avatar] בקצה השמאלי הביותר,
  // שכבר נוסף ע"י installAuthUi לפני הקריאה הזאת. לכן נכניס את 3 האייקונים
  // *לפני* ה-avatar באמצעות insertBefore.
  const avatarWrap = document.getElementById("profile-avatar-wrap");
  const ref = avatarWrap || null;
  if (ref) {
    actions.insertBefore(wrench, ref);
    actions.insertBefore(gift, ref);
    actions.insertBefore(diamond, ref);
  } else {
    actions.appendChild(wrench);
    actions.appendChild(gift);
    actions.appendChild(diamond);
  }

  // אם המנוי פעיל — הצג סרט קטן על האווטאר
  if (auth.paid && avatarWrap) {
    const avatarBtn = avatarWrap.querySelector(".profile-avatar");
    if (avatarBtn && !avatarBtn.querySelector(".rt-prem-active-ribbon")) {
      const ribbon = document.createElement("span");
      ribbon.className = "rt-prem-active-ribbon";
      ribbon.textContent = "מנוי";
      avatarBtn.appendChild(ribbon);
    }
  }
}
