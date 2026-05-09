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

function openSettings() {
  // Settings is rendered as a ribbon-tab (data-ribbon-tab="settings").
  // Try to switch the ribbon to "settings"; if no ribbon system answers,
  // scroll the panel into view as a fallback.
  const tab = document.querySelector('[data-ribbon-tab-trigger="settings"], [data-tab-target="settings"]');
  if (tab && typeof tab.click === "function") {
    tab.click();
  }
  const panel = document.getElementById("settings-panel-wrap");
  if (panel) {
    panel.hidden = false;
    panel.classList.add("rt-prem-settings-active");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    // last-resort: dispatch a custom event other modules can listen to
    document.dispatchEvent(new CustomEvent("ravtext:open-settings"));
  }
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
  if (document.getElementById("rt-prem-icon-star")) return;

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

  // Premium star — מרכז העניין
  const star = buildIconButton({
    id: "rt-prem-icon-star",
    cls: "rt-prem-icon-star" + (auth.paid ? "" : " rt-prem-pulse"),
    title: auth.paid
      ? "המנוי שלך פעיל. לחץ לניהול"
      : "שדרג לפרמיום — שימוש מלא ללא הגבלה",
    label: "פרמיום",
    html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  });
  star.addEventListener("click", openPremiumPage);

  // סדר הוספה ל-flex-RTL: append מוסיף לשמאל. הסדר הוויזואלי משמאל לימין:
  // [wrench] [gift] [star] [avatar]. אנחנו רוצים [avatar] בקצה השמאלי הביותר,
  // שכבר נוסף ע"י installAuthUi לפני הקריאה הזאת. לכן נכניס את 3 האייקונים
  // *לפני* ה-avatar באמצעות insertBefore.
  const avatarWrap = document.getElementById("profile-avatar-wrap");
  const ref = avatarWrap || null;
  if (ref) {
    actions.insertBefore(wrench, ref);
    actions.insertBefore(gift, ref);
    actions.insertBefore(star, ref);
  } else {
    actions.appendChild(wrench);
    actions.appendChild(gift);
    actions.appendChild(star);
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
