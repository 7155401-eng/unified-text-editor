// משה 2026-05-10: באנר שיווקי לקידום המתנה החודשית של 20 דקות שימוש מלא
// לחברים רשומים. מופיע רק למשתמשים שלא התחברו, ניתן לסגירה, ונסגר אוטומטית
// ל-7 ימים אחרי שנסגר ידנית. ה-CTA מפנה ישירות לכניסה דרך גוגל.

const DISMISS_KEY = "ravtext.giftBanner.dismissedAt";
const REAPPEAR_DAYS = 7;

function isDismissedRecently() {
  try {
    const ts = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
    if (!ts) return false;
    const daysAgo = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return daysAgo < REAPPEAR_DAYS;
  } catch {
    return false;
  }
}

function markDismissedNow() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
}

export function installGiftPromoBanner() {
  if (typeof document === "undefined") return;

  const auth = window.__RAVTEXT_AUTH__ || { loggedIn: false, paid: false };
  if (auth.loggedIn) return;
  if (isDismissedRecently()) return;
  if (document.getElementById("rt-gift-promo-banner")) return;

  const banner = document.createElement("aside");
  banner.id = "rt-gift-promo-banner";
  banner.dir = "rtl";
  banner.setAttribute("role", "complementary");
  banner.setAttribute("aria-label", "מתנה חודשית לחברים רשומים");
  banner.innerHTML = `
    <button type="button" class="rt-gift-promo-close" aria-label="סגור באנר">✕</button>
    <div class="rt-gift-promo-sparkle" aria-hidden="true">✨</div>
    <div class="rt-gift-promo-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="56" height="56">
        <defs>
          <linearGradient id="rt-gift-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fbbf24"/>
            <stop offset="50%" stop-color="#ec4899"/>
            <stop offset="100%" stop-color="#a855f7"/>
          </linearGradient>
        </defs>
        <polyline points="20 12 20 22 4 22 4 12" fill="none" stroke="url(#rt-gift-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="2" y="7" width="20" height="5" fill="none" stroke="url(#rt-gift-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="12" y1="22" x2="12" y2="7" stroke="url(#rt-gift-grad)" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" fill="none" stroke="url(#rt-gift-grad)" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" fill="none" stroke="url(#rt-gift-grad)" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    </div>
    <h3 class="rt-gift-promo-title">🎁 לחברי האתר — בכל חודש</h3>
    <p class="rt-gift-promo-headline">20 דקות שימוש מלא, <strong>חינם</strong></p>
    <p class="rt-gift-promo-body">פותחים חשבון בלחיצה אחת, ובכל חודש מחכות לכם 20 דקות לעבודה רציפה. בלי כרטיס אשראי, בלי התחייבות, בלי תשלום מאחורי הקלעים.</p>
    <a href="/api/auth/login" class="rt-gift-promo-cta">
      <span>פתיחת חשבון בחינם</span>
      <span aria-hidden="true">←</span>
    </a>
    <p class="rt-gift-promo-footnote">⏱ 30 שניות · כניסה מהירה עם חשבון גוגל</p>
  `;

  document.body.appendChild(banner);

  banner.querySelector(".rt-gift-promo-close").addEventListener("click", () => {
    banner.classList.add("rt-gift-promo-leaving");
    setTimeout(() => banner.remove(), 280);
    markDismissedNow();
  });
}
