// משה 2026-05-09: שכבת ה-API של התשלומים. שולח בקשת checkout לשרת,
// השרת חוזר עם redirectUrl של יעד שריג / פייפאל. הדפדפן עובר לשם.
// השרת אחראי על קריאת חזרה (callback) ועדכון ה-DB עם המנוי / השעות.

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    credentials: "same-origin",
  });
  if (!res.ok) {
    let msg = `שגיאה (${res.status})`;
    let code = null;
    try {
      const j = await res.json();
      if (j && j.error) {
        msg = j.error;
        // משה 2026-05-09/10: קודי שגיאה מובנים — phone_required, id_required.
        if (typeof j.error === "string") {
          if (j.error.startsWith("phone_required")) code = "phone_required";
          else if (j.error.startsWith("id_required")) code = "id_required";
        }
      }
    } catch {}
    const err = new Error(msg);
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function requireLogin() {
  const auth = (typeof window !== "undefined") ? window.__RAVTEXT_AUTH__ : null;
  if (!auth || !auth.loggedIn) {
    const ok = confirm("כדי להשלים תשלום צריך קודם להתחבר עם גוגל. להעביר אותך עכשיו?");
    if (ok) window.location.href = "/api/auth/login?next=" + encodeURIComponent(window.location.pathname + "?premium=1");
    throw new Error("נדרש להתחבר תחילה");
  }
}

export async function startCheckoutYaad({ planCode, packCode, pkgToken, amount }) {
  requireLogin();
  const data = await postJson("/api/payments/yaad/start", { planCode, packCode, pkgToken, amount });
  if (!data || !data.redirectUrl) throw new Error("השרת לא החזיר כתובת תשלום");
  window.location.href = data.redirectUrl;
}

export async function startCheckoutPaypal({ planCode, packCode, pkgToken, amount }) {
  requireLogin();
  if (amount < 30) throw new Error("פייפאל זמין מ-30 ₪ ומעלה");
  const data = await postJson("/api/payments/paypal/start", { planCode, packCode, pkgToken, amount });
  if (!data || !data.redirectUrl) throw new Error("השרת לא החזיר כתובת תשלום");
  window.location.href = data.redirectUrl;
}

export async function getAccountStatus() {
  try {
    const res = await fetch("/api/payments/status", { credentials: "same-origin" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function claimMonthlyGift() {
  return postJson("/api/payments/gift/claim", {});
}

export async function cancelSubscription(opts = {}) {
  return postJson("/api/payments/cancel", { reason: opts.reason || "" });
}
