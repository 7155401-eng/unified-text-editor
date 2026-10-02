// המרת טקסט לדיבור — המסך (העברה מהתוכנה הקודמת, פריט ה-2).
//
// כל הלוגיקה יושבת ב-`tts_engine.js` ונבדקת שם בלי רשת. כאן יש רק חלון.
//
// שתי דרכי הקראה, לפי מה שיש למשתמש:
//   1. **מפתח ElevenLabs משלו** — קול אנושי באיכות גבוהה, ואפשר להוריד קובץ.
//      משה הכריע 02/10: „אף אחד לא מקבל ספק בחינם אלא רק מכניס מפתח לבד".
//      המפתח נשמר באותו מקום שבו כלי התמלול כבר שומר אותו, ולכן מי שכבר הזין
//      אותו שם — לא צריך להזין כלום.
//   2. **קול המחשב** — חינם, בלי מפתח, בלי רשת. איכות נמוכה יותר, ואי-אפשר
//      להוריד קובץ. קיים כדי שהכלי יהיה שימושי גם בלי חשבון בתשלום.
//
// אין כאן שעון ואין מעקב אחרי הדף: החלון נבנה כשנפתח, והטקסט נקרא פעם אחת.

import {
  TTS_CONFIG_KEY,
  ELEVEN_DEFAULT_VOICE,
  readElevenLabsKey,
  stripForSpeech,
  chunkTextForSpeech,
  estimateSpeechSeconds,
  buildElevenLabsRequest,
  describeTtsFailure,
} from "./tts_engine.js";

const DIALOG_ID = "rt-tts-dialog";
const STYLE_ID = "rt-tts-style";

const CSS = `
#${DIALOG_ID}{position:fixed;inset:0;z-index:10045;display:none;direction:rtl}
#${DIALOG_ID}.is-open{display:block}
#${DIALOG_ID} .rtts-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42)}
#${DIALOG_ID} .rtts-window{position:absolute;top:50%;right:50%;transform:translate(50%,-50%);
  width:min(540px,calc(100vw - 24px));max-height:min(88vh,640px);display:flex;flex-direction:column;
  background:var(--rt-surface,#fff);color:var(--rt-text,#222);border:1px solid rgba(0,0,0,.16);
  border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.28);font-size:13px;box-sizing:border-box}
#${DIALOG_ID} .rtts-head{display:flex;align-items:center;gap:8px;padding:10px 13px;
  border-bottom:1px solid rgba(0,0,0,.10)}
#${DIALOG_ID} .rtts-title{font-weight:700;font-size:14px}
#${DIALOG_ID} .rtts-spacer{flex:1}
#${DIALOG_ID} .rtts-body{padding:11px 13px;display:grid;gap:10px;overflow:auto}
#${DIALOG_ID} label.rtts-field{display:grid;gap:4px;font-size:12px;opacity:.92}
#${DIALOG_ID} input,#${DIALOG_ID} select,#${DIALOG_ID} textarea{font:inherit;font-size:13px;
  color:inherit;background:var(--rt-surface,#fff);border:1px solid rgba(0,0,0,.2);
  border-radius:8px;padding:7px 9px;box-sizing:border-box;width:100%}
#${DIALOG_ID} textarea{min-height:92px;resize:vertical;line-height:1.65;direction:rtl}
#${DIALOG_ID} .rtts-stats{font-size:12px;opacity:.85;display:flex;gap:10px;flex-wrap:wrap}
#${DIALOG_ID} .rtts-hint{font-size:11px;opacity:.74;line-height:1.55}
#${DIALOG_ID} .rtts-bar{height:7px;border-radius:999px;background:rgba(0,0,0,.09);overflow:hidden;display:none}
#${DIALOG_ID} .rtts-bar.is-on{display:block}
#${DIALOG_ID} .rtts-bar i{display:block;height:100%;width:0;background:#2c5aa0;transition:width .25s}
#${DIALOG_ID} .rtts-msg{min-height:1.5em;font-size:12px;line-height:1.5}
#${DIALOG_ID} .rtts-msg.is-warn{color:#9a3412;font-weight:600}
#${DIALOG_ID} .rtts-msg.is-ok{color:#166534;font-weight:600}
#${DIALOG_ID} audio{width:100%;margin-top:2px}
#${DIALOG_ID} .rtts-foot{display:flex;gap:7px;padding:10px 13px;border-top:1px solid rgba(0,0,0,.10);
  flex-wrap:wrap;align-items:center}
#${DIALOG_ID} button{font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:inherit;
  min-height:32px;padding:6px 12px;border-radius:9px;border:1px solid rgba(0,0,0,.16);
  background:rgba(0,0,0,.04)}
#${DIALOG_ID} button.rtts-primary{border-color:rgba(44,90,160,.5);
  background:linear-gradient(180deg,rgba(44,90,160,.16),rgba(44,90,160,.07))}
#${DIALOG_ID} button[disabled]{opacity:.5;cursor:default}
`;

