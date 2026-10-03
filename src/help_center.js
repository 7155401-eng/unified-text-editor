// help_center.js — מדריך קריא ומורחב מתוך האתר עצמו.
// אין תלות בשרת: התוכן זמין גם אם שירות חיצוני אינו זמין.

const STYLE_ID = "ravtext-help-center-style";
const MODAL_ID = "ravtext-help-center";
const BACKDROP_ID = "ravtext-help-center-backdrop";

const SECTIONS = [
  {
    id: "streams-core",
    title: "איך רב טקסט עובד — זרמים וקישורים",
    items: [
      ["מה הם „טקסט ראשי” ו„זרמים”?", "הטקסט הראשי הוא גוף המסמך. כל פירוש, הערה או שכבת טקסט נוספת יכולה לשבת בחלונית זרם נפרדת. הקשר בין הראשי לזרם נשמר באמצעות סימני @NN, כגון @01 או @02."],
      ["איך הופכים קטע מתוך הראשי לזרם?", "מסמנים קטע בחלונית הראשית ולוחצים על כפתור הזרם המתאים בשורת „סמן בחירה כזרם”. הקטע עובר לחלונית הזרם, ובמקומו נשאר סימן @NN שמקשר למיקום ההערה."],
      ["איך עובדים עם מסמך שכבר מכיל סימני @NN?", "הכפתור „פצל לחלוניות” קורא את סימני @NN שבטקסט הראשי, משאיר בראשי את סימני הקישור, ויוצר או מעדכן חלונית נפרדת לכל זרם שנמצא."],
      ["איך מאחדים את הזרמים בחזרה?", "הכפתור „אחד” מחבר את תוכן חלוניות הזרמים בחזרה לטקסט הראשי לפי סימני הקישור. יש גם „מזג / פרק” לעבודה במצב משולב בלי לבטל את מבנה הזרמים."],
      ["אפשר לקשר הערה לזרם אחר ולא רק לטקסט הראשי?", "כן. קיימת אפשרות „תמיכה בהערות להערות”, ובכל חלונית זרם יש מנגנון לקביעת הזרמים שאליהם ההערות שלה רשאיות להשתייך. ברירת המחדל נשארת קישור לטקסט הראשי."],
      ["איך בודקים לאן זרם מסוים הגיע בתוצאה?", "בשורת „קפוץ לזרם” אפשר לבחור זרם, ורב טקסט גולל למופע שלו בתצוגת העמודים לאחר רינדור."],
    ],
  },
  {
    id: "layouts",
    title: "פריסות — איך הזרמים מסודרים בדף",
    items: [
      ["אילו פריסות אפשר לקבוע לזרם?", "בהגדרות כל זרם קיים שדה „פריסה”. האפשרויות הפעילות הן ברירת מחדל, גמרא (כתר), משנה ברורה, תרגום אונקלוס והערות צד."],
      ["אפשר לבחור מיקום לזרם בצד הדף?", "בפריסות שבהן המיקום רלוונטי, כגון אונקלוס והערות צד, קיים שדה „מיקום” עם פנימי, חיצוני, ימין או שמאל."],
      ["מהו מצב גפ״ת?", "בכרטיסיית הפריסה אפשר להפעיל „גפ״ת: צורת הדף”, לבחור עד שני זרמי גפ״ת, לקבוע את מספר שורות הכתר, את אחוז רוחב הראשי ואת סדר הצדדים."],
      ["מהו מצב משנה ברורה?", "אפשר להפעיל „משנה ברורה: גלישה” ולחלק זרמים לרמות. המערכת משתמשת ברמות האלה כדי לארגן את הזרמים סביב הראשי."],
      ["אפשר להגדיר כמה טורים לכל זרם?", "כן. בהגדרות הזרם קיימים „טורים” ו„מינ׳ שורות לטור”, כך שאפשר לשלוט במספר הטורים ובסף שממנו החלוקה לטורים נכנסת לפעולה."],
      ["אפשר לשנות את מבנה החלוניות בזמן העריכה?", "כן. הכפתור „זרמים לרוחב” מחליף בין תצוגת חלוניות זו לצד זו לבין תצוגה מוערמת, בלי לשנות את תוכן המסמך."],
    ],
  },
  {
    id: "design",
    title: "עיצוב — כללי ולפי זרם",
    items: [
      ["אפשר לתת עיצוב שונה לכל זרם?", "כן. לכל זרם יש בחירת „סגנון זרם”, „סגנון כותרת”, אפשרות להציג או להסתיר כותרת זרם, ושליטה בפס הכותרת."],
      ["מה אפשר לקבוע לכותרת הזרם?", "אפשר לבחור סגנון כותרת, להציג או להסתיר אותה, לבחור סגנון פס מוכן או ידני, ולשלוט בצבע ובעובי הפס."],
      ["אפשר לשלוט בעיצוב של טקסט מודגש בתוך זרם?", "כן. קיימת אפשרות „סגנון מותאם לבולד”, עם בחירת סגנון ייעודי ואפשרות שהסגנון הנבחר יגבר על עיצוב פנימי שהגיע מהמסמך."],
      ["איך מעצבים את הטקסט הראשי?", "קיים „סגנון טקסט ראשי” שמסונכרן עם „זרם ראשי” ברשימת הזרמים. בנוסף יש כלי עיצוב רגילים לטקסט נבחר, כולל גופן, גודל, הדגשה, יישור וסגנונות."],
      ["יש תמיכה במילה פותחת?", "כן. אפשר להפעיל „מילה פותחת”, לבחור אם היעד הוא מילה, אות או מספר מילים, ולקבוע מצב, גודל, גופן ורווחים."],
      ["אפשר להוסיף מספרי עמוד, כותרת עליונה ותחתונה?", "כן. מנגנון תכונות המסמך כולל מספרי עמוד, כותרת עליונה וכותרת תחתונה, והם מוחלים על העמודים המרונדרים."],
    ],
  },
  {
    id: "import",
    title: "ייבוא והכנת המסמך",
    items: [
      ["אפשר לטעון קובץ Word?", "כן. הכפתור „טען מ-Word” פותח ייבוא Word ומאפשר לבחור זרמים ולהגדיר את סימני הקישור שלהם."],
      ["מה עושים אחרי ייבוא Word מורכב?", "בודקים שהטקסט הראשי, הזרמים וסימני הקישור הגיעו למקומות הנכונים; לאחר מכן אפשר להשתמש ב„פצל לחלוניות” כדי לעבוד בכל זרם בנפרד."],
      ["יש חיפוש והחלפה?", "כן. קיים כלי חיפוש והחלפה בעורך, ובתצוגת העמודים יש גם חיפוש נפרד בפלט המרונדר."],
      ["אפשר לעבוד עם הרבה זרמים?", "כן. המערכת תומכת בקודי זרם מספריים, כולל קוד מותאם אישית, ויוצרת חלוניות זרם לפי הצורך."],
    ],
  },
  {
    id: "render",
    title: "רינדור ותצוגת עמודים",
    items: [
      ["מה עושה כפתור רנדר?", "הוא בונה מחדש את תצוגת העמודים לפי הטקסט, הזרמים, הפריסות והגדרות העיצוב הנוכחיות."],
      ["אפשר לרנדר רק חלק מהעמודים?", "כן. אחרי שהרינדור התחיל, חלון ההתקדמות מציג „רנדר רק טווח עמודים”. ברירת המחדל כבויה; אם מפעילים אותה, קובעים עמוד התחלה ועמוד סיום."],
      ["אפשר לעצור רינדור?", "כן. בחלון ההתקדמות יש כפתור „עצור” שמבקש לעצור את הרינדור הפעיל."],
      ["מה אפשר לעשות בתצוגת העמודים?", "יש לוח עמודים ממוזער, ניווט לעמוד ראשון/קודם/הבא, זום, חיפוש בתוך הפלט, הדפסה והורדת PDF."],
    ],
  },
  {
    id: "save-export",
    title: "שמירה וייצוא",
    items: [
      ["האם המסמך נשמר?", "למשתמש מחובר קיימת שמירת מסמך והגדרות דרך מנגנון השמירה של האתר, ובמקביל קיימים מנגנוני התאוששות מקומיים בדפדפן."],
      ["אפשר לשמור בחזרה ל-Word?", "כן. באתר קיים הכפתור „שמור ל-Word” לייצוא המסמך."],
      ["אפשר להוריד PDF או להדפיס?", "כן. בסרגל תצוגת העמודים קיימים כפתורי PDF והדפסה. כאשר נבחר טווח עמודים, הפלט משתמש בעמודים שבטווח."],
    ],
  },
  {
    id: "trouble",
    title: "פתרון בעיות",
    items: [
      ["הטקסט קיים אבל אין עמודים בתצוגה", "לחצו על „רנדר”. אזור התצוגה יכול להיות ריק גם כשהטקסט עצמו עדיין נמצא בחלוניות העריכה."],
      ["שיניתי פריסה או עיצוב ולא רואים את השינוי", "בנו את התצוגה מחדש באמצעות רנדר. חלק מהגדרות הפריסה והעיצוב נכנסות לפלט רק בזמן בניית העמודים."],
      ["איך שולחים תקלה או שאלה?", "בכותרת האתר קיימים „דיווח באג” ו„צור קשר”. הפנייה נשמרת בלוח המנהל ונשלחת גם כהתראת מייל לצוות."],
    ],
  },
];

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${BACKDROP_ID}{position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:18px}
#${MODAL_ID}{direction:rtl;width:min(980px,96vw);height:min(780px,92vh);background:#fff;color:#172033;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.3);display:grid;grid-template-rows:auto 1fr;overflow:hidden;font-family:var(--ravtext-ui-font-family,"Heebo","Segoe UI",Arial,sans-serif)}
#${MODAL_ID} .rth-head{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#f8fbff,#fffaf0)}
#${MODAL_ID} h2{margin:0;font-size:22px;flex:1;color:#17325c}
#${MODAL_ID} .rth-search{width:min(340px,42vw);padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;background:#fff}
#${MODAL_ID} .rth-close{border:0;background:transparent;font-size:28px;line-height:1;cursor:pointer;color:#64748b;padding:4px 8px}
#${MODAL_ID} .rth-body{display:grid;grid-template-columns:210px 1fr;min-height:0}
#${MODAL_ID} .rth-nav{padding:14px;border-left:1px solid #e2e8f0;background:#f8fafc;overflow:auto}
#${MODAL_ID} .rth-nav button{display:block;width:100%;text-align:right;border:0;background:transparent;padding:9px 10px;border-radius:8px;cursor:pointer;font:600 13px/1.35 inherit;color:#334155}
#${MODAL_ID} .rth-nav button:hover,#${MODAL_ID} .rth-nav button.active{background:#e8eefb;color:#1e3a8a}
#${MODAL_ID} .rth-content{padding:20px 24px 30px;overflow:auto;scroll-behavior:smooth}
#${MODAL_ID} .rth-section{margin:0 0 26px}
#${MODAL_ID} .rth-section h3{margin:0 0 10px;font-size:19px;color:#1e3a8a}
#${MODAL_ID} details{border:1px solid #e2e8f0;border-radius:10px;margin:8px 0;background:#fff}
#${MODAL_ID} summary{cursor:pointer;font-weight:700;padding:11px 13px;color:#243b64}
#${MODAL_ID} details p{margin:0;padding:0 13px 13px;color:#475569;line-height:1.65;font-size:14px}
#${MODAL_ID} .rth-empty{padding:40px;text-align:center;color:#64748b}
@media(max-width:720px){#${MODAL_ID}{height:94vh}#${MODAL_ID} .rth-head{flex-wrap:wrap}#${MODAL_ID} .rth-search{order:3;width:100%}#${MODAL_ID} .rth-body{grid-template-columns:1fr}#${MODAL_ID} .rth-nav{display:flex;gap:6px;overflow:auto;border-left:0;border-bottom:1px solid #e2e8f0}#${MODAL_ID} .rth-nav button{width:auto;white-space:nowrap}#${MODAL_ID} .rth-content{padding:16px}}
`;
  document.head.appendChild(style);
}

function closeHelpCenter() {
  document.getElementById(BACKDROP_ID)?.remove();
}

function buildSections(content, nav, query = "") {
  const q = String(query || "").trim().toLowerCase();
  content.innerHTML = "";
  nav.innerHTML = "";
  let shown = 0;
  for (const section of SECTIONS) {
    const items = section.items.filter(([title, body]) => {
      if (!q) return true;
      return (title + " " + body + " " + section.title).toLowerCase().includes(q);
    });
    if (!items.length) continue;
    shown++;
    const navBtn = document.createElement("button");
    navBtn.type = "button";
    navBtn.textContent = section.title;
    navBtn.addEventListener("click", () => {
      content.querySelector(`#rth-${section.id}`)?.scrollIntoView({ block: "start" });
    });
    nav.appendChild(navBtn);

    const sec = document.createElement("section");
    sec.className = "rth-section";
    sec.id = `rth-${section.id}`;
    const h = document.createElement("h3");
    h.textContent = section.title;
    sec.appendChild(h);
    for (const [title, body] of items) {
      const d = document.createElement("details");
      if (q) d.open = true;
      const s = document.createElement("summary");
      s.textContent = title;
      const p = document.createElement("p");
      p.textContent = body;
      d.appendChild(s);
      d.appendChild(p);
      sec.appendChild(d);
    }
    content.appendChild(sec);
  }
  if (!shown) {
    const empty = document.createElement("div");
    empty.className = "rth-empty";
    empty.textContent = "לא נמצאה תשובה מתאימה. אפשר לנסות מילה אחרת או לפנות דרך כפתור צור קשר.";
    content.appendChild(empty);
  }
}

