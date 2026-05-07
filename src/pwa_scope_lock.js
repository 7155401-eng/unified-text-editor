// Scope-lock — בחלון העצמאי (PWA standalone) לחיצה על קישור
// לאתר חיצוני נחסמת בחלון, ונפתחת כאשונית חדשה בדפדפן הרגיל.
// ככה החלון של רב טקסט לא יכול "להיתקע" באתר אחר גם אם משתמש
// יבצע ניווט דרך קישור או טופס.

import { isStandalone } from "./pwa_install_controller.js";

const SCOPE_HOST = location.host;

function isOutOfScope(href) {
  if (!href) return false;
  // mailto / tel / sms — תמיד לפתוח באפליקציה הטבעית של המערכת
  if (/^(mailto:|tel:|sms:|javascript:)/i.test(href)) return false;
  try {
    const u = new URL(href, location.href);
    return u.host !== SCOPE_HOST;
  } catch {
    return false;
  }
}

function findAnchor(target) {
  let el = target;
  while (el && el !== document.body) {
    if (el.tagName === "A") return el;
    el = el.parentElement;
  }
  return null;
}

export function lockScopeWhileStandalone() {
  if (!isStandalone()) return;

  // לוכד click + auxclick (לחיצת גלגלת = פתיחה חדשה) בשלב ה-capture
  // כדי לקדם את כל המאזינים של הדף.
  const handler = (e) => {
    const a = findAnchor(e.target);
    if (!a) return;
    const href = a.getAttribute("href");
    if (!isOutOfScope(href)) return;
    e.preventDefault();
    e.stopPropagation();
    // פותח בדפדפן הרגיל; noopener מנתק את ה-window.opener לבטיחות.
    window.open(a.href, "_blank", "noopener,noreferrer");
  };
  document.addEventListener("click", handler, true);
  document.addEventListener("auxclick", handler, true);

  // אם איכשהו קוד JS יבצע location.assign / .replace לאתר חיצוני,
  // נחזיר את הניווט החוצה לדפדפן הראשי. זה לא חוסם 100% (אי-אפשר
  // לחסום את location.href = ...) אבל סוגר את הוקטורים השכיחים.
  const origAssign = location.assign.bind(location);
  const origReplace = location.replace.bind(location);
  location.assign = function (url) {
    if (isOutOfScope(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    return origAssign(url);
  };
  location.replace = function (url) {
    if (isOutOfScope(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    return origReplace(url);
  };
}
