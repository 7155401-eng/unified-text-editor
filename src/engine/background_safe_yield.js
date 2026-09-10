// background_safe_yield.js
//
// משה 09/09/2026: „יש חסרון משמעותי שכשהחלון לא עליון הרינדור נעצר,
// תקן את זה.”
//
// ## למה זה קרה
// בין עמוד לעמוד המנוע „נושם” — הוא מוסר את התור לדפדפן לרגע, כדי
// שהמסך לא ייתקע. עד היום הנשימה הזאת נעשתה בשני מנגנונים:
//
//   requestAnimationFrame  — „תעיר אותי לפני הציור הבא”
//   requestIdleCallback    — „תעיר אותי כשיהיה לך רגע פנוי”
//
// שניהם קשורים ל**ציור על המסך**. וכשהחלון יורד לרקע הדפדפן מפסיק
// לצייר — כדי לחסוך סוללה. הראשון נעצר לגמרי. השני נחנק לפעימה אחת
// בערך בשנייה. ואז המנוע יושב ומחכה להערה שלא מגיעה.
//
// זה כמו לומר לעובד „תמשיך אחרי שהאור יידלק” ואז לכבות את האור.
// הוא לא עצל — הוא פשוט מחכה לסימן שלא יגיע.
//
// ## מה עושים במקום
// כשהחלון ברקע עוברים ל-MessageChannel — צינור הודעות פנימי של
// הדפדפן. הוא אינו קשור לציור ואינו נחנק ברקע, ולכן הנשימה ממשיכה
// בקצב מלא גם כשהחלון מוסתר לגמרי.
//
// ⭐ וכשהחלון כן עליון — שום דבר לא משתנה. שם המנגנונים המקוריים
// עדיפים, כי הם מסתנכרנים עם הציור ומונעים ריצוד.

function isHidden() {
  try {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  } catch (_) {
    return false;
  }
}

// צינור ההודעות הפנימי. נוצר פעם אחת ורק אם באמת צריך אותו, כדי
// שלא לפתוח משאב לחינם בכל טעינה של הדף.
let _channel = null;
let _queue = [];

function postViaChannel(fn) {
  try {
    if (typeof MessageChannel !== "function") {
      setTimeout(fn, 0);
      return;
    }
    if (!_channel) {
      _channel = new MessageChannel();
      _channel.port1.onmessage = () => {
        const next = _queue.shift();
        if (next) next();
      };
    }
    _queue.push(fn);
    _channel.port2.postMessage(0);
  } catch (_) {
    setTimeout(fn, 0);
  }
}

// נשימה בין עמוד לעמוד. מחזירה הבטחה שנפתרת ברגע שהדפדפן פנוי —
// וברקע, ברגע שההודעה הפנימית חוזרת.
export function yieldToBrowser() {
  return new Promise((resolve) => {
    if (isHidden()) {
      postViaChannel(resolve);
      return;
    }
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 50 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

// „תעשה את זה אחרי שהמסך יצויר.” ברקע אין ציור, ולכן פשוט עושים
// את זה מיד — אחרת הפעולה לא קורית כלל עד שמשה יחזור לחלון.
export function afterPaint(fn) {
  if (typeof fn !== "function") return;
  if (isHidden()) {
    postViaChannel(fn);
    return;
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fn());
    return;
  }
  setTimeout(fn, 0);
}

// לבדיקות בלבד — מאפשר לדמות חלון מוסתר בלי דפדפן אמיתי.
export const _internals = { isHidden, postViaChannel };
