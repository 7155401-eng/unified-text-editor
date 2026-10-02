// מכוון העמודים — הממשק (העברה מהתוכנה הקודמת, `page_tweaker_ui.py`).
//
// מה זה עושה: בתוכנה שהייתה מותקנת על המחשב היה חלון שבו אפשר לעבור עמוד-עמוד
// ולהגיד ידנית „בעמוד הזה תוריד שורה לעמוד הבא" או „בעמוד הזה תמשוך שורה
// מלמעלה", לסמן עמוד כ„בדקתי ואישרתי", ולשמור את הכל לקובץ. באתר כבר קיים
// *המודל* של הדבר הזה (`page_tweaks.js`) והמנוע כבר מכבד אותו (`vilna_v9.js`),
// אבל לא היה שום מסך שדרכו משה יכול להפעיל אותו. זה המסך.
//
// למה חלון צף ולא קנבס משלו, כמו בתוכנה הישנה:
// התוכנה הישנה ציירה לעצמה את העמוד מחדש מתוך PDF. באתר העמוד *כבר* מצויר
// ונכון, ולכן ציור שני היה יוצר מנוע-גיאומטריה שני שחולק על הראשון — בדיוק
// הדבר שמסמך ההעברה מזהיר מפניו. כאן הקנבס הוא העמוד האמיתי: בחירת עמוד
// ברשימה גוללת אליו ומסמנת אותו, והכוונון נעשה על הדבר עצמו.
//
// על לולאות רינדור: כל שינוי נרשם מיד על המסך אבל נשלח למנוע רק אחרי 350
// מילי-שנייה של שקט. לכן החזקת כפתור או עשר לחיצות רצופות = רינדור אחד, לא
// עשרה. אין כאן שום דבר שרץ על שעון קבוע ואין מעקב אחרי הדף.

import {
  PAGE_TWEAK_STATUS_APPROVED,
  PAGE_TWEAK_STATUS_CHANGED,
  PAGE_TWEAK_STATUS_PENDING,
} from "./page_tweaks.js";

const DIALOG_ID = "rt-page-tweaker";
const STYLE_ID = "rt-page-tweaker-style";
const PAGE_SELECTOR = ".page:not(.page-placeholder):not(.ravtext-empty-page)";
const HILITE_CLASS = "rt-tweaker-target";
const COMMIT_DELAY_MS = 350;
const MAX_LINES_DIFF = 30;
const MAX_FOOTNOTE_SHIFT = 30;

const STATUS_TEXT = {
  [PAGE_TWEAK_STATUS_PENDING]: "ממתין",
  [PAGE_TWEAK_STATUS_APPROVED]: "מאושר",
  [PAGE_TWEAK_STATUS_CHANGED]: "שונה",
};

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10050;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtpt-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.38)}
#${DIALOG_ID} .rtpt-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(760px,calc(100vw - 24px));max-height:min(90vh,680px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtpt-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtpt-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtpt-spacer{flex:1}
#${DIALOG_ID} .rtpt-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} .rtpt-bar{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
#${DIALOG_ID} .rtpt-tablewrap{border:1px solid rgba(0,0,0,.12);border-radius:10px;overflow:auto;max-height:240px}
#${DIALOG_ID} table{width:100%;border-collapse:collapse;font-size:12px}
#${DIALOG_ID} th,#${DIALOG_ID} td{padding:5px 8px;text-align:right;white-space:nowrap;
  border-bottom:1px solid rgba(0,0,0,.07)}
#${DIALOG_ID} th{position:sticky;top:0;background:var(--rt-surface,#fff);font-weight:700;z-index:1}
#${DIALOG_ID} tbody tr{cursor:pointer}
#${DIALOG_ID} tbody tr:hover{background:rgba(44,90,160,.07)}
#${DIALOG_ID} tbody tr.is-sel{background:rgba(44,90,160,.15);font-weight:600}
#${DIALOG_ID} td.is-bad{color:#9a3412;font-weight:700}
#${DIALOG_ID} .rtpt-badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;
  border:1px solid rgba(0,0,0,.14)}
