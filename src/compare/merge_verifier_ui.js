// בדיקת שלמות אחרי מיזוג — המסך (העברה מהתוכנה הקודמת, פריט ה-5).
//
// ההיגיון ב-`merge_verifier.js` ונבדק שם. כאן רק חלון.
//
// ⛔ הכלי אינו מתקן דבר ואינו נוגע במסמך. הוא עונה על שאלה אחת: **האם משהו
// אבד?** — ובמספרים, לא בדעה.

import { compareMergedToSource, describeMergeReport } from "./merge_verifier.js";

const DIALOG_ID = "rt-merge-verify";
const STYLE_ID = "rt-merge-verify-style";

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10051;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtmv-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtmv-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(760px,calc(100vw - 24px));max-height:min(90vh,680px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtmv-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtmv-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtmv-spacer{flex:1}
#${DIALOG_ID} .rtmv-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} .rtmv-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${DIALOG_ID} select,#${DIALOG_ID} textarea{font:inherit;font-size:12px;color:inherit;
  background:var(--rt-surface,#fff);border:1px solid rgba(0,0,0,.2);border-radius:8px;
  padding:6px 8px;box-sizing:border-box}
#${DIALOG_ID} textarea{width:100%;min-height:80px;resize:vertical;direction:rtl;line-height:1.6}
#${DIALOG_ID} .rtmv-verdict{border-radius:10px;padding:9px 11px;font-size:13px;line-height:1.7;
  border:1px solid rgba(0,0,0,.14)}
#${DIALOG_ID} .rtmv-verdict.is-ok{background:rgba(22,101,52,.10);border-color:rgba(22,101,52,.35);color:#166534}
#${DIALOG_ID} .rtmv-verdict.is-bad{background:rgba(154,52,18,.10);border-color:rgba(154,52,18,.4);color:#9a3412}
#${DIALOG_ID} .rtmv-chips{display:flex;gap:7px;flex-wrap:wrap;font-size:12px}
#${DIALOG_ID} .rtmv-chip{padding:2px 9px;border-radius:999px;border:1px solid rgba(0,0,0,.14)}
#${DIALOG_ID} .rtmv-list{border:1px solid rgba(0,0,0,.12);border-radius:10px;max-height:230px;
  overflow:auto;font-size:12px}
