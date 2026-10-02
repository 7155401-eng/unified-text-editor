// הצעת מיקום לסמני הערות — המנוע (העברה מהתוכנה הקודמת, פריטים ה-3/ה-4/ה-6).
//
// בתפריט הישן היו שלושה כלים: „משלב קישורים אוטומטי", „הוספת קישורים לביאור"
// ו„טופס השתלת קישורים". כולם מסומנים `"external": True` — כלומר **כרטיס בתפריט
// בלי שורת קוד אחת**. אין מה להעביר; צריך לבנות.
//
// ⛔ הדבר המסוכן כאן אינו הקוד אלא ההחלטה: איפה סמן חדש צריך לשבת. בוט שמנחש
// הורס מסמך — משה כבר חי את זה: „היו בעבר בוטים שפשוט מצאו באמצע הערה מילה אחת
// שלא מצאו אותה במילים הסמוכות ודילגו הרבה מאוד כדי למצוא מילה דומה, ובגלל זה
// הם פספסו משם עד הסוף".
//
// ולכן המנוע הזה **אינו משנה שום מסמך**. הוא מחזיר הצעה: לכל הערה — איפה הסמן
// היה נכנס, למה, וכמה בטוח. ההחלטה נשארת של משה.
//
// הכלל שלפיו הוא עובד הוא הכלל של משה עצמו (16/09/2026):
//
//   „הקישור צריך להיות כמו **דיבור המתחיל**, שזה אומר **לפני** ההפניה ולא
//    אחרי. כל ציטוט של הדיבור המתחיל שבתחילת כל הערה, צריך להיות לו קישור
//    בטקסט המקביל, בהערה לפני זה."
//
//   „ההערות כאן הן כמעט כולן לפי הסדר, אבל יש מהם יוצאים מן הכלל. אם אתה רואה
//    משהו שהוא לא לפי הסדר, אל תשנה אותו, כי זה צריך בדיקה ידנית... תעשה איזה
//    סימן ייחודי על כל הערה שהיא לא לפי הסדר."
//
//   „אל תקפוץ מדי הרבה מהערה להערה... כל שורה או שתיים או שלוש שורות לפחות
//    אמורות להיות לפחות הערה אחת."

/** כמה תווים קדימה מותר לחפש מהסמן הקודם. נגזר מההנחיה „אל תקפוץ מדי הרבה". */
export const DEFAULT_SEARCH_WINDOW = 1200;

/** דירוג ודאות של הצעה. */
export const CONFIDENCE_EXACT = "exact";       // נמצא ציטוט מלא, במקום אחד בלבד
export const CONFIDENCE_AMBIGUOUS = "ambiguous"; // נמצא יותר מפעם אחת בחלון
export const CONFIDENCE_FAR = "far";           // נמצא, אבל רחוק מהצפוי
export const CONFIDENCE_NONE = "none";         // לא נמצא — נשאר לבדיקה ידנית

const NOTE_HEAD = /^\s*@(\d{1,3})\s*(?:\[(\d+)\]\s*)?/u;

// הפרדה בין הדיבור המתחיל לגוף ההערה, לפי מה שמקובל בספרי קודש.
const DH_SEPARATORS = ["—", "–", " - ", "׃", ":", "–"];

