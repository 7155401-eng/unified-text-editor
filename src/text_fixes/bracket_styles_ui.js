// עיצוב תוכן שבתוך סוגריים — המסך (העברה מהתוכנה הקודמת, פריט 1 בביקורת).
//
// כל ההיגיון ב-`bracket_styles.js` ונבדק שם. כאן יש רק חלון.
//
// בתוכנה הישנה זה היה „הגדרות סוגריים **לזרם**" — כלומר לכל חלונית הגדרות
// משלה. כך זה גם כאן: בוחרים חלונית, ולכל אחד מארבעת סוגי הסוגריים קובעים
// בנפרד אם הוא פעיל, באיזה גודל, באיזה פונט, ובאיזה סגנון וורד.
//
// ⛔ הכלי הזה **אינו משנה את הטקסט**. הוא שומר הגדרות ומראה תצוגה מקדימה.
// העיצוב עצמו מוחל בזמן הציור, ולכן אפשר לכבות אותו בכל רגע והטקסט חוזר.

import {
  BRACKET_TYPES,
  emptyBracketSettings,
  normalizeBracketSettings,
  applyBracketStyles,
  summarizeBrackets,
} from "./bracket_styles.js";

const DIALOG_ID = "rt-bracket-styles";
const STYLE_ID = "rt-bracket-styles-style";
const STORE_PREFIX = "ravtext.bracketStyles.";

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10047;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtbs-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtbs-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(780px,calc(100vw - 24px));max-height:min(90vh,680px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtbs-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtbs-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtbs-spacer{flex:1}
#${DIALOG_ID} .rtbs-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} .rtbs-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${DIALOG_ID} select,#${DIALOG_ID} input[type=text],#${DIALOG_ID} input[type=number]{
  font:inherit;font-size:12px;color:inherit;background:var(--rt-surface,#fff);
  border:1px solid rgba(0,0,0,.2);border-radius:7px;padding:5px 7px;box-sizing:border-box}
#${DIALOG_ID} fieldset{border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:8px 10px 10px;margin:0}
#${DIALOG_ID} legend{font-weight:700;font-size:12px;padding:0 5px}
#${DIALOG_ID} legend label{display:flex;align-items:center;gap:5px;cursor:pointer}
#${DIALOG_ID} .rtbs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px}
#${DIALOG_ID} .rtbs-fld{display:grid;gap:3px;font-size:11px;opacity:.9}
#${DIALOG_ID} fieldset.is-off .rtbs-grid{opacity:.45;pointer-events:none}
#${DIALOG_ID} .rtbs-count{font-size:11px;opacity:.78;font-weight:400}
#${DIALOG_ID} .rtbs-preview{border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:9px 11px;
  max-height:160px;overflow:auto;line-height:1.9;font-size:14px}