export function openHelpCenter() {
  ensureStyle();
  closeHelpCenter();
  const backdrop = document.createElement("div");
  backdrop.id = BACKDROP_ID;
  backdrop.innerHTML = `
    <section id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="ravtext-help-title">
      <div class="rth-head">
        <h2 id="ravtext-help-title">עזרה ומדריך — רב טקסט</h2>
        <input class="rth-search" type="search" placeholder="חפש במדריך…" aria-label="חיפוש במדריך" />
        <button class="rth-close" type="button" aria-label="סגור">×</button>
      </div>
      <div class="rth-body">
        <nav class="rth-nav" aria-label="נושאי עזרה"></nav>
        <main class="rth-content"></main>
      </div>
    </section>
  `;
  document.body.appendChild(backdrop);
  const modal = backdrop.querySelector(`#${MODAL_ID}`);
  const content = backdrop.querySelector(".rth-content");
  const nav = backdrop.querySelector(".rth-nav");
  const search = backdrop.querySelector(".rth-search");
  buildSections(content, nav);
  backdrop.querySelector(".rth-close")?.addEventListener("click", closeHelpCenter);
  backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closeHelpCenter(); });
  search?.addEventListener("input", () => buildSections(content, nav, search.value));
  const onKey = (ev) => {
    if (ev.key !== "Escape") return;
    document.removeEventListener("keydown", onKey);
    closeHelpCenter();
  };
  document.addEventListener("keydown", onKey);
  modal?.addEventListener("click", (ev) => ev.stopPropagation());
  setTimeout(() => search?.focus(), 0);
}

export function wireHelpCenter() {
  const btn = document.getElementById("btn-help-center");
  if (!btn || btn.dataset.helpCenterBound === "1") return;
  btn.dataset.helpCenterBound = "1";
  btn.addEventListener("click", openHelpCenter);
}