/** ניקוד, טעמים וגרשיים — מסירים להשוואה בלבד, לא מהמסמך. */
const NIQQUD = /[֑-ׇ]/gu;
const PUNCT = /["'`״׳.,;:!?()[\]{}<>–—-]/gu;

/**
 * מנרמל טקסט להשוואה בלבד.
 * המסמך עצמו לעולם אינו משתנה — זה משמש רק כדי למצוא התאמה למרות ניקוד,
 * גרשיים ורווחים כפולים.
 */
export function normalizeForMatch(text) {
  return String(text ?? "")
    .replace(NIQQUD, "")
    .replace(PUNCT, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * שולף את הדיבור המתחיל מתוך הערה.
 *
 * „@01 [3] זכור את היום — פירוש..." ⇐ „זכור את היום"
 *
 * אם אין מפריד, לוקחים את שלוש המילים הראשונות: זה מה שמקובל כדיבור מתחיל
 * קצר, ועדיף מלנחש על סמך כל ההערה.
 */
export function extractOpeningPhrase(noteText, { maxWords = 8 } = {}) {
  let body = String(noteText ?? "").replace(NOTE_HEAD, "").trim();
  if (!body) return "";

  let cut = -1;
  for (const sep of DH_SEPARATORS) {
    const at = body.indexOf(sep);
    if (at > 0 && (cut === -1 || at < cut)) cut = at;
  }

  let phrase = cut > 0 ? body.slice(0, cut) : body;
  const words = phrase.trim().split(/\s+/u).filter(Boolean);
  if (words.length > maxWords) phrase = words.slice(0, maxWords).join(" ");
  return phrase.trim();
}

/** מפרק חלונית זרם לרשימת הערות, לפי הסדר שבה. */
export function parseNotes(streamText) {
  const out = [];
  const lines = String(streamText ?? "").split("\n");
  for (const line of lines) {
    const m = NOTE_HEAD.exec(line);
    if (!m) continue;
    out.push({
      code: m[1],
      number: m[2] ? Number(m[2]) : null,
      raw: line,
      phrase: extractOpeningPhrase(line),
    });
  }
  return out;
}

/**
 * מוצא את כל המקומות שבהם הביטוי מופיע בטקסט הראשי.
 * מחזיר מיקומים **בטקסט המקורי**, למרות שההשוואה נעשית על גרסה מנורמלת.
 */
export function findPhrasePositions(mainText, phrase) {
  const needle = normalizeForMatch(phrase);
  if (!needle) return [];

  // מפה בין כל תו בגרסה המנורמלת למיקומו בטקסט המקורי, כדי שההצעה תצביע
  // על מקום אמיתי במסמך ולא על מקום בגרסה המנורמלת.
  const src = String(mainText ?? "");
  let norm = "";
  const map = [];
  let lastWasSpace = true;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (NIQQUD.test(ch)) { NIQQUD.lastIndex = 0; continue; }
    NIQQUD.lastIndex = 0;
    const isSep = /\s/u.test(ch) || PUNCT.test(ch);
    PUNCT.lastIndex = 0;
    if (isSep) {
      if (lastWasSpace) continue;
      norm += " ";
      map.push(i);
      lastWasSpace = true;
    } else {
      norm += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }

  const hits = [];
  let from = 0;
  for (;;) {
    const at = norm.indexOf(needle, from);
    if (at === -1) break;
    hits.push(map[at] ?? 0);
    from = at + 1;
  }
  return hits;
}

/**
 * בונה הצעה לכל הערה — ואינו נוגע במסמך.
 *
 * @param {string} mainText הטקסט הראשי
 * @param {string} streamText חלונית הזרם
 * @param {{searchWindow?: number}} options
 * @returns {{proposals: Array, summary: Object}}
 */
export function proposeMarkerPlacements(mainText, streamText, { searchWindow = DEFAULT_SEARCH_WINDOW } = {}) {
  const notes = parseNotes(streamText);
  const proposals = [];
  let cursor = 0;          // המיקום שאחרי הסמן הקודם שהוצע
  let lastAccepted = -1;

  for (const note of notes) {
    const base = {
      code: note.code,
      number: note.number,
      phrase: note.phrase,
      raw: note.raw,
      position: null,
      confidence: CONFIDENCE_NONE,
      inOrder: true,
      reason: "",
    };

    if (!note.phrase) {
      proposals.push({ ...base, reason: "אין בהערה דיבור מתחיל שאפשר לחפש לפיו." });
      continue;
    }

    const hits = findPhrasePositions(mainText, note.phrase);
    if (!hits.length) {
      proposals.push({ ...base, reason: "הדיבור המתחיל לא נמצא בטקסט הראשי." });
      continue;
    }

    // ⭐ הכלל של משה: לא לקפוץ רחוק. מעדיפים את ההתאמה הראשונה שאחרי הסמן
    // הקודם ובתוך החלון. אם אין כזו — זו כבר לא התאמה בטוחה.
    const inWindow = hits.filter((h) => h >= cursor && h - cursor <= searchWindow);
    const forward = hits.filter((h) => h >= cursor);

    let position = null;
    let confidence = CONFIDENCE_NONE;
    let reason = "";

    if (inWindow.length === 1) {
      position = inWindow[0];
      confidence = CONFIDENCE_EXACT;
      reason = "נמצא פעם אחת, בטווח הצפוי אחרי ההערה הקודמת.";
    } else if (inWindow.length > 1) {
      position = inWindow[0];
      confidence = CONFIDENCE_AMBIGUOUS;
      reason = `הדיבור המתחיל מופיע ${inWindow.length} פעמים בטווח — נבחרה הראשונה, וצריך אישור.`;
    } else if (forward.length) {
      position = forward[0];
      confidence = CONFIDENCE_FAR;
      reason = `נמצא רק ${forward[0] - cursor} תווים קדימה — מעבר לטווח הצפוי. צריך בדיקה ידנית.`;
    } else {
      position = hits[hits.length - 1];
      confidence = CONFIDENCE_NONE;
      reason = "נמצא רק **לפני** ההערה הקודמת — כלומר ההערות אינן לפי הסדר כאן.";
    }

    // „אם אתה רואה משהו שהוא לא לפי הסדר, אל תשנה אותו" — מסמנים ולא מזיזים.
    const inOrder = position !== null && position >= lastAccepted;

    proposals.push({ ...base, position, confidence, inOrder, reason });

    if (confidence === CONFIDENCE_EXACT && inOrder) {
      lastAccepted = position;
      cursor = position + Math.max(1, normalizeForMatch(note.phrase).length);
    }
  }

  const summary = {
    notes: proposals.length,
    exact: proposals.filter((p) => p.confidence === CONFIDENCE_EXACT && p.inOrder).length,
    ambiguous: proposals.filter((p) => p.confidence === CONFIDENCE_AMBIGUOUS).length,
    far: proposals.filter((p) => p.confidence === CONFIDENCE_FAR).length,
    notFound: proposals.filter((p) => p.confidence === CONFIDENCE_NONE).length,
    outOfOrder: proposals.filter((p) => !p.inOrder).length,
  };
  summary.needsReview = summary.notes - summary.exact;

  return { proposals, summary };
}

/**
 * מנסח את ההצעה כדוח קריא בעברית. מחזיר מחרוזת — לא נוגע בשום מסמך.
 */
export function describeProposalReport({ proposals, summary }) {
  const lines = [];
  lines.push(`נבדקו ${summary.notes} הערות.`);
  lines.push(`מתוכן ${summary.exact} נמצאו במקום ברור ואפשר לאשר אותן יחד.`);
  if (summary.ambiguous) lines.push(`${summary.ambiguous} מופיעות יותר מפעם אחת ודורשות הכרעה.`);
  if (summary.far) lines.push(`${summary.far} נמצאו רחוק מהצפוי.`);
  if (summary.notFound) lines.push(`${summary.notFound} לא נמצאו כלל.`);
  if (summary.outOfOrder) lines.push(`⚠ ${summary.outOfOrder} אינן לפי הסדר — לא הוזזו, רק סומנו.`);
  lines.push("");
  lines.push("שום דבר במסמך לא השתנה. זו הצעה בלבד.");
  return lines.join("\n");
}
