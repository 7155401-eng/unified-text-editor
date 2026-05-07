// משה 2026-05-07: כפתור התחברות/יציאה בכותרת. קורא את __RAVTEXT_AUTH__ שהוחדר ע"י ה-Worker.
// במצב דמו → "התחבר עם גוגל". במצב משלם → המייל של המשתמש + יציאה.

export function installAuthUi() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const auth = window.__RAVTEXT_AUTH__ || { paid: false, email: null, admin: false };
  const header = document.querySelector(".app-header");
  if (!header) return;

  const wrap = document.createElement("div");
  wrap.id = "ravtext-auth";
  wrap.dir = "rtl";
  wrap.style.cssText = [
    "position:absolute",
    "top:8px",
    "left:12px",
    "display:flex",
    "gap:8px",
    "align-items:center",
    "font-size:13px",
    "z-index:50",
  ].join(";");

  if (auth.paid && auth.email) {
    const label = document.createElement("span");
    label.textContent = `מחובר: ${auth.email}`;
    label.style.cssText = "color:#1e3a8a;background:#dbeafe;padding:4px 10px;border-radius:6px;";

    const out = document.createElement("a");
    out.textContent = "יציאה";
    out.href = "/api/auth/logout";
    out.style.cssText = "color:#b91c1c;text-decoration:none;padding:4px 8px;";

    wrap.append(label, out);
  } else {
    const btn = document.createElement("a");
    btn.textContent = "התחבר עם גוגל";
    btn.href = "/api/auth/login";
    btn.style.cssText = [
      "background:#1e3a8a",
      "color:#fff",
      "padding:6px 14px",
      "border-radius:6px",
      "text-decoration:none",
      "font-weight:600",
    ].join(";");
    wrap.appendChild(btn);
  }

  if (header.style.position !== "absolute" && header.style.position !== "fixed") {
    header.style.position = "relative";
  }
  header.appendChild(wrap);

  const denied = new URLSearchParams(window.location.search).get("login");
  if (denied) {
    const banner = document.createElement("div");
    banner.dir = "rtl";
    banner.style.cssText = [
      "background:#fee2e2",
      "color:#991b1b",
      "padding:8px 14px",
      "text-align:center",
      "font-size:13px",
      "border-bottom:1px solid #fecaca",
    ].join(";");
    const messages = {
      denied: "החשבון שלך לא רשום כמנוי. למידע ולרישום פנה למשה.",
      expired: "המנוי פג. חדש כדי להמשיך לתצוגה מלאה.",
      disabled: "החשבון מושבת. פנה למשה.",
      cancelled: "ההתחברות בוטלה.",
      token_error: "תקלה זמנית בהתחברות לגוגל. נסה שוב.",
      no_token: "תקלה זמנית בהתחברות לגוגל. נסה שוב.",
      info_error: "תקלה זמנית בקבלת פרטי המשתמש מגוגל.",
      no_email: "לא קיבלנו כתובת מייל מגוגל.",
    };
    banner.textContent = messages[denied] || `שגיאת התחברות: ${denied}`;
    document.body.insertBefore(banner, document.body.firstChild);
  }
}
