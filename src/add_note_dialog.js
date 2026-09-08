// משה 07/09/2026 (הערה 3): חלון קטן להוספת הערת שוליים.
//
// עד היום, כדי להוסיף הערה, היה צריך לזכור לכתוב סימן בטקסט הראשי, לעבור
// לחלונית של הזרם, ולכתוב שם את ההערה במקום הנכון ברשימה. מעכשיו יש חלון אחד:
// בוחרים זרם לפי השם שנתת לו, כותבים את ההערה, ולוחצים אישור.
//
// כל מה שקשור למקום שההערה מקבלת ברשימה נעשה בשרת. כאן יש רק את החלון עצמו.
//
// אין כאן שום דבר שרץ על שעון או על מעקב אחרי הדף. רשימת הזרמים נבנית מחדש רק
// כשהחלון נפתח, ולכן החלון הזה לא יכול ליצור לולאה של שינויים בדף.

import { addNoteToStream, streamPanes, mainPane, normaliseCode } from "./stream_note_insert.js";

const DIALOG_ID = "rt-add-note-dialog";
const STYLE_ID = "rt-add-note-dialog-style";
const OPEN_BTN_ID = "rt-add-note-open-btn";
const OPEN_BTN_TEXT = "➕ הוסף הערה";

let installed = false;
let busy = false;
let refs = null;
let previousFocus = null;
let savedFrom = 0;

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10040;display:none}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtan-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtan-window{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:min(460px,calc(100vw - 24px));max-height:min(88vh,560px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtan-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtan-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtan-spacer{flex:1}
#${DIALOG_ID} .rtan-body{padding:11px 13px;display:grid;gap:9px;overflow:auto}
#${DIALOG_ID} label.rtan-field{display:grid;gap:4px;font-size:12px;opacity:.9}
#${DIALOG_ID} select,#${DIALOG_ID} textarea{font:inherit;font-size:13px;color:inherit;
  background:var(--rt-surface,#fff);border:1px solid rgba(0,0,0,.2);border-radius:8px;
  padding:7px 9px;box-sizing:border-box;width:100%}
#${DIALOG_ID} textarea{min-height:112px;resize:vertical;line-height:1.6}
#${DIALOG_ID} .rtan-hint{font-size:11px;opacity:.72;line-height:1.5}
#${DIALOG_ID} .rtan-msg{min-height:1.5em;font-size:12px;line-height:1.5}
#${DIALOG_ID} .rtan-msg.is-warn{color:#9a3412;font-weight:600}
#${DIALOG_ID} .rtan-msg.is-ok{color:#166534;font-weight:600}
#${DIALOG_ID} .rtan-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:32px;padding:6px 12px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtan-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
#${DIALOG_ID} button[disabled]{opacity:.55;cursor:default}
#${OPEN_BTN_ID}{white-space:nowrap}
`;

const $ = (id) => document.getElementById(id);

function ensureStyle() {
  if ($(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function setMsg(text, kind) {
  if (!refs) return;
  const el = refs.msg;
  if (el.textContent !== text) el.textContent = text;
  const cls = kind ? `rtan-msg is-${kind}` : "rtan-msg";
  if (el.className !== cls) el.className = cls;
}

function setStatusLine(text) {
  const el = $("status");
  if (el && el.textContent !== text) el.textContent = text;
}

function build() {
  ensureStyle();
  let root = $(DIALOG_ID);
  if (root && refs) return refs;

  root = document.createElement("div");
  root.id = DIALOG_ID;
  root.dir = "rtl";

  const backdrop = document.createElement("div");
  backdrop.className = "rtan-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closeDialog();
  });

  const win = document.createElement("div");
  win.className = "rtan-window";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-modal", "true");
  win.setAttribute("aria-labelledby", "rtan-title");

  const head = document.createElement("div");
  head.className = "rtan-head";
  const title = document.createElement("span");
  title.className = "rtan-title";
  title.id = "rtan-title";
  title.textContent = "הוספת הערה לזרם";
  const spacer = document.createElement("span");
  spacer.className = "rtan-spacer";
  const xBtn = document.createElement("button");
  xBtn.type = "button";
  xBtn.textContent = "×";
  xBtn.title = "סגור";
  xBtn.setAttribute("aria-label", "סגור את החלון");
  xBtn.addEventListener("click", closeDialog);
  head.append(title, spacer, xBtn);

  const body = document.createElement("div");
  body.className = "rtan-body";

  const selLabel = document.createElement("label");
  selLabel.className = "rtan-field";
  const selCap = document.createElement("span");
  selCap.textContent = "לאיזה זרם ההערה נכנסת";
  const select = document.createElement("select");
  select.id = "rt-add-note-stream";
  select.dir = "rtl";
  selLabel.append(selCap, select);

  const marker = document.createElement("div");
  marker.className = "rtan-hint";

  const boxLabel = document.createElement("label");
  boxLabel.className = "rtan-field";
  const boxCap = document.createElement("span");
  boxCap.textContent = "טקסט ההערה";
  const box = document.createElement("textarea");
  box.id = "rt-add-note-text";
  box.dir = "rtl";
  box.rows = 5;
  box.setAttribute("placeholder", "כתוב כאן את ההערה…");
  boxLabel.append(boxCap, box);

  const hint = document.createElement("div");
  hint.className = "rtan-hint";
  hint.textContent = "ההערה תיכנס לחלונית של הזרם, ובטקסט הראשי יישאר הסימן שמקשר אליה. אנטר יורד שורה — לאישור לחץ על הכפתור או Ctrl+Enter. Esc סוגר.";

  const msg = document.createElement("div");
  msg.className = "rtan-msg";
  msg.setAttribute("role", "status");
  msg.setAttribute("aria-live", "polite");

  body.append(selLabel, marker, boxLabel, hint, msg);

  const foot = document.createElement("div");
  foot.className = "rtan-foot";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "rtan-primary";
  ok.textContent = "הוסף את ההערה";
  ok.addEventListener("click", submit);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "סגור";
  cancel.addEventListener("click", closeDialog);
  foot.append(ok, cancel);

  win.append(head, body, foot);
  root.append(backdrop, win);
  document.body.appendChild(root);

  select.addEventListener("change", showMarker);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  });

  refs = { root, win, select, marker, box, msg, ok, cancel, xBtn };
  return refs;
}

function showMarker() {
  if (!refs) return;
  const code = normaliseCode(refs.select.value);
  const text = code ? `בטקסט הראשי יתווסף הסימן @${code} במקום שבו הסמן עומד.` : "";
  if (refs.marker.textContent !== text) refs.marker.textContent = text;
}

// רשימת הזרמים נבנית מחדש בכל פתיחה, מהשם החי של החלונית — כדי שלא יופיע פה
// שם ישן אחרי שמשה שינה את שם הזרם.
function fillStreams() {
  const panes = streamPanes();
  const previous = refs.select.value;
  refs.select.textContent = "";
  for (const pane of panes) {
    const code = normaliseCode(pane.streamCode);
    if (!code) continue;
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = String(pane.label || "").trim() || `זרם ${code}`;
    opt.title = `${opt.textContent} — ${code}`;
    refs.select.appendChild(opt);
  }
  if (previous && panes.some((p) => normaliseCode(p.streamCode) === previous)) {
    refs.select.value = previous;
  }
  refs.ok.disabled = !panes.length;
  return panes.length;
}

export function openAddNoteDialog() {
  const r = build();
  previousFocus = document.activeElement;

  // תופסים את מקום הסמן בטקסט הראשי *לפני* שהחלון לוקח את המיקוד — אחרת
  // הסימן יתווסף במקום אקראי.
  const main = mainPane();
  savedFrom = main?.editor ? main.editor.state.selection.from : 0;

  const count = fillStreams();
  showMarker();
  r.box.value = "";
  setMsg(count ? "" : "אין כרגע חלוניות של זרמים. פתח חלונית זרם ואז נסה שוב.", count ? null : "warn");

  if (!r.root.classList.contains("is-open")) r.root.classList.add("is-open");
  setTimeout(() => { try { r.box.focus(); } catch (_) {} }, 0);
  return true;
}

export function closeDialog() {
  const r = $(DIALOG_ID);
  if (r && r.classList.contains("is-open")) r.classList.remove("is-open");
  try { previousFocus?.focus?.(); } catch (_) {}
  previousFocus = null;
  return true;
}

export function isAddNoteDialogOpen() {
  return !!$(DIALOG_ID)?.classList.contains("is-open");
}

async function submit() {
  if (busy || !refs) return false;

  const text = refs.box.value.trim();
  if (!text) {
    setMsg("החלון ריק — כתוב את ההערה, ורק אז לחץ אישור. לא הוספנו כלום.", "warn");
    try { refs.box.focus(); } catch (_) {}
    return false;
  }

  const code = normaliseCode(refs.select.value);
  if (!code) {
    setMsg("צריך לבחור זרם.", "warn");
    return false;
  }

  busy = true;
  refs.ok.disabled = true;
  setMsg("מוסיף…", null);

  try {
    const res = await addNoteToStream({
      code,
      noteText: text,
      from: savedFrom,
      to: savedFrom,
    });
    const name = refs.select.selectedOptions[0]?.textContent || `זרם ${code}`;
    const line = `ההערה נוספה ל${name} במקום ${res.ordinal} מתוך ${res.noteCount}.`;
    setStatusLine(line);
    refs.box.value = "";

    if (res.inSync) {
      // הכול הסתדר — סוגרים, וההודעה נשארת בשורת המצב של המסך.
      closeDialog();
    } else {
      // בזרם הזה יש יותר סימנים בטקסט הראשי מאשר הערות בחלונית, ולכן ההערה
      // לא יכלה לשבת בדיוק במקום שהסימן מצביע עליו. משאירים את החלון פתוח כדי
      // שמשה באמת יראה את ההודעה.
      setMsg(`${line} שים לב: ב${name} יש יותר סימנים בטקסט הראשי מאשר הערות בחלונית, ולכן ההערה נוספה בסוף.`, "warn");
    }
    return true;
  } catch (err) {
    setMsg(err?.message || "לא הצלחנו להוסיף את ההערה.", "warn");
    return false;
  } finally {
    busy = false;
    if (refs) refs.ok.disabled = false;
  }
}

function openButton() {
  let b = $(OPEN_BTN_ID);
  if (!b) {
    b = document.createElement("button");
    b.id = OPEN_BTN_ID;
    b.type = "button";
    b.textContent = OPEN_BTN_TEXT;
    b.title = "פתח חלון קטן להוספת הערה לזרם שתבחר";
    b.setAttribute("aria-haspopup", "dialog");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAddNoteDialog();
    });
  }
  return b;
}

export function installAddNoteDialog() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const place = () => {
    const host = document.querySelector(".source-stream-toolbar .tb-group");
    if (!host) return false;
    const b = openButton();
    if (!host.contains(b)) host.appendChild(b);
    return true;
  };

  // ניסיון אחד בטעינה, ועוד כמה ניסיונות בודדים בזמנים קבועים — ברגע שהכפתור
  // במקום, אין יותר כתיבות לדף.
  const boot = () => { if (!place()) [200, 700, 1800, 4000].forEach((ms) => setTimeout(place, ms)); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

if (typeof window !== "undefined") {
  window.__ravtextOpenAddNoteDialog = openAddNoteDialog;
  window.__ravtextCloseAddNoteDialog = closeDialog;
}

installAddNoteDialog();
