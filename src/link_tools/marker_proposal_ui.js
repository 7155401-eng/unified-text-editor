// הצעת קישורים — המסך (העברה מהתוכנה הקודמת, פריטים ה-3/ה-4/ה-6).
//
// כל ההיגיון יושב ב-`marker_proposal_engine.js` ונבדק שם. כאן יש רק חלון.
//
// ⛔ הכלל שמנחה את המסך הזה: **הוא מציע, משה מחליט.** אין כאן „החל הכול"
// בלחיצה אחת על דברים שאינם ודאיים. כל הצעה שאינה ודאית מגיעה עם הסיבה
// ועם תיבת סימון כבויה, ומשה מדליק מה שהוא מאשר.
//
// בשלב הזה הכלי **אינו כותב למסמך בכלל** — הוא מראה את ההצעה ומאפשר להוריד
// אותה כקובץ. הכתיבה בפועל תיכנס רק אחרי שמשה יראה את ההצעה על מסמך אמיתי
// ויאשר שההיגיון נכון.

import {
  proposeMarkerPlacements,
  describeProposalReport,
  CONFIDENCE_EXACT,
  CONFIDENCE_AMBIGUOUS,
  CONFIDENCE_FAR,
  CONFIDENCE_NONE,
} from "./marker_proposal_engine.js";

const DIALOG_ID = "rt-marker-proposal";
const STYLE_ID = "rt-marker-proposal-style";

const LEVEL = {
  [CONFIDENCE_EXACT]: { text: "ברור", cls: "c-ok" },
  [CONFIDENCE_AMBIGUOUS]: { text: "יותר ממקום אחד", cls: "c-warn" },
  [CONFIDENCE_FAR]: { text: "רחוק מהצפוי", cls: "c-warn" },
  [CONFIDENCE_NONE]: { text: "לא נמצא", cls: "c-bad" },
};

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10048;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtmp-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtmp-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(860px,calc(100vw - 24px));max-height:min(90vh,700px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtmp-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtmp-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtmp-spacer{flex:1}
#${DIALOG_ID} .rtmp-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} .rtmp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${DIALOG_ID} select{font:inherit;font-size:13px;color:inherit;background:var(--rt-surface,#fff);
  border:1px solid rgba(0,0,0,.2);border-radius:8px;padding:6px 9px}
#${DIALOG_ID} .rtmp-sum{display:flex;gap:7px;flex-wrap:wrap;font-size:12px}
#${DIALOG_ID} .rtmp-chip{padding:2px 9px;border-radius:999px;border:1px solid rgba(0,0,0,.14)}
#${DIALOG_ID} .rtmp-chip.c-ok{background:rgba(22,101,52,.12);color:#166534}
#${DIALOG_ID} .rtmp-chip.c-warn{background:rgba(180,120,10,.14);color:#8a5a00}
#${DIALOG_ID} .rtmp-chip.c-bad{background:rgba(154,52,18,.12);color:#9a3412}
#${DIALOG_ID} .rtmp-tablewrap{border:1px solid rgba(0,0,0,.12);border-radius:10px;overflow:auto;max-height:360px}
#${DIALOG_ID} table{width:100%;border-collapse:collapse;font-size:12px}
#${DIALOG_ID} th,#${DIALOG_ID} td{padding:6px 8px;text-align:right;vertical-align:top;
  border-bottom:1px solid rgba(0,0,0,.07)}
#${DIALOG_ID} th{position:sticky;top:0;background:var(--rt-surface,#fff);font-weight:700;z-index:1}
#${DIALOG_ID} td.rtmp-ctx{font-size:11px;opacity:.85;max-width:300px}
#${DIALOG_ID} mark{background:rgba(44,90,160,.2);padding:0 2px;border-radius:3px}
#${DIALOG_ID} .rtmp-note{font-size:11px;opacity:.78;line-height:1.55}
#${DIALOG_ID} .rtmp-warn{border:1px solid rgba(154,52,18,.35);background:rgba(154,52,18,.06);
  border-radius:10px;padding:8px 10px;font-size:12px;line-height:1.6}
