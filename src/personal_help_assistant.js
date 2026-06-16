const A="data-rav-help-attached",S="data-rav-help-skip",D="rav-help-dot",W="rav-help-wrap",C="rav-help-card",Q="button,[role='button'],select,input:not([type='hidden']),textarea,h1,h2,h3,h4,h5,h6,[role='heading']";
const M={
"engine-render":["רינדור עמודים","הכפתור מחובר לפקודת engine-render: הקוד קורא למנוע העימוד, קורא את מצב העורך וההגדרות, בונה מחדש את דפי הפלט ומעדכן את אזור התצוגה."],
"word-import":["ייבוא Word","הפקודה מפעילה את מסלול ייבוא Word: קריאת קובץ, המרה למבנה פנימי של העורך, ואז הכנסת התוכן לחלונית הפעילה."],
"word-import-streams":["ייבוא Word עם זרמים","הפקודה מפעילה ייבוא שמנסה לזהות במסמך Word כמה זרמי תוכן ולהעביר אותם לחלוניות או אזורי עימוד נפרדים."],
"word-export":["שמירה ל־Word","הפקודה מרכיבה קובץ Word מתוך מצב העורך: טקסט, מבנה, אזורים וסגנונות שהמערכת יודעת לייצא."],
"styles-io":["סגנונות","הפקודה מפעילה ייבוא או ייצוא של הגדרות סגנון, כדי להעביר מראה ועיצוב בין מסמכים בלי לערוך ידנית כל פריט."],
"pane-add":["הוספת חלונית","הפקודה קוראת למנהל החלוניות ויוצרת חלונית עריכה נוספת עם עורך עצמאי."],
"pane-remove":["הסרת חלונית","הפקודה מבקשת ממנהל החלוניות להסיר את החלונית הפעילה ולעדכן את מבנה העבודה."],
"split-to-panes":["פיצול לחלוניות","הקוד מנתח את תוכן המסמך, מזהה סימוני זרם פנימיים, ומפצל את התוכן לחלוניות עבודה נפרדות."],
"merge-from-panes":["איחוד חלוניות","הקוד קורא את תוכן החלוניות הפעילות, מחבר אותו לפי סדר המערכת, ומחזיר תוצאה למסמך הראשי."],
"preview-toggle":["תצוגה מקדימה","הפקודה מחליפה את מצב אזור הפלט: הצגה או הסתרה של התוצאה שנוצרה ממנוע העימוד."],
"sync-toggle":["סנכרון גלילה","הפקודה מחברת בין גלילת העריכה לגלילת הפלט, כדי שתנועה באזור אחד תעדכן את המיקום באזור השני."],
"auto-parse":["זיהוי מבנה","הקוד מעביר את הטקסט דרך מנתח מבנה שמנסה לזהות חלוקות, זרמים ואזורים לפי כללי המערכת."],
"insert-table":["טבלה","הפקודה מבקשת גודל, בונה צומת טבלה פנימי, ומכניסה אותו לעץ המסמך של העורך הפעיל."],
"insert-math":["נוסחה","הקוד טוען KaTeX בעת הצורך, מרנדר נוסחת LaTeX, ומכניס את התוצאה כרכיב למסמך."],
"insert-mermaid":["תרשים","הקוד טוען Mermaid בעת הצורך, מרנדר קוד תרשים ל־SVG, ומכניס את התרשים למסמך."],
"insert-comment":["הערה","הקוד מבקש טקסט הערה ומוסיף אותו כסימון סביב הבחירה או במקום הסמן."],
"auto-number-clauses":["מספור סעיפים","הקוד סורק פסקאות בעורך ומוסיף מספור עברי לפסקאות שעדיין אינן ממוספרות."],
"insert-chapter-heading":["כותרת פרק","הקוד מבקש מספר וכותרת, מכניס כותרת h2 ייעודית, ולאחריה פסקה ריקה להמשך כתיבה."],
"theme-toggle":["מצב תצוגה","הקוד מחליף מחלקת עיצוב ושומר את הבחירה בדפדפן כדי שהמצב יישמר גם לאחר רענון."],
"lang-toggle":["שפת ממשק","הקוד מחליף את שפת הממשק ומרענן רכיבי תצוגה בהתאם למנגנון התרגום."]
};
const I={
"btn-render":M["engine-render"],
"btn-fullscreen":["מסך מלא","הקוד מפעיל requestFullscreen או exitFullscreen, ואז מאזין ל־fullscreenchange כדי לעדכן את מצב הכפתור."],
"zoom-slider":["זום","הקוד מעדכן משתנה CSS של קנה מידה, משנה את תצוגת הדפים, ומחזיק את הערך ב־localStorage."],
"zoom-reset":["איפוס זום","הקוד מחזיר את בקרת הזום ל־100% ומריץ מחדש את פונקציית ההחלה של הזום."],
"formatting-marks-toggle":["סימני עיצוב","הקוד מחליף מחלקה על body כדי להציג או להסתיר סימוני עיצוב, ושומר את המצב בדפדפן."],
"spellcheck-toggle":["בדיקת איות","הקוד מעדכן spellcheck על עורכי ProseMirror וגם על editorProps של TipTap."],
"word-file-input":["קובץ Word","זה שדה הקובץ שממנו מנגנון הייבוא קורא את הקובץ לפני המרה לתוכן העורך."]
};
function text(v){return String(v||"").replace(/\s+/g," ").trim()}
function heading(e){return e.matches?.("h1,h2,h3,h4,h5,h6,[role='heading']")}
function code(e){if(heading(e))return{t:"h",tag:e.tagName.toLowerCase(),id:e.id||"",cls:text(e.className||""),lvl:e.getAttribute("aria-level")||e.tagName.replace(/\D/g,"")};if(e.dataset?.cmd)return{t:"cmd",v:e.dataset.cmd};if(e.id)return{t:"id",v:e.id};if(e.dataset?.ribbonTab)return{t:"rib",v:e.dataset.ribbonTab};if(e.dataset?.stream)return{t:"stream",v:e.dataset.stream};if(e.dataset?.mul)return{t:"stress",v:e.dataset.mul};return{t:"node",tag:e.tagName.toLowerCase(),role:e.getAttribute("role")||"",cls:text(e.className||"")}}
function byCmd(c){
 if(M[c])return M[c];
 let m=c.match(/^h([1-6])$/);if(m)return[`כותרת ${m[1]}`,`הקוד מגדיר את הבלוק הפעיל ככותרת ברמה ${m[1]} בתוך עץ המסמך.`];
 m=c.match(/^stream-(0[1-8])$/);if(m)return[`זרם ${m[1]}`,`הקוד מריץ toggleStream("${m[1]}") ומסמן את הבחירה כשייכת לזרם הזה.`];
 if(c==="stream-clear")return["ניקוי זרם","הקוד מריץ unsetStream ומסיר מהבחירה שיוך לזרם."];
 if(/^stream-/.test(c))return["ניווט זרמים","הקוד מחפש סימוני זרם במסמך ומעביר אליהם מיקוד, סימון או ספירה."];
 if(/^(bold|italic|underline|strike|super|sub|bullet|ordered|check|blockquote|code-|align-|rtl|ltr|link|unlink|clear|undo|redo)/.test(c))return["פקודת עריכה","הקוד מריץ פקודת TipTap על העורך הפעיל: שינוי mark, block, כיוון, יישור, קישור או היסטוריית עריכה לפי שם הפקודה."];
 if(/^size-/.test(c))return["גודל טקסט","הקוד מחשב ערך גודל ומחיל אותו על הבחירה או על מצב ההקלדה הבא."];
 if(/^font-|^indent-/.test(c))return["סגנון פסקה","הקוד מעדכן סגנון טקסט או הזחה לפי מזהה הפקודה."];
 if(/^table-/.test(c))return["פעולת טבלה","הקוד מאתר את צומת הטבלה סביב הסמן ומוסיף או מוחק שורה, עמודה או את הטבלה כולה."];
 return[`פקודת קוד: ${c}`,`הכפתור מחובר ל־data-cmd="${c}" במאזין הקליקים המרכזי. זהו הסבר לפי מזהה הקוד ולא לפי הכיתוב שעל הכפתור.`]
}
function info(e){let c=code(e);if(c.t==="h"){let a=[`תג ${c.tag}`];if(c.id)a.push(`id=${c.id}`);if(c.cls)a.push(`class=${c.cls}`);return[`כותרת מבנית${c.lvl?` ברמה ${c.lvl}`:""}`,`זו כותרת HTML שמגדירה מדרג או אזור בממשק. היא אינה מפעילה פעולה; הקוד משתמש בתג, במזהה ובמחלקות שלה לסידור, ניווט וסגנון. ${a.join(" · ")}.`]}if(c.t==="cmd")return byCmd(c.v);if(c.t==="id"&&I[c.v])return I[c.v];if(e.classList?.contains("ribbon-tab"))return["לשונית רצועת כלים",`הקוד מפעיל activateTab("${c.v||e.dataset?.ribbonTab||""}"), שומר את הלשונית ב־localStorage, ומציג את קבוצות הכלים שלה.`];if(e.classList?.contains("ribbon-collapse-toggle"))return["קיפול רצועה","הקוד מחליף מחלקת ribbon-collapsed על body ושומר את המצב בדפדפן."];if(e.classList?.contains("preview-minimize-toggle"))return["מזעור תצוגה","הקוד מחליף preview-minimized, מעדכן aria-pressed, ושומר את ההעדפה."];if(e.classList?.contains("btn-stream"))return["סימון זרם",`הקוד מריץ toggleStream("${e.dataset?.stream||""}") על העורך הפעיל.`];if(e.classList?.contains("btn-stream-jump"))return["קפיצה לזרם",`הקוד מחפש את הזרם ${e.dataset?.stream||""}, מעביר אליו מיקוד ומבליט את המקום.`];if(e.classList?.contains("btn-stress"))return["בדיקת עומס",`הקוד מכפיל תוכן דוגמה פי ${e.dataset?.mul||""}, טוען אותו ומרנדר מחדש.`];if(c.t==="id")return[`רכיב קוד: ${c.v}`,`הרכיב מזוהה לפי id="${c.v}". אין שימוש בכיתוב שעל המסך; כדי לפרט עוד צריך לחבר את המזהה לפונקציית ההאזנה שלו.`];return["רכיב ממשק",`הרכיב נסרק לפי tag="${c.tag}"${c.role?` role="${c.role}"`:""}${c.cls?` class="${c.cls}"`:""}. ההסבר מבוסס על מבנה הקוד ולא על הטקסט המוצג.`]}
function vis(e){if(!e||e.nodeType!==1||e.hasAttribute(A)||e.getAttribute(S)==="1"||e.hidden||e.disabled)return false;if(e.closest?.(`#${C},.${W}`))return false;let s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0}
function style(){if(document.getElementById("rav-help-style"))return;let s=document.createElement("style");s.id="rav-help-style";s.textContent=`.${W}{display:inline-flex!important;vertical-align:super!important;margin-inline:3px!important;line-height:1!important}.${D}{all:initial!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:15px!important;height:15px!important;border-radius:50%!important;border:1px solid rgba(24,90,189,.55)!important;background:rgba(255,255,255,.58)!important;color:#1453b5!important;font:800 10px/1 Arial,sans-serif!important;cursor:help!important;box-shadow:0 2px 8px rgba(20,83,181,.28)!important;backdrop-filter:blur(7px)!important;-webkit-backdrop-filter:blur(7px)!important;opacity:.88!important;transform:translateY(-.15em) scale(1)!important;transition:transform .14s ease,opacity .14s ease,box-shadow .14s ease,background .14s ease!important}.${D}:hover,.${D}:focus-visible{opacity:1!important;background:rgba(255,255,255,.82)!important;transform:translateY(-.15em) scale(1.38)!important;box-shadow:0 4px 14px rgba(20,83,181,.45)!important;outline:2px solid rgba(24,90,189,.25)!important}#${C}{position:fixed;z-index:2147483000;max-width:min(390px,calc(100vw - 24px));background:rgba(255,255,255,.78);color:#182230;border:1px solid rgba(80,120,190,.32);border-radius:16px;box-shadow:0 18px 45px rgba(0,0,0,.24);padding:14px 16px;font:14px/1.65 system-ui,Arial,sans-serif;direction:rtl;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform .14s ease}#${C}:hover{transform:scale(1.025)}#${C} h3{margin:0 0 7px;font-size:16px;color:#1453b5}#${C} p{margin:0}#${C} button{margin-top:12px;border:1px solid rgba(24,90,189,.25);background:rgba(248,250,255,.85);border-radius:999px;padding:5px 12px;cursor:pointer}`;document.head.appendChild(s)}
function close(){document.getElementById(C)?.remove()}function put(p,t,v){let n=document.createElement(t);n.textContent=v;p.appendChild(n);return n}
function open(d,e){let i=info(e);close();let c=document.createElement("aside");c.id=C;c.setAttribute("role","dialog");put(c,"h3",i[0]);put(c,"p",i[1]);let b=put(c,"button","סגור");b.type="button";b.onclick=close;document.body.appendChild(c);let r=d.getBoundingClientRect(),p=10,top=r.bottom+8,left=Math.min(Math.max(p,r.left),innerWidth-c.offsetWidth-p);if(top+c.offsetHeight>innerHeight-p)top=Math.max(p,r.top-c.offsetHeight-8);c.style.top=top+"px";c.style.left=left+"px"}
function add(e){if(!vis(e))return;let i=info(e);e.setAttribute(A,"1");let d=document.createElement("span");d.className=D;d.textContent="?";d.title=i[0]+" — "+i[1];d.setAttribute(S,"1");d.setAttribute("role","button");d.setAttribute("tabindex","0");d.setAttribute("aria-label","עזרה לפי הקוד: "+i[0]);d.onclick=ev=>{ev.preventDefault();ev.stopPropagation();open(d,e)};d.onkeydown=ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();open(d,e)}};let w=document.createElement("span");w.className=W;w.setAttribute(S,"1");w.appendChild(d);try{e.insertAdjacentElement("afterend",w)}catch{e.parentNode?.insertBefore(w,e.nextSibling)}}
function scan(root=document){if(!root.querySelectorAll)return;(root.matches?.(Q)?[root,...root.querySelectorAll(Q)]:[...root.querySelectorAll(Q)]).forEach(add)}
function install(){if(!document.body)return;style();scan();let t=0,l=r=>{clearTimeout(t);t=setTimeout(()=>scan(r||document),120)};new MutationObserver(ms=>{for(let m of ms)if(m.type==="childList")for(let n of m.addedNodes)n.nodeType===1&&l(n)}).observe(document.body,{childList:true,subtree:true});document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});document.addEventListener("click",e=>{if(!e.target.closest?.(`#${C},.${D}`))close()},true)}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",install,{once:true}):install();
export{scan as refreshPersonalHelpAssistant};
