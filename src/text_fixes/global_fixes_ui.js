// תיקונים גלובליים — המסך (העברה מהתוכנה הקודמת, פריט 13 בביקורת).
//
// כל ההיגיון ב-`global_fixes_engine.js` ונבדק שם. כאן יש רק חלון.
//
// ⚠️ שימו לב: בניגוד ל„הצעת קישורים", הכלי הזה **כן משנה את המסמך** — זה
// תפקידו. ולכן הוא בנוי כך שאי-אפשר להפתיע איתו:
//   * כל התיקונים כבויים כברירת מחדל, כמו בתוכנה הישנה;
//   * לפני ההחלה מוצגת **תצוגה מקדימה**: מה היה, מה יהיה, וכמה תווים ישתנו;
//   * כל תיקון שמסומן ושלא ישנה כלום מסומן „לא ישנה כאן כלום" מראש;
//   * ההחלה היא על החלונית שנבחרה בלבד, ולא על כל המסמך בבת אחת;
//   * אחרי ההחלה נשמר גיבוי בזיכרון ואפשר לבטל בלחיצה אחת.

import {
  GLOBAL_FIXES,
  emptyFixFlags,
  applyGlobalFixes,
  previewGlobalFixes,
} from "./global_fixes_engine.js";

const DIALOG_ID = "rt-global-fixes";
const STYLE_ID = "rt-global-fixes-style";
const STORE_KEY = "ravtext.globalFixes.flags";

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10046;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtgf-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtgf-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(820px,calc(100vw - 24px));max-height:min(90vh,700px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtgf-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtgf-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtgf-spacer{flex:1}
#${DIALOG_ID} .rtgf-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} .rtgf-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${DIALOG_ID} select{font:inherit;font-size:13px;color:inherit;background:var(--rt-surface,#fff);
  border:1px solid rgba(0,0,0,.2);border-radius:8px;padding:6px 9px}
#${DIALOG_ID} .rtgf-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}
#${DIALOG_ID} fieldset{border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:7px 10px 9px;margin:0}
#${DIALOG_ID} legend{font-weight:700;font-size:12px;padding:0 4px}
#${DIALOG_ID} label.rtgf-fix{display:flex;align-items:flex-start;gap:6px;font-size:12px;
  line-height:1.5;padding:2px 0;cursor:pointer}
#${DIALOG_ID} label.rtgf-fix input{margin-top:2px}
#${DIALOG_ID} label.rtgf-fix.is-noop{opacity:.55}
#${DIALOG_ID} .rtgf-noop{font-size:10px;opacity:.8}
#${DIALOG_ID} .rtgf-preview{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#${DIALOG_ID} .rtgf-preview div{border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:7px 9px;
  max-height:150px;overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.65}
#${DIALOG_ID} .rtgf-preview h5{margin:0 0 4px;font-size:11px;opacity:.8}
#${DIALOG_ID} .rtgf-msg{min-height:1.5em;font-size:12px;line-height:1.5}
#${DIALOG_ID} .rtgf-msg.is-ok{color:#166534;font-weight:600}
#${DIALOG_ID} .rtgf-msg.is-warn{color:#9a3412;font-weight:600}
#${DIALOG_ID} .rtgf-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);
  flex-wrap:wrap;align-items:center}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtgf-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