#${DIALOG_ID} .rtbs-msg{min-height:1.5em;font-size:12px;line-height:1.5}
#${DIALOG_ID} .rtbs-msg.is-ok{color:#166534;font-weight:600}
#${DIALOG_ID} .rtbs-msg.is-warn{color:#9a3412;font-weight:600}
#${DIALOG_ID} .rtbs-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);
  flex-wrap:wrap;align-items:center}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtbs-primary{border-color:rgba(44,90,160,.5);
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

function setMsg(text, kind) {
  if (!refs) return;
  refs.msg.textContent = text;
  refs.msg.className = kind ? `rtbs-msg is-${kind}` : "rtbs-msg";
}

function panes() {
  return (ctx?.paneManager?.panes || []).filter((p) => p && p.paneRole);
}
const paneKey = (p) => String(p.id ?? p.streamCode ?? p.paneRole);

function paneText(pane) {
  try {
    const ed = pane?.editor || pane?._editor;
    if (ed?.state?.doc) return ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n", "\n");
    return String(pane?._body?.textContent || "");
  } catch { return ""; }
}

/* ───────── שמירה לכל חלונית בנפרד ───────── */

export function loadBracketSettings(key, storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  try {
    const raw = storage?.getItem?.(STORE_PREFIX + key);
    return raw ? normalizeBracketSettings(JSON.parse(raw)) : emptyBracketSettings();
  } catch { return emptyBracketSettings(); }
}

export function saveBracketSettings(key, settings, storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  try { storage?.setItem?.(STORE_PREFIX + key, JSON.stringify(normalizeBracketSettings(settings))); return true; }
  catch { return false; }
}

function readForm() {
  const out = emptyBracketSettings();
  for (const b of BRACKET_TYPES) {
    out[b.id] = {
      enabled: !!$(`rtbs-${b.id}-on`)?.checked,
      style: $(`rtbs-${b.id}-style`)?.value || "",
      font: $(`rtbs-${b.id}-font`)?.value || "",
      sizePercent: Number($(`rtbs-${b.id}-size`)?.value) || 100,
      parIndentPt: Number($(`rtbs-${b.id}-indent`)?.value) || 0,
      parSkipPt: Number($(`rtbs-${b.id}-skip`)?.value) || 0,
    };
  }
  return normalizeBracketSettings(out);
}

function writeForm(cfg) {
  for (const b of BRACKET_TYPES) {
    const c = cfg[b.id];
    const set = (suffix, v) => { const el = $(`rtbs-${b.id}-${suffix}`); if (el) el.value = v; };
    const on = $(`rtbs-${b.id}-on`);
    if (on) on.checked = !!c.enabled;
    set("style", c.style);
    set("font", c.font);
    set("size", c.sizePercent);
    set("indent", c.parIndentPt);
    set("skip", c.parSkipPt);
  }
}

function refresh() {
  if (!refs) return;
  const pane = panes().find((p) => paneKey(p) === refs.pane.value);
  if (!pane) { setMsg("לא נבחרה חלונית.", "warn"); return; }

  const cfg = readForm();
  const text = paneText(pane);
  const counts = summarizeBrackets(text, cfg);

  for (const b of BRACKET_TYPES) {
    const box = $(`rtbs-fs-${b.id}`);
    if (box) box.classList.toggle("is-off", !cfg[b.id].enabled);
    const tag = $(`rtbs-count-${b.id}`);
    if (tag) {
      const n = counts[b.id].found;
      tag.textContent = n === 0 ? " — אין כאלה בחלונית" : n === 1 ? " — קטע אחד" : ` — ${n} קטעים`;
    }
  }

  const { html, wrapped } = applyBracketStyles(text.slice(0, 700), cfg);
  refs.preview.innerHTML = html || "(החלונית ריקה)";
  const active = BRACKET_TYPES.filter((b) => cfg[b.id].enabled).length;
  if (!active) setMsg("לא הופעל אף סוג סוגריים.");
  else if (!wrapped) setMsg("הסוגים שהופעלו אינם מופיעים בתחילת החלונית.", "warn");
  else setMsg(`${wrapped === 1 ? "קטע אחד מעוצב" : `${wrapped} קטעים מעוצבים`} בתצוגה המקדימה.`);
}

function doSave() {
  const pane = panes().find((p) => paneKey(p) === refs.pane.value);
  if (!pane) return;
  const ok = saveBracketSettings(paneKey(pane), readForm());
  setMsg(ok ? `נשמר עבור „${pane.label || "החלונית"}”.` : "לא הצלחנו לשמור.", ok ? "ok" : "warn");
}

function doReset() {
  writeForm(emptyBracketSettings());
  refresh();
  setMsg("ההגדרות אופסו. לא נשמר עדיין.");
}

function buildDialog() {
  const root = document.createElement("div");
  root.id = DIALOG_ID;
  root.setAttribute("dir", "rtl");
  root.innerHTML = `
    <div class="rtbs-backdrop" data-act="close"></div>
    <div class="rtbs-window" role="dialog" aria-modal="true" aria-label="עיצוב סוגריים">
      <div class="rtbs-head">
        <span class="rtbs-title">🔘 עיצוב מה שבתוך הסוגריים</span>
        <span class="rtbs-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtbs-body">
        <div class="rtbs-bar">
          <label>חלונית:</label>
          <select id="rtbs-pane"></select>
          <span class="rtbs-count">לכל חלונית הגדרות משלה, כמו בתוכנה הקודמת.</span>
        </div>

        ${BRACKET_TYPES.map((b) => `
          <fieldset id="rtbs-fs-${b.id}" class="is-off">
            <legend><label for="rtbs-${b.id}-on">
              <input type="checkbox" id="rtbs-${b.id}-on"> ${b.label}
              <span class="rtbs-count" id="rtbs-count-${b.id}"></span>
            </label></legend>
            <div class="rtbs-grid">
              <label class="rtbs-fld"><span>גודל באחוזים</span>
                <input type="number" id="rtbs-${b.id}-size" min="10" max="400" step="5" value="100"></label>
              <label class="rtbs-fld"><span>פונט</span>
                <input type="text" id="rtbs-${b.id}-font" placeholder="כמו הטקסט"></label>
              <label class="rtbs-fld"><span>סגנון וורד</span>
                <input type="text" id="rtbs-${b.id}-style" placeholder="לא חובה"></label>
              <label class="rtbs-fld"><span>כניסת פסקה (נק׳)</span>
                <input type="number" id="rtbs-${b.id}-indent" step="1" value="0"></label>
              <label class="rtbs-fld"><span>רווח פסקה (נק׳)</span>
                <input type="number" id="rtbs-${b.id}-skip" min="0" step="1" value="0"></label>
            </div>
          </fieldset>`).join("")}

        <div><div class="rtbs-count" style="margin-bottom:4px">כך זה ייראה:</div>
          <div class="rtbs-preview" id="rtbs-preview"></div></div>

        <div class="rtbs-msg" id="rtbs-msg"></div>
      </div>
      <div class="rtbs-foot">
        <button type="button" class="rtbs-primary" id="rtbs-save">שמור לחלונית</button>
        <button type="button" id="rtbs-reset">אפס</button>
        <span class="rtbs-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = { root, pane: $("rtbs-pane"), preview: $("rtbs-preview"), msg: $("rtbs-msg") };

  root.addEventListener("input", refresh);
  root.addEventListener("change", (e) => {
    if (e.target?.id === "rtbs-pane") {
      writeForm(loadBracketSettings(refs.pane.value));
    }
    refresh();
  });
  $("rtbs-save").addEventListener("click", doSave);
  $("rtbs-reset").addEventListener("click", doReset);
  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="close"]')) closeBracketStyles();
  });
  return root;
}

function onKeyDown(e) {
  if (e.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeBracketStyles();
}

export function openBracketStyles({ paneManager } = {}) {
  ensureStyle();
  ctx = { paneManager: paneManager || window.paneManager || null };
  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  const list = panes();
  refs.pane.innerHTML = list
    .map((p) => `<option value="${paneKey(p)}">${p.label || p.paneRole}</option>`)
    .join("") || `<option value="">אין חלוניות</option>`;

  writeForm(loadBracketSettings(refs.pane.value));
  refresh();
}

export function closeBracketStyles() {
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenBracketStyles = openBracketStyles;
  window.__ravtextCloseBracketStyles = closeBracketStyles;
}