const $ = (id) => document.getElementById(id);

let refs = null;
let previousFocus = null;
let ctx = null;            // { paneManager }
let busy = false;
let cancelRequested = false;
let lastAudioUrl = "";

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
  refs.msg.className = kind ? `rtts-msg is-${kind}` : "rtts-msg";
}

function setProgress(done, total) {
  if (!refs) return;
  if (!total) { refs.bar.classList.remove("is-on"); return; }
  refs.bar.classList.add("is-on");
  refs.barFill.style.width = `${Math.round((done / total) * 100)}%`;
}

/* ───────────────── מאיפה לוקחים את הטקסט ───────────────── */

function selectedText() {
  try { return String(window.getSelection?.()?.toString() || "").trim(); }
  catch { return ""; }
}

function paneText(pane) {
  try {
    const ed = pane?.editor || pane?._editor;
    if (ed?.state?.doc) return ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n", "\n");
    return String(pane?._body?.textContent || "");
  } catch { return ""; }
}

function textSources() {
  const pm = ctx?.paneManager;
  const out = [];
  const sel = selectedText();
  if (sel) out.push({ id: "selection", label: `הטקסט המסומן (${sel.length} תווים)`, text: sel });

  const main = pm?.getMainPane?.();
  if (main) out.push({ id: "main", label: "הטקסט הראשי", text: paneText(main) });

  for (const pane of pm?.panes || []) {
    if (pane?.paneRole !== "stream" || !pane?.streamCode) continue;
    out.push({ id: `s${pane.streamCode}`, label: `${pane.label || `זרם ${pane.streamCode}`}`, text: paneText(pane) });
  }

  const all = out.filter((s) => s.id !== "selection").map((s) => s.text).join("\n\n");
  if (all.trim()) out.push({ id: "all", label: "כל המסמך", text: all });

  return out.filter((s) => String(s.text || "").trim());
}

function currentText() {
  const id = refs?.source?.value;
  const found = (refs?._sources || []).find((s) => s.id === id);
  return stripForSpeech(found?.text || "", { keepCurlyNotes: !!refs?.keepNotes?.checked });
}

// „כ-00:03 דקות" לשלוש שניות זה מגוחך, ו„1 מנות" זה לא עברית. כאן נבנה
// ניסוח שנשמע כמו שאדם היה אומר אותו.
export function describeDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `כ-${s} שניות`;
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  const minText = minutes === 1 ? "דקה" : `${minutes} דקות`;
  if (!rest) return `כ-${minText}`;
  return `כ-${minText} ו-${rest} שניות`;
}

function refreshStats() {
  if (!refs) return;
  const text = currentText();
  const chunks = chunkTextForSpeech(text);
  const parts = chunks.length === 1 ? "מנה אחת" : `${chunks.length} מנות`;
  refs.stats.textContent = text
    ? `${text.length} תווים · ${parts} · ${describeDuration(estimateSpeechSeconds(text))} קריאה`
    : "אין טקסט להקראה.";
  refs.preview.value = text.slice(0, 600);
  refs.play.disabled = !text || busy;
}

/* ───────────────── הקראה ───────────────── */

function saveKey(key) {
  try {
    const raw = localStorage.getItem(TTS_CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    cfg.elevenlabs_api_key = String(key || "").trim();
    localStorage.setItem(TTS_CONFIG_KEY, JSON.stringify(cfg));
  } catch { /* אחסון חסום — לא מפילים את הכלי בגלל זה */ }
}

async function speakWithProvider(text, key) {
  const chunks = chunkTextForSpeech(text);
  const parts = [];
  setProgress(0, chunks.length);

  for (let i = 0; i < chunks.length; i += 1) {
    if (cancelRequested) return null;
    setMsg(`מכין מנה ${i + 1} מתוך ${chunks.length}…`);
    const req = buildElevenLabsRequest({
      text: chunks[i],
      apiKey: key,
      voiceId: refs.voice.value.trim() || ELEVEN_DEFAULT_VOICE,
    });
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 200); } catch { /* אין פירוט */ }
      throw new Error(describeTtsFailure(res.status, detail));
    }
    parts.push(await res.blob());
    setProgress(i + 1, chunks.length);
  }
  return new Blob(parts, { type: "audio/mpeg" });
}

