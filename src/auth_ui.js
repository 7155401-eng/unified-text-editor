// Unified auth menu UI + shared menu visuals.
// Injected from a module that is loaded at app startup, so menu/dropdown
// styling stays consistent across profile menus, context menus and selects.

const STATUS_LABELS = {
  paid: "מנוי פעיל",
  free: "מצב משתמש חינמי",
  demo: "מצב דמו",
  guest: "אורח",
};

function installUnifiedMenuVisuals() {
  if (document.getElementById("ravtext-unified-menu-visuals")) return;

  const style = document.createElement("style");
  style.id = "ravtext-unified-menu-visuals";
  style.textContent = `
:root {
  --rt-menu-radius: 14px;
  --rt-menu-item-radius: 10px;
  --rt-menu-pad: 8px;
  --rt-menu-font-size: 13px;
  --rt-menu-line-height: 1.35;
  --rt-menu-shadow: 0 18px 46px rgba(15, 23, 42, .22), 0 0 0 1px rgba(148, 163, 184, .18);
  --rt-menu-bg: var(--panel, #ffffff);
  --rt-menu-fg: var(--text, #0f172a);
  --rt-menu-muted: var(--muted, #64748b);
  --rt-menu-border: var(--border, #d8e0ea);
  --rt-menu-hover: color-mix(in srgb, var(--word-blue, #2b579a) 10%, transparent);
  --rt-menu-control-bg: color-mix(in srgb, var(--panel, #ffffff) 92%, var(--word-blue, #2b579a) 8%);
}
body.light-theme {
  --rt-menu-bg: #ffffff;
  --rt-menu-fg: #0f172a;
  --rt-menu-muted: #64748b;
  --rt-menu-border: #d8e0ea;
}
.profile-menu,
.ctx-menu,
[data-ravtext-menu],
.rt-menu,
.dropdown-menu {
  direction: rtl;
  box-sizing: border-box;
  padding: var(--rt-menu-pad);
  border: 1px solid var(--rt-menu-border);
  border-radius: var(--rt-menu-radius);
  background: var(--rt-menu-bg);
  color: var(--rt-menu-fg);
  box-shadow: var(--rt-menu-shadow);
  font-size: var(--rt-menu-font-size);
  line-height: var(--rt-menu-line-height);
  overflow: hidden;
}
.profile-menu { min-width: 236px; }
.profile-menu::before { background: linear-gradient(90deg, var(--word-blue, #2b579a), var(--gold, #c49a2c)); }
.profile-menu-header,
.profile-menu-guest {
  margin: 0 0 6px;
  padding: 10px;
  border-radius: 12px;
  background: var(--rt-menu-control-bg);
  border: 1px solid color-mix(in srgb, var(--rt-menu-border) 74%, transparent);
}
.profile-menu-email,
.profile-menu-guest-title { color: var(--rt-menu-fg); font-weight: 700; }
.profile-menu-guest-sub,
.profile-menu-status { color: var(--rt-menu-muted); }
.profile-menu-sep,
.ctx-sep {
  height: 1px;
  margin: 6px 2px;
  background: color-mix(in srgb, var(--rt-menu-border) 82%, transparent);
  border: 0;
}
.profile-menu-item,
.profile-menu-login-btn,
.ctx-menu button,
[data-ravtext-menu] button,
[data-ravtext-menu] a,
.rt-menu button,
.rt-menu a,
.dropdown-menu button,
.dropdown-menu a {
  width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--rt-menu-item-radius);
  background: transparent;
  color: var(--rt-menu-fg);
  font: inherit;
  text-align: right;
  text-decoration: none;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, transform .14s ease, color .14s ease;
}
.profile-menu-item:hover,
.profile-menu-login-btn:hover,
.ctx-menu button:hover,
[data-ravtext-menu] button:hover,
[data-ravtext-menu] a:hover,
.rt-menu button:hover,
.rt-menu a:hover,
.dropdown-menu button:hover,
.dropdown-menu a:hover {
  background: var(--rt-menu-hover);
  border-color: color-mix(in srgb, var(--word-blue, #2b579a) 22%, transparent);
  color: var(--rt-menu-fg);
  transform: translateY(-1px);
}
.profile-menu-item-icon { width: 20px; text-align: center; flex: 0 0 20px; }
.profile-menu-login-btn {
  justify-content: center;
  margin-top: 8px;
  background: linear-gradient(135deg, #ffffff, var(--rt-menu-control-bg));
  border-color: var(--rt-menu-border);
  font-weight: 700;
}
.toolbar select,
.panes-toolbar select,
.ribbon-panel select,
.settings-panel select,
.stream-col-select,
.font-gallery-select,
.opw-control select,
.rt-video-gallery-field select,
select[data-ravtext-select] {
  box-sizing: border-box;
  min-height: 34px;
  border: 1px solid var(--rt-menu-border);
  border-radius: 10px;
  background: var(--rt-menu-control-bg);
  color: var(--rt-menu-fg);
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  padding: 6px 10px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.45);
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease;
}
.toolbar select:hover,
.panes-toolbar select:hover,
.ribbon-panel select:hover,
.settings-panel select:hover,
.stream-col-select:hover,
.font-gallery-select:hover,
.opw-control select:hover,
.rt-video-gallery-field select:hover,
select[data-ravtext-select]:hover {
  border-color: color-mix(in srgb, var(--word-blue, #2b579a) 44%, var(--rt-menu-border));
}
.toolbar select:focus,
.panes-toolbar select:focus,
.ribbon-panel select:focus,
.settings-panel select:focus,
.stream-col-select:focus,
.font-gallery-select:focus,
.opw-control select:focus,
.rt-video-gallery-field select:focus,
select[data-ravtext-select]:focus {
  outline: 2px solid color-mix(in srgb, var(--word-blue, #2b579a) 34%, transparent);
  outline-offset: 1px;
  border-color: var(--word-blue, #2b579a);
}
@media (max-width: 560px) {
  .profile-menu,
  .ctx-menu,
  [data-ravtext-menu],
  .rt-menu,
  .dropdown-menu {
    border-radius: 12px;
    font-size: 12px;
  }
  .profile-menu { min-width: min(236px, calc(100vw - 24px)); }
}`;
  document.head.appendChild(style);
}

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
  for (let i = 0; i < email.length; i += 1) hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  const [a, b] = palettes[Math.abs(hash) % palettes.length];
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

