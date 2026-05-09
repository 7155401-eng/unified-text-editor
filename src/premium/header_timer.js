// משה 2026-05-09: טיימר זמן נותר בכותרת — בולט אך עדין.
// מציג למשתמשים בעלי מנוי / יתרת שעות. מתעדכן חי ממנוע הזמן.
// 3 מצבים ויזואליים: מנוי-תקופה (ירוק רך), שעות (נייטרלי), פחות מ-30 דק' (כתום
// מתפעם), פחות מ-5 דק' (אדום מתפעם מהר). לחיצה פותחת את עמוד הפרמיום לטעינה.

import { onTimerUpdate } from "./time_warning.js";
import { openPremiumPage } from "./premium_page.js";

const TIMER_ID = "rt-prem-timer";

function fmtRemain(remainMs, planType) {
  if (planType === "subscription") {
    // מנוי = הצג ימים נותרים
    const days = Math.ceil(remainMs / (24 * 3600 * 1000));
    if (days >= 60) {
      const months = Math.round(days / 30);
      return { value: `${months} חודשים`, label: "מנוי" };
    }
    if (days >= 14) {
      const weeks = Math.round(days / 7);
      return { value: `${weeks} שבועות`, label: "מנוי" };
    }
    if (days >= 2) return { value: `${days} ימים`, label: "מנוי" };
    if (days === 1) return { value: "יום אחד", label: "מנוי" };
    // יום אחרון — שעות
    const hrs = Math.floor(remainMs / (3600 * 1000));
    const mins = Math.floor((remainMs % (3600 * 1000)) / 60000);
    return { value: `${hrs}:${String(mins).padStart(2, "0")}`, label: "מנוי נגמר היום" };
  }
  // שעות — הצג HH:MM:SS עד 24 שעות, אחרת ימים+שעות
  const totalSec = Math.floor(remainMs / 1000);
  if (totalSec >= 24 * 3600) {
    const days = Math.floor(totalSec / (24 * 3600));
    const hrs = Math.floor((totalSec % (24 * 3600)) / 3600);
    return { value: hrs ? `${days}י׳ ${hrs}ש׳` : `${days} ימים`, label: "נותרו" };
  }
  if (totalSec >= 3600) {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    return { value: `${hrs}:${String(mins).padStart(2, "0")}`, label: "שעות נותרו" };
  }
  // פחות משעה — דקות:שניות
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return { value: `${mins}:${String(secs).padStart(2, "0")}`, label: "דקות נותרו" };
}

function classFor(snap) {
  if (snap.planType === "subscription") {
    // אם נשארו פחות מיום — נחשב נמוך, יותר מכך = ירוק רגיל
    const days = Math.ceil(snap.remainMs / (24 * 3600 * 1000));
    if (days <= 0) return "rt-prem-timer-critical";
    if (days <= 1) return "rt-prem-timer-low";
    return "rt-prem-timer-sub";
  }
  // שעות
  const minutes = snap.remainMs / 60000;
  if (minutes <= 5) return "rt-prem-timer-critical";
  if (minutes <= 30) return "rt-prem-timer-low";
  return "rt-prem-timer-hours";
}

function buildTimerEl() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = TIMER_ID;
  btn.className = "rt-prem-timer";
  btn.dir = "rtl";
  btn.title = "הזמן הנותר בחשבונך — לחץ להטענה";
  btn.innerHTML = `
    <svg class="rt-prem-timer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8"/>
      <path d="M12 9v4l2.5 2.5"/>
      <path d="M9 2h6"/>
      <path d="M12 2v3"/>
    </svg>
    <span class="rt-prem-timer-content">
      <span class="rt-prem-timer-value">—</span>
      <span class="rt-prem-timer-label"></span>
    </span>
  `;
  btn.addEventListener("click", () => openPremiumPage());
  return btn;
}

function applySnapshot(btn, snap) {
  if (!snap.active) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const f = fmtRemain(snap.remainMs, snap.planType);
  const valueEl = btn.querySelector(".rt-prem-timer-value");
  const labelEl = btn.querySelector(".rt-prem-timer-label");
  if (valueEl) valueEl.textContent = f.value;
  if (labelEl) labelEl.textContent = f.label;

  // החלפת קלאס מצב מבלי לדרוס בסיס
  btn.classList.remove("rt-prem-timer-sub", "rt-prem-timer-hours", "rt-prem-timer-low", "rt-prem-timer-critical");
  btn.classList.add(classFor(snap));

  // טייטל מפורט
  const exp = new Date(snap.expiresAtMs);
  btn.title = `נגמר ב-${exp.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · לחץ להטענה`;
}

export function installHeaderTimer() {
  if (typeof document === "undefined") return;
  if (document.getElementById(TIMER_ID)) return;

  const actions = document.querySelector(".app-header .app-header-actions");
  if (!actions) return;

  const btn = buildTimerEl();
  btn.hidden = true; // מוסתר עד שיש מאזן זמן

  // הצב את הטיימר בקצה החיצוני ביותר (לפני 3 האייקונים החדשים).
  // ב-RTL, הקצה החיצוני = השמאלי החיצוני; ב-DOM זה append בקצה הסוף.
  // אנחנו רוצים: [טיימר] [כוכב/יהלום] [מתנה] [מפתח] [פרופיל]
  // לכן insertBefore לפני הראשון מבין החדשים. אם החדשים עדיין לא קיימים בעת ההתקנה,
  // נציב לפני ה-profile-avatar-wrap, וכשה-icons יותקנו הם ייכנסו ביניהם — לכן צריך
  // להריץ את הטיימר *אחרי* installHeaderPremiumIcons. main.js מסדר את הסדר.
  const diamond = document.getElementById("rt-prem-icon-diamond");
  const avatarWrap = document.getElementById("profile-avatar-wrap");
  const ref = diamond || avatarWrap;
  if (ref) actions.insertBefore(btn, ref); else actions.appendChild(btn);

  onTimerUpdate((snap) => applySnapshot(btn, snap));
}
