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

  // משה 2026-05-10: ה-CTA הראשי הוא הטענה. ביטול מנוי נסתר כקישור טקסט קטן
  // ואפור — קיים ונגיש, אבל לא מתפתה ללחוץ עליו. הקליק עצמו פותח דיאלוג
  // שמאיר מה המשתמש מאבד לפני שמוודא שהוא רוצה לבטל.
  const actions = [];
  actions.push(`<button type="button" class="rt-prem-status-btn rt-prem-status-btn-primary" data-act="topup">הטענה / שדרוג</button>`);

  let cancelLink = "";
  if (planType === "subscription") {
    if (status.subscriptionActive === false) {
      cancelLink = `<div class="rt-prem-cancel-line rt-prem-cancel-state-cancelled">
        המנוי לא יתחדש אוטומטית. הגישה שלך פעילה עד ${fmtDate(Math.floor((status.expiresAt || 0) / 1000))}.
        <a href="#" class="rt-prem-reactivate-link" data-act="reactivate">להחזיר חידוש אוטומטי</a>
      </div>`;
    } else {
      cancelLink = `<div class="rt-prem-cancel-line"><a href="#" class="rt-prem-cancel-link" data-act="cancel">ניהול חידוש המנוי</a></div>`;
    }
  }

  section.innerHTML = `
    <h3 class="settings-h3">החשבון שלך</h3>
    <div class="rt-prem-status-card ${isPaid ? "rt-prem-status-active" : ""}">
      ${items.join("")}
      <div class="rt-prem-status-actions">
        ${actions.join("")}
      </div>
      ${cancelLink}
    </div>
  `;

  section.querySelector('[data-act="topup"]')?.addEventListener("click", () => {
    openPremiumPage();
  });
  section.querySelector('[data-act="cancel"]')?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    const choice = await openCancelDialog(status);
    if (choice === "stay") {
      showToast({ kind: "ok", title: "נהדר", msg: "ממשיכים לעבוד יחד.", autoCloseMs: 4000 });
      return;
    }
    if (choice === "cancel") {
      try {
        await cancelSubscription({ reason: choice.reason || "" });
        showToast({ kind: "info", title: "החידוש בוטל", msg: "הגישה שלך נשמרת עד תום התקופה. אפשר להחזיר חידוש בכל רגע.", autoCloseMs: 7000 });
        load();
      } catch (err) {
        showToast({ kind: "danger", title: "תקלה בביטול", msg: (err && err.message) || "נסה שוב או צור קשר", autoCloseMs: 6000 });
      }
    }
  });
  section.querySelector('[data-act="reactivate"]')?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try {
      const r = await fetch("/api/account/reactivate", { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error("שגיאה");
      showToast({ kind: "ok", title: "החידוש האוטומטי הוחזר", msg: "המנוי שלך ימשיך אוטומטית.", autoCloseMs: 5000 });
      load();
    } catch (err) {
      showToast({ kind: "danger", title: "תקלה", msg: "לא הצלחנו להחזיר את החידוש. נסה שוב.", autoCloseMs: 6000 });
    }
  });
}

// משה 2026-05-10: דיאלוג ביטול מודע. מציג קודם 3 יתרונות לאי-ביטול, ורק אז
// מאפשר ללחוץ "ביטול". כל הניסוח רך ונייטרלי — לא לוחץ, אבל מבהיר מה מאבדים.
function openCancelDialog(status) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "rt-prem-overlay rt-cancel-modal-overlay";
    back.dir = "rtl";
    back.style.zIndex = 100002;

    const sheet = document.createElement("div");
    sheet.className = "rt-prem-sheet rt-cancel-modal-sheet";
    const remainSec = status.expiresAt ? Math.max(0, Math.floor((status.expiresAt - Date.now()) / 1000)) : 0;
    const remainTxt = fmtRemainSeconds(remainSec) || "—";
    sheet.innerHTML = `
      <button class="rt-prem-close" type="button" aria-label="סגור">✕</button>
      <h2 style="text-align:center;margin-top:8px">לפני שמבטלים — רגע אחד</h2>
      <p style="text-align:center;color:#666">המנוי שלך פעיל עוד ${remainTxt}. הביטול לא יחזיר את התשלום הקודם, רק יעצור חיוב חוזר.</p>
      <ul style="margin:18px 0;padding-inline-start:24px;line-height:1.9">
        <li>המנוי שומר על הגישה לכל הכלים — בלי הגבלה יומית, בלי סימני מים.</li>
        <li>החידוש החודשי הוא 50 ₪ בלבד — פחות מארוחת צהריים אחת.</li>
        <li>אפשר לבטל בלחיצה גם מאוחר יותר — תמיד יש שליטה מלאה.</li>
      </ul>
      <p style="text-align:center;color:#666;font-size:13px">אם משהו לא עובד או לא ברור — נשמח לעזור.<br/>052-7155401 · yiddishebilder@gmail.com</p>
      <div style="display:flex;gap:12px;margin-top:20px;flex-direction:column">
        <button class="rt-prem-btn rt-prem-btn-yaad" data-act="stay" style="font-size:18px">להישאר ולהמשיך לעבוד</button>
        <button data-act="confirm-cancel" style="background:none;border:none;color:#888;text-decoration:underline;cursor:pointer;font:inherit;padding:8px">בכל זאת לבטל את החידוש האוטומטי</button>
      </div>
    `;
    back.appendChild(sheet);
    document.body.appendChild(back);

    function close(result) {
      back.remove();
      resolve(result);
    }
    sheet.querySelector(".rt-prem-close").addEventListener("click", () => close("stay"));
    sheet.querySelector('[data-act="stay"]').addEventListener("click", () => close("stay"));
    sheet.querySelector('[data-act="confirm-cancel"]').addEventListener("click", () => close("cancel"));
    back.addEventListener("click", (ev) => { if (ev.target === back) close("stay"); });
  });
}

async function load() {
  const section = ensureSection();
  if (!section) return;
  const auth = window.__RAVTEXT_AUTH__;
  if (!auth || !auth.loggedIn) {
    renderEmpty(section);
    removePhoneSection();
    removeIdSection();
    return;
  }
  try {
    const accountInfo = await fetchAccountPhone();
    const status = await getAccountStatus();
    if (status) {
      // משלבים את subscriptionActive מ-account/me לתוך status (חסר ב-payments/status).
      status.subscriptionActive = accountInfo?.subscriptionActive !== false;
    }
    if (!status) { renderEmpty(section); }
    else renderStatus(section, status);
  } catch {
    renderEmpty(section);
  }
  // משה 2026-05-10: ת.ז. לא נמצאת כאן — היא חלק מטופס התשלום עצמו (premium_page).
  await renderPhoneSection(section);
}

function removeIdSection() {
  // backwards compat — אם נשמרה סקציה ישנה במסך, נסיר.
  document.getElementById("settings-account-id")?.remove();
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
