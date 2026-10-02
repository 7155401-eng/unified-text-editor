// עיצוב כותרת ותחתית — המסך (העברה מהתוכנה הקודמת, פריט 12 בביקורת).
//
// ההיגיון ב-`header_styles.js` ונבדק שם. כאן רק חלון.
//
// ⛔ אינו נוגע בטקסט, ואינו נוגע ב-`document_features.js` שבוטים אחרים
// עובדים עליו כרגע. הוא רק מזריק כלל עיצוב לכותרת ולתחתית שכבר קיימות,
// וכיבוי ההגדרה מחזיר את המראה הקודם במדויק.

import {
  ALIGN_OPTIONS,
  emptyHeaderStyle,
  loadHeaderStyle,
  saveHeaderStyle,
  applyHeaderStyle,
  markPageParity,
  buildHeaderStyleSheet,
} from "./header_styles.js";

const DIALOG_ID = "rt-header-styles";
const STYLE_ID = "rt-header-styles-style";

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10049;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rths-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rths-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(520px,calc(100vw - 24px));max-height:min(88vh,640px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rths-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rths-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rths-spacer{flex:1}
#${DIALOG_ID} .rths-body{padding:11px 13px;display:grid;gap:9px;overflow:auto}
#${DIALOG_ID} .rths-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
#${DIALOG_ID} label.rths-fld{display:grid;gap:3px;font-size:11px;opacity:.92}
#${DIALOG_ID} label.rths-chk{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
#${DIALOG_ID} input,#${DIALOG_ID} select{font:inherit;font-size:12px;color:inherit;
  background:var(--rt-surface,#fff);border:1px solid rgba(0,0,0,.2);border-radius:7px;
  padding:5px 7px;box-sizing:border-box;width:100%}
#${DIALOG_ID} input[type=checkbox]{width:auto}
#${DIALOG_ID} .rths-off .rths-grid,#${DIALOG_ID} .rths-off .rths-extra{opacity:.45;pointer-events:none}
#${DIALOG_ID} .rths-demo{border:1px solid rgba(0,0,0,.14);border-radius:9px;padding:8px 10px;background:#fff}
#${DIALOG_ID} .rths-hint{font-size:11px;opacity:.76;line-height:1.55}
#${DIALOG_ID} .rths-msg{min-height:1.4em;font-size:12px}
#${DIALOG_ID} .rths-msg.is-ok{color:#166534;font-weight:600}
#${DIALOG_ID} .rths-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rths-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
`;

const $ = (id) => document.getElementById(id);
let refs = null;
let ctx = null;
let previousFocus = null;

function ensureStyle() {
  if ($(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function readForm() {
  return {
    enabled: !!$("rths-on")?.checked,
    font: $("rths-font")?.value || "",
    sizePt: Number($("rths-size")?.value) || 10,
    bold: !!$("rths-bold")?.checked,
    italic: !!$("rths-italic")?.checked,
    align: $("rths-align")?.value || "center",
    color: $("rths-color")?.value || "",
    rule: !!$("rths-rule")?.checked,
    applyToFooter: !!$("rths-footer")?.checked,
  };
}

function writeForm(c) {
  $("rths-on").checked = !!c.enabled;
  $("rths-font").value = c.font;
  $("rths-size").value = c.sizePt;
  $("rths-bold").checked = !!c.bold;
  $("rths-italic").checked = !!c.italic;
  $("rths-align").value = c.align;
  $("rths-color").value = c.color;
  $("rths-rule").checked = !!c.rule;
  $("rths-footer").checked = !!c.applyToFooter;
}

function refresh() {
  if (!refs) return;
  const cfg = readForm();
  refs.window.classList.toggle("rths-off", !cfg.enabled);

  // התצוגה המקדימה משתמשת באותו גיליון בדיוק שיוחל על הדף — רק מכוונת
  // לשתי הדוגמאות שבחלון במקום לעמודים האמיתיים.
  refs.demoStyle.textContent = buildHeaderStyleSheet(cfg).replace(/\.page\[/gu, "#rths-demo [");

  applyHeaderStyle(cfg);
  if (ctx?.pagesContainer) markPageParity(ctx.pagesContainer);

  refs.msg.textContent = cfg.enabled ? "" : "העיצוב כבוי — הכותרת נראית כמו קודם.";
  refs.msg.className = "rths-msg";
}

function doSave() {
  const cfg = readForm();
  const ok = saveHeaderStyle(cfg);
  applyHeaderStyle(cfg);
  refs.msg.textContent = ok ? "נשמר." : "לא הצלחנו לשמור.";
  refs.msg.className = ok ? "rths-msg is-ok" : "rths-msg";
}

function doReset() {
  writeForm(emptyHeaderStyle());
  refresh();
}

function buildDialog() {
  const root = document.createElement("div");
  root.id = DIALOG_ID;
  root.setAttribute("dir", "rtl");
  root.innerHTML = `
    <div class="rths-backdrop" data-act="close"></div>
    <div class="rths-window rths-off" role="dialog" aria-modal="true" aria-label="עיצוב כותרת ותחתית">
      <div class="rths-head">
        <span class="rths-title">📰 עיצוב כותרת ותחתית</span>
        <span class="rths-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rths-body">
        <label class="rths-chk"><input type="checkbox" id="rths-on"> להפעיל עיצוב לכותרת ולתחתית</label>

        <div class="rths-grid">
          <label class="rths-fld"><span>גופן</span>
            <input type="text" id="rths-font" placeholder="כמו המסמך"></label>
          <label class="rths-fld"><span>גודל (נק׳)</span>
            <input type="number" id="rths-size" min="4" max="72" step="1" value="10"></label>
          <label class="rths-fld"><span>יישור</span>
            <select id="rths-align">${
              ALIGN_OPTIONS.map((a) => `<option value="${a.id}">${a.label}</option>`).join("")
            }</select></label>
          <label class="rths-fld"><span>צבע</span>
            <input type="text" id="rths-color" placeholder="#333333"></label>
        </div>

        <div class="rths-extra" style="display:flex;gap:14px;flex-wrap:wrap">
          <label class="rths-chk"><input type="checkbox" id="rths-bold"> מודגש</label>
          <label class="rths-chk"><input type="checkbox" id="rths-italic"> נטוי</label>
          <label class="rths-chk"><input type="checkbox" id="rths-rule"> קו מפריד</label>
          <label class="rths-chk"><input type="checkbox" id="rths-footer" checked> גם לתחתית</label>
        </div>

        <div class="rths-hint">⭐ „לצד החיצוני" ו„לצד הפנימי" מתחלפים בין עמוד זוגי
          לאי-זוגי, כמו בספר פתוח. בעברית הצד הפנימי של עמוד אי-זוגי הוא שמאל.</div>

        <div>
          <div class="rths-hint" style="margin-bottom:4px">כך זה ייראה:</div>
          <div class="rths-demo" id="rths-demo">
            <div class="page" data-page-parity="odd">
              <div class="ravtext-page-header">עמוד אי-זוגי — שם הספר</div>
            </div>
            <div class="page" data-page-parity="even">
              <div class="ravtext-page-header">עמוד זוגי — שם הפרק</div>
            </div>
          </div>
          <style id="rths-demo-style"></style>
        </div>

        <div class="rths-msg" id="rths-msg"></div>
      </div>
      <div class="rths-foot">
        <button type="button" class="rths-primary" id="rths-save">שמור</button>
        <button type="button" id="rths-reset">אפס</button>
        <span class="rths-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    window: root.querySelector(".rths-window"),
    msg: $("rths-msg"),
    demoStyle: $("rths-demo-style"),
  };

  root.addEventListener("input", refresh);
  root.addEventListener("change", refresh);
  $("rths-save").addEventListener("click", doSave);
  $("rths-reset").addEventListener("click", doReset);
  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="close"]')) closeHeaderStyles();
  });
  return root;
}

function onKeyDown(e) {
  if (e.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeHeaderStyles();
}

export function openHeaderStyles({ pagesContainer } = {}) {
  ensureStyle();
  ctx = { pagesContainer: pagesContainer || document.getElementById("pages") };
  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);
  writeForm(loadHeaderStyle());
  refresh();
}

export function closeHeaderStyles() {
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenHeaderStyles = openHeaderStyles;
  window.__ravtextCloseHeaderStyles = closeHeaderStyles;
}
