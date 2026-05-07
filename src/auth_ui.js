// משה 2026-05-07: אייקון פרופיל עגול בודד בכותרת, משובץ בתוך app-header-actions
// כך שהאייקון העגול והכפתורים האחרים (דיווח באג / צור קשר / טלפון) יושבים זה לצד זה.
// לחיצה על האייקון פותחת תפריט נשלף עם המייל, סטטוס מנוי, קישור ניהול ויציאה.
// (קודם השתמשנו ב-position:absolute שגרם לחפיפה עם app-header-actions שגם הוא בצד שמאל ב-RTL.)

const STATUS_LABELS = {
  paid: "מנוי פעיל",
  demo: "מצב דמו",
  guest: "אורח",
};

function gradientForEmail(email) {
  const palettes = [
    ["#6366f1", "#8b5cf6"],
    ["#0ea5e9", "#3b82f6"],
    ["#10b981", "#14b8a6"],
    ["#f59e0b", "#ef4444"],
    ["#ec4899", "#8b5cf6"],
    ["#14b8a6", "#0ea5e9"],
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % palettes.length;
  const [a, b] = palettes[idx];
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

function initialFromEmail(email) {
  if (!email) return "";
  const ch = email.trim().charAt(0).toUpperCase();
  return /[A-Z֐-׿0-9]/.test(ch) ? ch : "?";
}

function guestAvatarSvg() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <circle cx="12" cy="9" r="3.5" fill="currentColor"/>
    <path d="M4.5 20c0-3.7 3.4-6 7.5-6s7.5 2.3 7.5 6" fill="currentColor"/>
  </svg>`;
}

function statusFor(auth) {
  if (!auth.loggedIn) return "guest";
  if (auth.paid) return "paid";
  return "demo";
}

function buildAvatar(auth) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "profile-avatar-btn";
  btn.className = "profile-avatar";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");

  const status = statusFor(auth);
  btn.dataset.status = status;
  btn.title = auth.loggedIn
    ? `${auth.email || ""} · ${STATUS_LABELS[status]}`
    : "כניסה לחשבון";

  if (auth.loggedIn && auth.email) {
    btn.style.background = gradientForEmail(auth.email);
    btn.innerHTML = `<span class="profile-avatar-initial">${initialFromEmail(auth.email)}</span>`;
  } else {
    btn.classList.add("profile-avatar-guest");
    btn.innerHTML = `<span class="profile-avatar-icon">${guestAvatarSvg()}</span>`;
  }
  // ניקוד סטטוס: נקודה צבעונית בפינה
  const dot = document.createElement("span");
  dot.className = "profile-avatar-dot";
  btn.appendChild(dot);
  return btn;
}

function buildMenu(auth) {
  const menu = document.createElement("div");
  menu.id = "profile-avatar-menu";
  menu.className = "profile-menu";
  menu.dir = "rtl";
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  if (auth.loggedIn && auth.email) {
    const status = statusFor(auth);
    const header = document.createElement("div");
    header.className = "profile-menu-header";
    header.innerHTML = `
      <div class="profile-menu-avatar" style="background:${gradientForEmail(auth.email)};">
        <span>${initialFromEmail(auth.email)}</span>
      </div>
      <div class="profile-menu-id">
        <div class="profile-menu-email">${auth.email}</div>
        <div class="profile-menu-status status-${status}">${STATUS_LABELS[status]}</div>
      </div>
    `;
    menu.appendChild(header);

    const sep = document.createElement("div");
    sep.className = "profile-menu-sep";
    menu.appendChild(sep);

    if (auth.admin) {
      const adminLink = document.createElement("a");
      adminLink.className = "profile-menu-item profile-menu-item-admin";
      adminLink.href = "/admin";
      adminLink.setAttribute("role", "menuitem");
      adminLink.innerHTML = `<span class="profile-menu-item-icon">⚙</span><span>פאנל ניהול</span>`;
      menu.appendChild(adminLink);
    }

    const logout = document.createElement("a");
    logout.className = "profile-menu-item profile-menu-item-logout";
    logout.href = "/api/auth/logout";
    logout.setAttribute("role", "menuitem");
    logout.innerHTML = `<span class="profile-menu-item-icon">⎋</span><span>יציאה</span>`;
    menu.appendChild(logout);
  } else {
    const intro = document.createElement("div");
    intro.className = "profile-menu-guest";
    intro.innerHTML = `
      <div class="profile-menu-guest-title">לא מחובר</div>
      <div class="profile-menu-guest-sub">היכנס כדי לשמור הגדרות וקבצים</div>
    `;
    menu.appendChild(intro);

    const loginBtn = document.createElement("a");
    loginBtn.className = "profile-menu-login-btn";
    loginBtn.href = "/api/auth/login";
    loginBtn.setAttribute("role", "menuitem");
    loginBtn.innerHTML = `
      <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
        <path fill="#fff" d="M17.5 9.2c0-.6-.05-1.2-.15-1.7H9v3.3h4.8c-.2 1-.85 1.85-1.8 2.4v2h2.9c1.7-1.55 2.7-3.85 2.7-6z"/>
        <path fill="#fff" opacity=".9" d="M9 18c2.4 0 4.45-.8 5.95-2.15l-2.9-2c-.8.55-1.85.85-3.05.85-2.35 0-4.35-1.6-5.05-3.7H.95v2.05C2.45 15.95 5.5 18 9 18z"/>
        <path fill="#fff" opacity=".75" d="M3.95 11c-.2-.55-.3-1.15-.3-1.75s.1-1.2.3-1.75V5.45H.95C.35 6.65 0 7.95 0 9.25c0 1.3.35 2.6.95 3.8L3.95 11z"/>
        <path fill="#fff" opacity=".85" d="M9 3.55c1.3 0 2.5.45 3.4 1.3l2.55-2.55C13.45.85 11.4 0 9 0 5.5 0 2.45 2.05.95 5.45L3.95 7.5C4.65 5.4 6.65 3.55 9 3.55z"/>
      </svg>
      <span>התחבר עם גוגל</span>
    `;
    menu.appendChild(loginBtn);
  }
  return menu;
}

function showLoginBanner(loginParam) {
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

export function installAuthUi() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.getElementById("profile-avatar-btn")) return; // הגנה כפולה

  const auth = window.__RAVTEXT_AUTH__ || { loggedIn: false, paid: false, email: null, admin: false, status: null };

  const actions = document.querySelector(".app-header .app-header-actions");
  const host = actions || document.querySelector(".app-header") || document.body;

  const wrap = document.createElement("div");
  wrap.id = "profile-avatar-wrap";
  wrap.className = "profile-avatar-wrap";
  wrap.dir = "rtl";

  const avatar = buildAvatar(auth);
  const menu = buildMenu(auth);
  wrap.appendChild(avatar);
  wrap.appendChild(menu);

  // append → ב-RTL בתוך flex זה הופך לרכיב הכי שמאלי (קצה הכותרת)
  host.appendChild(wrap);

  function setOpen(open) {
    menu.hidden = !open;
    avatar.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) wrap.classList.add("open"); else wrap.classList.remove("open");
  }

  avatar.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });

  document.addEventListener("click", (e) => {
    if (menu.hidden) return;
    if (!wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      setOpen(false);
      avatar.focus();
    }
  });

  const loginParam = new URLSearchParams(window.location.search).get("login");
  if (loginParam) showLoginBanner(loginParam);
}
