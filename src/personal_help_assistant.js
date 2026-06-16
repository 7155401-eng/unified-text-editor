// RavText personal contextual help assistant.
// A light DOM layer that places a friendly help face next to every visible control.
const RH_ATTACHED="data-rav-help-attached";
const RH_BTN="rav-help-trigger";
const RH_CARD="rav-help-card";
const RH_SELECTOR="button,a[href],select,textarea,input:not([type='hidden']),[role='button'],[role='switch'],[role='tab']";
const RH_EXACT=new Map([
["רנדר",["רינדור","יוצר מחדש את תצוגת העמודים לפי הטקסט וההגדרות הנוכחיים."]],
["שמור ל-Word",["שמירה ל־Word","מייצא את העבודה למסמך Word לפי התצוגה והסגנונות הנוכחיים."]],
["טען",["טעינה","מכניס תוכן או הגדרות אל סביבת העבודה."]],
["ביטול",["ביטול","סוגר את הפעולה הנוכחית בלי להמשיך אותה."]],
["איפוס",["איפוס","מחזיר את ההגדרה או האזור למצב נקי יותר."]],
["הגדרות",["הגדרות","פותח אפשרויות שמאפשרות להתאים את העבודה להרגלים שלך."]],
["תצוגה",["תצוגה","משנה איך הדברים נראים, בלי לשנות בהכרח את התוכן עצמו."]],
["שמירה",["שמירה","שומר את הבחירה או העבודה כדי שתישאר גם אחרי רענון."]],
["מחיקה",["מחיקה","מסיר פריט או מנקה מידע. כדאי לוודא שזה מה שרצית."]],
["הורדה",["הורדה","מוריד קובץ למחשב או למכשיר שלך."]],
["חיפוש",["חיפוש","מאפשר למצוא טקסט או פריט במהירות."]],
["החלפה",["החלפה","מחליף טקסט קיים בטקסט אחר לפי הבחירה שלך."]],
["ייבוא Word",["ייבוא Word","טוען מסמך Word ומנסה לשמור מבנה, זרמים ועיצוב."]],
["ייצוא Word",["ייצוא Word","מכין קובץ Word מתוך העבודה הנוכחית."]],
["PDF",["ייצוא PDF","מכין קובץ PDF לפי התצוגה הנוכחית."]],
["ניקוד",["ניקוד","עוזר להוסיף או למזג ניקוד בטקסט."]],
["השוואת טקסט",["השוואה","מציג הבדלים בין שני טקסטים כדי לזהות שינוי או חוסר."]],
["זרמים",["זרמים","מנהל חלוקה בין טקסט ראשי, הערות, מקורות ואזורים נוספים."]],
["עמודים",["עמודים","קשור לאופן שבו הטקסט נשבר ומסתדר בעמודי התצוגה."]],
["סגנונות",["סגנונות","שולט במראה הטקסט: גופן, גודל, רווחים וצבעים."]],
["עזרה",["עזרה","פותח הסבר ידידותי על הפעולה שלידך."]]
]);
function rhText(v){return String(v||"").replace(/\s+/g," ").trim();}
function rhVisible(el){
  if(!el||el.nodeType!==1||el.closest(".rav-help-wrap,#"+RH_CARD)||el.closest("[data-rav-help-skip]"))return false;
  if(el.disabled||el.hidden||el.getAttribute("aria-hidden")==="true")return false;
  const st=getComputedStyle(el);
  if(st.display==="none"||st.visibility==="hidden"||st.opacity==="0")return false;
  const r=el.getBoundingClientRect();
  return r.width>0&&r.height>0;
}
function rhEsc(v){
  const s=String(v||"");
  if(typeof CSS!=="undefined"&&typeof CSS.escape==="function")return CSS.escape(s);
  return s.replace(/["\\#.;:[\],>+~*'()]/g,"\\$&");
}
function rhName(el){
  let v=rhText(el.getAttribute("aria-label"))||rhText(el.getAttribute("title"))||rhText(el.textContent);
  if(v)return v.slice(0,90);
  if(el.id){const l=document.querySelector(`label[for="${rhEsc(el.id)}"]`);v=rhText(l&&l.textContent);if(v)return v.slice(0,90);}
  v=rhText(el.closest("label")&&el.closest("label").textContent)||rhText(el.getAttribute("placeholder"))||rhText(el.name)||rhText(el.id)||rhText(el.className);
  return (v||"האפשרות הזו").slice(0,90);
}
function rhCat(name,el){
  for(const [key,val]of RH_EXACT){if(name.includes(key))return val;}
  if(el.tagName==="SELECT")return["בחירה מרשימה","פותח רשימת אפשרויות כדי לבחור את הערך המתאים."];
  if(el.tagName==="TEXTAREA")return["שדה טקסט ארוך","כאן כותבים או עורכים טקסט ארוך יותר."];
  if(el.tagName==="INPUT"){const t=(el.type||"text").toLowerCase();if(t==="checkbox")return["סימון","מפעיל או מכבה אפשרות אחת."];if(t==="radio")return["בחירה אחת","בוחר אפשרות אחת מתוך קבוצה."];if(t==="file")return["בחירת קובץ","מאפשר להעלות קובץ מהמכשיר."];return["שדה קלט","כאן מזינים ערך קצר או מספר."];}
  const n=name.toLowerCase();
  if(/word|docx|וורד/.test(n))return["Word","פעולה שקשורה לטעינה או שמירה של מסמך Word."];
  if(/pdf/.test(n))return["PDF","פעולה שקשורה להכנת קובץ PDF."];
  if(/render|רנדר|תצוגה|preview/.test(n))return["תצוגה","מרענן או משנה את התצוגה כדי לראות את התוצאה."];
  if(/save|שמור|שמירה/.test(n))return["שמירה","שומר את המצב הנוכחי או מייצא אותו."];
  if(/load|טען|ייבא|import/.test(n))return["טעינה","מביא תוכן או הגדרות לתוך העבודה."];
  if(/delete|clear|נקה|מחק|מחיקה/.test(n))return["ניקוי","מסיר או מנקה מידע. להשתמש בזהירות."];
  if(/settings|הגדר/.test(n))return["הגדרות","פותח התאמות של המערכת והמסמך."];
  if(/style|font|גופן|סגנון/.test(n))return["עיצוב","משנה את המראה בלי לשכתב את הטקסט."];
  if(/search|find|חפש|מצא/.test(n))return["חיפוש","עוזר למצוא משהו במהירות."];
  if(/tab|לשונית|pane|חלונית/.test(n))return["מעבר אזור","מעביר אותך לאזור עבודה או חלונית אחרת."];
  return["פעולה","מבצע את האפשרות שעליה כתוב הכפתור או השדה."];
}
function rhExplain(el){
  const name=rhName(el),[title,body]=rhCat(name,el);
  const short=`בקצרה: ${title} — ${body}`;
  return {name,title,short,body:`${body} אם אינך בטוח, אפשר לסגור את ההסבר, לבדוק את הטקסט שעל הכפתור, ורק אז להפעיל.`};
}
function rhEnsureStyle(){
  if(document.getElementById("rav-help-style"))return;
  const css=`.rav-help-wrap{display:inline-flex;align-items:center;gap:.25rem;vertical-align:middle}.rav-help-trigger{border:0;background:#fff8db;color:#5a4211;border-radius:999px;box-shadow:0 1px 5px #0002;cursor:pointer;font-size:15px;line-height:1;min-width:24px;min-height:24px;padding:3px 5px;margin-inline:.2rem}.rav-help-trigger:hover{transform:translateY(-1px)}#rav-help-card{position:fixed;z-index:2147483000;max-width:min(360px,calc(100vw - 24px));background:#fffdf6;color:#2b2315;border:1px solid #ead9a7;border-radius:18px;box-shadow:0 16px 40px #0003;padding:14px;font:14px/1.55 system-ui,Arial,sans-serif;direction:rtl}#rav-help-card .face{font-size:30px;float:inline-start;margin-inline-end:8px}#rav-help-card h3{margin:0 0 4px;font-size:16px}#rav-help-card p{margin:6px 0}#rav-help-card .short{font-weight:700}#rav-help-card button{margin-top:8px;border:1px solid #dcc27b;background:#fff7d5;border-radius:999px;padding:5px 12px;cursor:pointer}`;
  const st=document.createElement("style");st.id="rav-help-style";st.textContent=css;document.head.appendChild(st);
}
function rhClose(){document.getElementById(RH_CARD)?.remove();}
function rhOpen(trigger,target){
  rhClose();const info=rhExplain(target),card=document.createElement("aside");card.id=RH_CARD;card.setAttribute("role","dialog");card.setAttribute("aria-live","polite");
  card.innerHTML=`<div class="face" aria-hidden="true">🙂</div><h3>${info.title}: ${info.name}</h3><p class="short">${info.short}</p><p>${info.body}</p><button type="button">סגור</button>`;
  card.querySelector("button").addEventListener("click",rhClose);document.body.appendChild(card);
  const r=trigger.getBoundingClientRect(),pad=10;let top=r.bottom+8,left=Math.min(Math.max(pad,r.left),innerWidth-card.offsetWidth-pad);
  if(top+card.offsetHeight>innerHeight-pad)top=Math.max(pad,r.top-card.offsetHeight-8);
  card.style.top=top+"px";card.style.left=left+"px";
}
function rhAttach(el){
  if(!rhVisible(el)||el.hasAttribute(RH_ATTACHED))return;
  el.setAttribute(RH_ATTACHED,"1");
  const b=document.createElement("button");b.type="button";b.className=RH_BTN;b.textContent="🙂";b.title="עזרה על האפשרות הזו";b.setAttribute("aria-label","עזרה על "+rhName(el));
  b.addEventListener("click",ev=>{ev.preventDefault();ev.stopPropagation();rhOpen(b,el);});
  const w=document.createElement("span");w.className="rav-help-wrap";w.setAttribute("data-rav-help-skip","1");w.appendChild(b);
  try{el.insertAdjacentElement("afterend",w);}catch{el.parentNode&&el.parentNode.insertBefore(w,el.nextSibling);}
}
function rhScan(root=document){
  if(!root.querySelectorAll)return;
  const list=root.matches?.(RH_SELECTOR)?[root,...root.querySelectorAll(RH_SELECTOR)]:[...root.querySelectorAll(RH_SELECTOR)];
  list.forEach(rhAttach);
}
function rhInstall(){
  if(!document.body)return;
  rhEnsureStyle();rhScan(document);
  let timer=0;const later=root=>{clearTimeout(timer);timer=setTimeout(()=>rhScan(root||document),80);};
  new MutationObserver(ms=>{for(const m of ms){if(m.type==="childList"){for(const n of m.addedNodes){if(n.nodeType===1)later(n);}}else if(m.type==="attributes"){later(m.target);}}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden","aria-hidden","class","style"]});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")rhClose();});
  document.addEventListener("click",e=>{if(!e.target.closest?.("#"+RH_CARD+",."+RH_BTN))rhClose();},true);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",rhInstall,{once:true});else rhInstall();
export { rhScan as refreshPersonalHelpAssistant };
