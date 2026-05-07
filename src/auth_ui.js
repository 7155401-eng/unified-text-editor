// צוות האתר 2026-05-07: 3 מצבי תצוגה בכותרת.
// 1. לא־מחובר: כפתור "התחבר עם גוגל"
// 2. מחובר אך לא מאושר (status='unauthorized' / expired): מציג מייל + תווית "מצב דמו" + יציאה
// 3. מחובר ומשלם (paid=true): מציג מייל + תווית "מנוי פעיל" + יציאה

export function installAuthUi() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const auth = window.__RAVTEXT_AUTH__ || { loggedIn: false, paid: false, email: null, admin: false, status: null };
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

  if (auth.loggedIn && auth.email) {
    const label = document.createElement("span");
    label.textContent = `${auth.email}`;
    if (auth.paid) {
      label.style.cssText = "color:#1e3a8a;background:#dbeafe;padding:4px 10px;border-radius:6px;";
    } else {
      label.style.cssText = "color:#92400e;background:#fef3c7;padding:4px 10px;border-radius:6px;";
    }

    const tag = document.createElement("span");
    tag.textContent = auth.paid ? "מנוי פעיל" : "מצב דמו";
    tag.style.cssText = auth.paid
      ? "color:#065f46;background:#d1fae5;padding:2px 8px;border-radius:4px;font-size:11px;"
      : "color:#991b1b;background:#fee2e2;padding:2px 8px;border-radius:4px;font-size:11px;";

    const out = document.createElement("a");
    out.textContent = "יציאה";
    out.href = "/api/auth/logout";
    out.style.cssText = "color:#b91c1c;text-decoration:none;padding:4px 8px;";

    const children = [label, tag];
    if (auth.admin) {
      const adminLink = document.createElement("a");
      adminLink.textContent = "ניהול";
      adminLink.href = "/admin";
      adminLink.style.cssText = "color:#1e3a8a;text-decoration:none;padding:4px 10px;background:#dbeafe;border-radius:4px;font-weight:600;";
      children.push(adminLink);
    }
    children.push(out);
    wrap.append(...children);
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

  const loginParam = new URLSearchParams(window.location.search).get("login");
  if (loginParam) {
    const banner = document.createElement("div");
    banner.dir = "rtl";
    const isInfo = loginParam === "demo";
    banner.style.cssText = [
      isInfo ? "background:#fef3c7" : "background:#fee2e2",
      isInfo ? "color:#92400e" : "color:#991b1b",
      "padding:8px 14px",
      "text-align:center",
      "font-size:13px",
      isInfo ? "border-bottom:1px solid #fde68a" : "border-bottom:1px solid #fecaca",
    ].join(";");
    const messages = {
      demo: "התחברת! לקבלת מנוי גישה צור קשר עם צוות האתר במייל או בטלפון. בינתיים העורך במצב דמו עם סימני מים. הקבצים וההגדרות שלך נשמרים — ברגע שיופעל המנוי, התצוגה המלאה תופיע אוטומטית.",
      expired: "המנוי פג. ההתחברות נשמרה כדמו עד לחידוש.",
      cancelled: "ההתחברות בוטלה.",
      token_error: "תקלה זמנית בהתחברות לגוגל. נסה שוב.",
      no_token: "תקלה זמנית בהתחברות לגוגל. נסה שוב.",
      info_error: "תקלה זמנית בקבלת פרטי המשתמש מגוגל.",
      no_email: "לא קיבלנו כתובת מייל מגוגל.",
    };
    banner.textContent = messages[loginParam] || `שגיאת התחברות: ${loginParam}`;
    document.body.insertBefore(banner, document.body.firstChild);
  }
}