#${DIALOG_ID} .rtmv-list div{padding:6px 9px;border-bottom:1px solid rgba(0,0,0,.07);line-height:1.6}
#${DIALOG_ID} .rtmv-ctx{opacity:.72}
#${DIALOG_ID} .rtmv-lost{color:#9a3412;font-weight:600}
#${DIALOG_ID} .rtmv-hint{font-size:11px;opacity:.76;line-height:1.55}
#${DIALOG_ID} .rtmv-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);flex-wrap:wrap}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtmv-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
#${DIALOG_ID} button[disabled]{opacity:.5;cursor:default}
`;

const $ = (id) => document.getElementById(id);
let refs = null;
let ctx = null;
let previousFocus = null;
let lastResult = null;

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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function sourceText() {
  if (refs.source.value === "__paste") return refs.paste.value;
  const pane = panes().find((p) => paneKey(p) === refs.source.value);
  return pane ? paneText(pane) : "";
}

function mergedText() {
  const pane = panes().find((p) => paneKey(p) === refs.merged.value);
  return pane ? paneText(pane) : "";
}

function run() {
  const src = sourceText();
  const mer = mergedText();
  if (!src.trim()) { setVerdict("אין טקסט מקור להשוות אליו.", false); return; }

  lastResult = compareMergedToSource(src, mer);
  const { ok, summary, lost } = lastResult;

  refs.chips.innerHTML = [
    `<span class="rtmv-chip">${summary.sourceWords} מילים במקור</span>`,
    `<span class="rtmv-chip">${summary.mergedWords} בתוצאה</span>`,
    `<span class="rtmv-chip">${summary.keptPercent}% נשמרו</span>`,
    summary.addedWords ? `<span class="rtmv-chip">${summary.addedWords} נוספו</span>` : "",
  ].filter(Boolean).join("");

  if (ok) {
    setVerdict("✅ כל מילה שהייתה במקור נמצאת גם בתוצאה. שום דבר לא אבד.", true);
  } else if (summary.runaway) {
    setVerdict(`⛔⛔ חסרות ${summary.lostWords} מילים, והקטע הרצוף הארוך ביותר שאבד הוא ` +
      `${summary.biggestLostRun} מילים — זה סימן מובהק שהמיזוג ברח ממקומו, ומשם ואילך הכול זז.`, false);
  } else {
    setVerdict(`⛔ חסרות ${summary.lostWords} מילים, ב-${summary.lostRuns} מקומות.`, false);
  }

  refs.list.innerHTML = lost.length
    ? lost.slice(0, 200).map((r) => `<div>
        <span class="rtmv-ctx">…${escapeHtml(r.context)}</span>
        <span class="rtmv-lost"> ⟵ חסר: ${escapeHtml(r.words.slice(0, 15).join(" "))}${
          r.words.length > 15 ? ` (ועוד ${r.words.length - 15})` : ""}</span>
      </div>`).join("")
    : `<div style="opacity:.7">אין מה להציג — שום דבר לא אבד.</div>`;

  refs.download.disabled = false;
}

function setVerdict(text, ok) {
  refs.verdict.textContent = text;
  refs.verdict.className = `rtmv-verdict ${ok ? "is-ok" : "is-bad"}`;
}

function download() {
  if (!lastResult) return;
  const blob = new Blob([describeMergeReport(lastResult)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-");
  a.href = url;
  a.download = `ravtext-בדיקת-מיזוג-${stamp}.txt`;
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
    <div class="rtmv-backdrop" data-act="close"></div>
    <div class="rtmv-window" role="dialog" aria-modal="true" aria-label="בדיקת שלמות אחרי מיזוג">
      <div class="rtmv-head">
        <span class="rtmv-title">🧾 בדיקת שלמות אחרי מיזוג</span>
        <span class="rtmv-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtmv-body">
        <div class="rtmv-hint">⛔ הכלי אינו מתקן דבר ואינו נוגע במסמך. הוא עונה על שאלה אחת:
          <b>האם משהו אבד</b> — ובמספרים, לא בדעה. בלי בוט, בלי רשת, בלי עלות.</div>

        <div class="rtmv-row">
          <label>המקור (לפני):</label>
          <select id="rtmv-source"></select>
          <label>התוצאה (אחרי):</label>
          <select id="rtmv-merged"></select>
          <button type="button" class="rtmv-primary" id="rtmv-run">בדוק</button>
        </div>

        <div id="rtmv-paste-wrap" style="display:none">
          <textarea id="rtmv-paste" placeholder="הדבק כאן את הטקסט המקורי"></textarea>
        </div>

        <div class="rtmv-chips" id="rtmv-chips"></div>
        <div class="rtmv-verdict" id="rtmv-verdict">בחר מקור ותוצאה, ולחץ „בדוק”.</div>
        <div class="rtmv-list" id="rtmv-list"></div>
      </div>
      <div class="rtmv-foot">
        <button type="button" id="rtmv-download" disabled>⭳ הורד דוח</button>
        <span class="rtmv-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    source: $("rtmv-source"),
    merged: $("rtmv-merged"),
    paste: $("rtmv-paste"),
    pasteWrap: $("rtmv-paste-wrap"),
    chips: $("rtmv-chips"),
    verdict: $("rtmv-verdict"),
    list: $("rtmv-list"),
    download: $("rtmv-download"),
  };

  refs.source.addEventListener("change", () => {
    refs.pasteWrap.style.display = refs.source.value === "__paste" ? "block" : "none";
  });
  $("rtmv-run").addEventListener("click", run);
  refs.download.addEventListener("click", download);
  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="close"]')) closeMergeVerifier();
  });
  return root;
}

function onKeyDown(e) {
  if (e.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeMergeVerifier();
}

export function openMergeVerifier({ paneManager } = {}) {
  ensureStyle();
  ctx = { paneManager: paneManager || window.paneManager || null };
  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  const list = panes();
  const options = list.map((p) => `<option value="${paneKey(p)}">${p.label || p.paneRole}</option>`).join("");
  refs.source.innerHTML = options + `<option value="__paste">— להדביק טקסט —</option>`;
  refs.merged.innerHTML = options || `<option value="">אין חלוניות</option>`;
  refs.pasteWrap.style.display = "none";
  refs.chips.innerHTML = "";
  refs.list.innerHTML = "";
  refs.download.disabled = true;
  lastResult = null;
  refs.verdict.textContent = "בחר מקור ותוצאה, ולחץ „בדוק”.";
  refs.verdict.className = "rtmv-verdict";
}

export function closeMergeVerifier() {
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenMergeVerifier = openMergeVerifier;
  window.__ravtextCloseMergeVerifier = closeMergeVerifier;
}
