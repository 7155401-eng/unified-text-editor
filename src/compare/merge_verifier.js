// בדיקת שלמות אחרי מיזוג הערות למקור (העברה מהתוכנה הקודמת, פריט ה-5).
//
// בתפריט הישן היה כרטיס „השוואת טקסטים עם בוט — השוואת טקסטים לאחר שילוב בין
// הערות למקור בעזרת בוט". `"external": True` — כלומר **בלי שורת קוד**.
//
// ⭐ ההחלטה החשובה כאן: **הבדיקה הזאת אינה צריכה בוט.** השאלה „האם טקסט אבד
// במיזוג" היא שאלה מכנית, ותשובה מכנית היא ודאית. בוט נותן דעה; כאן צריך
// הוכחה. ולכן אין כאן רשת, אין מפתח, ואין עלות — רק השוואה.
//
// זה בדיוק כשל-העבר שמשה תיאר: „היו בעבר בוטים שפשוט מצאו באמצע הערה מילה
// אחת שלא מצאו אותה במילים הסמוכות ודילגו הרבה מאוד... ומשם עד הסוף זה איבד
// את זה שלו." הכלי הזה תופס בדיוק את זה — ובמספרים.
//
// ⛔ הכלי **אינו מתקן דבר**. הוא מדווח.

/** ניקוד וטעמים — מוסרים להשוואה בלבד, לא מהמסמך. */
const NIQQUD = /[֑-ׇ]/gu;
/** סימני זרם והערות שנוספו במיזוג ואינם „טקסט שאבד". */
const MARKERS = /@\d{1,3}(?:\s*\[\d+\])?|\[\d+\]/gu;

/**
 * הופך טקסט לרשימת מילים להשוואה.
 * מסירים ניקוד, סימני זרם ופיסוק — כי שינוי בהם אינו „אובדן טקסט".
 */
export function tokenize(text, { keepMarkers = false } = {}) {
  let s = String(text ?? "");
  if (!keepMarkers) s = s.replace(MARKERS, " ");
  s = s.replace(NIQQUD, "");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  return s.split(" ").filter(Boolean);
}

/**
 * עוגנים: מילים שמופיעות **בדיוק פעם אחת** בכל אחד משני הטקסטים.
 * מילה כזאת אינה יכולה להתבלבל, ולכן היא נקודת-ייחוס בטוחה.
 */
function uniqueAnchors(a, b) {
  const countA = new Map();
  const countB = new Map();
  for (const w of a) countA.set(w, (countA.get(w) || 0) + 1);
  for (const w of b) countB.set(w, (countB.get(w) || 0) + 1);

  const posB = new Map();
  b.forEach((w, i) => { if (countB.get(w) === 1) posB.set(w, i); });

  const pairs = [];
  a.forEach((w, i) => {
    if (countA.get(w) !== 1) return;
    const j = posB.get(w);
    if (j !== undefined) pairs.push([i, j]);
  });
  return pairs;
}

/** תת-סדרה עולה ארוכה ביותר — כדי לשמור רק עוגנים שאינם סותרים את הסדר. */
function longestIncreasing(pairs) {
  if (!pairs.length) return [];
  const tails = [];
  const tailIdx = [];
  const prev = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i += 1) {
    const v = pairs[i][1];
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tailIdx[lo - 1];
    tails[lo] = v;
    tailIdx[lo] = i;
    if (lo === tails.length - 1) { /* הורחב */ }
  }
  const out = [];
  let k = tailIdx[tails.length - 1];
  while (k !== -1) { out.push(pairs[k]); k = prev[k]; }
  return out.reverse();
}

/**
 * משווה את התוצאה למקור ומדווח מה אבד, מה נוסף, ואיפה הסדר נשבר.
 *
 * @param {string} source הטקסט לפני המיזוג
 * @param {string} merged הטקסט אחרי המיזוג
 * @returns {{ok:boolean, summary:Object, lost:Array, added:Array}}
 */
export function compareMergedToSource(source, merged, { contextWords = 6 } = {}) {
  const a = tokenize(source);
  const b = tokenize(merged);

  const anchors = longestIncreasing(uniqueAnchors(a, b));

  const lost = [];
  const added = [];
  let ai = 0, bi = 0;

  const flush = (aEnd, bEnd) => {
    if (aEnd > ai) {
      lost.push({
        words: a.slice(ai, aEnd),
        atSourceWord: ai,
        context: a.slice(Math.max(0, ai - contextWords), ai).join(" "),
      });
    }
    if (bEnd > bi) {
      added.push({
        words: b.slice(bi, bEnd),
        atMergedWord: bi,
        context: b.slice(Math.max(0, bi - contextWords), bi).join(" "),
      });
    }
  };

  for (const [i, j] of anchors) {
    flush(i, j);
    ai = i + 1;
    bi = j + 1;
  }
  flush(a.length, b.length);

  const lostWords = lost.reduce((n, r) => n + r.words.length, 0);
  const addedWords = added.reduce((n, r) => n + r.words.length, 0);

  // ⭐ „הבריחה" שמשה תיאר: קטע אבוד ארוך ורצוף, ולא מילה פה ושם.
  const biggestLost = lost.reduce((m, r) => Math.max(m, r.words.length), 0);
  const runaway = biggestLost >= 20;

  const summary = {
    sourceWords: a.length,
    mergedWords: b.length,
    anchors: anchors.length,
    lostRuns: lost.length,
    lostWords,
    addedRuns: added.length,
    addedWords,
    biggestLostRun: biggestLost,
    runaway,
    keptPercent: a.length ? Math.round(((a.length - lostWords) / a.length) * 1000) / 10 : 100,
  };

  return { ok: lostWords === 0, summary, lost, added };
}

/** דוח בעברית. מחזיר מחרוזת — אינו נוגע בשום מסמך. */
export function describeMergeReport({ ok, summary, lost }) {
  const lines = [];
  lines.push(`במקור ${summary.sourceWords} מילים, בתוצאה ${summary.mergedWords}.`);
  if (ok) {
    lines.push("✅ כל מילה שהייתה במקור נמצאת גם בתוצאה. שום דבר לא אבד.");
  } else {
    lines.push(`⛔ חסרות ${summary.lostWords} מילים, ב-${summary.lostRuns} מקומות.`);
    lines.push(`נשמרו ${summary.keptPercent}% מהמקור.`);
    if (summary.runaway) {
      lines.push(`⛔⛔ הקטע הרצוף הארוך ביותר שאבד הוא ${summary.biggestLostRun} מילים — ` +
        "זה סימן מובהק שהמיזוג ברח ממקומו ומשם ואילך הכול זז.");
    }
  }
  if (summary.addedWords) {
    lines.push(`נוספו ${summary.addedWords} מילים שלא היו במקור (לרוב זה תוכן ההערות עצמן).`);
  }
  for (const run of lost.slice(0, 5)) {
    lines.push(`  · אחרי „${run.context}" חסר: „${run.words.slice(0, 12).join(" ")}"`);
  }
  if (lost.length > 5) lines.push(`  · ועוד ${lost.length - 5} מקומות.`);
  lines.push("");
  lines.push("שום דבר לא תוקן. זהו דוח בלבד.");
  return lines.join("\n");
}
