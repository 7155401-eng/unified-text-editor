// help_center.js — מדריך קריא ומורחב מתוך האתר עצמו.
// אין תלות בשרת: התוכן זמין גם אם שירות חיצוני אינו זמין.

const STYLE_ID = "ravtext-help-center-style";
const MODAL_ID = "ravtext-help-center";
const BACKDROP_ID = "ravtext-help-center-backdrop";

const SECTIONS = [
  {
    id: "start",
    title: "התחלה מהירה",
    items: [
      ["איך מתחילים?", "טוענים מסמך Word או מדביקים טקסט, מסדרים את החלוניות והזרמים לפי הצורך, ואז לוחצים על רנדר כדי לבנות את תצוגת העמודים."],
      ["מה ההבדל בין העורך לתצוגת העמודים?", "החלוניות הן מקור הטקסט והעריכה. אזור העמודים הוא תוצאה מחושבת שאפשר לבנות מחדש בכל עת בלי למחוק את הטקסט שבחלוניות."],
      ["האם העבודה נשמרת?", "המערכת שומרת את המסמך וההגדרות לפי מנגנוני השמירה של החשבון והדפדפן. לפני פעולה גדולה מומלץ גם לייצא עותק ל-Word."],
    ],
  },
  {
    id: "import",
    title: "ייבוא ועריכת תוכן",
    items: [
      ["ייבוא Word", "כפתור ייבוא Word קורא מסמך קיים ומכניס אותו לעורך. במסמכים מורכבים מומלץ לעבור על הכותרות, ההערות והסגנונות אחרי הייבוא."],
      ["חלוניות וזרמים", "הטקסט הראשי נמצא בחלונית הראשית. פירושים והערות יכולים להישמר בזרמים נפרדים, כאשר סימני הזרם בטקסט הראשי קושרים בין המקור להערה."],
      ["פיצול ואיחוד", "אפשר לפצל תוכן לחלוניות לצורך עבודה מסודרת, ולאחד אותו שוב. לפני איחוד גדול מומלץ לבצע שמירה או ייצוא."],
      ["חיפוש והחלפה", "השתמש בכלי החיפוש וההחלפה לעריכות חוזרות. לפני החלפה רחבה בדוק התאמה אחת או שתיים כדי לוודא שהביטוי מדויק."],
    ],
  },
  {
    id: "streams",
    title: "זרמים, הערות וגפ״ת",
    items: [
      ["סימון כזרם", "מסמנים קטע בטקסט הראשי ובוחרים את הזרם הרצוי. הקטע מועבר לזרם ונשאר במקומו סימן הקישור המתאים."],
      ["כותרות זרם", "בהגדרות הזרמים אפשר לקבוע שם, סגנון וכותרת לכל זרם. ההגדרות משפיעות על הרינדור הבא."],
      ["הערות בתוך הערות", "כאשר האפשרות פעילה, אפשר לקשר זרם הערות לזרם אחר וליצור מבנה מקונן. כדאי להגדיר קשרים מפורשים כדי למנוע שיוך לא רצוי."],
      ["מצב גפ״ת", "מצב גפ״ת משתמש במנוע העימוד הייעודי של רב טקסט. חלוקת הראשי, הכתר, הצדדים וההערות מחושבת לפי הגדרות המסמך והזרמים."],
    ],
  },
  {
    id: "render",
    title: "רינדור ותצוגת עמודים",
    items: [
      ["מה עושה רנדר?", "רנדר מחשב מחדש את חלוקת הטקסט לעמודים לפי התוכן וההגדרות הנוכחיים. שינוי טקסט או הגדרה משמעותית מצריך רינדור חדש כדי לראות את התוצאה."],
      ["טווח עמודים", "לאחר שהרינדור מתחיל נפתחת בחלון ההתקדמות אפשרות לבחור טווח עמודים. ברירת המחדל היא ללא הגבלה. אם מסמנים טווח, אפשר לקבוע עמוד התחלה ועמוד סיום."],
      ["עצירת רינדור", "אם יש כפתור עצירה בחלון ההתקדמות, אפשר לעצור רינדור פעיל. המערכת משתדלת להשאיר את התצוגה התקינה האחרונה ולא להחליף אותה בתוצאה חלקית."],
      ["תמונות ממוזערות וניווט", "בסרגל התצוגה אפשר לעבור בין עמודים, לפתוח תמונות ממוזערות, לשנות זום ולחפש טקסט בתוצאה."],
    ],
  },
  {
    id: "design",
    title: "עיצוב וסגנונות",
    items: [
      ["סגנונות מסמך", "אפשר לקבוע גופן, גודל, ריווח והגדרות נוספות למסמך ולזרמים. חלק מהאפשרויות שייכות לטקסט הנבחר וחלקן לכל המסמך."],
      ["מילת פתיח", "הגדרות מילת הפתיח משפיעות על מיקומה וגודלה בתוך העימוד. במצב גפ״ת המנוע מתחשב בשטח שהיא תופסת בזמן חלוקת השורות."],
      ["מספרי עמוד וכותרות", "הגדרות המסמך מאפשרות להוסיף רכיבי עמוד כגון מספרי עמוד וכותרות. שינויים כאלה נראים לאחר רינדור."],
    ],
  },
  {
    id: "export",
    title: "שמירה, Word ו-PDF",
    items: [
      ["ייצוא ל-Word", "יוצר מסמך Word מהתוכן הנוכחי ככל שניתן לשמר את המבנה והעיצוב."],
      ["PDF", "אפשר להוריד PDF או להשתמש בהדפסה. אם נבחר טווח עמודים ברינדור, הפלט מיועד לכלול את העמודים שנבחרו בלבד."],
      ["לפני פעולה גדולה", "לפני ייבוא מחדש, איפוס, שינוי מבני רחב או ניסוי בעימוד מורכב, מומלץ לשמור עותק נוסף של המסמך."],
    ],
  },
  {
    id: "trouble",
    title: "פתרון בעיות",
    items: [
      ["התצוגה ריקה אבל הטקסט קיים", "לחץ על רנדר. הטקסט נשמר בחלוניות גם כאשר תצוגת העמודים עדיין לא נבנתה."],
      ["הרינדור נראה תקוע", "בדוק את חלון ההתקדמות ואת שורת המצב. במסמך גדול שלבי מדידה וסידור סופי יכולים להימשך גם אחרי שכבר נבנו עמודים."],
      ["תוצאה לא צפויה אחרי שינוי", "נסה רינדור חדש לאחר סיום השינוי. אם הבעיה חוזרת, השתמש בכפתור דיווח באג וצרף תיאור מדויק של הפעולות שביצעת."],
      ["יצירת קשר", "כפתור צור קשר מיועד לשאלה, בקשה או הצעה. הפנייה נשמרת במערכת ונשלחת גם לצוות במייל."],
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