#${DIALOG_ID} button[disabled]{opacity:.5;cursor:default}
`;

const $ = (id) => document.getElementById(id);
let refs = null;
let ctx = null;
let previousFocus = null;
let undoSnapshot = null;   // { paneId, text }

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
  refs.msg.className = kind ? `rtgf-msg is-${kind}` : "rtgf-msg";
}

function loadFlags() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...emptyFixFlags(), ...JSON.parse(raw) } : emptyFixFlags();
  } catch { return emptyFixFlags(); }
}

function saveFlags(flags) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(flags)); } catch { /* אחסון חסום */ }
}

function currentFlags() {
  const out = emptyFixFlags();
  for (const fix of GLOBAL_FIXES) {
    const el = $(`rtgf-${fix.id}`);
    out[fix.id] = !!el?.checked;
  }
  return out;
}

/* ───────── חלוניות ───────── */

function allPanes() {
  const pm = ctx?.paneManager;
  return (pm?.panes || []).filter((p) => p && (p.paneRole === "main" || p.paneRole === "stream" || p.paneRole === "intro"));
}

function paneById(id) {
  return allPanes().find((p) => String(p.id ?? p.streamCode ?? p.paneRole) === String(id)) || null;
}

function paneKey(p) {
  return String(p.id ?? p.streamCode ?? p.paneRole);
}

function paneText(pane) {
  try {
    const ed = pane?.editor || pane?._editor;
    if (ed?.state?.doc) return ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n", "\n");
    return String(pane?._body?.textContent || "");
  } catch { return ""; }
}

function writePaneText(pane, text) {
  const ed = pane?.editor || pane?._editor;
  if (ed?.commands?.setContent) {
    // כל שורה היא פסקה — בדיוק כמו שהעורך קורא טקסט פשוט.
    const html = String(text).split("\n")
      .map((line) => `<p>${line.replace(/[&<>]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) || "<br>"}</p>`)
      .join("");
    ed.commands.setContent(html);
    return true;
  }
  if (pane?._body) { pane._body.textContent = text; return true; }
  return false;
}

/* ───────── ציור ───────── */

function refreshPreview() {
  if (!refs) return;
  const pane = paneById(refs.pane.value);
  if (!pane) { setMsg("לא נבחרה חלונית.", "warn"); return; }

  const flags = currentFlags();
  saveFlags(flags);

  const text = paneText(pane);
  const { rows, result } = previewGlobalFixes(text, flags);

  // כל תיקון שסומן ולא ישנה כלום — נאמר מראש, כדי שלא יחכה להפתעה.
  for (const fix of GLOBAL_FIXES) {
    const label = $(`rtgf-${fix.id}`)?.closest("label");
    if (!label) continue;
    const row = rows.find((r) => r.id === fix.id);
    const noop = row && !row.changed;
    label.classList.toggle("is-noop", !!noop);
    const tag = label.querySelector(".rtgf-noop");
    if (tag) tag.textContent = noop ? " — לא ישנה כאן כלום" : "";
  }

  const chosen = rows.length;
  refs.before.textContent = text.slice(0, 900) || "(החלונית ריקה)";
  refs.after.textContent = result.text.slice(0, 900) || "(החלונית ריקה)";

  if (!chosen) { setMsg("לא נבחר אף תיקון."); refs.apply.disabled = true; return; }
  if (!result.changed) { setMsg("התיקונים שנבחרו לא משנים כלום בחלונית הזאת.", "warn"); refs.apply.disabled = true; return; }

  const diff = Math.abs(result.text.length - text.length);
  const n = result.applied.length;
  const howMany = n === 1 ? "תיקון אחד ישנה" : `${n} תיקונים ישנו`;
  const howMuch = diff === 0 ? "בלי שינוי באורך" : diff === 1 ? "הפרש של תו אחד" : `הפרש של ${diff} תווים`;
  setMsg(`${howMany} משהו כאן · ${howMuch}.`);
  refs.apply.disabled = false;
}

function doApply() {
  const pane = paneById(refs.pane.value);
  if (!pane) return;
  const flags = currentFlags();
  const text = paneText(pane);
  const result = applyGlobalFixes(text, flags);
  if (!result.changed) { setMsg("אין מה להחיל.", "warn"); return; }

  undoSnapshot = { paneId: paneKey(pane), text };
  if (!writePaneText(pane, result.text)) { setMsg("לא הצלחנו לכתוב לחלונית.", "warn"); return; }

  refs.undo.disabled = false;
  setMsg(`הוחל על „${pane.label || "החלונית"}”. אפשר לבטל.`, "ok");
  refreshPreview();
}

function doUndo() {
  if (!undoSnapshot) return;
  const pane = allPanes().find((p) => paneKey(p) === undoSnapshot.paneId);
  if (!pane) { setMsg("החלונית כבר לא קיימת.", "warn"); return; }
  writePaneText(pane, undoSnapshot.text);
  undoSnapshot = null;
  refs.undo.disabled = true;
  setMsg("בוטל. החלונית חזרה למה שהיה.", "ok");
  refreshPreview();
}

function buildDialog() {
  const groups = [...new Set(GLOBAL_FIXES.map((f) => f.group))];
  const root = document.createElement("div");
  root.id = DIALOG_ID;
  root.setAttribute("dir", "rtl");
  root.innerHTML = `
    <div class="rtgf-backdrop" data-act="close"></div>
    <div class="rtgf-window" role="dialog" aria-modal="true" aria-label="תיקונים גלובליים">
      <div class="rtgf-head">
        <span class="rtgf-title">🧹 תיקונים גלובליים</span>
        <span class="rtgf-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtgf-body">
        <div class="rtgf-bar">
          <label>על איזו חלונית:</label>
          <select id="rtgf-pane"></select>
          <button type="button" data-act="none">נקה בחירה</button>
        </div>

        <div class="rtgf-groups">
          ${groups.map((g) => `<fieldset><legend>${g}</legend>${
            GLOBAL_FIXES.filter((f) => f.group === g).map((f) => `
              <label class="rtgf-fix" for="rtgf-${f.id}">
                <input type="checkbox" id="rtgf-${f.id}">
                <span>${f.label}<span class="rtgf-noop"></span></span>
              </label>`).join("")
          }</fieldset>`).join("")}
        </div>

        <div class="rtgf-preview">
          <div><h5>לפני</h5><span id="rtgf-before"></span></div>
          <div><h5>אחרי</h5><span id="rtgf-after"></span></div>
        </div>

        <div class="rtgf-msg" id="rtgf-msg"></div>
      </div>
      <div class="rtgf-foot">
        <button type="button" class="rtgf-primary" id="rtgf-apply" disabled>החל על החלונית</button>
        <button type="button" id="rtgf-undo" disabled>↩ בטל</button>
        <span class="rtgf-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    pane: $("rtgf-pane"),
    before: $("rtgf-before"),
    after: $("rtgf-after"),
    msg: $("rtgf-msg"),
    apply: $("rtgf-apply"),
    undo: $("rtgf-undo"),
  };

  for (const fix of GLOBAL_FIXES) {
    $(`rtgf-${fix.id}`)?.addEventListener("change", refreshPreview);
  }
  refs.pane.addEventListener("change", refreshPreview);
  refs.apply.addEventListener("click", doApply);
  refs.undo.addEventListener("click", doUndo);
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") closeGlobalFixes();
    else if (act === "none") {
      for (const fix of GLOBAL_FIXES) { const el = $(`rtgf-${fix.id}`); if (el) el.checked = false; }
      refreshPreview();
    }
  });
  return root;
}

function onKeyDown(e) {
  if (e.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeGlobalFixes();
}

export function openGlobalFixes({ paneManager } = {}) {
  ensureStyle();
  ctx = { paneManager: paneManager || window.paneManager || null };
  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  const panes = allPanes();
  refs.pane.innerHTML = panes
    .map((p) => `<option value="${paneKey(p)}">${p.label || p.paneRole}</option>`)
    .join("") || `<option value="">אין חלוניות</option>`;

  const saved = loadFlags();
  for (const fix of GLOBAL_FIXES) {
    const el = $(`rtgf-${fix.id}`);
    if (el) el.checked = !!saved[fix.id];
  }
  undoSnapshot = null;
  refs.undo.disabled = true;
  refreshPreview();
}

export function closeGlobalFixes() {
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenGlobalFixes = openGlobalFixes;
  window.__ravtextCloseGlobalFixes = closeGlobalFixes;
}