#${DIALOG_ID} .rtpt-badge.s-approved{background:rgba(22,101,52,.12);color:#166534}
#${DIALOG_ID} .rtpt-badge.s-changed{background:rgba(154,52,18,.12);color:#9a3412}
#${DIALOG_ID} .rtpt-panel{border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:10px;display:grid;gap:9px}
#${DIALOG_ID} .rtpt-panel h4{margin:0;font-size:13px}
#${DIALOG_ID} .rtpt-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
#${DIALOG_ID} .rtpt-row .rtpt-name{min-width:148px}
#${DIALOG_ID} .rtpt-val{min-width:42px;text-align:center;font-weight:700;
  font-variant-numeric:tabular-nums}
#${DIALOG_ID} .rtpt-hint{font-size:11px;opacity:.74;line-height:1.55}
#${DIALOG_ID} .rtpt-msg{min-height:1.5em;font-size:12px;line-height:1.5}
#${DIALOG_ID} .rtpt-msg.is-warn{color:#9a3412;font-weight:600}
#${DIALOG_ID} .rtpt-msg.is-ok{color:#166534;font-weight:600}
#${DIALOG_ID} textarea{font:inherit;font-size:12px;color:inherit;background:var(--rt-surface,#fff);
  border:1px solid rgba(0,0,0,.2);border-radius:8px;padding:6px 8px;width:100%;box-sizing:border-box;
  min-height:52px;resize:vertical;direction:rtl}
#${DIALOG_ID} .rtpt-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);
  flex-wrap:wrap}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:30px;padding:5px 11px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtpt-step{min-width:34px;font-size:15px;line-height:1}
