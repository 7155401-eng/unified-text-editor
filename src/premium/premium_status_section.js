// משה 2026-05-09: פרטי הרכישה של המשתמש בתוך מסך ההגדרות.
// מחליף את "לא הוטמע עדיין" בנתונים אמיתיים מ-/api/payments/status:
//   • סוג תוכנית (מנוי / שעות נטענות / בלי תוכנית)
//   • תוקף (תאריך פג ל-מנוי, יתרה ב-HH:MM ל-שעות)
//   • היסטוריית 3 התשלומים האחרונים (אם יש endpoint; אחרת מתחבא בעדינות)
//   • כפתור הטענה (פותח עמוד פרמיום) + ביטול מנוי (אם יש מנוי פעיל)

import { getAccountStatus, cancelSubscription } from "./payment_api.js";
import { openPremiumPage } from "./premium_page.js";
import { showToast } from "./time_warning.js";
import { buildPhoneInput, fetchAccountPhone, savePhone } from "./phone_input.js";

const SECTION_ID = "settings-premium-status";
const PHONE_SECTION_ID = "settings-account-phone";

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
    removePhoneSection();
    return;
  }
  try {
    const status = await getAccountStatus();
    if (!status) { renderEmpty(section); }
    else renderStatus(section, status);
  } catch {
    renderEmpty(section);
  }
  // טען וצייר את סקציית הטלפון מתחת לסטטוס
  await renderPhoneSection(section);
}

function removePhoneSection() {
  document.getElementById(PHONE_SECTION_ID)?.remove();
}

async function renderPhoneSection(afterSection) {
  let section = document.getElementById(PHONE_SECTION_ID);
  if (!section) {
    section = document.createElement("div");
    section.id = PHONE_SECTION_ID;
    section.className = "settings-section";
    afterSection.parentNode.insertBefore(section, afterSection.nextSibling);
  }
  const info = await fetchAccountPhone();
  const country = info?.phoneCountry || "IL";
  const phone = info?.phone || "";
  const hasPhone = !!info?.hasPhone;

  section.innerHTML = `
    <h3 class="settings-h3">פרטי קשר</h3>
    <div class="rt-phone-section ${hasPhone ? '' : 'rt-phone-missing'}">
      <div class="rt-phone-label">טלפון <span class="rt-phone-required">*</span></div>
      <div class="rt-phone-host"></div>
      <div class="rt-phone-help">${hasPhone ? "המספר שמור במערכת. ניתן לעדכן בכל עת." : "הזנת מספר טלפון נדרשת לפני ביצוע תשלום."}</div>
      <div class="rt-phone-actions">
        <button type="button" class="rt-phone-save">שמור טלפון</button>
        <span class="rt-phone-status"></span>
      </div>
    </div>
  `;

  const host = section.querySelector(".rt-phone-host");
  let lastValid = false;
  const ctrl = buildPhoneInput({
    country,
    phone,
    onChange: ({ valid }) => { lastValid = valid; },
  });
  host.appendChild(ctrl.wrap);

  const statusEl = section.querySelector(".rt-phone-status");
  const saveBtn = section.querySelector(".rt-phone-save");
  saveBtn.addEventListener("click", async () => {
    const v = ctrl.getValue();
    if (!v.valid) {
      statusEl.textContent = "מספר לא תקין";
      statusEl.className = "rt-phone-status rt-phone-status-err";
      return;
    }
    saveBtn.disabled = true;
    statusEl.textContent = "שומר…";
    statusEl.className = "rt-phone-status";
    try {
      await savePhone({ country: v.country, phone: v.phone });
      statusEl.textContent = "נשמר ✓";
      statusEl.className = "rt-phone-status rt-phone-status-ok";
      const wrap = section.querySelector(".rt-phone-section");
      wrap.classList.remove("rt-phone-missing");
      const help = section.querySelector(".rt-phone-help");
      if (help) help.textContent = "המספר שמור במערכת. ניתן לעדכן בכל עת.";
    } catch (err) {
      statusEl.textContent = err?.message || "שגיאה בשמירה";
      statusEl.className = "rt-phone-status rt-phone-status-err";
    } finally {
      saveBtn.disabled = false;
    }
  });
}

export function setupPremiumStatusSection() {
  if (typeof document === "undefined") return;
  load();
  // רענון כל פעם שפותחים את מסך ההגדרות (יציאה ופתיחה מחדש)
  document.addEventListener("ravtext:settings-opened", load);
}
