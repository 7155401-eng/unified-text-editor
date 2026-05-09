// משה 2026-05-09: עמוד תשלום פרמיום משכנע (וואו שיווקי).
// מציג מסכים: חודשי 50, שנתי 300, חבילות שעות (1/5/10/20), חיבור ליעד שריג + פייפאל.
// פייפאל פעיל רק מ-30 ש"ח ומעלה. המינוי מתחדש עד ביטול.
// נפתח כ-overlay מסך מלא; אפשר גם לעקוף ע"י URL ?premium=1 או לחיצה על אייקון הכוכב.

import { startCheckoutYaad, startCheckoutPaypal } from "./payment_api.js";

const OVERLAY_ID = "rt-premium-overlay";

const PLANS = {
  monthly: {
    code: "monthly",
    title: "חופשי חודשי",
    price: 50,
    unit: "₪/חודש",
    badge: "המתחיל",
    perks: [
      "גישה מלאה לכל הכלים — בלי הגבלה",
      "ייצוא מסמכים ללא סימני מים",
      "עימוד גפ\"ת מלא ללא הגבלת זמן",
      "ביטול בכל עת מהאזור האישי",
    ],
    cta: "הפעל מנוי חודשי",
  },
  yearly: {
    code: "yearly",
    title: "חופשי שנתי",
    price: 300,
    unit: "₪/שנה",
    badge: "החיסכון הגדול",
    highlight: true,
    saveLine: "חוסך 50% מול חודשי",
    perks: [
      "כל מה שיש בחודשי — בחצי מחיר",
      "12 חודשים שימוש ללא הגבלה",
      "תמיכה במייל ובטלפון בעדיפות",
      "ביטול בכל עת מהאזור האישי",
    ],
    cta: "הפעל מנוי שנתי",
  },
};

