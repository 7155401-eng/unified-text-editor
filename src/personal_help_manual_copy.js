const ATTR = "data-rav-help-attached";
const SKIP = "data-rav-help-skip";
const DOT = "rav-help-dot";
const WRAP = "rav-help-wrap";
const CARD = "rav-help-card";
const SEL = "button,[role='button'],select,input:not([type='hidden']),textarea,h1,h2,h3,h4,h5,h6,[role='heading']";

const HELP = {
  "nested-notes-toggle": ["הערות בתוך הערות", "מציג או מסתיר הערות שנמצאות בתוך הערות אחרות, כדי לעבוד עם שכבות הסבר בלי להעמיס על המסך."],
  "notes-toggle": ["הערות", "מציג או מסתיר את שכבת ההערות במסמך. מתאים כשצריך לעבור בין קריאה נקייה לבין עבודה עם הערות."],
  "engine-render": ["רינדור עמודים", "בונה מחדש את תצוגת העמודים לפי התוכן וההגדרות הנוכחיים. השתמש בזה אחרי שינוי משמעותי במסמך."],
  "btn-render": ["רינדור עמודים", "מרענן את תצוגת העמודים ומחשב מחדש את החלוקה, המראה והסידור של המסמך."],
  "word-import": ["ייבוא Word", "פותח קובץ Word ומכניס אותו לעורך, כדי שתוכל להמשיך לערוך אותו בתוך המערכת."],
  "word-import-streams": ["ייבוא Word מחולק", "מייבא מסמך Word ומנסה לחלק אותו לחלקים נפרדים, כדי לעבוד על כמה אזורים במקביל."],
  "word-export": ["ייצוא ל־Word", "יוצר קובץ Word מהמסמך הנוכחי, כולל התוכן והעיצוב שניתן לשמור."],
  "word-file-input": ["בחירת קובץ Word", "בחר כאן את קובץ ה־Word שברצונך להכניס לעורך."],
  "styles-io": ["סגנונות", "שומר או טוען הגדרות עיצוב, כדי להשתמש באותו מראה גם במסמכים אחרים."],
  "pane-add": ["הוספת חלונית", "פותח אזור עבודה נוסף לצד האזור הקיים."],
  "pane-remove": ["סגירת חלונית", "סוגר את החלונית הפעילה בלי למחוק את שאר אזורי העבודה."],
  "split-to-panes": ["פיצול לחלוניות", "מחלק את הטקסט לחלקים נפרדים ופותח אותם בחלוניות לעבודה נוחה יותר."],
  "split-special-notes": ["פיצול הערות", "מפריד הערות מיוחדות מהטקסט הראשי ומעביר אותן לאזור נפרד."],
  "merge-toggle": ["מצב איחוד", "מפעיל או מכבה מצב שבו מחברים תוכן מכמה חלוניות למסמך אחד."],
  "toggle-merge": ["מצב איחוד", "מפעיל או מכבה מצב שבו מחברים תוכן מכמה חלוניות למסמך אחד."],
  "merge-from-panes": ["איחוד חלוניות", "אוסף את התוכן מהחלוניות ומחזיר אותו למסמך אחד מסודר."],
  "preview-toggle": ["תצוגה מקדימה", "מציג או מסתיר תצוגה נקייה של המסמך, בלי כלי העריכה סביב הטקסט."],
  "sync-toggle": ["סנכרון", "מחבר בין אזורי העבודה כך ששינוי באזור אחד יוכל להתעדכן גם באזור המקביל."],
  "pane-layout-toggle": ["פריסת חלוניות", "משנה את צורת הסידור של החלוניות על המסך."],
  "lines-toggle": ["שורות", "מציג או מסתיר סימון שורות בתצוגת המסמך."],
  "insert-table": ["הוספת טבלה", "יוצר טבלה במסמך לפי מספר השורות והעמודות שתבחר."],
  "insert-math": ["הוספת נוסחה", "מכניס נוסחה למסמך בצורה מסודרת."],
  "insert-mermaid": ["הוספת תרשים", "יוצר תרשים מטקסט מובנה ומכניס אותו למסמך."],
  "insert-comment": ["הוספת הערה", "מוסיף הערת הסבר לטקסט בלי לשנות את גוף המסמך עצמו."],
  "insert-footnote": ["הערת שוליים", "מוסיף הערה שמיועדת להופיע כהערת שוליים."],
  "insert-toc": ["תוכן עניינים", "מוסיף מקום לתוכן עניינים שמבוסס על כותרות המסמך."],
  "insert-chapter-heading": ["כותרת פרק", "מוסיף כותרת פרק מסודרת כדי לחלק את המסמך לחלקים ברורים."],
  "auto-number-clauses": ["מספור סעיפים", "עובר על סעיפי המסמך ומוסיף להם מספור רציף."],
  "theme-toggle": ["מצב תצוגה", "מחליף בין מראה בהיר למראה כהה."],
  "lang-toggle": ["שפת ממשק", "מחליף את שפת הממשק ואת כיוון התצוגה כאשר קיימת תמיכה בכך."],
  "btn-fullscreen": ["מסך מלא", "מגדיל את אזור העבודה למסך מלא ומחזיר לתצוגה רגילה בלחיצה נוספת."],
  "zoom-slider": ["זום", "משנה את גודל התצוגה של המסמך על המסך. הטקסט עצמו לא משתנה."],
  "zoom-reset": ["איפוס זום", "מחזיר את גודל התצוגה לברירת המחדל."],
  "formatting-marks-toggle": ["סימני עריכה", "מציג סימנים שעוזרים לראות מבנה נסתר כמו רווחים, פסקאות ושבירות שורה."],
  "spellcheck-toggle": ["בדיקת איות", "מפעיל או מכבה בדיקת איות באזור העריכה."],
  "torah-spellcheck-run": ["בדיקה ייעודית", "בודק מילים נבחרות מול מאגר פנימי ומציג מילים שכדאי לעבור עליהן שוב."],
  "btn-format-painter": ["מברשת עיצוב", "מעתיקה עיצוב מטקסט שסימנת ומחילה אותו על טקסט אחר שתבחר אחר כך."],
  "btn-highlight": ["הדגשה בצבע", "מסמן את הטקסט הנבחר בצבע רקע."],
  "btn-highlight-clear": ["ניקוי הדגשה", "מסיר צבע רקע מהטקסט הנבחר."],
  "btn-insert-hr": ["קו מפריד", "מוסיף קו אופקי שמפריד בין חלקים במסמך."],
  "btn-insert-page-break": ["מעבר עמוד", "מכניס סימון שמבקש להתחיל עמוד חדש בנקודה הנוכחית."],
  "btn-insert-hardbreak": ["שבירת שורה", "מוריד שורה בתוך אותה פסקה בלי לפתוח פסקה חדשה."],
  bold: ["הדגשה", "מדגיש את הטקסט הנבחר או את הטקסט שתקליד מכאן והלאה."],
  italic: ["נטוי", "מחיל כתב נטוי על הטקסט הנבחר או על הטקסט הבא שתקליד."],
  underline: ["קו תחתון", "מוסיף קו תחתון לטקסט הנבחר."],
  strike: ["קו מחיקה", "מסמן את הטקסט בקו מחיקה בלי למחוק אותו."],
  link: ["קישור", "הופך את הטקסט הנבחר לקישור."],
  unlink: ["הסרת קישור", "מסיר קישור ומשאיר את הטקסט עצמו."],
  clear: ["ניקוי עיצוב", "מסיר עיצוב מהטקסט הנבחר ומחזיר אותו למראה פשוט יותר."],
  undo: ["ביטול פעולה", "מחזיר את המסמך צעד אחד אחורה."],
  redo: ["שחזור פעולה", "מחזיר פעולה שבוטלה קודם."],
  bullet: ["רשימת נקודות", "הופך את הפסקאות הנבחרות לרשימת נקודות."],
  ordered: ["רשימה ממוספרת", "הופך את הפסקאות הנבחרות לרשימה עם מספרים."],
  check: ["רשימת משימות", "יוצר רשימה שאפשר לסמן בה פריטים שבוצעו."],
  blockquote: ["ציטוט", "מעצב את הפסקה כקטע ציטוט נפרד."],
  "code-block": ["בלוק קוד", "מעצב את הקטע כקוד נפרד עם שמירה על מבנה ושורות."],
  "code-inline": ["קוד קצר", "מעצב מילים בודדות כקוד בתוך שורה."],
  "align-right": ["יישור לימין", "מיישר את הפסקה לצד ימין."],
  "align-center": ["מרכוז", "ממרכז את הפסקה."],
  "align-left": ["יישור לשמאל", "מיישר את הפסקה לצד שמאל."],
  rtl: ["כיוון ימין לשמאל", "מגדיר את כיוון הכתיבה לימין־לשמאל."],
  ltr: ["כיוון שמאל לימין", "מגדיר את כיוון הכתיבה לשמאל־לימין."]
};