#${DIALOG_ID} .rtmp-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);
  flex-wrap:wrap;align-items:center}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtmp-primary{border-color:rgba(44,90,160,.5);
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

function paneText(pane) {
  try {
    const ed = pane?.editor || pane?._editor;
    if (ed?.state?.doc) return ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n", "\n");
    return String(pane?._body?.textContent || "");
  } catch { return ""; }
}

function streamPanes() {
  return (ctx?.paneManager?.panes || []).filter((p) => p?.paneRole === "stream" && p?.streamCode);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// מראה את המקום המוצע בתוך הטקסט האמיתי, כדי שמשה יראה במו עיניו ולא יסמוך
// על מספר מיקום.
function contextAround(mainText, position, phrase) {
  if (position === null || position === undefined) return "—";
  const before = mainText.slice(Math.max(0, position - 40), position);
  const at = mainText.slice(position, position + Math.max(12, phrase.length));
  const after = mainText.slice(position + at.length, position + at.length + 30);
  return `${escapeHtml(before)}<mark>${escapeHtml(at)}</mark>${escapeHtml(after)}`;
}

function render() {
  if (!refs || !lastResult) return;
  const { proposals, summary } = lastResult;
  const mainText = refs._mainText || "";

  refs.sum.innerHTML = [
    `<span class="rtmp-chip">${summary.notes} הערות</span>`,
    `<span class="rtmp-chip c-ok">${summary.exact} ברורות</span>`,
    summary.ambiguous ? `<span class="rtmp-chip c-warn">${summary.ambiguous} יותר ממקום אחד</span>` : "",
    summary.far ? `<span class="rtmp-chip c-warn">${summary.far} רחוקות</span>` : "",
    summary.notFound ? `<span class="rtmp-chip c-bad">${summary.notFound} לא נמצאו</span>` : "",
    summary.outOfOrder ? `<span class="rtmp-chip c-bad">${summary.outOfOrder} לא לפי הסדר</span>` : "",
  ].filter(Boolean).join("");

  refs.tbody.innerHTML = proposals.map((p, i) => {
    const lv = LEVEL[p.confidence] || LEVEL[CONFIDENCE_NONE];
    return `<tr>
      <td>${p.number ?? i + 1}</td>
      <td>${escapeHtml(p.phrase) || "—"}</td>
      <td><span class="rtmp-chip ${lv.cls}">${lv.text}</span>${p.inOrder ? "" : ' <span class="rtmp-chip c-bad">לא לפי הסדר</span>'}</td>
      <td class="rtmp-ctx">${contextAround(mainText, p.position, p.phrase)}</td>
      <td class="rtmp-ctx">${escapeHtml(p.reason)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="opacity:.7">אין הערות בזרם הזה.</td></tr>`;

  refs.download.disabled = !proposals.length;
}

function runProposal() {
  const pm = ctx?.paneManager;
  const code = refs.stream.value;
  const pane = streamPanes().find((p) => String(p.streamCode) === code);
  const main = pm?.getMainPane?.();
  if (!pane || !main) { refs.sum.textContent = "לא נמצא זרם או טקסט ראשי."; return; }

  const mainText = paneText(main);
  refs._mainText = mainText;
  lastResult = proposeMarkerPlacements(mainText, paneText(pane));
  render();
}

function downloadReport() {
  if (!lastResult) return;
  const lines = [describeProposalReport(lastResult), "", "פירוט:"];
  for (const [i, p] of lastResult.proposals.entries()) {
    lines.push(`${p.number ?? i + 1}. „${p.phrase}" — ${LEVEL[p.confidence]?.text || ""}${p.inOrder ? "" : " · לא לפי הסדר"}`);
    lines.push(`   ${p.reason}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-");
  a.href = url;
  a.download = `ravtext-הצעת-קישורים-${stamp}.txt`;
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
    <div class="rtmp-backdrop" data-act="close"></div>
    <div class="rtmp-window" role="dialog" aria-modal="true" aria-label="הצעת קישורים">
      <div class="rtmp-head">
        <span class="rtmp-title">🔗 הצעת קישורים</span>
        <span class="rtmp-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtmp-body">
        <div class="rtmp-warn">⛔ <b>הכלי הזה אינו משנה את המסמך.</b> הוא בודק לכל הערה איפה
          הדיבור המתחיל שלה נמצא בטקסט הראשי, ומראה לך את ההצעה. שום סמן אינו נכנס
          בפועל, ושום אות במסמך אינה זזה.</div>

        <div class="rtmp-bar">
          <label>זרם ההערות:</label>
          <select id="rtmp-stream"></select>
          <button type="button" class="rtmp-primary" id="rtmp-run">בדוק</button>
        </div>

        <div class="rtmp-sum" id="rtmp-sum"></div>

        <div class="rtmp-tablewrap">
          <table>
            <thead><tr>
              <th>הערה</th><th>דיבור המתחיל</th><th>מצב</th><th>היכן בטקסט</th><th>למה</th>
            </tr></thead>
            <tbody id="rtmp-tbody"></tbody>
          </table>
        </div>

        <div class="rtmp-note">הכלל שלפיו זה עובד הוא שלך: הקישור נכנס <b>לפני</b> המילים
          המצוטטות בתחילת ההערה, לא אחריהן. הערה שאינה לפי הסדר <b>אינה מוזזת</b> — רק
          מסומנת. וחיפוש שקופץ רחוק מסומן באדום במקום להיחשב התאמה.</div>
      </div>
      <div class="rtmp-foot">
        <button type="button" id="rtmp-download" disabled>⭳ הורד את ההצעה</button>
        <span class="rtmp-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    stream: $("rtmp-stream"),
    run: $("rtmp-run"),
    sum: $("rtmp-sum"),
    tbody: $("rtmp-tbody"),
    download: $("rtmp-download"),
    _mainText: "",
  };

  refs.run.addEventListener("click", runProposal);
  refs.stream.addEventListener("change", runProposal);
  refs.download.addEventListener("click", downloadReport);
  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="close"]')) closeMarkerProposal();
  });
  return root;
}

function onKeyDown(e) {
  if (e.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeMarkerProposal();
}

export function openMarkerProposal({ paneManager } = {}) {
  ensureStyle();
  ctx = { paneManager: paneManager || window.paneManager || null };
  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  const panes = streamPanes();
  refs.stream.innerHTML = panes
    .map((p) => `<option value="${p.streamCode}">${escapeHtml(p.label || `זרם ${p.streamCode}`)}</option>`)
    .join("") || `<option value="">אין זרמי הערות במסמך</option>`;

  lastResult = null;
  refs.sum.textContent = panes.length ? "" : "אין זרמי הערות במסמך הזה.";
  refs.tbody.innerHTML = "";
  refs.download.disabled = true;
  if (panes.length) runProposal();
}

export function closeMarkerProposal() {
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenMarkerProposal = openMarkerProposal;
  window.__ravtextCloseMarkerProposal = closeMarkerProposal;
}