function speakWithComputerVoice(text) {
  return new Promise((resolve, reject) => {
    const synth = window.speechSynthesis;
    if (!synth) { reject(new Error("הדפדפן הזה אינו יודע להקריא בעצמו.")); return; }
    synth.cancel();
    const chunks = chunkTextForSpeech(text, 220);
    setProgress(0, chunks.length);
    let index = 0;

    const next = () => {
      if (cancelRequested || index >= chunks.length) { resolve(null); return; }
      const u = new SpeechSynthesisUtterance(chunks[index]);
      u.lang = "he-IL";
      u.rate = Number(refs.rate.value) || 1;
      u.onend = () => { index += 1; setProgress(index, chunks.length); next(); };
      u.onerror = () => { index += 1; setProgress(index, chunks.length); next(); };
      synth.speak(u);
    };
    next();
  });
}

async function doSpeak() {
  if (busy) return;
  const text = currentText();
  if (!text) { setMsg("אין טקסט להקראה.", "warn"); return; }

  busy = true;
  cancelRequested = false;
  refs.play.disabled = true;
  refs.stop.disabled = false;

  try {
    const key = refs.key.value.trim();
    if (key) {
      saveKey(key);
      const blob = await speakWithProvider(text, key);
      if (cancelRequested) { setMsg("ההקראה בוטלה."); return; }
      if (lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);
      lastAudioUrl = URL.createObjectURL(blob);
      refs.audio.src = lastAudioUrl;
      refs.audio.style.display = "block";
      refs.download.disabled = false;
      await refs.audio.play().catch(() => { /* הדפדפן חוסם ניגון אוטומטי — הנגן מוצג */ });
      setMsg("מוכן. אפשר להאזין או להוריד את הקובץ.", "ok");
    } else {
      refs.audio.style.display = "none";
      refs.download.disabled = true;
      setMsg("מקריא בקול המחשב. להורדת קובץ שמע יש להזין מפתח.");
      await speakWithComputerVoice(text);
      setMsg(cancelRequested ? "ההקראה בוטלה." : "ההקראה הסתיימה.", cancelRequested ? undefined : "ok");
    }
  } catch (error) {
    setMsg(error?.message || "ההקראה נכשלה.", "warn");
  } finally {
    busy = false;
    cancelRequested = false;
    refs.play.disabled = false;
    refs.stop.disabled = true;
    setProgress(0, 0);
  }
}

function doStop() {
  cancelRequested = true;
  try { window.speechSynthesis?.cancel(); } catch { /* אין קול מחשב */ }
  try { refs.audio.pause(); } catch { /* אין ניגון */ }
  setMsg("עוצר…");
}

function doDownload() {
  if (!lastAudioUrl) return;
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-");
  a.href = lastAudioUrl;
  a.download = `ravtext-הקראה-${stamp}.mp3`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setMsg("הקובץ ירד.", "ok");
}

/* ───────────────── בנייה ───────────────── */

