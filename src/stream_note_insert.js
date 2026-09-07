// משה 07/09/2026 (הערות 2 ו-3): המקום היחיד בדפדפן שמכניס הערת שוליים לזרם.
//
// ההחלטה *לאן* ההערה שייכת — באיזה מקום ברשימת ההערות של הזרם — נעשית בשרת,
// בפעולה "add_note_to_stream" שבקובץ worker/main_text_tools.js. הקובץ הזה לא
// מחשב את זה מחדש; הוא רק שואל את השרת ומחיל את התשובה על שני העורכים.
//
// למה לא פשוט לדרוס את הזרם בטקסט שהשרת מחזיר? כי השרת מחזיר טקסט שטוח, בלי
// עיצוב. בחלוניות של משה יש הדגשות, גופנים וסגנונות משלו — דריסה כזו הייתה
// מוחקת אותם. לכן אנחנו לוקחים מהשרת רק את המספר (באיזה מקום ההערה נכנסת),
// ומכניסים את ההערה בעצמנו בדיוק שם, בלי לגעת בשאר החלונית.

import { addNoteToStreamOnServer } from "./main_text_tools_client.js";

// ראש של הערה בחלונית זרם: הסימן, ואחריו לפעמים מספר סידורי בסוגריים.
const NOTE_HEAD = /^(\s*)(@\d{1,3})(\s*)(\[\d+\]\s*)?/;

export function normaliseCode(raw) {
  const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 1 || n > 999) return null;
  return String(n).padStart(2, "0");
}

function manager() {
  return typeof window === "undefined" ? null : window.paneManager;
}

export function streamPanes() {
  const list = manager()?.panes;
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && p.streamCode && p.editor);
}

export function paneForCode(code) {
  const c = normaliseCode(code);
  if (!c) return null;
  return streamPanes().find((p) => normaliseCode(p.streamCode) === c) || null;
}

export function mainPane() {
  const m = manager();
  if (!m) return null;
  if (typeof m.getMainPane === "function") return m.getMainPane();
  return Array.isArray(m.panes) ? m.panes.find((p) => !p.streamCode) || null : null;
}

// הטקסט הפשוט של עורך, עם שורה חדשה בין פסקה לפסקה — בדיוק הצורה שהשרת
// יודע לספור בה סימנים והערות.
export function plainTextOf(editor) {
  const doc = editor.state.doc;
  return doc.textBetween(0, doc.content.size, "\n", "\n");
}

// כל הערה בחלונית זרם היא פסקה נפרדת שנפתחת בסימן הזרם. מחזיר את המקום שלפני
// כל פסקה כזו, לפי הסדר.
function noteBlocks(editor, code) {
  const out = [];
  editor.state.doc.forEach((node, offset) => {
    const m = NOTE_HEAD.exec(node.textContent || "");
    if (!m || normaliseCode(m[2]) !== code) return;
    out.push({ pos: offset, head: m });
  });
  return out;
}

// אחרי הכנסה באמצע, המספרים בסוגריים של ההערות שאחריה כבר לא נכונים. כאן
// מתקנים רק את המספרים עצמם — שום אות אחרת בחלונית לא זזה. כותבים רק מספר
// שבאמת השתנה, ולכן קריאה חוזרת בלי שינוי לא כותבת כלום.
export function renumberStreamNotes(editor, code) {
  const c = normaliseCode(code);
  if (!c) return 0;
  const blocks = noteBlocks(editor, c);
  const doc = editor.state.doc;
  const edits = [];

  blocks.forEach((b, i) => {
    const m = b.head;
    const want = `[${i + 1}] `;
    const current = m[4] || "";
    if (current === want) return;
    const at = b.pos + 1 + m[1].length + m[2].length + m[3].length;
    const stop = at + current.length;
    if (stop > doc.content.size) return;
    // בדיקת ביטחון: מוודאים שבמקום הזה באמת יושב בדיוק מה שזיהינו. אם יש שם
    // משהו אחר (תמונה, שבירת שורה) — מוותרים על התיקון ולא נוגעים.
    if (doc.textBetween(at, stop, "", "") !== current) return;
    edits.push({ at, stop, text: want });
  });

  if (!edits.length) return 0;
  const tr = editor.state.tr;
  for (let i = edits.length - 1; i >= 0; i--) {
    tr.insertText(edits[i].text, edits[i].at, edits[i].stop);
  }
  editor.view.dispatch(tr);
  return edits.length;
}

