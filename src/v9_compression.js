// v9_compression.js — דחיסת אותיות + רווחים במידה זעירה.
//
// משה 2026-05-15: רמה 4 בסולם העלויות לחיתוכים. כשפסקה חורגת מהעמוד
// ב-1-2 שורות, במקום לפצל אותה (יקר), מנסים לדחוס מעט את האותיות
// והרווחים שלה. אם הדחיסה מספיקה כדי שהפסקה תיכנס בעמוד הנוכחי —
// הצלחה (חיסכון בפיצול). אם לא — חוזרים לרמת עלות גבוהה יותר.
//
// כללים:
//   - דחיסה מתבצעת בעדינות: עד 3% הקטנה (אותיות) ועד 3% הקטנה (רווחים),
//     בנפרד, צעד אחר צעד
//   - תמיד מנסים את האפשרות הזולה ביותר קודם (1% אותיות בלבד), עולים
//     הדרגתית
//   - אם מגיעים למקסימום ועדיין לא נכנס — ויתור
//   - לא מערכת קבועים: בודקים בפועל ב-DOM אם הפסקה עכשיו נכנסת
//
// API:
//   tryCompressToFit(paragraphEl, maxOverflowPx)
//     → { success: boolean, letterSpacing, wordSpacing, finalOverflow }
//
//   resetCompression(paragraphEl) — מסיר את הדחיסה (חזרה למצב טבעי)

// משה 2026-05-15: עלייה הדרגתית. עד 3% — מעבר לזה הטקסט נראה דחוס לעין.
const LETTER_STEPS = [-0.005, -0.010, -0.015, -0.020, -0.025, -0.030];
const WORD_STEPS = [-0.5, -1.0, -1.5, -2.0]; // px

/**
 * מודד עד כמה הפסקה גולשת מהעמוד / מהמיקום המוקצב.
 * @param {HTMLElement} el האלמנט עם תוכן הפסקה
 * @returns {number} פיקסלים של חריגה (חיובי = גולש; שלילי = יש מקום פנוי)
 */
function measureOverflow(el) {
  if (!el) return 0;
  return el.scrollHeight - el.clientHeight;
}

/**
 * מחיל דחיסת אותיות (letter-spacing שלילי, באמ).
 * @param {HTMLElement} el
 * @param {number} emValue — ערך כמו -0.01 (= 1% מהפונט פחות)
 */
function applyLetterSpacing(el, emValue) {
  if (!el) return;
  if (emValue === 0 || emValue == null) {
    el.style.letterSpacing = "";
  } else {
    el.style.letterSpacing = emValue + "em";
  }
}

/**
 * מחיל דחיסת רווחים בין מילים (word-spacing שלילי בפיקסלים).
 * @param {HTMLElement} el
 * @param {number} pxValue — ערך כמו -1 (= מוריד פיקסל מהרווח)
 */
function applyWordSpacing(el, pxValue) {
  if (!el) return;
  if (pxValue === 0 || pxValue == null) {
    el.style.wordSpacing = "";
  } else {
    el.style.wordSpacing = pxValue + "px";
  }
}

/**
 * מנסה לדחוס את הפסקה כך שתיכנס במקום המוקצב.
 * מנסה את ה-letter-spacing מהקל לכבד, ואז word-spacing.
 * @param {HTMLElement} paragraphEl פסקה (יכולה להיות מכל אלמנט עם תוכן)
 * @param {number} maxOverflowPx (אופציונלי) חריגה מקסימלית שמנסים לפתור.
 *   אם החריגה הראשונית גדולה מהמספר הזה, מוותרים מיד.
 * @returns {{success: boolean, letterSpacing: number, wordSpacing: number, finalOverflow: number}}
 */
export function tryCompressToFit(paragraphEl, maxOverflowPx = 50) {
  if (!paragraphEl) {
    return { success: false, letterSpacing: 0, wordSpacing: 0, finalOverflow: 0 };
  }
  // מצב התחלתי — לוודא שאין דחיסה קודמת תקועה
  resetCompression(paragraphEl);

  const initialOverflow = measureOverflow(paragraphEl);
  if (initialOverflow <= 0) {
    // אין חריגה מלכתחילה
    return { success: true, letterSpacing: 0, wordSpacing: 0, finalOverflow: initialOverflow };
  }
  if (initialOverflow > maxOverflowPx) {
    // חריגה גדולה מדי — דחיסה לא תספיק. ויתור.
    return { success: false, letterSpacing: 0, wordSpacing: 0, finalOverflow: initialOverflow };
  }

  // שלב 1: מנסים letter-spacing הדרגתי
  for (const step of LETTER_STEPS) {
    applyLetterSpacing(paragraphEl, step);
    const ov = measureOverflow(paragraphEl);
    if (ov <= 0) {
      return { success: true, letterSpacing: step, wordSpacing: 0, finalOverflow: ov };
    }
  }
  // letter-spacing במקסימום — שלב 2: מוסיפים גם word-spacing
  const maxLetter = LETTER_STEPS[LETTER_STEPS.length - 1];
  for (const wordStep of WORD_STEPS) {
    applyWordSpacing(paragraphEl, wordStep);
    const ov = measureOverflow(paragraphEl);
    if (ov <= 0) {
      return { success: true, letterSpacing: maxLetter, wordSpacing: wordStep, finalOverflow: ov };
    }
  }

  // עדיין לא נכנס — מסירים את הדחיסה ומוותרים
  resetCompression(paragraphEl);
  return {
    success: false,
    letterSpacing: 0,
    wordSpacing: 0,
    finalOverflow: measureOverflow(paragraphEl),
  };
}

/**
 * מסיר את כל הדחיסה שהוחלה על האלמנט.
 * @param {HTMLElement} el
 */
export function resetCompression(el) {
  if (!el) return;
  applyLetterSpacing(el, 0);
  applyWordSpacing(el, 0);
}

/**
 * בודק אם דחיסה הוחלה על אלמנט.
 * @param {HTMLElement} el
 * @returns {boolean}
 */
export function hasCompression(el) {
  if (!el) return false;
  return Boolean(el.style.letterSpacing || el.style.wordSpacing);
}
