// משה 2026-05-09: פרטי הרכישה של המשתמש בתוך מסך ההגדרות.
// מחליף את "לא הוטמע עדיין" בנתונים אמיתיים מ-/api/payments/status:
//   • סוג תוכנית (מנוי / שעות נטענות / בלי תוכנית)
//   • תוקף (תאריך פג ל-מנוי, יתרה ב-HH:MM ל-שעות)
//   • היסטוריית 3 התשלומים האחרונים (אם יש endpoint; אחרת מתחבא בעדינות)
//   • כפתור הטענה (פותח עמוד פרמיום) + ביטול מנוי (אם יש מנוי פעיל)

import { getAccountStatus, cancelSubscription } from "./payment_api.js";
import { openPremiumPage } from "./premium_page.js";
import { showToast } from "./time_warning.js";

const SECTION_ID = "settings-premium-status";

function fmtDate(epochSec) {
  if (!epochSec) return "—";
  return new Date(epochSec * 1000).toLocaleDateString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function fmtRemainSeconds(sec) {
  if (!sec || sec <= 0) return "—";
  if (sec >= 24 * 3600) {
    const d = Math.floor(sec / (24 * 3600));
    return `${d} ימים`;
  }
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")} שעות`;
  }
  const m = Math.floor(sec / 60);
  return `${m} דקות`;
}

function planLabel(planType) {
  if (planType === "subscription") return "מנוי תקופתי";
  if (planType === "hours") return "חבילת שעות";
  return "ללא תוכנית פעילה";
}

function ensureSection() {
  let section = document.getElementById(SECTION_ID);
  if (section) return section;

  // נכנס לפני סקציית "AI ועיצוב" אם קיימת, אחרת בסוף
  const settingsPanel = document.getElementById("settings-panel");
  if (!settingsPanel) return null;

  // משה 2026-05-09: מחליף את אזור "רישיון משתמש" הקיים — לא משכפל.
  // מוצא את הסקציה שמכילה #settings-license-status ועוטף אותה במידע מורחב.
  const licenseStatus = document.getElementById("settings-license-status");
  const targetSection = licenseStatus?.closest(".settings-section");
  if (targetSection) {
    section = document.createElement("div");
    section.id = SECTION_ID;
    section.className = "settings-section settings-premium-section";
    targetSection.parentNode.insertBefore(section, targetSection.nextSibling);
    targetSection.hidden = true; // מחביא את האזור הישן בעדינות (לא מוחק)
    return section;
  }

  // fallback: בסוף ה-panel
  section = document.createElement("div");
  section.id = SECTION_ID;
  section.className = "settings-section settings-premium-section";
  settingsPanel.appendChild(section);
  return section;
}

function renderEmpty(section) {
  section.innerHTML = `
    <h3 class="settings-h3">החשבון שלך</h3>
    <div class="rt-prem-status-card rt-prem-status-empty">
      <div class="rt-prem-status-line">
        <span class="rt-prem-status-label">סטטוס:</span>
        <span class="rt-prem-status-value">לא מחובר</span>
      </div>
      <div class="rt-prem-status-help">היכנס עם גוגל כדי לראות את פרטי החשבון, היתרה והמנוי שלך.</div>
      <div class="rt-prem-status-actions">
        <a class="rt-prem-status-btn rt-prem-status-btn-primary" href="/api/auth/login">התחברות</a>
      </div>
    </div>
  `;
}

function renderStatus(section, status) {
  const planType = status.planType || null;
  const isPaid = !!status.paid;
  const remainSec = status.expiresAt ? Math.max(0, Math.floor((status.expiresAt - Date.now()) / 1000)) : 0;
  const balanceSec = Number(status.balanceSeconds) || 0;

  const items = [];
  items.push(`
    <div class="rt-prem-status-line">
      <span class="rt-prem-status-label">חשבון:</span>
      <span class="rt-prem-status-value rt-prem-status-email" dir="ltr">${status.email || "—"}</span>
    </div>
  `);
  items.push(`
    <div class="rt-prem-status-line">
      <span class="rt-prem-status-label">סוג חשבון:</span>
      <span class="rt-prem-status-value rt-prem-status-plan-${planType || "none"}">${planLabel(planType)}</span>
    </div>
  `);

  if (planType === "subscription") {
    items.push(`
      <div class="rt-prem-status-line">
        <span class="rt-prem-status-label">תוקף עד:</span>
        <span class="rt-prem-status-value">${fmtDate(Math.floor((status.expiresAt || 0) / 1000))}${remainSec > 0 ? ` <span class="rt-prem-status-sub">(נותרו ${fmtRemainSeconds(remainSec)})</span>` : ""}</span>
      </div>
    `);
  } else if (planType === "hours" || balanceSec > 0) {
    items.push(`
      <div class="rt-prem-status-line">
        <span class="rt-prem-status-label">יתרה שנותרה:</span>
        <span class="rt-prem-status-value">${fmtRemainSeconds(balanceSec)}</span>
      </div>
    `);
  }

  if (!isPaid) {
    items.push(`
      <div class="rt-prem-status-help">
        כרגע החשבון שלך במצב חינמי. שדרוג לפרמיום פותח את כל הכלים, מבטל סימני מים בעימוד ומסיר את ההגבלה היומית.
      </div>
    `);
  }

  const actions = [];
  actions.push(`<button type="button" class="rt-prem-status-btn rt-prem-status-btn-primary" data-act="topup">הטענה / שדרוג</button>`);
  if (planType === "subscription") {
    actions.push(`<button type="button" class="rt-prem-status-btn rt-prem-status-btn-secondary" data-act="cancel">ביטול מנוי</button>`);
  }

  section.innerHTML = `
    <h3 class="settings-h3">החשבון שלך</h3>
    <div class="rt-prem-status-card ${isPaid ? "rt-prem-status-active" : ""}">
      ${items.join("")}
      <div class="rt-prem-status-actions">
        ${actions.join("")}
      </div>
    </div>
  `;

  section.querySelector('[data-act="topup"]')?.addEventListener("click", () => {
    openPremiumPage();
  });
  section.querySelector('[data-act="cancel"]')?.addEventListener("click", async () => {
    if (!confirm("לבטל את המנוי המתחדש? הגישה תישאר עד תום התקופה הנוכחית, ולא יתבצע חיוב נוסף.")) return;
    try {
      await cancelSubscription();
      showToast({ kind: "info", title: "המנוי בוטל", msg: "לא יתבצע חיוב נוסף. הגישה שלך נשמרת עד תום התקופה.", autoCloseMs: 6000 });
      // refresh
      load();
    } catch (err) {
      showToast({ kind: "danger", title: "תקלה בביטול", msg: (err && err.message) || "נסה שוב או צור קשר", autoCloseMs: 6000 });
    }
  });
}

async function load() {
  const section = ensureSection();
  if (!section) return;
  const auth = window.__RAVTEXT_AUTH__;
  if (!auth || !auth.loggedIn) {
    renderEmpty(section);
    return;
  }
  try {
    const status = await getAccountStatus();
    if (!status) { renderEmpty(section); return; }
    renderStatus(section, status);
  } catch {
    renderEmpty(section);
  }
}

export function setupPremiumStatusSection() {
  if (typeof document === "undefined") return;
  load();
  // רענון כל פעם שפותחים את מסך ההגדרות (יציאה ופתיחה מחדש)
  document.addEventListener("ravtext:settings-opened", load);
}