const HOUR_PACKS = [
  { code: "h1",  hours: 1,  price: 5,  perHour: 5.00 },
  { code: "h5",  hours: 5,  price: 22, perHour: 4.40, save: "12%" },
  { code: "h10", hours: 10, price: 40, perHour: 4.00, save: "20%" },
  { code: "h20", hours: 20, price: 70, perHour: 3.50, save: "30%" },
];

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.id) node.id = opts.id;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.style) {
    for (const [k, v] of Object.entries(opts.style)) node.style[k] = v;
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function buildPlanCard(plan) {
  const card = el("div", { cls: `rt-prem-plan ${plan.highlight ? "rt-prem-plan-hot" : ""}`, attrs: { "data-plan": plan.code } });
  if (plan.badge) {
    card.appendChild(el("div", { cls: "rt-prem-badge", text: plan.badge }));
  }
  card.appendChild(el("div", { cls: "rt-prem-plan-title", text: plan.title }));
  const priceWrap = el("div", { cls: "rt-prem-plan-price" });
  priceWrap.appendChild(el("span", { cls: "rt-prem-currency", text: "₪" }));
  priceWrap.appendChild(el("span", { cls: "rt-prem-amount", text: String(plan.price) }));
  priceWrap.appendChild(el("span", { cls: "rt-prem-unit", text: plan.unit.replace("₪", "").trim() }));
  card.appendChild(priceWrap);
  if (plan.saveLine) {
    card.appendChild(el("div", { cls: "rt-prem-save-line", text: plan.saveLine }));
  }
  const ul = el("ul", { cls: "rt-prem-perks" });
  for (const p of plan.perks) {
    ul.appendChild(el("li", { cls: "rt-prem-perk", html: `<span class="rt-prem-check">✓</span><span>${p}</span>` }));
  }
  card.appendChild(ul);

  const renew = el("div", { cls: "rt-prem-renew", text: "המינוי מתחדש אוטומטית עד שתבחר לבטל מהאזור האישי." });
  card.appendChild(renew);

  const buttons = el("div", { cls: "rt-prem-buttons" });
  const yaadBtn = el("button", {
    cls: "rt-prem-btn rt-prem-btn-yaad",
    attrs: { type: "button", "data-pay": "yaad", "data-plan": plan.code, "data-amount": String(plan.price) },
  });
  yaadBtn.innerHTML = `<span class="rt-prem-btn-icon">💳</span><span>${plan.cta}</span>`;
  buttons.appendChild(yaadBtn);

  const paypalBtn = el("button", {
    cls: "rt-prem-btn rt-prem-btn-paypal",
    attrs: { type: "button", "data-pay": "paypal", "data-plan": plan.code, "data-amount": String(plan.price) },
  });
  paypalBtn.innerHTML = `<span class="rt-prem-btn-icon">PayPal</span><span>תשלום באמצעות פייפאל</span>`;
  buttons.appendChild(paypalBtn);

  card.appendChild(buttons);
  return card;
}

function buildHourCard(pack) {
  const card = el("div", { cls: "rt-prem-hour-card", attrs: { "data-pack": pack.code } });
  card.appendChild(el("div", { cls: "rt-prem-hour-title", text: `${pack.hours} ${pack.hours === 1 ? "שעה" : "שעות"}` }));
  card.appendChild(el("div", { cls: "rt-prem-hour-price", html: `<span>₪</span><b>${pack.price}</b>` }));
  card.appendChild(el("div", { cls: "rt-prem-hour-rate", text: `₪${pack.perHour.toFixed(2)} לשעה` }));
  if (pack.save) {
    card.appendChild(el("div", { cls: "rt-prem-hour-save", text: `חיסכון ${pack.save}` }));
  }

  const buttons = el("div", { cls: "rt-prem-hour-buttons" });
  const yaadBtn = el("button", {
    cls: "rt-prem-btn-mini rt-prem-btn-yaad",
    attrs: { type: "button", "data-pay": "yaad", "data-pack": pack.code, "data-amount": String(pack.price) },
  });
  yaadBtn.innerHTML = `<span class="rt-prem-btn-icon">💳</span><span>תשלום באשראי</span>`;
  buttons.appendChild(yaadBtn);

  if (pack.price >= 30) {
    const paypalBtn = el("button", {
      cls: "rt-prem-btn-mini rt-prem-btn-paypal",
      attrs: { type: "button", "data-pay": "paypal", "data-pack": pack.code, "data-amount": String(pack.price) },
    });
    paypalBtn.innerHTML = `<span class="rt-prem-btn-icon">PayPal</span>`;
    buttons.appendChild(paypalBtn);
  } else {
    const note = el("div", { cls: "rt-prem-paypal-note", text: "פייפאל זמין מ-30 ₪ ומעלה" });
    buttons.appendChild(note);
  }
  card.appendChild(buttons);
  return card;
}

function buildOverlay() {
  const overlay = el("div", { id: OVERLAY_ID, cls: "rt-prem-overlay", attrs: { dir: "rtl", role: "dialog", "aria-modal": "true", "aria-labelledby": "rt-prem-h" } });
  overlay.tabIndex = -1;

  const sheet = el("div", { cls: "rt-prem-sheet" });

  const closeBtn = el("button", { cls: "rt-prem-close", attrs: { type: "button", "aria-label": "סגור" }, html: "✕" });
  sheet.appendChild(closeBtn);

  const hero = el("div", { cls: "rt-prem-hero" });
  hero.appendChild(el("div", { cls: "rt-prem-hero-eyebrow", text: "✦ פרמיום ✦" }));
  hero.appendChild(el("h1", { id: "rt-prem-h", cls: "rt-prem-hero-title", text: "כל הכלים, ללא הגבלה, ללא סימני מים" }));
  hero.appendChild(el("p", { cls: "rt-prem-hero-sub", text: "המנוי שמשתלם לכל מי שעורך מסמכי תורה. בלי תקרה, בלי קוצים, בלי הפתעות." }));

  const trustRow = el("div", { cls: "rt-prem-trust-row" });
  trustRow.appendChild(el("span", { cls: "rt-prem-trust-item", text: "🔒 חיוב מאובטח דרך יעד שריג" }));
  trustRow.appendChild(el("span", { cls: "rt-prem-trust-item", text: "✓ ביטול בכל עת" }));
  trustRow.appendChild(el("span", { cls: "rt-prem-trust-item", text: "📞 תמיכה אישית בטלפון" }));
  hero.appendChild(trustRow);
  sheet.appendChild(hero);

  // Plans
  const plansWrap = el("div", { cls: "rt-prem-plans-wrap" });
  plansWrap.appendChild(buildPlanCard(PLANS.monthly));
  plansWrap.appendChild(buildPlanCard(PLANS.yearly));
  sheet.appendChild(plansWrap);

  // Hours section
  const hourTitle = el("div", { cls: "rt-prem-hour-section-title", text: "לא מוכנים למנוי? קונים שעות עבודה בודדות:" });
  sheet.appendChild(hourTitle);

  const hourGrid = el("div", { cls: "rt-prem-hour-grid" });
  for (const p of HOUR_PACKS) hourGrid.appendChild(buildHourCard(p));
  sheet.appendChild(hourGrid);

  // Why section
  const whySection = el("div", { cls: "rt-prem-why-section" });
  whySection.appendChild(el("div", { cls: "rt-prem-why-title", text: "למה זה משתלם לך?" }));
  const whyGrid = el("div", { cls: "rt-prem-why-grid" });
  const reasons = [
    { i: "⚡", t: "חוסך לך שעות", d: "במקום לעמד ידנית — המערכת מסיימת ב-2 דקות." },
    { i: "📚", t: "כל הספרים", d: "תנ\"ך, משנה, גמרא, שו\"ע — ספריה אחת מאוחדת." },
    { i: "🎯", t: "תוצר מקצועי", d: "ייצוא לוורד שמוכן להדפסה, בלי תיקונים." },
    { i: "🔄", t: "עדכונים שוטפים", d: "כל גרסה חדשה עוברת אוטומטית — אין מה להתקין." },
  ];
  for (const r of reasons) {
    const card = el("div", { cls: "rt-prem-why-card" });
    card.appendChild(el("div", { cls: "rt-prem-why-icon", text: r.i }));
    card.appendChild(el("div", { cls: "rt-prem-why-card-title", text: r.t }));
    card.appendChild(el("div", { cls: "rt-prem-why-card-desc", text: r.d }));
    whyGrid.appendChild(card);
  }
  whySection.appendChild(whyGrid);
  sheet.appendChild(whySection);

  // Note about AI provider keys
  const aiNote = el("div", { cls: "rt-prem-ai-note" });
  aiNote.innerHTML = `
    <div class="rt-prem-ai-note-icon">ℹ️</div>
    <div class="rt-prem-ai-note-body">
      <div class="rt-prem-ai-note-title">לתשומת לבך</div>
      <div class="rt-prem-ai-note-text">המנוי פותח את כל הכלים והעימוד במערכת. הוא <b>לא מחליף</b> מפתחות API אישיים של ספקי בינה מלאכותית (כמו OpenAI, Anthropic, Gemini) — אלה נשארים באחריותך ומוגדרים בנפרד דרך מסך ההגדרות.</div>
    </div>
  `;
  sheet.appendChild(aiNote);

  // Footer
  const footer = el("div", { cls: "rt-prem-footer" });
  footer.appendChild(el("div", { cls: "rt-prem-footer-line", text: "שאלות? כתבו לנו: yiddishebilder@gmail.com · 052-7155401" }));
  sheet.appendChild(footer);

  overlay.appendChild(sheet);
  return { overlay, closeBtn };
}

function wireButtons(overlay) {
  overlay.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-pay]");
    if (!btn) return;
    const provider = btn.getAttribute("data-pay");
    const planCode = btn.getAttribute("data-plan") || null;
    const packCode = btn.getAttribute("data-pack") || null;
    const amount = parseInt(btn.getAttribute("data-amount") || "0", 10);
    if (!amount) return;

    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="rt-prem-btn-spin"></span><span>מעביר לתשלום…</span>`;
    try {
      if (provider === "yaad") {
        await startCheckoutYaad({ planCode, packCode, amount });
      } else if (provider === "paypal") {
        if (amount < 30) {
          throw new Error("פייפאל זמין מ-30 ₪ ומעלה. בחרו חבילה גדולה יותר או תשלום באשראי.");
        }
        await startCheckoutPaypal({ planCode, packCode, amount });
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      alert((err && err.message) || "אירעה תקלה זמנית. נסה שוב או צור קשר בטלפון.");
    }
  });
}

export function openPremiumPage() {
  if (typeof document === "undefined") return;
  closePremiumPage();
  const { overlay, closeBtn } = buildOverlay();
  document.body.appendChild(overlay);
  document.documentElement.classList.add("rt-prem-locked");

  function close() { closePremiumPage(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener("keydown", function escHandler(ev) {
    if (ev.key === "Escape") {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  });
  wireButtons(overlay);
  // focus management
  setTimeout(() => overlay.focus(), 30);
}

export function closePremiumPage() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();
  document.documentElement.classList.remove("rt-prem-locked");
}

// Auto-open if ?premium=1 in URL
export function maybeAutoOpenFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("premium") === "1" || p.get("upgrade") === "1") {
      setTimeout(openPremiumPage, 200);
    }
  } catch {}
}
