// תרגום לצד הטקסט — המסך (העברה מהתוכנה הקודמת, פריט 7 בביקורת).
//
// ההיגיון ב-`parallel_translation.js` ונבדק שם. כאן רק חלון.
//
// ⛔ הכלי אינו משנה את המסמך. הוא מציג תצוגה מקבילה ומאפשר להוריד אותה.
// ⭐ ואם מספר הפסקאות אינו תואם — הוא **אומר את זה בראש המסך** ואינו מנחש.

import {
  emptyParallelSettings,
  normalizeParallelSettings,
  buildParallelHtml,
  describeParallelSummary,
  cmToPx,
} from "./parallel_translation.js";

const DIALOG_ID = "rt-parallel";
const STYLE_ID = "rt-parallel-style";
const STORE_KEY = "ravtext.parallelTranslation";

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10052;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtp-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtp-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(880px,calc(100vw - 24px));max-height:min(90vh,700px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtp-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtp-titlebar{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtp-spacer{flex:1}
#${DIALOG_ID} .rtp-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} .rtp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${DIALOG_ID} label.rtp-fld{display:grid;gap:3px;font-size:11px;opacity:.92}
#${DIALOG_ID} select,#${DIALOG_ID} input{font:inherit;font-size:12px;color:inherit;
  background:var(--rt-surface,#fff);border:1px solid rgba(0,0,0,.2);border-radius:7px;
  padding:5px 7px;box-sizing:border-box}
#${DIALOG_ID} input[type=number]{width:80px}
#${DIALOG_ID} .rtp-note{border-radius:10px;padding:8px 10px;font-size:12px;line-height:1.65;
  border:1px solid rgba(0,0,0,.14)}
#${DIALOG_ID} .rtp-note.is-ok{background:rgba(22,101,52,.10);border-color:rgba(22,101,52,.3);color:#166534}
#${DIALOG_ID} .rtp-note.is-warn{background:rgba(180,120,10,.12);border-color:rgba(180,120,10,.4);color:#8a5a00}
#${DIALOG_ID} .rtp-preview{border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:10px;
  max-height:320px;overflow:auto;background:#fff}
#${DIALOG_ID} .rtp-grid{font-size:13px;line-height:1.85}
#${DIALOG_ID} .rtp-grid > div{padding:3px 0}
#${DIALOG_ID} .rtp-title{font-weight:700;border-bottom:1px solid rgba(0,0,0,.15);margin-bottom:4px}
#${DIALOG_ID} .rtp-src{text-align:justify}
#${DIALOG_ID} .rtp-tr{text-align:justify;opacity:.92}
#${DIALOG_ID} .is-empty{min-height:1em;background:rgba(180,120,10,.09);border-radius:4px}
#${DIALOG_ID} .rtp-hint{font-size:11px;opacity:.76;line-height:1.55}
#${DIALOG_ID} .rtp-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);flex-wrap:wrap}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtp-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
#${DIALOG_ID} button[disabled]{opacity:.5;cursor:default}
`;

const $ = (id) => document.getElementById(id);
let refs = null;
let ctx = null;
let previousFocus = null;
let lastHtml = "";

function ensureStyle() {
  if ($(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
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

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalizeParallelSettings(JSON.parse(raw)) : emptyParallelSettings();
  } catch { return emptyParallelSettings(); }
}

function saveSettings(cfg) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(normalizeParallelSettings(cfg))); return true; }
  catch { return false; }
}

function readForm() {
  return {
    enabled: true,
    streamCode: refs.translation.value,
    widthPercent: Number(refs.width.value) || 30,
    gapCm: Number(refs.gap.value) || 0.8,
    position: refs.position.value,
    showTitles: !!refs.titles.checked,
  };
}

function refresh() {
  if (!refs) return;
  const cfg = readForm();
  const srcPane = panes().find((p) => paneKey(p) === refs.source.value);
  const trPane = panes().find((p) => paneKey(p) === refs.translation.value);
  if (!srcPane || !trPane) { refs.note.textContent = "צריך לבחור מקור ותרגום."; return; }
  if (srcPane === trPane) {
    refs.note.textContent = "⚠️ המקור והתרגום הם אותה חלונית. בחר שתיים שונות.";
    refs.note.className = "rtp-note is-warn";
    refs.preview.innerHTML = "";
    refs.download.disabled = true;
    return;
  }

  const { html, summary } = buildParallelHtml(
    paneText(srcPane), paneText(trPane), cfg,
    { source: srcPane.label || "מקור", translation: trPane.label || "תרגום" });

  lastHtml = html;
  refs.preview.innerHTML = html;
  refs.note.textContent = describeParallelSummary(summary);
  refs.note.className = `rtp-note ${summary.aligned ? "is-ok" : "is-warn"}`;
  refs.gapPx.textContent = `= ${cmToPx(cfg.gapCm)} פיקסלים`;
  refs.download.disabled = false;
}

function doSave() {
  const ok = saveSettings(readForm());
  refs.note.textContent = ok ? "ההגדרות נשמרו." : "לא הצלחנו לשמור.";
  refs.note.className = "rtp-note is-ok";
}

function doDownload() {
  if (!lastHtml) return;
  const page = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>תרגום לצד הטקסט</title><style>
body{font-family:David,serif;margin:28px;line-height:1.85}
.rtp-title{font-weight:700;border-bottom:1px solid #999;margin-bottom:6px}
.rtp-src,.rtp-tr{text-align:justify;padding:3px 0}
</style></head><body>${lastHtml}</body></html>`;
  const blob = new Blob([page], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-");
  a.href = url;
  a.download = `ravtext-תרגום-מקביל-${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function buildDialog() {
  const root = document.createElement("div");
  root.id = DIALOG_ID;
  root.setAttribute("dir", "rtl");
  root.innerHTML = `
    <div class="rtp-backdrop" data-act="close"></div>
    <div class="rtp-window" role="dialog" aria-modal="true" aria-label="תרגום לצד הטקסט">
      <div class="rtp-head">
        <span class="rtp-titlebar">🈂 תרגום לצד הטקסט</span>
        <span class="rtp-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtp-body">
        <div class="rtp-hint">⭐ זה אינו „הערת צד": הערות <b>זורמות</b> לאורך העמוד,
          ותרגום הוא <b>עמודה קבועה</b> שרצה לצד הטקסט — פסקה מול פסקה. ולכן גם
          מותר <b>תרגום אחד בלבד</b>, בדיוק כמו בתוכנה הקודמת.</div>

        <div class="rtp-bar">
          <label class="rtp-fld"><span>המקור</span><select id="rtp-source"></select></label>
          <label class="rtp-fld"><span>התרגום</span><select id="rtp-translation"></select></label>
          <label class="rtp-fld"><span>צד התרגום</span><select id="rtp-position">
            <option value="left">שמאל</option><option value="right">ימין</option>
          </select></label>
          <label class="rtp-fld"><span>רוחב התרגום (%)</span>
            <input type="number" id="rtp-width" min="10" max="70" step="5" value="30"></label>
          <label class="rtp-fld"><span>מרווח (ס״מ)</span>
            <input type="number" id="rtp-gap" min="0" max="5" step="0.1" value="0.8"></label>
          <span class="rtp-hint" id="rtp-gap-px"></span>
          <label class="rtp-fld" style="display:flex;align-items:center;gap:5px;margin-top:12px">
            <input type="checkbox" id="rtp-titles" checked style="width:auto"> כותרות</label>
        </div>

        <div class="rtp-note" id="rtp-note"></div>
        <div class="rtp-preview" id="rtp-preview"></div>
      </div>
      <div class="rtp-foot">
        <button type="button" class="rtp-primary" id="rtp-save">שמור הגדרות</button>
        <button type="button" id="rtp-download" disabled>⭳ הורד תצוגה</button>
        <span class="rtp-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    source: $("rtp-source"),
    translation: $("rtp-translation"),
    position: $("rtp-position"),
    width: $("rtp-width"),
    gap: $("rtp-gap"),
    gapPx: $("rtp-gap-px"),
    titles: $("rtp-titles"),
    note: $("rtp-note"),
    preview: $("rtp-preview"),
    download: $("rtp-download"),
  };

  root.addEventListener("input", refresh);
  root.addEventListener("change", refresh);
  $("rtp-save").addEventListener("click", doSave);
  $("rtp-download").addEventListener("click", doDownload);
  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="close"]')) closeParallelTranslation();
  });
  return root;
}

function onKeyDown(e) {
  if (e.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeParallelTranslation();
}

export function openParallelTranslation({ paneManager } = {}) {
  ensureStyle();
  ctx = { paneManager: paneManager || window.paneManager || null };
  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  const list = panes();
  const opts = list.map((p) => `<option value="${paneKey(p)}">${p.label || p.paneRole}</option>`).join("");
  refs.source.innerHTML = opts || `<option value="">אין חלוניות</option>`;
  refs.translation.innerHTML = opts || `<option value="">אין חלוניות</option>`;
  if (list.length > 1) refs.translation.selectedIndex = 1;

  const saved = loadSettings();
  refs.position.value = saved.position;
  refs.width.value = saved.widthPercent;
  refs.gap.value = saved.gapCm;
  refs.titles.checked = saved.showTitles;
  if (saved.streamCode) {
    const match = [...refs.translation.options].find((o) => o.value === saved.streamCode);
    if (match) refs.translation.value = saved.streamCode;
  }
  refresh();
}

export function closeParallelTranslation() {
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenParallel = openParallelTranslation;
  window.__ravtextCloseParallel = closeParallelTranslation;
}