#${DIALOG_ID} button.rtpt-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
#${DIALOG_ID} button[disabled]{opacity:.5;cursor:default}
#${DIALOG_ID} label.rtpt-check{display:flex;align-items:center;gap:5px;font-size:12px}
.${HILITE_CLASS}{outline:3px solid rgba(44,90,160,.75)!important;outline-offset:3px}
`;

let installed = false;
let refs = null;
let previousFocus = null;
let ctx = null;              // { paneManager, pagesContainer }
let selectedPage = 0;
let onlyProblems = false;
let pageReportsByNumber = new Map();
let lastMeasuredAt = null;
let commitTimer = 0;
let pendingPatches = new Map();   // pageNumber -> patch

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
  refs.msg.className = kind ? `rtpt-msg is-${kind}` : "rtpt-msg";
}

/* ---------- נתונים ---------- */

function pageElements() {
  return [...(ctx?.pagesContainer?.querySelectorAll?.(PAGE_SELECTOR) || [])]
    .filter((p) => getComputedStyle(p).display !== "none");
}

function pageCount() {
  return pageElements().length;
}

function streamList() {
  const panes = ctx?.paneManager?.panes || [];
  return panes
    .filter((p) => p?.paneRole === "stream" && p?.streamCode)
    .map((p) => ({ code: String(p.streamCode), label: p.label || `זרם ${p.streamCode}` }));
}

// הערך שמוצג: מה שכבר נשמר, ועליו מה שהמשתמש שינה ברגע זה וטרם נשלח למנוע.
function effectiveTweak(pageNumber) {
  const saved = ctx?.paneManager?.getPageTweak?.(pageNumber) || {};
  const pending = pendingPatches.get(pageNumber);
  if (!pending) return saved;
  return {
    ...saved,
    ...pending,
    footnoteShift: { ...(saved.footnoteShift || {}), ...(pending.footnoteShift || {}) },
  };
}

function reportFor(pageNumber) {
  return pageReportsByNumber.get(pageNumber) || null;
}

function isProblemPage(pageNumber) {
  const r = reportFor(pageNumber);
  if (!r) return false;
  return r.overflowPx > 1 || r.bottomGapLines > 1.5 || (r.issues || []).length > 0;
}

/* ---------- שליחה למנוע, עם השהיה ---------- */

function queuePatch(pageNumber, patch) {
  const current = pendingPatches.get(pageNumber) || {};
  const merged = { ...current, ...patch };
  if (patch.footnoteShift) {
    merged.footnoteShift = { ...(current.footnoteShift || {}), ...patch.footnoteShift };
  }
  pendingPatches.set(pageNumber, merged);

  renderAll();
  setMsg("מחיל…");

  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(commitPending, COMMIT_DELAY_MS);
}

function commitPending() {
  commitTimer = 0;
  if (!pendingPatches.size) return;
  const pm = ctx?.paneManager;
  if (!pm?.setPageTweak) {
    pendingPatches.clear();
    setMsg("לא הצלחנו לשמור — אין חיבור למסמך.", "warn");
    return;
  }

  const entries = [...pendingPatches.entries()];
  pendingPatches.clear();

  // כל העמודים נרשמים בלי רינדור, והרינדור נעשה פעם אחת בסוף.
  entries.forEach(([pageNumber, patch], index) => {
    const last = index === entries.length - 1;
    pm.setPageTweak(pageNumber, patch, { rerender: last });
  });

  renderAll();
  setMsg("נשמר. המנוע מעמד מחדש.", "ok");
}

/* ---------- מדידה ---------- */

async function measureNow({ quiet = false } = {}) {
  if (!ctx?.pagesContainer) return false;
  if (!pageCount()) {
    if (!quiet) setMsg("אין עדיין עמודים מוכנים. יש לרנדר תחילה.", "warn");
    return false;
  }
  try {
    if (!quiet) setMsg("מודד את העמודים…");
    const { analyzePagesContainer } = await import("./layout_analysis_report.js");
    const result = analyzePagesContainer(ctx.pagesContainer);
    const reports = result?.pageReports || [];
    pageReportsByNumber = new Map(reports.map((r) => [Number(r.page), r]));
    lastMeasuredAt = new Date();
    ctx.paneManager?.syncPageTweakMeasurements?.(reports);
    renderAll();
    if (!quiet) {
      const bad = reports.filter((r) => isProblemPage(Number(r.page))).length;
      setMsg(bad
        ? `נמדדו ${reports.length} עמודים. ${bad} דורשים תשומת לב.`
        : `נמדדו ${reports.length} עמודים. לא נמצאה בעיה.`, bad ? "warn" : "ok");
    }
    return true;
  } catch (error) {
    console.error("[page-tweaker] measure", error);
    if (!quiet) setMsg("המדידה נכשלה: " + (error?.message || error), "warn");
    return false;
  }
}

/* ---------- בחירת עמוד וגלילה אליו ---------- */

function clearHighlight() {
  ctx?.pagesContainer?.querySelectorAll?.(`.${HILITE_CLASS}`)
    ?.forEach((el) => el.classList.remove(HILITE_CLASS));
}

function selectPage(pageNumber, { scroll = true } = {}) {
  const total = pageCount();
  if (!total) return;
  selectedPage = clamp(Math.trunc(pageNumber) || 1, 1, total);
  clearHighlight();
  if (scroll) {
    const el = pageElements()[selectedPage - 1];
    if (el) {
      el.classList.add(HILITE_CLASS);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  renderAll();
}

/* ---------- ציור ---------- */

function statusBadge(status) {
  const text = STATUS_TEXT[status] || STATUS_TEXT[PAGE_TWEAK_STATUS_PENDING];
  const cls = status === PAGE_TWEAK_STATUS_APPROVED ? "s-approved"
    : status === PAGE_TWEAK_STATUS_CHANGED ? "s-changed" : "";
  return `<span class="rtpt-badge ${cls}">${text}</span>`;
}

function num(v, digits = 1) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : "—";
}

function renderTable() {
  const total = pageCount();
  const rows = [];
  for (let page = 1; page <= total; page += 1) {
    if (onlyProblems && !isProblemPage(page)) continue;
    const tweak = effectiveTweak(page);
    const report = reportFor(page);
    const shifts = Object.entries(tweak.footnoteShift || {});
    const gapBad = report && report.bottomGapLines > 1.5;
    const ovBad = report && report.overflowPx > 1;
    rows.push(`<tr data-page="${page}" class="${page === selectedPage ? "is-sel" : ""}">
      <td>${page}</td>
      <td>${statusBadge(tweak.status)}</td>
      <td class="${gapBad ? "is-bad" : ""}">${report ? num(report.bottomGapLines) : "—"}</td>
      <td class="${ovBad ? "is-bad" : ""}">${report ? num(report.overflowPx, 0) : "—"}</td>
      <td>${tweak.linesDiff ? (tweak.linesDiff > 0 ? `+${tweak.linesDiff}` : tweak.linesDiff) : "—"}</td>
      <td>${shifts.length ? shifts.map(([c, n]) => `${c}:${n}`).join(" · ") : "—"}</td>
    </tr>`);
  }

  refs.tbody.innerHTML = rows.join("") || `<tr><td colspan="6" style="opacity:.7">${
    total ? "אין עמודים שעונים לסינון." : "אין עדיין עמודים. יש לרנדר תחילה."
  }</td></tr>`;
}

function renderPanel() {
  const total = pageCount();
  if (!total) {
    refs.panel.innerHTML = `<div class="rtpt-hint">אין עמודים לכוונון.</div>`;
    return;
  }
  const page = selectedPage || 1;
  const tweak = effectiveTweak(page);
  const report = reportFor(page);
  const streams = streamList();

  const measured = report
    ? `רווח תחתון ${num(report.bottomGapLines)} שורות · גלישה ${num(report.overflowPx, 0)} פיקסל · מילוי ${
        Math.round((report.fillRatio || 0) * 100)}%`
    : "טרם נמדד — לחץ „מדוד עמודים”.";

  refs.panel.innerHTML = `
    <h4>עמוד ${page} מתוך ${total} — ${STATUS_TEXT[tweak.status]}</h4>
    <div class="rtpt-hint">${measured}</div>

    <div class="rtpt-row">
      <span class="rtpt-name">שורות מהעמוד הבא</span>
      <button type="button" class="rtpt-step" data-act="lines-dec" title="להוריד שורה לעמוד הבא">−</button>
      <span class="rtpt-val" id="rtpt-lines-val">${tweak.linesDiff > 0 ? `+${tweak.linesDiff}` : tweak.linesDiff}</span>
      <button type="button" class="rtpt-step" data-act="lines-inc" title="למשוך שורה מהעמוד הבא">+</button>
    </div>
    <div class="rtpt-hint">מספר שלילי שומר שורות ריקות בתחתית ודוחף תוכן לעמוד הבא. מספר חיובי מבקש
      למשוך שורות מהפסקה הבאה — והמנוע ימשוך רק מה שנכנס באמת.</div>

    ${streams.length ? `<div style="display:grid;gap:6px">
      ${streams.map((s) => {
        const value = clamp(Number(tweak.footnoteShift?.[s.code] || 0), 0, MAX_FOOTNOTE_SHIFT);
        return `<div class="rtpt-row">
          <span class="rtpt-name">הורדת שורות ב${s.label} (${s.code})</span>
          <button type="button" class="rtpt-step" data-act="shift-dec" data-code="${s.code}">−</button>
          <span class="rtpt-val">${value}</span>
          <button type="button" class="rtpt-step" data-act="shift-inc" data-code="${s.code}">+</button>
        </div>`;
      }).join("")}
    </div>` : `<div class="rtpt-hint">אין זרמי הערות במסמך הזה, ולכן אין מה להזיז בהם.</div>`}

    <label class="rtpt-field" style="display:grid;gap:4px">
      <span style="font-size:12px;opacity:.9">הערה לעצמך על העמוד הזה</span>
      <textarea id="rtpt-notes" maxlength="2000" placeholder="למשל: בדקתי, הכתר כאן בכוונה">${
        (tweak.notes || "").replace(/</gu, "&lt;")}</textarea>
    </label>

    <div class="rtpt-row">
      <button type="button" class="rtpt-primary" data-act="approve">✓ אשר את העמוד</button>
      <button type="button" data-act="reset-page">נקה את העמוד</button>
    </div>
  `;
}

function renderAll() {
  if (!refs || !$(DIALOG_ID)?.classList.contains("is-open")) return;
  const total = pageCount();
  if (total && (!selectedPage || selectedPage > total)) selectedPage = 1;
  renderTable();
  renderPanel();
  const stats = ctx?.paneManager?.getPageTweaks?.() || { pages: {} };
  const tuned = Object.keys(stats.pages || {}).length;
  refs.stats.textContent = `${total} עמודים · ${tuned} מכוונים${
    lastMeasuredAt ? ` · נמדד ב-${lastMeasuredAt.toLocaleTimeString("he-IL")}` : ""}`;
}

/* ---------- פעולות ---------- */

function bumpLines(delta) {
  const page = selectedPage || 1;
  const current = Number(effectiveTweak(page).linesDiff || 0);
  const next = clamp(current + delta, -MAX_LINES_DIFF, MAX_LINES_DIFF);
  if (next === current) {
    setMsg(`הגעת לגבול (${MAX_LINES_DIFF} שורות).`, "warn");
    return;
  }
  queuePatch(page, { linesDiff: next });
}

function bumpShift(code, delta) {
  const page = selectedPage || 1;
  const current = Number(effectiveTweak(page).footnoteShift?.[code] || 0);
  const next = clamp(current + delta, 0, MAX_FOOTNOTE_SHIFT);
  if (next === current) return;
  queuePatch(page, { footnoteShift: { [code]: next } });
}

function approveCurrent() {
  const page = selectedPage || 1;
  const pm = ctx?.paneManager;
  if (!pm?.approvePageTweak) return;
  if (commitTimer) { clearTimeout(commitTimer); commitPending(); }
  const report = reportFor(page);
  pm.approvePageTweak(page, report ? {
    bottomGapLines: report.bottomGapLines,
    overflowPx: report.overflowPx,
    linePitchPx: report.linePitchPx,
  } : {});
  renderAll();
  setMsg(`עמוד ${page} סומן כמאושר. אם תשנה אותו שוב הוא יחזור לסימון „שונה”.`, "ok");
}

function resetCurrent() {
  const page = selectedPage || 1;
  pendingPatches.delete(page);
  ctx?.paneManager?.resetPageTweak?.(page);
  renderAll();
  setMsg(`הכוונון של עמוד ${page} נוקה.`, "ok");
}

function clearAll() {
  const count = Object.keys(ctx?.paneManager?.getPageTweaks?.()?.pages || {}).length;
  if (!count) { setMsg("אין כוונונים לנקות."); return; }
  if (!window.confirm(`לנקות את הכוונון של כל ${count} העמודים? אין דרך לבטל.`)) return;
  pendingPatches.clear();
  ctx?.paneManager?.clearPageTweaks?.();
  renderAll();
  setMsg("כל הכוונונים נוקו.", "ok");
}

function exportTweaks() {
  const data = ctx?.paneManager?.getPageTweaks?.() || { pages: {} };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-");
  a.href = url;
  a.download = `ravtext-page-tweaks-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  setMsg("הקובץ ירד.", "ok");
}

