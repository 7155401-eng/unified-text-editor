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

// משה 2026-05-08: אווטאר אורח = לוגו G הרשמי של גוגל ב-4 צבעים על רקע לבן.
// קודם היה פילואט אדם אפור-עכור על גרדיאנט אפור — לא ברור שהאווטאר הוא הזמנה
// להתחברות בגוגל. עכשיו האייקון עצמו מודיע: לחיצה = כניסה עם גוגל.
function guestAvatarSvg() {
  return `<svg viewBox="0 0 18 18" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
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
    // משה 2026-05-08: לוגו G ב-4 צבעים רשמיים, רקע לבן + מסגרת — בהתאם להנחיות
    // Sign in with Google של גוגל. קודם היה G לבן-מונוכרום על רקע כחול כהה,
    // לא בולט ולא מזוהה מיד.
    loginBtn.innerHTML = `
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
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
  banner.className = `login-banner login-banner-${isInfo ? "info" : "error"}`;
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
