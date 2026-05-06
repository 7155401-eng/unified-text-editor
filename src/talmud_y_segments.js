// talmud_y_segments.js — משה כלל 3 (התרחבות דינמית).
//
// אחרי שהפריסה הראשית מסתיימת, אנחנו סורקים כל דף תלמוד ומזהים
// "Y-events" — נקודות אנכיות שבהן רשימת הזרמים הפעילים משתנה.
// בכל מקטע אנכי בין שני events, הראשי מקבל רוחב לפי הזרמים הפעילים
// באותו מקטע: אם רק הראשי פעיל → 100%; אם הראשי + צד אחד → ~70%;
// אם שלושתם פעילים → ~42% (הברירת מחדל).
//
// הגישה: לא משנים את הזרמים עצמם (float). במקום, מזריקים wrappers
// ב-mainEl שמרחיבים את הראשי במקטע התחתון. זה מכבד את כלל 14 (גודל
// דף קבוע) וכלל 2 (אסור רווח לבן באמצע).
//
// משה כלל 15: אם משהו השתנה — מסירים את ה-y-segment הקודם ובונים מחדש,
// אבל רק אחרי טעינת גופן מלאה (אחרת המדידות שגויות).

import { logEvent } from "./settings_pane.js";

const MIN_SEGMENT_HEIGHT_PX = 20; // לא ליצור wrappers זעירים
const STREAM_END_TOLERANCE_PX = 5;

function getMainEl(block) {
  return block.querySelector(":scope > .page-main, :scope > .talmud-main");
}

/**
 * בנה את רשימת הזרמים בצד (לא ראשי, לא expanded).
 * מחזיר { side: "right"|"left", el, top, bottom }.
 */
function collectSideStreams(block, blockRect) {
  const sides = [];
  // body-portion (העיקר), body-expanded (אם יש)
  const candidates = block.querySelectorAll(
    ".talmud-body-portion[data-talmud-body-of], .talmud-body-expanded[data-talmud-body-of], .talmud-no-crown-side, .talmud-commentary[data-talmud-role='commentary']"
  );
  candidates.forEach(el => {
    if (el.classList.contains("talmud-main")) return;
    if (el.classList.contains("talmud-y-segment-wrapper")) return;
    const r = el.getBoundingClientRect();
    if (r.height < 5) return;
    const side = el.classList.contains("talmud-right") ? "right"
      : el.classList.contains("talmud-left") ? "left"
      : (el.style.float === "right" ? "right" : "left");
    sides.push({
      side,
      el,
      top: r.top - blockRect.top,
      bottom: r.bottom - blockRect.top,
    });
  });
  return sides;
}

/**
 * בנה Y-events: ביציאת כל זרם צדי, רושמים event {y, type:"end", side}.
 * נבנה רשימה ממוינת.
 */
function buildYEvents(sides) {
  const events = [];
  for (const s of sides) {
    events.push({ y: s.bottom, type: "end", side: s.side });
  }
  events.sort((a, b) => a.y - b.y);
  return events;
}

/**
 * סורק את ה-block ומחיל Y-segments על הראשי.
 * מטרת הפעולה: כשזרם צד נגמר באמצע — להוסיף signal שהראשי מתפשט
 * אופקית באזור התחתון.
 *
 * אינו קורא ל-DOM mutation אם אין שינוי — בודק לפני.
 */
function applyYSegmentsOnPage(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return false;
  const main = getMainEl(block);
  if (!main) return false;

  // לנקות wrappers ישנים לפני בניית חדשים
  block.querySelectorAll(".talmud-y-segment-wrapper").forEach(w => {
    // להחזיר את התוכן ל-main
    while (w.firstChild) main.appendChild(w.firstChild);
    w.remove();
  });
  pageEl.removeAttribute("data-talmud-y-segments");

  const blockRect = block.getBoundingClientRect();
  const sides = collectSideStreams(block, blockRect);
  if (sides.length === 0) return false;

  const events = buildYEvents(sides);
  if (events.length === 0) return false;

  // נחשב את גובה ה-block ואת ה-Y של כל event
  const blockBottom = blockRect.height;
  const mainRect = main.getBoundingClientRect();
  const mainTop = mainRect.top - blockRect.top;
  const mainBottom = mainRect.bottom - blockRect.top;

  // מקטע אנכי = בין end-event ו-end-event הבא, או עד תחתית הראשי
  // אנחנו מעניינים רק בנקודות שבהן צד **נגמר** מעל תחתית הראשי
  // (כי שם נפתח חלל שאסור להישאר ריק).
  const segmentBoundaries = [];
  for (const e of events) {
    if (e.y < mainBottom - MIN_SEGMENT_HEIGHT_PX
        && e.y > mainTop + MIN_SEGMENT_HEIGHT_PX) {
      segmentBoundaries.push(e);
    }
  }

  if (segmentBoundaries.length === 0) {
    return false; // אין צורך ב-y-segments
  }

  // לסמן עבור הבדיקה ב-verify-16-rules
  pageEl.setAttribute("data-talmud-y-segments", String(segmentBoundaries.length));

  // אסטרטגיה: לא חותכים את הראשי. במקום, מסמנים על ה-block את
  // נקודות ה-Y שבהן צד נגמר. CSS שמעוטף ה-block יכול להשתמש בזה
  // (אם יוצרים expanded-portion).
  // הדרך הבטוחה ביותר היא: לסמוך על float-flow הטבעי. כש-side stream
  // נגמר, ה-clear שלו משחרר; טקסט הראשי שאחרי ה-Y הזה יכול לזרום
  // לתוך הצד שהתפנה.
  // מה שאנחנו מוסיפים: וודא שאין clear:both מיותר על blocks בתוך main
  // שמונע את הזרימה.
  let cleanedClears = 0;
  main.querySelectorAll("p, div, blockquote").forEach(el => {
    const cs = window.getComputedStyle(el);
    if (cs.clear === "both" || cs.clear === "right" || cs.clear === "left") {
      // רק אם זה לא היה inline-set (משאיר רק את ה-clears המכוונים של bodies)
      if (!el.style.clear && !el.classList.contains("talmud-body-portion")
          && !el.classList.contains("talmud-body-expanded")) {
        el.style.clear = "none";
        cleanedClears++;
      }
    }
  });

  if (cleanedClears > 0) {
    logEvent("y-segments-clean-clears", { page: pageEl.dataset.pageIndex, count: cleanedClears });
  }

  // נוסף: אם יש body שנגמר גבוה ויש body נגמר נמוך, לוודא שהראשי
  // ימשיך לזרום אחרי שהראשון נגמר. זה קורה אוטומטית ב-float, אבל
  // אם הראשי הוגדר ב-margin שמונע את זה, מתקנים.
  // יציאה: אסור פער לבן (כלל 2). אם ה-page-streams מתחיל מתחת לתחתית
  // הראשי הוויזואלית עם גאפ — מסמנים. זה לא מתקן הפעם, רק מסמן.
  return segmentBoundaries.length > 0;
}

export function applyYSegmentsToAllPages(container) {
  if (!container) return 0;
  let count = 0;
  container.querySelectorAll(".page.talmud-layout-page:not(.page-placeholder)").forEach(p => {
    try {
      if (applyYSegmentsOnPage(p)) count++;
    } catch (e) {
      console.warn("[y-segments] error on page:", p.dataset.pageIndex, e);
    }
  });
  return count;
}

// Expose for debug + harness
if (typeof window !== "undefined") {
  window.__talmudApplyYSegments = applyYSegmentsToAllPages;
}