// בתוכנה הקודמת היו *שני* קבצים, לא אחד:
//   page_tweaks.json           → {"3": {"lines_diff": 1}}
//   page_footnote_shifts.json  → {"3": {"A": 2}}
// השני מזהה את הזרם לפי *אות סדרה* ולא לפי מספר הזרם, והתוכנה הישנה תמיד
// כתבה "A" (זה כתוב שם במפורש כהערה: „בהמשך אפשר לתת למשתמש לבחור סדרה").
// באתר הזרם מזוהה לפי המספר שלו (01, 02…), ולכן אות סדרה מתורגמת לפי מקום:
// A = הזרם הראשון במסמך, B = השני, וכן הלאה. תרגום קבוע וניתן לבדיקה, ולא ניחוש.
export function seriesLetterToStreamCode(letter, streamCodes = []) {
  const ch = String(letter || "").trim().toUpperCase();
  if (!/^[A-Z]$/u.test(ch)) return null;
  const index = ch.charCodeAt(0) - 65;
  return streamCodes[index] ?? null;
}

// מזהה איזה מהשני קבצים קיבלנו, ומחזיר תיקון אחיד לכל עמוד.
export function parseDesktopTweakFile(parsed, streamCodes = []) {
  const root = parsed?.pages && typeof parsed.pages === "object" ? parsed.pages : parsed;
  const pageKeys = Object.keys(root || {}).filter((k) => /^\d+$/u.test(String(k)));
  if (!pageKeys.length) return { kind: "empty", patches: new Map(), unmapped: [] };

  const looksLikeShifts = pageKeys.every((key) => {
    const entry = root[key];
    if (!entry || typeof entry !== "object") return false;
    const entryKeys = Object.keys(entry);
    return entryKeys.length > 0 && entryKeys.every((k) => /^[A-Za-z]$/u.test(k));
  });

  const patches = new Map();
  const unmapped = [];

  for (const key of pageKeys) {
    const page = Number(key);
    const entry = root[key] || {};
    if (looksLikeShifts) {
      const footnoteShift = {};
      for (const [letter, value] of Object.entries(entry)) {
        const code = seriesLetterToStreamCode(letter, streamCodes);
        if (!code) { unmapped.push(`${page}:${letter}`); continue; }
        footnoteShift[code] = Number(value) || 0;
      }
      if (Object.keys(footnoteShift).length) patches.set(page, { footnoteShift });
    } else {
      patches.set(page, entry);
    }
  }

  return { kind: looksLikeShifts ? "footnote-shifts" : "page-tweaks", patches, unmapped };
}