function buildDialog() {
  const root = document.createElement("div");
  root.id = DIALOG_ID;
  root.setAttribute("dir", "rtl");
  root.innerHTML = `
    <div class="rtts-backdrop" data-act="close"></div>
    <div class="rtts-window" role="dialog" aria-modal="true" aria-label="המרת טקסט לדיבור">
      <div class="rtts-head">
        <span class="rtts-title">🔊 הקראת הטקסט</span>
        <span class="rtts-spacer"></span>
        <button type="button" data-act="close" aria-label="סגור">✕</button>
      </div>
      <div class="rtts-body">
        <label class="rtts-field">
          <span>מה להקריא</span>
          <select id="rtts-source"></select>
        </label>

        <label class="rtts-field" style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="rtts-keep-notes" style="width:auto">
          <span>להקריא גם הערות שבתוך סוגריים מסולסלות</span>
        </label>

        <div class="rtts-stats" id="rtts-stats"></div>

        <label class="rtts-field">
          <span>כך זה יישמע (תחילת הטקסט, אחרי הסרת הקודים)</span>
          <textarea id="rtts-preview" readonly></textarea>
        </label>

        <label class="rtts-field">
          <span>מפתח <bdi>ElevenLabs</bdi> שלך — לקול אנושי ולהורדת קובץ</span>
          <input type="password" id="rtts-key" autocomplete="off" placeholder="בלי מפתח — יוקרא בקול המחשב">
        </label>
        <div class="rtts-hint">המפתח נשמר רק במחשב שלך, באותו מקום שבו כלי התמלול כבר שומר אותו.
          אנחנו לא רואים אותו ולא שולחים אותו לשום מקום חוץ מהספק עצמו. החיוב הוא בחשבון שלך אצלו.</div>

        <label class="rtts-field">
          <span>מזהה קול (לא חובה)</span>
          <input type="text" id="rtts-voice" placeholder="${ELEVEN_DEFAULT_VOICE}">
        </label>

        <label class="rtts-field">
          <span>מהירות קול המחשב</span>
          <input type="range" id="rtts-rate" min="0.6" max="1.6" step="0.1" value="1">
        </label>

        <div class="rtts-bar" id="rtts-bar"><i id="rtts-bar-fill"></i></div>
        <div class="rtts-msg" id="rtts-msg"></div>
        <audio id="rtts-audio" controls style="display:none"></audio>
      </div>
      <div class="rtts-foot">
        <button type="button" class="rtts-primary" id="rtts-play">▶ הקרא</button>
        <button type="button" id="rtts-stop" disabled>■ עצור</button>
        <button type="button" id="rtts-download" disabled>⭳ הורד קובץ שמע</button>
        <span class="rtts-spacer"></span>
        <button type="button" data-act="close">סגור</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  refs = {
    root,
    source: $("rtts-source"),
    keepNotes: $("rtts-keep-notes"),
    stats: $("rtts-stats"),
    preview: $("rtts-preview"),
    key: $("rtts-key"),
    voice: $("rtts-voice"),
    rate: $("rtts-rate"),
    bar: $("rtts-bar"),
    barFill: $("rtts-bar-fill"),
    msg: $("rtts-msg"),
    audio: $("rtts-audio"),
    play: $("rtts-play"),
    stop: $("rtts-stop"),
    download: $("rtts-download"),
    _sources: [],
  };

  refs.source.addEventListener("change", refreshStats);
  refs.keepNotes.addEventListener("change", refreshStats);
  refs.play.addEventListener("click", doSpeak);
  refs.stop.addEventListener("click", doStop);
  refs.download.addEventListener("click", doDownload);
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-act=\"close\"]")) closeTtsDialog();
  });

  return root;
}

function onKeyDown(event) {
  if (event.key === "Escape" && $(DIALOG_ID)?.classList.contains("is-open")) closeTtsDialog();
}

export function openTtsDialog({ paneManager } = {}) {
  ensureStyle();
  ctx = { paneManager: paneManager || window.paneManager || null };

  const root = $(DIALOG_ID) || buildDialog();
  previousFocus = document.activeElement;
  root.classList.add("is-open");
  document.addEventListener("keydown", onKeyDown, true);

  // רשימת המקורות נבנית מחדש בכל פתיחה — ולכן החלון לא צריך לעקוב אחרי הדף.
  refs._sources = textSources();
  refs.source.innerHTML = refs._sources
    .map((s) => `<option value="${s.id}">${s.label}</option>`)
    .join("") || `<option value="">אין טקסט במסמך</option>`;

  try { refs.key.value = readElevenLabsKey(localStorage); } catch { refs.key.value = ""; }
  setMsg(refs.key.value ? "" : "בלי מפתח ההקראה תהיה בקול המחשב — חינם, אבל פחות טבעי.");
  setProgress(0, 0);
  refreshStats();
}

export function closeTtsDialog() {
  doStop();
  $(DIALOG_ID)?.classList.remove("is-open");
  document.removeEventListener("keydown", onKeyDown, true);
  previousFocus?.focus?.();
  previousFocus = null;
}

if (typeof window !== "undefined") {
  window.__ravtextOpenTts = openTtsDialog;
  window.__ravtextCloseTts = closeTtsDialog;
}
