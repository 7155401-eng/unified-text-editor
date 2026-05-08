// word_extractor_streams.js — לוגיקת מיפוי זרמים (A/B/C/D…)
// כל סוג הערה הוא זרם נפרד (footnote/endnote/comment/sidenote/parallel/external/custom).
// ברירת-מחדל אוטומטית עוקבת אחרי word_extractor.py: A=fn, B=en, C=cm, D=sn, ואז שאר אותיות.

import {
  SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT,
  SOURCE_SIDENOTE, SOURCE_PARALLEL, SOURCE_EXTERNAL, SOURCE_CUSTOM,
  SERIES_LETTERS,
} from "./word_extractor_i18n.js";

// ברירת-מחדל לאות זרם לפי סוג הערה.
// אם יש כבר זרם של אותו סוג, האחרים מקבלים את האות הפנויה הבאה ב-SERIES_LETTERS.
const TYPE_DEFAULT_LETTER = {
  [SOURCE_FOOTNOTE]: 'A',
  [SOURCE_ENDNOTE]:  'B',
  [SOURCE_COMMENT]:  'C',
  [SOURCE_SIDENOTE]: 'D',
  [SOURCE_PARALLEL]: 'E',
  [SOURCE_EXTERNAL]: 'F',
  [SOURCE_CUSTOM]:   'G',
};

/**
 * מקבל רשימת sources (פלט find_all_note_sources) ומחזיר רשימת streams עם series פנויות.
 * שומר על דטרמיניזם — אם שני זרמים של אותו סוג, השני יקבל את האות הבאה אחרי ברירת המחדל.
 */
export function buildDefaultStreamMapping(sources) {
  const used = new Set();
  const out = [];

  // עזר: בחר אות פנויה התחל מ-startLetter
  function pickLetter(startLetter) {
    const startIdx = Math.max(0, SERIES_LETTERS.indexOf(startLetter));
    for (let i = startIdx; i < SERIES_LETTERS.length; i++) {
      if (!used.has(SERIES_LETTERS[i])) {
        used.add(SERIES_LETTERS[i]);
        return SERIES_LETTERS[i];
      }
    }
    // fallback — מחפש מההתחלה
    for (let i = 0; i < SERIES_LETTERS.length; i++) {
      if (!used.has(SERIES_LETTERS[i])) {
        used.add(SERIES_LETTERS[i]);
        return SERIES_LETTERS[i];
      }
    }
    return SERIES_LETTERS[SERIES_LETTERS.length - 1];
  }

  // סדר עיבוד דטרמיניסטי (כמו ב-Python: footnote, endnote, comment, ואז custom/external/sidenote)
  const order = [SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT,
                 SOURCE_SIDENOTE, SOURCE_PARALLEL, SOURCE_EXTERNAL, SOURCE_CUSTOM];
  const buckets = new Map();
  for (const src of sources) {
    const k = src.source_type || SOURCE_FOOTNOTE;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(src);
  }
  // נשמר סדר ההופעה בכל סוג כדי לתת A/A→A,B לאותו סוג ברצף
  for (const t of order) {
    const arr = buckets.get(t);
    if (!arr) continue;
    for (const src of arr) {
      const start = TYPE_DEFAULT_LETTER[t] || 'A';
      const letter = pickLetter(start);
      out.push({
        // נשמר כל המידע המקורי, ועליו מתווספים שדות החלטה
        ...src,
        source_type: src.source_type,
        marker: src.marker || null,
        has_at: !!src.has_at,
        count: src.count || 0,
        included: true,
        series: letter,
        position: 'right',         // לסידנוט
        sidenote_font_cmd: '',
        first_note_as_title: false,
        layout: 'normal',
        opw: null,
        fli: null,
        custom_pattern: src.custom_pattern || '',
        target_marker: src.target_marker || src.marker || null,
        base_source: src.base_source || src.source_type,
      });
    }
  }
  // אם נשארו סוגים שלא ב-order (עתידיים), נוסיף בסוף:
  for (const [k, arr] of buckets.entries()) {
    if (order.includes(k)) continue;
    for (const src of arr) {
      const letter = pickLetter('A');
      out.push({ ...src, included: true, series: letter });
    }
  }
  return out;
}

/**
 * הפיכת רשימת streams (מ-buildDefaultStreamMapping) ל-sd dict כמו ב-extract_and_process.
 * key = id של ה-stream; value = הגדרת הזרם המלאה.
 */
export function streamsToSd(streams) {
  const sd = {};
  for (const s of streams) {
    if (!s.included) continue;
    const sid = s.id || `${s.source_type}_${s.marker || 'none'}`;
    sd[sid] = {
      source_type: s.source_type,
      marker: s.marker || null,
      series: s.series,
      count: 0,
      position: s.position || 'right',
      sidenote_font_cmd: s.sidenote_font_cmd || '',
      first_note_as_title: !!s.first_note_as_title,
      layout: s.layout || 'normal',
      opw: s.opw || null,
      fli: s.fli || null,
      custom_pattern: s.custom_pattern || '',
      target_marker: s.target_marker || null,
      base_source: s.base_source || s.source_type,
    };
  }
  return sd;
}

/** בודק ייחודיות אותיות בזרמים שנבחרו לכלול. מחזיר רשימת אותיות כפולות. */
export function findDuplicateSeries(streams) {
  const seen = new Map();
  const dups = new Set();
  for (const s of streams) {
    if (!s.included) continue;
    if (!s.series) continue;
    if (seen.has(s.series)) dups.add(s.series);
    seen.set(s.series, true);
  }
  return Array.from(dups);
}