function importTweaks() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const pm = ctx?.paneManager;
      if (!pm?.setPageTweak) throw new Error("אין חיבור למסמך");

      const codes = streamList().map((s) => s.code);
      const { kind, patches, unmapped } = parseDesktopTweakFile(parsed, codes);
      if (kind === "empty" || !patches.size) throw new Error("לא נמצאו עמודים בקובץ");

      const entries = [...patches.entries()];
      entries.forEach(([page, patch], index) => {
        pm.setPageTweak(page, patch, { rerender: index === entries.length - 1 });
      });
      pendingPatches.clear();
      renderAll();

      const what = kind === "footnote-shifts" ? "הזזות זרמים" : "כוונוני עמודים";
      const warn = unmapped.length
        ? ` ⚠ ${unmapped.length} סדרות לא נמצא להן זרם מתאים במסמך הזה, והן דולגו.`
        : "";
      setMsg(`נטענו ${entries.length} עמודים (${what}) מהקובץ.${warn}`, unmapped.length ? "warn" : "ok");
    } catch (error) {
      setMsg("הקובץ לא נטען: " + (error?.message || error), "warn");
    }
  }, { once: true });
  input.click();
}

/* ---------- בנייה ---------- */

function buildDialog() {
  const root = document.createElement("div");
  root.id = DIALOG_ID;
  root.setAttribute("dir", "rtl");
  root.innerHTML = `
    <div class="rtpt-backdrop" data-act="close"></div>
    <div class="rtpt-window" role="dialog" aria-modal="true" aria-label="מכוון העמודים">
      <div class="rtpt-head">
        <span class="rtpt-title">🛠️ מכוון העמודים</span>
        <span class="rtpt-spacer"></span>
        <span class="rtpt-hint" id="rtpt-stats"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtpt-body">
        <div class="rtpt-bar">
          <button type="button" data-act="measure">📏 מדוד עמודים</button>
          <label class="rtpt-check"><input type="checkbox" id="rtpt-only-problems"> רק עמודים בעייתיים</label>
          <span class="rtpt-spacer"></span>
          <button type="button" data-act="export">⭳ שמור לקובץ</button>
          <button type="button" data-act="import">⭱ טען מקובץ</button>
        </div>
        <div class="rtpt-tablewrap">
          <table>
            <thead><tr>
              <th>עמוד</th><th>מצב</th><th>רווח תחתון</th><th>גלישה</th><th>שורות</th><th>הזזת זרמים</th>
            </tr></thead>
            <tbody id="rtpt-tbody"></tbody>
          </table>
        </div>
        <div class="rtpt-panel" id="rtpt-panel"></div>
        <div class="rtpt-msg" id="rtpt-msg"></div>
        <div class="rtpt-hint">קיצורי מקלדת: מקשי החִצים למעבר בין עמודים ·
          <bdi>+</bdi> ו-<bdi>−</bdi> להורדת ומשיכת שורות ·
          <bdi>Esc</bdi> לסגירה. בחירת עמוד ברשימה גוללת אליו ומסמנת אותו במסך.</div>
      </div>
      <div class="rtpt-foot">
        <button type="button" data-act="clear-all">נקה הכול</button>
        <span class="rtpt-spacer"></span>
        <button type="button" class="rtpt-primary" data-act="close">סיום</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    tbody: $("rtpt-tbody"),
    panel: $("rtpt-panel"),
    msg: $("rtpt-msg"),
    stats: $("rtpt-stats"),
    onlyProblems: $("rtpt-only-problems"),
  };

  refs.onlyProblems.addEventListener("change", () => {
    onlyProblems = !!refs.onlyProblems.checked;
    renderAll();
  });

  refs.tbody.addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-page]");
    if (tr) selectPage(Number(tr.dataset.page));
  });

  refs.panel.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "lines-dec") bumpLines(-1);
    else if (act === "lines-inc") bumpLines(1);
    else if (act === "shift-dec") bumpShift(btn.dataset.code, -1);
    else if (act === "shift-inc") bumpShift(btn.dataset.code, 1);
    else if (act === "approve") approveCurrent();
    else if (act === "reset-page") resetCurrent();
  });

  // הערה נשמרת כשיוצאים מהשדה, לא על כל אות — כדי לא לרנדר על כל הקלדה.
  refs.panel.addEventListener("change", (event) => {
    if (event.target?.id !== "rtpt-notes") return;
    queuePatch(selectedPage || 1, { notes: event.target.value });
  });

  root.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn || btn.closest("#rtpt-panel")) return;
    const act = btn.dataset.act;
    if (act === "close") closeDialog();
    else if (act === "measure") measureNow();
    else if (act === "export") exportTweaks();
    else if (act === "import") importTweaks();
    else if (act === "clear-all") clearAll();
  });

  return root;
}

function onKeyDown(event) {
  if (!$(DIALOG_ID)?.classList.contains("is-open")) return;
  const inField = event.target?.tagName === "TEXTAREA" || event.target?.tagName === "INPUT";
  if (event.key === "Escape") { closeDialog(); return; }
  if (inField) return;
  if (event.key === "ArrowRight") { selectPage((selectedPage || 1) - 1); event.preventDefault(); }
  else if (event.key === "ArrowLeft") { selectPage((selectedPage || 1) + 1); event.preventDefault(); }
  else if (event.key === "+" || event.key === "=") { bumpLines(1); event.preventDefault(); }
  else if (event.key === "-" || event.key === "_") { bumpLines(-1); event.preventDefault(); }
}

export function openPageTweaker({ paneManager, pagesContainer } = {}) {
  ensureStyle();
  ctx = {
    paneManager: paneManager || window.paneManager || null,
    pagesContainer: pagesContainer
      || document.getElementById("pages")
      || document.querySelector(".pages"),
  };
  if (!ctx.paneManager) {
    window.alert("לא הצלחנו להתחבר למסמך. נסה לרענן את הדף.");
    return;
  }

  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  selectedPage = selectedPage || 1;
  setMsg("");
  renderAll();
  // מדידה אחת בפתיחה, בשקט — כדי שהטבלה לא תיפתח ריקה.
  measureNow({ quiet: true });
}

export function closeDialog() {
  if (commitTimer) { clearTimeout(commitTimer); commitPending(); }
  clearHighlight();
  const root = $(DIALOG_ID);
  root?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

export function installPageTweaker() {
  if (installed) return;
  installed = true;
  if (typeof window !== "undefined") {
    window.__ravtextOpenPageTweaker = openPageTweaker;
    window.__ravtextClosePageTweaker = closeDialog;
  }
}

installPageTweaker();