const HELP_BY_TEXT = new Map([
  ["רנדר", HELP["engine-render"]],
  ["ייבוא Word עם זרמים מלאים", HELP["word-import-streams"]],
  ["שמור ל-Word", HELP["word-export"]],
  ["+ חלונית", HELP["pane-add"]],
  ["✔ הסר חלונית", HELP["pane-remove"]],
  ["✂ פצל לחלוניות", HELP["split-to-panes"]],
  ["✂ הפרד הערות", HELP["split-special-notes"]],
  ["מזג / פרק", HELP["merge-toggle"]],
  ["↺ אחד", HELP["merge-from-panes"]],
  ["תצוגה", HELP["preview-toggle"]],
  ["גלילה", HELP["sync-toggle"]],
  ["▣ זרמים לרוחב", HELP["pane-layout-toggle"]],
  ["☷ שורות", HELP["lines-toggle"]],
  ["∑ נוסחה", HELP["insert-math"]],
  ["הערה", HELP["insert-comment"]],
  ["תוכן עניינים", HELP["insert-toc"]]
]);

function text(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll?.(`.${WRAP},.${DOT},#${CARD}`).forEach((n) => n.remove());
  return String(clone.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
}

function key(el) {
  return el.getAttribute("data-cmd") ||
    el.id ||
    el.getAttribute("data-ribbon-tab") ||
    el.getAttribute("data-stream") ||
    Array.from(el.classList || []).find((c) => HELP[c]) ||
    "";
}

function info(el) {
  if (el.matches("h1,h2,h3,h4,h5,h6,[role='heading']")) {
    const t = text(el);
    return t ? [t.length > 36 ? `${t.slice(0, 33)}…` : t, "זו כותרת אזור. היא עוזרת להבין באיזה חלק של המסך או המסמך נמצאים."] : null;
  }

  const k = key(el);
  if (HELP[k]) return HELP[k];

  const stream = k.match(/^stream-(0[1-8])$/);
  if (stream) return [`זרם ${stream[1]}`, `מציג או מסתיר את חלק ${stream[1]} בעבודה מרובת־חלקים.`];

  const h = k.match(/^h([1-6])$/);
  if (h) return [`כותרת רמה ${h[1]}`, `מעצב את הפסקה ככותרת ברמה ${h[1]}.`];

  const size = k.match(/^size-(\d+)$/);
  if (size) return [`גודל ${size[1]}`, `משנה את גודל הטקסט הנבחר לגודל ${size[1]}.`];

  const byText = HELP_BY_TEXT.get(text(el));
  if (byText) return byText;

  if (el.tagName === "SELECT") return ["בחירה מתוך רשימה", "בחר ערך מהרשימה כדי לשנות את ההגדרה הקשורה לאזור זה."];
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return ["שדה קלט", "כאן מזינים או עורכים ערך שהמערכת משתמשת בו במסמך או בתצוגה."];

  return null;
}

function clearOld() {
  document.querySelectorAll(`.${WRAP}`).forEach((n) => n.remove());
  document.querySelectorAll(`[${ATTR}]`).forEach((n) => n.removeAttribute(ATTR));
}

function close() {
  document.getElementById(CARD)?.remove();
}

function node(parent, tag, value) {
  const el = document.createElement(tag);
  el.textContent = value;
  parent.appendChild(el);
  return el;
}

function open(dot, target) {
  const data = info(target);
  if (!data) return;
  close();

  const card = document.createElement("aside");
  card.id = CARD;
  card.setAttribute("role", "dialog");
  node(card, "h3", data[0]);
  node(card, "p", data[1]);
  const btn = node(card, "button", "סגור");
  btn.type = "button";
  btn.onclick = close;
  document.body.appendChild(card);

  const rect = dot.getBoundingClientRect();
  const pad = 10;
  let top = rect.bottom + 8;
  const left = Math.min(Math.max(pad, rect.left), innerWidth - card.offsetWidth - pad);
  if (top + card.offsetHeight > innerHeight - pad) top = Math.max(pad, rect.top - card.offsetHeight - 8);
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function add(el) {
  if (!el || el.nodeType !== 1 || el.getAttribute(SKIP) === "1" || el.hidden || el.disabled) return;
  if (el.closest?.(`#${CARD},.${WRAP}`)) return;

  const data = info(el);
  el.setAttribute(ATTR, "1");
  if (!data) return;

  const dot = document.createElement("span");
  dot.className = DOT;
  dot.textContent = "?";
  dot.title = `${data[0]} — ${data[1]}`;
  dot.setAttribute(SKIP, "1");
  dot.setAttribute("role", "button");
  dot.setAttribute("tabindex", "0");
  dot.setAttribute("aria-label", `עזרה: ${data[0]}`);
  dot.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); open(dot, el); };
  dot.onkeydown = (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      open(dot, el);
    }
  };

  const wrap = document.createElement("span");
  wrap.className = WRAP;
  wrap.setAttribute(SKIP, "1");
  wrap.appendChild(dot);
  el.insertAdjacentElement("afterend", wrap);
}

function scan(root = document) {
  if (!root.querySelectorAll) return;
  const items = root.matches?.(SEL) ? [root, ...root.querySelectorAll(SEL)] : [...root.querySelectorAll(SEL)];
  items.forEach(add);
}

function installManualHelp() {
  if (!document.body) return;
  clearOld();
  scan();

  let timer = 0;
  const schedule = (root) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      clearOld();
      scan(root || document);
    }, 160);
  };

  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type !== "childList") continue;
      for (const node of change.addedNodes) {
        if (node.nodeType === 1) schedule(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest?.(`#${CARD},.${DOT}`)) close();
  }, true);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });

  setTimeout(() => schedule(document), 250);
  setTimeout(() => schedule(document), 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installManualHelp, { once: true });
} else {
  installManualHelp();
}