function initialFromEmail(email) {
  if (!email) return "";
  const ch = email.trim().charAt(0).toUpperCase();
  return /[A-Z\u0590-\u05ff0-9]/.test(ch) ? ch : "?";
}

function statusFor(auth) {
  if (!auth.loggedIn) return "guest";
  return auth.paid ? "paid" : "free";
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
  btn.title = auth.loggedIn ? `${auth.email || ""} · ${STATUS_LABELS[status]}` : "כניסה לחשבון";

  if (auth.loggedIn && auth.email) {
    btn.style.background = gradientForEmail(auth.email);
    const initial = document.createElement("span");
    initial.className = "profile-avatar-initial";
    initial.textContent = initialFromEmail(auth.email);
    btn.appendChild(initial);
  } else {
    btn.classList.add("profile-avatar-guest");
    const icon = document.createElement("span");
    icon.className = "profile-avatar-icon";
    icon.textContent = "G";
    btn.appendChild(icon);
  }

  const dot = document.createElement("span");
  dot.className = "profile-avatar-dot";
  btn.appendChild(dot);
  return btn;
}

function addMenuItem(menu, { href, cls = "", icon = "", text = "" }) {
  const item = document.createElement("a");
  item.className = `profile-menu-item ${cls}`.trim();
  item.href = href;
  item.setAttribute("role", "menuitem");
  item.innerHTML = `<span class="profile-menu-item-icon">${icon}</span><span></span>`;
  item.lastElementChild.textContent = text;
  menu.appendChild(item);
  return item;
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
        <div class="profile-menu-email"></div>
        <div class="profile-menu-status status-${status}">${STATUS_LABELS[status]}</div>
      </div>`;
    header.querySelector(".profile-menu-email").textContent = auth.email;
    menu.appendChild(header);

    const sep = document.createElement("div");
    sep.className = "profile-menu-sep";
    menu.appendChild(sep);

    if (auth.admin) {
      addMenuItem(menu, { href: "/admin", cls: "profile-menu-item-admin", icon: "⚙", text: "פאנל ניהול" });
    }
    addMenuItem(menu, { href: "/api/auth/logout", cls: "profile-menu-item-logout", icon: "↪", text: "יציאה" });
  } else {
    const intro = document.createElement("div");
    intro.className = "profile-menu-guest";
    intro.innerHTML = `
      <div class="profile-menu-guest-title">לא מחובר</div>
      <div class="profile-menu-guest-sub">היכנס כדי לשמור הגדרות וקבצים</div>`;
    menu.appendChild(intro);

    const loginBtn = document.createElement("a");
    loginBtn.className = "profile-menu-login-btn";
    loginBtn.href = "/api/auth/go";
    loginBtn.setAttribute("role", "menuitem");
    loginBtn.innerHTML = `<span class="profile-menu-item-icon">G</span><span>התחבר עם גוגל</span>`;
    loginBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const clientId = window.__RAVTEXT_AUTH__?.googleClientId;
      if (clientId) {
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: `${window.location.origin}/api/auth/callback`,
          response_type: "code",
          scope: "openid email",
          access_type: "online",
          prompt: "select_account",
          state: "/",
        });
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      } else {
        window.location.href = "/api/auth/go?_=" + Date.now();
      }
    });
    menu.appendChild(loginBtn);
  }

  return menu;
}

function showLoginBanner(loginParam) {
  const banner = document.createElement("div");
  banner.dir = "rtl";
  const isInfo = loginParam === "demo" || loginParam === "free";
  banner.className = `login-banner login-banner-${isInfo ? "info" : "error"}`;
  const messages = {
    free: "התחברת! זהו מצב משתמש חינמי — הפלט מסומן בסימני מים ומספר השימושים מוגבל. לשימוש מלא ללא סימני מים צור קשר עם צוות האתר לקבלת מנוי. הקבצים וההגדרות שלך נשמרים תמיד.",
    demo: "התחברת! לקבלת מנוי מלא נא צור קשר עם צוות האתר במייל או בטלפון.",
    expired: "המנוי פג. ההתחברות נשמרה כדי לעדכן.",
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
  installUnifiedMenuVisuals();

  if (document.getElementById("profile-avatar-btn")) return;

  const auth = window.__RAVTEXT_AUTH__ || {
    loggedIn: false,
    paid: false,
    email: null,
    admin: false,
    status: null,
  };

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
  host.appendChild(wrap);

  function setOpen(open) {
    menu.hidden = !open;
    avatar.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("open", open);
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