function insertNoteBlock(editor, code, ordinal, noteText) {
  const blocks = noteBlocks(editor, code);
  const at = ordinal - 1 < blocks.length
    ? blocks[ordinal - 1].pos
    : editor.state.doc.content.size;
  const text = `@${code} [${ordinal}] ${noteText}`;
  editor
    .chain()
    .insertContentAt(
      at,
      { type: "paragraph", content: [{ type: "text", text }] },
      { updateSelection: false, applyInputRules: false, applyPasteRules: false },
    )
    .run();
  return at;
}

// בטקסט הראשי: מוציאים את הקטע הנבחר (אם נבחר קטע) ומשאירים במקומו את הסימן.
// אין רווחים נוספים — בדיוק כמו שהשרת בונה את הטקסט אצלו, כדי ששני הצדדים
// יישארו זהים.
function applyMainEdit(editor, code, from, to) {
  const chain = editor.chain();
  if (to > from) chain.deleteRange({ from, to });
  chain.insertContentAt(from, `@${code}`, {
    updateSelection: true,
    applyInputRules: false,
    applyPasteRules: false,
  });
  chain.run();
}

export class StreamNoteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StreamNoteError";
    this.code = code;
  }
}

export async function addNoteToStream({ code, noteText, from, to } = {}) {
  const c = normaliseCode(code);
  if (!c) throw new StreamNoteError("bad_stream", "לא נבחר זרם תקין.");

  const note = String(noteText || "").trim();
  if (!note) throw new StreamNoteError("empty_note", "ההערה ריקה — כתוב טקסט לפני האישור.");

  const main = mainPane();
  if (!main?.editor) throw new StreamNoteError("no_main", "לא נמצאה החלונית של הטקסט הראשי.");

  const stream = paneForCode(c);
  if (!stream?.editor) throw new StreamNoteError("no_stream", `אין כרגע חלונית פתוחה לזרם ${c}.`);

  const size = main.editor.state.doc.content.size;
  const start = Math.max(0, Math.min(Number.isFinite(Number(from)) ? Number(from) : 0, size));
  const end = Math.max(start, Math.min(Number.isFinite(Number(to)) ? Number(to) : start, size));
  const caretIndex = main.editor.state.doc.textBetween(0, start, "\n", "\n").length;

  const answer = await addNoteToStreamOnServer({
    mainText: plainTextOf(main.editor),
    streamText: plainTextOf(stream.editor),
    code: c,
    noteText: note,
    caretIndex,
  });

  const ordinal = Number(answer?.ordinal) || 1;

  // סדר הפעולות חשוב: קודם החלונית של הזרם, ורק אחריה הטקסט הראשי. אם משהו
  // ייכשל באמצע, הטקסט הראשי עדיין שלם ושום מילה לא נעלמה.
  insertNoteBlock(stream.editor, c, ordinal, note);
  renumberStreamNotes(stream.editor, c);
  applyMainEdit(main.editor, c, start, end);

  try { stream.scheduleMarkerBarUpdate?.({ immediate: true }); } catch (_) {}
  try { main.scheduleMarkerBarUpdate?.({ immediate: true }); } catch (_) {}
  try { manager()?._save?.(); } catch (_) {}
  try { manager()?._emit?.("change"); } catch (_) {}

  return {
    code: c,
    note,
    ordinal,
    noteCount: Number(answer?.noteCount) || ordinal,
    markerOrdinal: Number(answer?.markerOrdinal) || ordinal,
    inSync: answer?.inSync !== false,
    movedChars: end - start,
  };
}

// חשיפה לבדיקות בדפדפן.
if (typeof window !== "undefined") {
  window.__ravtextAddNoteToStream = addNoteToStream;
}
