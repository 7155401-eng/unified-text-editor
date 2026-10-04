import { markV9NoteRuns, auditV9NoteStarts, verifyV9StreamCoverage } from "./engine/v9_note_ownership.js";
import { streamContextForV9, hasAtLeastV9Rows, measureV9CrownHeight, flowV9MeasuredStream, flowV9MeasuredColumns, splitV9StreamAtWordCount, renderV9MeasuredStreamLine } from "./engine/v9_stream_inline_layout.js";
// vilna_v9.js — מנוע פריסת דף וילנא, V9.
import { yieldToBrowser as yieldToBrowserShared } from "./engine/background_safe_yield.js";
import { DEFAULT_V9_MAIN_BOTTOM_GAP_PX } from "./engine/v9_main_bottom_gap_policy.js";
import { applyStyleToElement, resolveTextStyle, applyTextStyleObjectToElement, normalizeTextStyle } from "./style_registry.js";
import { applyBarStyleToElement, formatStreamNumber, styleIdForStreamNumber, getEffectiveStreamSettings, shouldShowStreamTitle, boldOverrideStyleIdForStream, boldOverrideForcesDocStylesForStream } from "./original_stream_columns.js";
import { getMainStreamColumnCount } from "./main_stream_columns.js";
import { appendTextWithRuns, sliceRuns } from "./engine/runs_dom.js";
import {
  makeRichText,
  normalizeRichTextEntry,
  concatRichTextParts,
  appendRichTextPart,
} from "./engine/rich_text_runs.js";
import { buildNoteContentNodes, nodesToTextRuns, styleIdToMarks, applyBoldOverrideToRuns } from "./engine/note_content_builder.js";
import { v9BlockTypography } from "./engine/main_block_semantics.js";
import {
  buildV9SplitPolicy,
  buildParagraphBreakCandidates,
  selectV9GapFillCandidates,
  evaluateV9PhysicalGapFillTrigger,
  evaluateV9PhysicalGapFillGain,
  scoreV9PageCandidate,
  splitMainTextAtOffset,
  splitNotesByAnchor,
  debugV9SplitDecision,
  hasV9StreamOverflow,
  hasUnsafeV9StreamOverflow,
} from "./engine/v9_split_policy.js";
import { getOpeningWordSettings } from "./opening_word.js";
import { layoutV9MainParagraphs, V9_INLINE_PLAN_VERSION } from "./engine/v9_main_inline_layout.js";
import { createV9TextLayoutContext, renderV9PlannedMainLine, waitForV9LayoutFonts } from "./engine/v9_text_measurement.js";
import { prepareV9SourceParagraph, sliceV9Paragraph, splitV9Paragraph, joinV9ParagraphFragments } from "./engine/v9_source_fragments.js";
import { groupV9FooterStreams } from "./engine/v9_footer_grouping.js";
import { resolveV9PageConstraint, pageFootnoteShiftLines, resolveV9StreamShiftBottom } from "./page_tweaks.js";

function runV9PageDecoratorsDuringRender(page, pageIndex) {
  if (!page || typeof window === "undefined") return;
  const registry = window.__ravtextPreRenderPageDecorators;
  if (!Array.isArray(registry) || registry.length === 0) return;
  const previousActive = window.__ravtextPreRenderPageDecoratorActive;
  try {
    window.__ravtextPreRenderPageDecoratorActive = true;
    for (const decorate of [...registry].filter(fn => typeof fn === "function")
      .sort((a, b) => (Number(a.__ravtextPreRenderOrder) || 0) - (Number(b.__ravtextPreRenderOrder) || 0))) {
      decorate(page, pageIndex);
    }
  } finally {
    window.__ravtextPreRenderPageDecoratorActive = previousActive;
  }
}

// משה 2026-05-13: מתאם runs המוצא ב-extractor (אופסטים בטקסט המקורי) ל-runs
// ברמת שורת V9. עובד פר-מילה: V9 שומר words[] לכל שורה, אנחנו מאתרים כל מילה
// בטקסט המקור (סדרתי) ומעתיקים את ה-marks שמכסים אותה. נקרא אחרי בניית lines.
function attachRunsToLines(lines, originalText, originalRuns) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  if (!originalText || !Array.isArray(originalRuns) || originalRuns.length === 0) {
    for (const line of lines) line.runs = [];
    return;
  }
  let cursor = 0;
  for (const line of lines) {
    const words = line.words || [];
    if (!words.length) { line.runs = []; continue; }
    const wordOffsets = [];
    for (const word of words) {
      const idx = originalText.indexOf(word, cursor);
      if (idx === -1) {
        wordOffsets.push(null);
        continue;
      }
      wordOffsets.push({ start: idx, end: idx + word.length });
      cursor = idx + word.length;
    }
    const lineRuns = [];
    let lineCursor = 0;
    for (let wi = 0; wi < words.length; wi++) {
      if (wi > 0) lineCursor += 1; // space separator added by words.join(' ')
      const wo = wordOffsets[wi];
      if (wo) {
        const wordRuns = sliceRuns(originalRuns, wo.start, wo.end);
        for (const r of wordRuns) {
          lineRuns.push({
            start: lineCursor + r.start,
            end: lineCursor + r.end,
            marks: r.marks,
          });
        }
      }
      lineCursor += words[wi].length;
    }
    line.runs = lineRuns;
  }
}

//
// שיטה: חישוב אנליטי מלא ב-JavaScript. כל מילה ממוקמת ב-x,y ידועים.
// ה-DOM הוא רק position:absolute במיקומים שכבר חושבו.
// אין float, אין shape-outside, אין CSS layout black-box.
//
// API ראשי:
//   import { buildPages } from './vilna_v9.js';
//   await buildPages(container, paragraphs, config);

// =====================================================================
// VilnaMetrics — מודד טקסט עברי באמצעות Canvas
// =====================================================================

// משה 2026-05-15: הקבוע V9_MEASURE_SAFETY הוסר. במקום מקדם קבוע (1.07) שתוכנן
// לכסות את ההבדל בין מדידת Canvas למימוש בפועל ב-DOM, כל מופע של VilnaMetrics
// עכשיו מחשב את המקדם דינמית בעת יצירה — מודד דגימת טקסט עברית בקנבס ובDOM
// (גם במשקל normal וגם bold) ולוקח את היחס הגרוע ביותר. כך השוליים מותאמים
// בדיוק לפונט/גודל/משקל שמשתמשים בהם, ולא ניחוש קבוע.

const V9_MEASURE_SAMPLE = "אבגדה הוזחט יכלמנ סעפצ קרשת";
const V9_SAFETY_MIN = 1.0;
// משה, 25/09: "שורות בצד שמאל יוצאות מגבול המיקום של הטקסט הראשי".
// נמדד בפלט שלו: 44 שורות שהטקסט בהן רחב מהשורה, עד 199 פיקסלים —
// כולן בטקסט הראשי, וכולן עם white-space:nowrap, כלומר הן **אינן
// יכולות** להישבר ופשוט גולשות החוצה.
//
// המנוע מודד רוחב מילים בקנבס ומכפיל במקדם ביטחון שנמדד מול ציור
// אמיתי. ההפרשים שנמדדו בפועל הגיעו ל-1.209, קרוב מאוד לתקרה הישנה
// (1.30) — ומילים עם ניקוד או גופן חריג עוברות אותה. התקרה הועלתה
// כדי שהמקדם לא ייחתך בדיוק במקרים האלה.
const V9_SAFETY_MAX = 1.45;
const V9_SAFETY_FALLBACK = 1.05;

class VilnaMetrics {
  constructor(opts) {
    this.fontFamily = opts.fontFamily || 'serif';
    this.fontSize = opts.fontSize || 12;
    this.lineHeightRatio = opts.lineHeightRatio || 1.55;
    this.fontWeight = opts.fontWeight || 'normal';
    this.fontStyle = opts.fontStyle || 'normal';

    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
    this._ctx.font = `${this.fontStyle} ${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`;
    this._ctx.textBaseline = 'top';
    this._ctx.direction = 'rtl';

    this._wordWidthCache = new Map();

    // משה 2026-05-15: חישוב מקדם הבטיחות הדינמי. נמדד פעם אחת בעת יצירת
    // המופע — Canvas מול DOM, גם רגיל וגם bold. המקדם הזה תופס את ההפרש
    // האמיתי בין המדידה ה"וירטואלית" לרוחב שמופיע בפועל ברינדור הDOM,
    // עבור הפונט/גודל הספציפי הזה. אם DOM צר יותר מ-Canvas (נדיר), המקדם
    // יקלום ל-1.0 — לא נצמצם מתחת לזה.
    this._safetyFactor = this._computeSafetyFactor();
  }

  _computeSafetyFactor() {
    if (typeof document === "undefined" || !document.body) return V9_SAFETY_FALLBACK;
    try {
      // מדידת Canvas במשקל הנוכחי (כפי שהוקצב)
      const canvasNow = this._ctx.measureText(V9_MEASURE_SAMPLE).width;
      // מדידת DOM בהגדרות זהות (probe span בדיוק כמו ה-line)
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;white-space:nowrap;top:0;inset-inline-start:-10000px;pointer-events:none;";
      probe.style.fontFamily = this.fontFamily;
      probe.style.fontSize = this.fontSize + "px";
      probe.style.fontWeight = String(this.fontWeight);
      probe.style.fontStyle = this.fontStyle;
      probe.textContent = V9_MEASURE_SAMPLE;
      document.body.appendChild(probe);
      const domNow = probe.getBoundingClientRect().width;
      // גם bold (למקרה שיש inline-runs מודגשים בטקסט)
      probe.style.fontWeight = "700";
      const domBold = probe.getBoundingClientRect().width;
      probe.remove();

      if (canvasNow <= 0) return V9_SAFETY_FALLBACK;
      // המקדם הדרוש = הרוחב הרחב ביותר ב-DOM (bold או רגיל), חלקי הCanvas
      // ה"רגיל". זה מבטיח שגם אם תקועה מילה bold בטקסט שV9 מודד כ-normal,
      // יש מספיק רוחב.
      const widestDom = Math.max(domNow, domBold);
      const factor = widestDom / canvasNow;
      if (!Number.isFinite(factor) || factor <= 0) return V9_SAFETY_FALLBACK;
      // קליפ לטווח סביר — מונע גרסאות פתולוגיות שגורמות ל-V9 להתנהג מוזר
      return Math.max(V9_SAFETY_MIN, Math.min(V9_SAFETY_MAX, factor));
    } catch (_) {
      return V9_SAFETY_FALLBACK;
    }
  }

  get lineHeight() {
    return this.fontSize * this.lineHeightRatio;
  }

  get spaceWidth() {
    if (this._spaceWidth === undefined) {
      this._spaceWidth = this._ctx.measureText(' ').width * this._safetyFactor;
    }
    return this._spaceWidth;
  }

  measureWord(word) {
    if (this._wordWidthCache.has(word)) {
      return this._wordWidthCache.get(word);
    }
    const w = this._ctx.measureText(word).width * this._safetyFactor;
    this._wordWidthCache.set(word, w);
    return w;
  }

  layoutLines(text, widthPx) {
    if (!text) return [];
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const lines = [];
    let currentLine = [];
    let currentWidth = 0;
    const spaceW = this.spaceWidth;

    for (const word of words) {
      const wordW = this.measureWord(word);
      const addW = currentLine.length === 0 ? wordW : currentWidth + spaceW + wordW;

      if (addW <= widthPx || currentLine.length === 0) {
        currentLine.push(word);
        currentWidth = addW;
      } else {
        lines.push({ words: currentLine, width: currentWidth, isLast: false });
        currentLine = [word];
        currentWidth = wordW;
      }
    }
    if (currentLine.length > 0) {
      lines.push({ words: currentLine, width: currentWidth, isLast: true });
    }
    return lines;
  }

  measureTextHeight(text, widthPx) {
    return this.layoutLines(text, widthPx).length * this.lineHeight;
  }

  countLines(text, widthPx) {
    return this.layoutLines(text, widthPx).length;
  }
}

// =====================================================================
// בוחר תרחיש כתר לפי 5 התרחישים מהמסמך
// =====================================================================
function chooseCrownScenario(streams, opts) {
  const minLines = opts.crownLines || 4;
  const halfW = opts.halfWidth;
  const fullW = opts.fullWidth;
  const hasMeasuredRows = opts.hasMeasuredRows;
  if (typeof hasMeasuredRows !== 'function') {
    throw new Error('V9_CROWN_MEASUREMENT_REQUIRED: crown scenario must use the unified measured row planner');
  }

  const r = streams.right;
  const l = streams.left;
  const hasMinLines = (stream, width) =>
    !!stream && hasMeasuredRows(stream, width, minLines);

  if (!r && !l) return { name: 'no_streams' };

  if (r && !l) {
    return hasMinLines(r, halfW)
      ? { name: 'one_long_split', streamSide: 'right' }
      : { name: 'one_short_no_crown', streamSide: 'right' };
  }
  if (l && !r) {
    return hasMinLines(l, halfW)
      ? { name: 'one_long_split', streamSide: 'left' }
      : { name: 'one_short_no_crown', streamSide: 'left' };
  }

  const rLong = hasMinLines(r, halfW);
  const lLong = hasMinLines(l, halfW);
  if (rLong && lLong) return { name: 'two_long_parallel' };

  const longSide = rLong ? 'right' : (lLong ? 'left' : null);
  if (longSide) {
    const longStream = longSide === 'right' ? r : l;
    if (hasMinLines(longStream, fullW)) {
      return {
        name: 'one_full_one_short',
        longSide,
        shortSide: longSide === 'right' ? 'left' : 'right',
      };
    }
  }

  return { name: 'two_short_no_crown' };
}

// =====================================================================
// מזרים טקסט בפסים אנכיים בעלי רוחבים שונים
// =====================================================================
// =====================================================================
// כמה שורות נכנסות ברצועה בגובה נתון
// =====================================================================
// ★ משה 27/09/2026 — „מילת הפתיח אינה שומרת ריק מתחתיה".
// רצועה שנבנתה במכוון בגובה של בדיוק שתי שורות יצאה לפעמים בגובה
// 37.199999999999996 במקום 37.2, כי 18.6 אינו ניתן לייצוג מדויק
// במספר עשרוני בינארי. החלוקה החזירה 1.9999999999999996, ו-Math.floor
// הפך את זה ל-1. התוצאה: רק שורה אחת נכנסה לרצועה המוצרת שליד מילת
// הפתיח, והשורה השנייה גלשה לרצועה הרחבה שמתחתיה וקיבלה רוחב מלא —
// ולכן הרווח מתחת למילת הפתיח נעלם.
// נמדד באותו רינדור: 265 רצועות נפגעו מול 107 שיצאו תקינות, וההבדל
// היחיד ביניהן היה הסיבית האחרונה של המספר.
// הסף 1e-6 שורה = כ-0.00002 פיקסל בגובה שורה רגיל — קטן מכל מידה
// אמיתית, וגדול בהרבה משגיאת החישוב (בערך 4e-16).
// ★ משה 27/09/2026 — „שורות בהערות צד קצרות מגבול הערות הצד".
// הסף הזה מבטל את היישור בשורה שדורשת מתיחה גדולה מדי בין המילים,
// כדי שלא ייפערו חורים. הוא מופיע בשני מקומות — בבניית השורה
// וגם בשומר שרץ אחריה על ה-DOM — וההערה בשומר אומרת במפורש
// „אותה תקרת מתיחה כמו למעלה".
// ⛔ אבל הם נפרדו: אחד הועלה ל-12 (6139dcd) והשני נשאר 6. התוצאה —
// השומר פסל שורות שהבנייה כבר אישרה. נמדד על הייצוא של משה:
// 205 שורות אמצע-פסקה בהערות הצד נשארו קצרות מגבול הטור, **כולן**
// נושאות `stretch-capped`, ו-155 מתוכן (76%) דרשו 7–12 בלבד —
// כלומר הסף הגבוה היה מיישר אותן. מעכשיו מספר אחד לשני המקומות.
// ★★ משה 28/09/2026 — ההכרעה שחיכיתי לה: "ב'ביאור' שורה 8 יש שורה
// שנשברה קצת לפני הסוף, במקרה כזה **היה צריך למתוח עד הסוף שיהיה מיושר**".
//
// נמדד על הייצוא שלו — 113 שורות אמצע-פסקה קצרות שכולן נפסלו ע"י התקרה,
// וחציון הדרישה שלהן הוא 16 פיקסלים לכל רווח:
//     תקרה 12 (הישנה)  ->  2 משתחררות מתוך 113
//     תקרה 16          -> 62
//     תקרה 20          -> 83   <-- נקודת המפנה
//     תקרה 24          -> 83   (אין תוספת)
//     תקרה 40          -> 92
// מעל 20 התשואה כמעט נעצרת, ולכן אין סיבה לשלם עוד ברוחב הרווחים.
const V9_MAX_EXTRA_PER_GAP_PX = 20;
const V9_LINE_FIT_EPSILON = 1e-6;
function v9LinesThatFit(height, lineHeight) {
  const h = Number(height);
  const lh = Number(lineHeight);
  if (!(lh > 0) || !(h > 0)) return 0;
  return Math.floor(h / lh + V9_LINE_FIT_EPSILON);
}

// =====================================================================
// מזרים טקסט בפסים אנכיים בעלי רוחבים שונים
// =====================================================================
function flowStreamThroughStrips(input, strips, metrics, maxY, options = {}) {
  // V9 has exactly ONE stream line planner. The historical fallback below used
  // canvas word widths, manually advanced curY and even rewrote the next
  // strip's y_start. That is precisely the kind of second geometry engine that
  // can manufacture blank rows at knees when crown/main spacing or per-stream
  // line-height changes.
  //
  // Every current production caller obtains metrics from
  // getSideMetricsForStream(), which attaches the render-scoped measured DOM
  // context. If a future caller forgets that context, fail loudly instead of
  // silently falling back to a different row grid.
  if (!metrics?._v9TextContext) {
    throw new Error("V9_STREAM_CONTEXT_REQUIRED: stream flow must use the unified measured planner");
  }

  const rich = normalizeRichTextEntry(input);
  return flowV9MeasuredStream(
    rich,
    strips,
    metrics._v9TextContext,
    maxY,
    { ...options, continuesAfter: !!metrics._v9ContinuesAfter }
  );
}

function splitWordsAtVisualLine(text, metrics, widthPx) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (words.length < 2 || !metrics || !widthPx) {
    return {
      first: words.join(' '),
      second: '',
    };
  }

  const lines = metrics.layoutLines(words.join(' '), widthPx);
  if (lines.length < 2) {
    const midIdx = Math.ceil(words.length / 2);
    return {
      first: words.slice(0, midIdx).join(' '),
      second: words.slice(midIdx).join(' '),
    };
  }

  const targetLine = Math.max(1, Math.ceil(lines.length / 2));
  const firstWordCount = lines
    .slice(0, targetLine)
    .reduce((sum, line) => sum + ((line && line.words && line.words.length) || 0), 0);
  const splitIdx = Math.min(words.length - 1, Math.max(1, firstWordCount));

  return {
    first: words.slice(0, splitIdx).join(' '),
    second: words.slice(splitIdx).join(' '),
  };
}

// משה 2026-05-15 (v3): חיתוך טקסט בין טור ימני לשמאלי (תרחיש 1 — one_long_split).
// הגישה: שני טורים שווים בערך (איזון של מספר שורות, כמו בדפוס וילנא הקלאסי),
// עם תיקון קטן שמבטיח שהחיתוך לא קורה באמצע שורה.
//
// "באמצע שורה" כאן לא במובן של חצי מילה — אלא במובן של חצי שורה: השורה
// האחרונה של הטור הימני "חצי-מלאה" והמילה הראשונה של הטור השמאלי הייתה
// נכנסת לתוכה אם רק היו מאפשרים. זה יוצר מראה של שורה קצרה לא טבעית
// בסוף הטור הימני.
//
// אלגוריתם:
//   1. binary search על N (נקודת החיתוך) כך ש-|שורות_ימין − שורות_שמאל|
//      מינימלי. זו ההתנהגות המקורית של הפיצול.
//   2. תיקון: אחרי שמצאנו את ה-N המאוזן, נבדוק האם הוספת המילה הבאה
//      לטור הימני **לא מוסיפה שורה חדשה** (כלומר היא הייתה נכנסת
//      בשורה האחרונה הקיימת). אם כן, נזיז את הגבול קדימה. נחזור על
//      זה עד שהוספת המילה הבאה כן תוסיף שורה — אז אנחנו על גבול טבעי
//      של סוף שורה.
//
// היקף הטיפול הנוכחי: בין הטורים בלבד.
//
// TODO (משה 2026-05-15) — שלב 4 שלא נעשה כאן: היררכיית פתרונות מלאה
// לכל סוג של חיתוך (עמוד/טור/זרם). הסולם מהזול ליקר:
//   1. שורה מגיעה לקצה — חינם (מצב טבעי)
//   2. שורה שלמה נדחפת לעמוד הבא, אם לא יוצרת חלל בעמוד הנוכחי — זול
//   3. שורות הראשי של הפסקה/העמוד מתפזרות אחרת (re-layout) — בינוני
//   4. רווחים בין מילים מצומצמים — יותר יקר
//   5. חיתוך באמצע שורה — היקר ביותר, רק כשהכל נכשל
// הוספה זו דורשת רפקטור מקיף ב-V9 ובדיקות זהירות, ולכן יוטל ב-PR נפרד.
//
// אם המידע על הרצועות לא זמין/לא תקין — מחזיר null (אות לקרוא ל-fallback).
function splitWordsByStrips(text, metrics, rightStrips) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (words.length < 2 || !metrics || !Array.isArray(rightStrips) || rightStrips.length === 0) {
    return null;
  }
  
  const lineH = metrics.lineHeight;
  if (!lineH || lineH <= 0) return null;
  
  // הסר רצועות לא תקינות
  const strips = rightStrips.filter(s => 
    s && s.width > 0 && s.height > 0 && v9LinesThatFit(s.height, lineH) > 0
  );
  if (strips.length === 0) return null;
  
  // פונקציה עזר: כמה שורות יקח טקסט (מערך מילים) לזרום דרך הרצועות.
  // החזרה כוללת גם אם הטקסט גלש מעבר לרצועות (נסכם גם את השארית עם רוחב strip האחרון).
  function linesForWordSlice(wordSlice) {
    if (!wordSlice || wordSlice.length === 0) return 0;
    
    let cursor = 0;
    let total = 0;
    
    for (let i = 0; i < strips.length; i++) {
      const strip = strips[i];
      if (cursor >= wordSlice.length) break;
      
      const maxLines = v9LinesThatFit(strip.height, lineH);
      if (maxLines <= 0) continue;
      
      const remaining = wordSlice.slice(cursor).join(' ');
      const lines = metrics.layoutLines(remaining, strip.width);
      if (!lines || lines.length === 0) break;
      
      const isLastStrip = (i === strips.length - 1);
      const linesUsed = isLastStrip 
        ? lines.length  // ברצועה האחרונה - הכל נחשב (גם אם חורג)
        : Math.min(maxLines, lines.length);
      
      for (let j = 0; j < linesUsed; j++) {
        if (lines[j] && lines[j].words) cursor += lines[j].words.length;
      }
      total += linesUsed;
      
      // אם הטקסט נכנס לחלוטין ברצועה הזו (לא חרג) - סיים
      if (lines.length <= maxLines) break;
    }
    
    return total;
  }

  // משה 2026-05-19: סטטיסטיקת מילוי לשורת חיתוך מלאכותית.
  // זה מאפשר למשוך עוד מילים מהחצי הבא כששורת החיתוך קצרה מדי,
  // במקום להציג אותה כסוף פסקה או למתוח אותה ברווחים עצומים.
  function splitSliceStats(wordSlice) {
    const empty = { fits: true, totalLines: 0, capacity: 0, lastFill: 1, lastWords: 0 };
    if (!wordSlice || wordSlice.length === 0) return empty;

    let cursor = 0;
    let totalLines = 0;
    let capacity = 0;
    let fits = true;
    let lastLine = null;

    for (let i = 0; i < strips.length; i++) {
      const strip = strips[i];
      const maxLines = Math.max(0, v9LinesThatFit(strip.height, lineH));
      capacity += maxLines;
      if (cursor >= wordSlice.length || maxLines <= 0) continue;

      const remaining = wordSlice.slice(cursor).join(' ');
      const lines = metrics.layoutLines(remaining, strip.width);
      if (!lines || lines.length === 0) break;

      const linesUsed = Math.min(maxLines, lines.length);
      for (let j = 0; j < linesUsed; j++) {
        const line = lines[j];
        if (line && line.words) cursor += line.words.length;
        lastLine = {
          width: strip.width,
          naturalWidth: line?.width || 0,
          words: line?.words || [],
        };
      }
      totalLines += linesUsed;

      if (lines.length <= maxLines) break;
      if (i === strips.length - 1) {
        fits = false;
        break;
      }
    }

    if (cursor < wordSlice.length) fits = false;

    const lastFill = lastLine && lastLine.width > 0
      ? Math.min(1, Math.max(0, lastLine.naturalWidth / lastLine.width))
      : 1;

    return {
      fits,
      totalLines,
      capacity,
      lastFill,
      lastWords: lastLine?.words?.length || 0,
    };
  }
  
  // שלב 1: binary search על נקודת החיתוך N.
  // המטרה: מינימום של |linesForWordSlice(left) − linesForWordSlice(right)|
  let lo = 1;
  let hi = words.length - 1;
  let bestN = Math.floor(words.length / 2);
  let bestDiff = Infinity;

  // 30 איטרציות מספיק עבור log2(words.length) ברוב המקרים
  for (let iter = 0; iter < 30 && lo <= hi; iter++) {
    const mid = Math.floor((lo + hi) / 2);
    const linesRight = linesForWordSlice(words.slice(0, mid));
    const linesLeft  = linesForWordSlice(words.slice(mid));
    const diff = linesRight - linesLeft;
    const absDiff = Math.abs(diff);

    if (absDiff < bestDiff) {
      bestDiff = absDiff;
      bestN = mid;
    }

    if (diff === 0) break; // מאוזן מושלם
    if (diff < 0) {
      // הימני קצר מדי, צריך להעביר אליו עוד מילים
      lo = mid + 1;
    } else {
      // הימני ארוך מדי, צריך להפחית
      hi = mid - 1;
    }
  }

  // שלב 2: תיקון לגבול שורה שלמה.
  // ה-binary search איזן בין שורות, אבל ייתכן שה-N שמצאנו נופל "באמצע
  // שורה" — כלומר השורה האחרונה של הימני חצי-מלאה, והמילה הראשונה של
  // השמאלי הייתה נכנסת לתוכה. נזיז את הגבול קדימה כל עוד הוספת מילה
  // לא מוסיפה שורה חדשה לטור הימני (משמע: היא משתלבת בשורה הקיימת).
  // עוצרים כשהמילה הבאה כן הייתה דורשת שורה חדשה — שם הגבול הטבעי.
  let finalSplit = bestN;
  let baselineLines = linesForWordSlice(words.slice(0, finalSplit));
  for (let bump = 0; bump < 20 && finalSplit < words.length - 1; bump++) {
    const tryLines = linesForWordSlice(words.slice(0, finalSplit + 1));
    if (tryLines > baselineLines) break; // המילה הבאה תוסיף שורה — סוף שורה טבעי
    finalSplit++;
  }

  // משה 2026-05-19: אם גבול החיתוך הוא סוף שורה "טכני" אבל השורה עדיין
  // קצרה מדי, מושכים עוד מילים מהחצי הבא עד שהשורה האחרונה נראית טבעית.
  // מותר להוסיף גם שורה אחת נוספת, בתנאי שהחצי הראשון עדיין נכנס ברצועות.
  const minContinuationFill = 0.72;
  for (let pull = 0; pull < 30 && finalSplit < words.length - 1; pull++) {
    const currentStats = splitSliceStats(words.slice(0, finalSplit));
    if (!currentStats.fits) break;
    if (currentStats.lastFill >= minContinuationFill && currentStats.lastWords > 1) break;

    // השאר לפחות שתי מילים בחצי הבא, כדי לא להפוך את הבעיה לצד השני.
    if (words.length - (finalSplit + 1) < 2) break;

    const nextStats = splitSliceStats(words.slice(0, finalSplit + 1));
    if (!nextStats.fits || nextStats.totalLines > nextStats.capacity) break;

    finalSplit++;
  }

  // הגנה: לפחות מילה אחת בכל צד (אחרת אין טעם בפיצול)
  const splitIdx = Math.min(words.length - 1, Math.max(1, finalSplit));
  
  return {
    first: words.slice(0, splitIdx).join(' '),
    second: words.slice(splitIdx).join(' '),
  };
}

function splitWordsByStripsWithLineEdgeGuard(text, metrics, rightStrips, opts = {}) {
  const fallback = splitWordsByStrips(text, metrics, rightStrips);
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (!fallback || words.length < 2 || !metrics || !Array.isArray(rightStrips) || rightStrips.length === 0) {
    return fallback;
  }

  const lineH = Number(metrics.lineHeight) || 0;
  if (!(lineH > 0)) return fallback;

  const strips = rightStrips.filter(s =>
    s && Number(s.width) > 0 && Number(s.height) > 0 && v9LinesThatFit(s.height, lineH) > 0
  );
  if (!strips.length) return fallback;

  const minLineEdgeFill = Math.max(Number(opts.minLineEdgeFill) || 0.82, 0.82);
  const oneWordFill = Math.max(0.96, minLineEdgeFill);

  function statsForPrefix(count) {
    const target = Math.max(0, Math.min(words.length, Number(count) || 0));
    if (target <= 0) {
      return { fits: true, totalLines: 0, capacity: 0, lastFill: 1, lastWords: 0, acceptable: false };
    }

    let cursor = 0;
    let totalLines = 0;
    let capacity = 0;
    let fits = true;
    let lastLine = null;

    for (let i = 0; i < strips.length; i++) {
      const strip = strips[i];
      const maxLines = Math.max(0, v9LinesThatFit(strip.height, lineH));
      capacity += maxLines;
      if (cursor >= target || maxLines <= 0) continue;

      const remaining = words.slice(cursor, target).join(' ');
      const lines = metrics.layoutLines(remaining, Number(strip.width));
      if (!lines || !lines.length) break;

      const linesUsed = Math.min(maxLines, lines.length);
      for (let j = 0; j < linesUsed; j++) {
        const line = lines[j];
        if (line && Array.isArray(line.words)) cursor += line.words.length;
        lastLine = {
          width: Number(strip.width) || 0,
          naturalWidth: Number(line?.width) || 0,
          words: Array.isArray(line?.words) ? line.words : [],
        };
      }
      totalLines += linesUsed;

      if (lines.length <= maxLines) break;
      if (i === strips.length - 1) {
        fits = false;
        break;
      }
    }

    if (cursor < target) fits = false;

    const lastFill = lastLine && lastLine.width > 0
      ? Math.min(1, Math.max(0, lastLine.naturalWidth / lastLine.width))
      : 0;
    const lastWords = lastLine?.words?.length || 0;
    const acceptable = !!lastLine && fits && (
      lastWords < 2 ? lastFill >= oneWordFill : lastFill >= minLineEdgeFill
    );

    return { fits, totalLines, capacity, lastFill, lastWords, acceptable };
  }

  function lineEndCandidates() {
    const out = [];
    let cursor = 0;
    let totalLines = 0;

    for (const strip of strips) {
      const maxLines = Math.max(0, v9LinesThatFit(strip.height, lineH));
      if (maxLines <= 0 || cursor >= words.length) continue;

      const remaining = words.slice(cursor).join(' ');
      const lines = metrics.layoutLines(remaining, Number(strip.width));
      if (!lines || !lines.length) break;

      const linesUsed = Math.min(maxLines, lines.length);
      for (let j = 0; j < linesUsed && cursor < words.length; j++) {
        const lineWords = Array.isArray(lines[j]?.words) ? lines[j].words.length : 0;
        if (lineWords <= 0) continue;
        cursor += lineWords;
        totalLines++;
        if (cursor > 0 && cursor < words.length) {
          out.push({ count: cursor, totalLines });
        }
      }

      if (lines.length <= maxLines || cursor >= words.length) break;
    }

    return out;
  }

  function approxLinesForSuffix(start, rightLineCount = 0) {
    const suffixWords = words.slice(start);
    if (!suffixWords.length) return 0;

    const halfWidth = Number(opts.halfWidth) || Number(strips[0]?.width) || Number(rightStrips[0]?.width) || 1;
    const fullWidth = Number(opts.fullWidth) || halfWidth;
    const halfLimit = Math.max(0, Math.floor(Number(rightLineCount) || 0));

    let cursor = 0;
    let totalLines = 0;

    // Column B first shares the page with column A. If it still has content
    // after column A ends, it may expand to full width. Estimating the suffix
    // this way prevents the split chooser from accepting a very short column A
    // just because the suffix was measured as if it stayed narrow forever.
    if (halfLimit > 0) {
      const halfLines = metrics.layoutLines(suffixWords.join(' '), halfWidth) || [];
      const useHalf = Math.min(halfLimit, halfLines.length);
      for (let i = 0; i < useHalf; i++) {
        const n = Array.isArray(halfLines[i]?.words) ? halfLines[i].words.length : 0;
        if (n <= 0) break;
        cursor += n;
        totalLines++;
      }
      if (cursor >= suffixWords.length || halfLines.length <= halfLimit) return totalLines;
    }

    const remaining = suffixWords.slice(cursor).join(' ');
    if (!remaining) return totalLines;
    const fullLines = metrics.layoutLines(remaining, fullWidth) || [];
    return totalLines + fullLines.length;
  }

  const candidates = lineEndCandidates();
  let best = null;

  for (const cand of candidates) {
    if (words.length - cand.count < 2) continue;
    const st = statsForPrefix(cand.count);
    if (!st.fits || !st.acceptable) continue;

    const suffixLines = approxLinesForSuffix(cand.count, st.totalLines);
    const balancePenalty = Math.abs(st.totalLines - suffixLines);
    const leftLongPenalty = Math.max(0, suffixLines - st.totalLines);
    const fillScore = st.lastFill;
    const wordScore = Math.min(3, st.lastWords) * 0.03;
    const laterTieBreaker = cand.count / Math.max(1, words.length) * 0.12;
    // Balance is now the primary criterion. A split that leaves column B much
    // longer than column A is exactly the visual bug reported by the user.
    const score = fillScore * 0.30 + wordScore + laterTieBreaker
      - balancePenalty * 0.75
      - leftLongPenalty * 0.85;

    if (!best || score > best.score) {
      best = { count: cand.count, score, stats: st, suffixLines, leftLongPenalty };
    }
  }

  if (!best) return fallback;

  const fallbackCount = (fallback.first || '').split(/\s+/).filter(Boolean).length;
  const fallbackStats = statsForPrefix(fallbackCount);

  if (fallbackStats.acceptable) {
    const fallbackSuffixLines = approxLinesForSuffix(fallbackCount, fallbackStats.totalLines);
    const fallbackBalance = Math.abs(fallbackStats.totalLines - fallbackSuffixLines);
    const fallbackLeftLong = Math.max(0, fallbackSuffixLines - fallbackStats.totalLines);
    const bestBalance = Math.abs(best.stats.totalLines - best.suffixLines);
    const bestLeftLong = Math.max(0, best.suffixLines - best.stats.totalLines);
    if (
      fallbackLeftLong <= bestLeftLong + 1 &&
      fallbackBalance <= bestBalance + 1 &&
      fallbackStats.lastFill >= best.stats.lastFill - 0.04
    ) {
      return fallback;
    }
  }

  return {
    first: words.slice(0, best.count).join(' '),
    second: words.slice(best.count).join(' '),
    _v9ColumnSplitLineEdgeGuard: {
      selectedWordCount: best.count,
      lastFill: best.stats.lastFill,
      lastWords: best.stats.lastWords,
      totalLines: best.stats.totalLines,
      suffixLines: best.suffixLines,
      leftLongPenalty: best.leftLongPenalty || 0,
    },
  };
}

// =====================================================================
// Main-reference anchors for V9
// =====================================================================
function v9MainRefsFromParagraph(p, textLen) {
  const source = Array.isArray(p?.mainRefs) && (p._v9Source || p.mainRefs.length) ? p.mainRefs : (Array.isArray(p?.notes) ? p.notes : []);
  const out = [];

  // משה 09/09/2026: עוגן שנמצא מעבר לסוף הפסקה הזאת נמדד בטקסט אחר —
  // בזרם שמארח הערות להערות. השורה שחתכה אותו לאורך הפסקה דחסה את כולם
  // לנקודה האחרונה, ומשם הערמה. נמדד על הקובץ של משה: עד 15 מספרים
  // באותו מקום בדיוק. לכן עוגן כזה אינו הופך למספר כאן.
  const limit = Number(textLen) || 0;
  // ⛔⛔ משה 10/09/2026: „זרם 03 — 401 סימנים, 0 מספרים.”
  // כאן ישבה רגרסיה שלי. הוספתי כלל „עוגן מעבר לסוף הטקסט אינו שייך
  // לטקסט הזה” — נכון בפני עצמו, אבל לא כאן: הפונקציה מקבלת את אורך
  // **חתיכה** מהפסקה (cleanPiece.length), בעוד שהעוגנים נמדדו על
  // הפסקה **השלמה**. לכן כל מספר שיושב אחרי החתיכה הראשונה נראה
  // „מחוץ לתחום” — ונמחק. זרם 03 איבד את כל 401 המספרים שלו,
  // וזרם 01 איבד 31.
  // המבחן הנכון אינו המיקום אלא **מהות ההערה**: הערה מקוננת אינה
  // שייכת לטקסט הראשי. זה בדיוק מה שהסימון `nested` אומר, והוא
  // מגיע מהמקום שבו באמת יודעים את התשובה.

  for (const raw of source || []) {
    const stream = String(raw?.stream || raw?.code || raw?.streamId || raw?.streamCode || "");
    if (!stream) continue;
    const anchorRaw = raw?.absoluteAnchor ?? raw?.anchor ?? raw?.localAnchor;
    const anchor = Number(anchorRaw);
    if (!Number.isFinite(anchor)) continue;
    // משה 09/09/2026: הערה מקוננת (הערה על הערה) אינה שייכת לטקסט
    // הראשי, ולכן אינה מקבלת מספר שם. היא מופיעה באריח שלה עם המספר
    // שלה. בלי זה כל אחיותיה נערמות על נקודת ההורה — נמדד עד 15 יחד.
    if (raw?.nested === true) continue;
    const clamped = Math.max(0, Math.min(limit, anchor));
    const num = typeof raw?.num === "number" && raw.num > 0 ? raw.num : 0;
    if (!num) continue;
    let formatted = "";
    try { formatted = formatStreamNumber(stream, num, "main") || ""; } catch (_) { formatted = ""; }
    if (!formatted) continue;
    out.push({
      stream,
      code: stream,
      num,
      formatted,
      uid: raw?.uid || (String(stream) + ":" + String(num) + ":" + String(clamped)),
      anchor: clamped,
      anchorAffinity: raw.anchorAffinity,
      absoluteAnchor: clamped,
      localAnchor: clamped,
      priority: Number(raw?.priority) || 0,
    });
  }
  out.sort((a, b) =>
    (a.anchor - b.anchor) ||
    ((a.priority || 0) - (b.priority || 0)) ||
    String(a.stream).localeCompare(String(b.stream)) ||
    ((a.num || 0) - (b.num || 0))
  );
  return out;
}

function v9RefsForWordTokens(mainRefs, wordTokens) {
  if (!Array.isArray(mainRefs) || !mainRefs.length || !Array.isArray(wordTokens) || !wordTokens.length) return [];
  const first = wordTokens[0];
  const last = wordTokens[wordTokens.length - 1];
  const start = Number(first?.start) || 0;
  const end = Number(last?.end) || start;
  const refs = mainRefs.filter((ref) => {
    const a = Number(ref?.absoluteAnchor ?? ref?.anchor);
    return Number.isFinite(a) && a >= start && a <= end;
  });
  if (!refs.length) return [];

  const usedKeys = new Set();
  return refs.map((ref) => {
    const anchor = Number(ref.absoluteAnchor ?? ref.anchor) || 0;
    let pos = 0;
    for (let i = 0; i < wordTokens.length; i++) {
      const tok = wordTokens[i];
      if (i > 0) pos += 1;
      const ts = Number(tok.start) || 0;
      const te = Number(tok.end) || ts;
      const text = String(tok.text || "");
      if (anchor <= ts) return { ...ref, localPos: pos };
      if (anchor > ts && anchor <= te) {
        const inside = anchor - ts;
        const toStart = inside;
        const toEnd = te - anchor;
        return { ...ref, localPos: toStart <= toEnd ? pos : pos + text.length };
      }
      pos += text.length;
    }
    return { ...ref, localPos: pos };
  }).filter((ref) => {
    const key = ref.uid || (String(ref.stream) + ":" + String(ref.num) + ":" + String(ref.anchor));
    if (usedKeys.has(key)) return false;
    usedKeys.add(key);
    return true;
  }).sort((a, b) =>
    (Number(a.localPos) - Number(b.localPos)) ||
    String(a.stream).localeCompare(String(b.stream)) ||
    ((a.num || 0) - (b.num || 0))
  );
}

function appendV9MainRefSpan(parent, ref) {
  const formatted = ref?.formatted || formatStreamNumber(ref.stream || ref.code, ref.num, "main");
  if (!formatted) return false;
  const span = document.createElement("span");
  span.className = "stream-ref v9-main-ref";
  span.textContent = formatted;
  span.setAttribute("dir", "ltr");
  span.style.unicodeBidi = "isolate";
  span.style.display = "inline-block";
  span.dataset.v9MainRef = "1";
  span.dataset.stream = String(ref.stream || ref.code || "");
  span.dataset.num = String(ref.num || "");
  span.dataset.uid = String(ref.uid || "");
  span.dataset.anchor = String(ref.absoluteAnchor ?? ref.anchor ?? "");
  span.dataset.localPos = String(ref.localPos ?? "");
  const styleId = styleIdForStreamNumber(ref.stream || ref.code, "main");
  if (styleId) applyStyleToElement(span, styleId);
  parent.appendChild(span);
  return true;
}

// ★ משה 28/09/2026 — „בהגדרות זרמים צריך הגדרות זרם ראשי כמו בכל
// הזרמים... ניסיתי להגדיר בולד בסגנון מותאם אישית בזרם הראשי ולא
// הצליח בגלל שאין ברשימת הזרמים זרם ראשי".
//
// עד היום „סגנון לבולד" עבד רק בזרמי ההערות. הטקסט הראשי צייר את
// ה-runs שלו כמו שהם, ולכן כל הגדרה כזאת פשוט לא נגעה בו.
// מעכשיו הראשי נקרא בשם הזרם `main` ומקבל את אותו טיפול בדיוק.
const V9_MAIN_STREAM_CODE = "main";

function v9RunIsSourceBold(marks) {
  if (!marks) return false;
  if (marks.bold === true) return true;
  const weight = marks.fontWeight;
  if (weight === undefined || weight === null || weight === "") return false;
  const text = String(weight).trim().toLowerCase();
  if (text === "bold" || text === "bolder") return true;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric >= 600;
}

function v9MainBaseTypography(cfg) {
  const registry = cfg?.mainStyleId ? resolveTextStyle(cfg.mainStyleId) : null;
  return normalizeTextStyle({
    ...(registry || {}),
    ...(cfg?.mainInlineStyle || {}),
  }) || {};
}

function v9MainSourceRunsUnderSelectedStyle(runs, cfg) {
  const list = Array.isArray(runs) ? runs : [];
  if (!boldOverrideForcesDocStylesForStream(V9_MAIN_STREAM_CODE)) return list;

  const base = v9MainBaseTypography(cfg);
  const controlsFontFamily = !!String(base.fontFamily || "").trim();
  const controlsFontSize = base.fontSize !== undefined && base.fontSize !== null && base.fontSize !== "";
  const controlsWeight = base.bold === true || (base.fontWeight !== undefined && base.fontWeight !== null && base.fontWeight !== "");
  const controlsStyle = base.italic === true || !!base.fontStyle;

  if (!controlsFontFamily && !controlsFontSize && !controlsWeight && !controlsStyle) return list;

  return list.map((run) => {
    if (!run) return run;
    const marks = { ...(run.marks || {}) };
    // Preserve the SEMANTIC fact that Word/source marked this range bold before
    // removing document typography that the selected main style is meant to
    // override. This is what lets bold style Y still target only genuine source
    // bold, while style X controls the ordinary text.
    const sourceBold = v9RunIsSourceBold(marks);

    if (controlsFontFamily) delete marks.fontFamily;
    if (controlsFontSize) {
      delete marks.fontSize;
      delete marks.fontSizeUnit;
    }
    if (controlsWeight) {
      delete marks.fontWeight;
      delete marks.bold;
    }
    if (controlsStyle) {
      delete marks.fontStyle;
      delete marks.italic;
    }
    if (sourceBold) marks.bold = true;
    return { ...run, marks };
  });
}

function v9MainBoldOverrideRuns(runs, cfg = null) {
  try {
    const sourceRuns = v9MainSourceRunsUnderSelectedStyle(runs, cfg);
    const marks = styleIdToMarks(boldOverrideStyleIdForStream(V9_MAIN_STREAM_CODE));
    if (!marks) return sourceRuns;
    // Only semantic source bold is eligible for style Y. A bold base style X
    // never promotes ordinary text to Y.
    return applyBoldOverrideToRuns(
      sourceRuns,
      marks,
      boldOverrideForcesDocStylesForStream(V9_MAIN_STREAM_CODE)
    );
  } catch (_) {
    return runs;
  }
}

function appendV9TextWithMainRefs(parent, line) {
  const refs = Array.isArray(line?.mainRefs) ? line.mainRefs : [];
  const text = String(line?.text || "");
  const runs = v9MainBoldOverrideRuns(Array.isArray(line?.runs) ? line.runs : [], line?._v9Config || null);
  if (!refs.length) {
    appendTextWithRuns(parent, text, runs);
    return;
  }
  let cursor = 0;
  for (const ref of refs) {
    const pos = Math.max(0, Math.min(text.length, Number(ref.localPos) || 0));
    if (pos > cursor) appendTextWithRuns(parent, text.slice(cursor, pos), sliceRuns(runs, cursor, pos));
    appendV9MainRefSpan(parent, ref);
    cursor = Math.max(cursor, pos);
  }
  if (cursor < text.length) appendTextWithRuns(parent, text.slice(cursor), sliceRuns(runs, cursor, text.length));
}

// =====================================================================
// בונה strips לראשי לפי בר־מצרא: כשפרשן נגמר, הראשי מתפשט לתוך שטחו.
// =====================================================================
//
// הקלט:
//   mainTopY    — התחלת הראשי (אחרי הכתר).
//   mainX       — x של הראשי בעמוד (בתיאום LTR).
//   mainWidth   — רוחב בסיסי של הראשי.
//   mainGap     — מרווח בין הראשי לזרמים (שמתאחד לתוך הראשי כשהפרשן נגמר).
//   innerWidth  — רוחב פנימי של הדף (אחרי padding).
//   rightEndY   — y שבו פרשן ימני נגמר (Infinity אם הוא מילא את כל strip 2).
//   leftEndY    — אותו דבר לשמאל.
//   pageBottom  — תחתית הדף (pageHeight - padding).
//
// הפלט: רשימת strips עם y_start, y_end, width, x.
// strip 1: שני הצדדים פעילים → רוחב = mainWidth, x = mainX.
// strip 2: צד אחד נגמר → הראשי מתפשט (רוחב = mainWidth + gap + שטח הצד הנגמר).
// strip 3: שני הצדדים נגמרו → הראשי לרוחב מלא (innerWidth).

function v9WordsWidth(words, metrics) {
  if (!Array.isArray(words) || words.length === 0 || !metrics) return 0;
  let w = 0;
  for (let i = 0; i < words.length; i++) {
    if (i > 0) w += metrics.spaceWidth;
    w += metrics.measureWord(words[i]);
  }
  return w;
}

function v9LineFromWords(words, metrics) {
  const ws = Array.isArray(words) ? words.filter(Boolean) : [];
  return {
    words: ws,
    width: v9WordsWidth(ws, metrics),
    isLast: false,
  };
}

// משה 2026-05-19: איזון חיתוך footer/הערות.
// לא חותכים slice עיוור אם השורה האחרונה קצרה מדי.
// מנסים לבנות מחדש את חלון השורות האחרון מהסוף, ולמשוך מילים מה-overflow
// כל עוד אותו מספר שורות עדיין נכנס.
function rebalanceFooterContinuationCut(allLines, maxLinesFit, metrics, widthPx) {
  const baseLines = Array.isArray(allLines) ? allLines.slice(0, maxLinesFit) : [];
  const rawOverflowWords = Array.isArray(allLines)
    ? allLines.slice(maxLinesFit).flatMap(l => (l && Array.isArray(l.words)) ? l.words : [])
    : [];

  if (!baseLines.length || !rawOverflowWords.length || !metrics || !widthPx) {
    return { linesToRender: baseLines, overflowWords: rawOverflowWords, balanced: false };
  }

  const last = baseLines[baseLines.length - 1];
  const lastFill = last && widthPx > 0 ? (Number(last.width) || 0) / widthPx : 1;
  if (lastFill >= 0.72 && (last?.words?.length || 0) > 1) {
    return { linesToRender: baseLines, overflowWords: rawOverflowWords, balanced: false };
  }

  const windowLineCount = Math.min(4, baseLines.length);
  const stableLines = baseLines.slice(0, baseLines.length - windowLineCount);
  const windowWords = baseLines.slice(baseLines.length - windowLineCount)
    .flatMap(l => (l && Array.isArray(l.words)) ? l.words : []);

  function breakWordsFromEnd(words, lineCount) {
    const result = [];
    let end = words.length;

    for (let lineNo = lineCount - 1; lineNo >= 0 && end > 0; lineNo--) {
      let start = end - 1;

      while (start > 0) {
        const candidate = words.slice(start - 1, end);
        const candidateWidth = v9WordsWidth(candidate, metrics);
        if (candidateWidth <= widthPx) start--;
        else break;
      }

      result.unshift(v9LineFromWords(words.slice(start, end), metrics));
      end = start;
    }

    if (end > 0) return null;
    if (result.length !== lineCount) return null;
    return result;
  }

  let best = null;
  const maxPull = Math.min(24, rawOverflowWords.length);

  for (let pull = 0; pull <= maxPull; pull++) {
    const candidateWords = windowWords.concat(rawOverflowWords.slice(0, pull));
    const candidateLines = breakWordsFromEnd(candidateWords, windowLineCount);
    if (!candidateLines) continue;

    const candidateLast = candidateLines[candidateLines.length - 1];
    const fill = widthPx > 0 ? (Number(candidateLast.width) || 0) / widthPx : 1;
    const wordsInLast = candidateLast.words?.length || 0;

    const reachesTarget = fill >= 0.72 && wordsInLast > 1;
    const score = (reachesTarget ? 10000 : 0) + fill * 100 + pull * 0.75;

    if (!best || score > best.score) {
      best = { pull, lines: candidateLines, score, fill };
    }
  }

  if (!best) {
    return { linesToRender: baseLines, overflowWords: rawOverflowWords, balanced: false };
  }

  return {
    linesToRender: stableLines.concat(best.lines),
    overflowWords: rawOverflowWords.slice(best.pull),
    balanced: best.pull > 0 || best.fill > lastFill + 0.05,
  };
}

// =====================================================================
// בונה strips לראשי לפי בר־מצרא: כשפרשן נגמר, הראשי מתפשט לתוך שטחו.
// =====================================================================
// ★ משה 13/09/2026 — איזון שני הצדדים של זרם יחיד (תרחיש one_long_split).
//
// הבעיה: החלוקה בין הטור הימני לשמאלי נעשתה ע"י "מלא את הימני עד שנגמר
// המקום, והשאר לשמאלי". התוצאה: הימני יורד עד תחתית העמוד והשמאלי נגמר
// באמצע — בעוד שבדף וילנא שני צדי הפירוש נגמרים באותו גובה.
//
// הפתרון: מודדים בפועל כמה גובה תופס כל צד (flowStreamThroughStrips מחזיר
// endY), ומזיזים את נקודת החיתוך בחיפוש חצייה עד ששני הגבהים מתקרבים.
// המדידה מונוטונית: כל שורה שעוברת ימינה→שמאלה מנמיכה את הימני ומגביהה
// את השמאלי, ולכן החיפוש מתכנס ב-~10 צעדים גם על אלפי מילים.
//
// ⛔ כלל ברזל: נקודות החיתוך המותרות הן **סופי שורות בלבד**. אסור לחתוך
// באמצע שורה, ואסור להשאיר רווח בסוף השורה שנחתכה.
function balanceOneLongSplitByHeight(allText, metrics, rightStrips, leftStrips, maxY, opts = {}) {
  // opts.lineStrips = הרצועות שבהן המנוע באמת מזרים את הטור הימני.
  // חובה לחשב את סופי-השורות מהן ולא מרצועות-האיזון, אחרת „סוף שורה”
  // כאן אינו סוף שורה שם — וזה בדיוק מה שגרם לחיתוך באמצע שורה.
  const lineStrips = Array.isArray(opts.lineStrips) && opts.lineStrips.length
    ? opts.lineStrips
    : rightStrips;
  const words = String(allText || "").split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  if (!Array.isArray(rightStrips) || !rightStrips.length) return null;
  if (!Array.isArray(leftStrips) || !leftStrips.length) return null;

  const topOf = (strips) => (strips.length ? strips[0].y_start : 0);
  const rightTop = topOf(rightStrips);
  const leftTop = topOf(leftStrips);

  const measure = (k) => {
    const first = words.slice(0, k).join(" ");
    const second = words.slice(k).join(" ");
    const r = flowStreamThroughStrips(first, rightStrips, metrics, maxY);
    const l = flowStreamThroughStrips(second, leftStrips, metrics, maxY);
    return {
      k,
      first,
      second,
      hRight: Math.max(0, (r.endY || rightTop) - rightTop),
      hLeft: Math.max(0, (l.endY || leftTop) - leftTop),
      overflowRight: !!(r.overflowText && r.overflowText.trim()),
      overflowLeft: !!(l.overflowText && l.overflowText.trim()),
    };
  };

  // ★ הוראה קשיחה (משה 13/09/2026): החיתוך בין הטור הימני לשמאלי חייב
  // ליפול **בדיוק בסוף שורה** — לא באמצע שורה, ובלי להשאיר רווח בסופה.
  // לכן קודם מזרימים את כל הטקסט דרך רצועות הטור הימני ורואים היכן
  // נגמרות השורות בפועל; אלה, ורק אלה, נקודות החיתוך המותרות.
  const TALL = 1e6;
  // ⚠ תיקון 14/09: קודם הוארכו **כל** הרצועות ב-TALL — וכך הרצועה
  // הראשונה הפכה לאינסופית וכל הטקסט זרם בה ברוחב אחד. סופי-השורות
  // שהתקבלו לא שיקפו את המעבר בין הרצועות, ולכן החיתוך נפל באמצע שורה
  // (נמדד: שורה אחרונה בטור הימני מלאה ב-27% בלבד).
  // עכשיו מאריכים **רק את הרצועה האחרונה**, כך שהזרימה בין הרצועות
  // נשארת אמיתית ורק בסוף יש מקום בלתי מוגבל.
  const flowStrips = lineStrips.map((st, i) => (
    i === lineStrips.length - 1 && st.y_end !== undefined
      ? { ...st, y_end: st.y_end + TALL }
      : { ...st }
  ));
  const fullFlow = flowStreamThroughStrips(allText, flowStrips, metrics, TALL);
  const lineEnds = [];
  let acc = 0;
  for (const line of (fullFlow.lines || [])) {
    const n = Array.isArray(line.words) ? line.words.length : String(line.text || "").split(/\s+/).filter(Boolean).length;
    acc += n;
    if (acc > 0 && acc < words.length) lineEnds.push(acc);
  }
  // בלי נקודות-שורה (טקסט קצר מאוד) — לא מאזנים, כדי לא לחתוך באמצע שורה.
  if (!lineEnds.length) return null;

  // חיפוש חצייה על **אינדקסי השורות**: כל מועמד הוא סוף שורה מלאה.
  let lo = 0;
  let hi = lineEnds.length - 1;
  let best = null;
  for (let iter = 0; iter < 12 && lo <= hi; iter++) {
    const mid = Math.floor((lo + hi) / 2);
    const m = measure(lineEnds[mid]);
    const gap = Math.abs(m.hRight - m.hLeft);
    if (!best || gap < Math.abs(best.hRight - best.hLeft)) best = m;
    if (m.hRight > m.hLeft) hi = mid - 1;
    else lo = mid + 1;
  }
  if (!best) return null;

  // אם החלוקה המאוזנת גורמת לגלישה באחד הצדדים — לא מאלצים אותה.
  if (best.overflowRight || best.overflowLeft) {
    if (!opts.allowOverflow) return null;
  }
  return { first: best.first, second: best.second, _v9BalancedHeights: true,
    _v9BalanceGap: Math.round(Math.abs(best.hRight - best.hLeft)) };
}

function buildMainStrips(opts) {
  const { mainTopY, mainX, mainWidth, mainGap, innerWidth,
          rightEndY, leftEndY, pageBottom } = opts;

  // משה 2026-05-08: כל ה-y חסומים ב-pageBottom. אם פאס 1 נתן endY מעבר לדף
  // (כי naiveMainBottomY היה ענק), חוסמים כדי שה-strips לא ייצרו טווח שלילי.
  // A short side may end INSIDE the crown. Expansion may change width, but
  // must never create strips above the main start / reserved crown clearance.
  if (!(pageBottom > mainTopY)) return [];
  const cap = (v) => (v === Infinity ? Infinity : Math.max(mainTopY, Math.min(v, pageBottom)));
  const right = (rightEndY === undefined || rightEndY === null) ? mainTopY : cap(rightEndY);
  const left  = (leftEndY  === undefined || leftEndY  === null) ? mainTopY : cap(leftEndY);

  const firstEnd  = Math.min(right, left);
  const secondEnd = Math.max(right, left);

  const strips = [];

  // Strip 1: שני הצדדים עדיין פעילים (mainTopY → firstEnd)
  if (firstEnd > mainTopY) {
    const y_end = (firstEnd === Infinity) ? pageBottom : firstEnd;
    strips.push({ y_start: mainTopY, y_end, width: mainWidth, x: mainX });
  }

  if (firstEnd === Infinity) return strips; // שני הצדדים מילאו, אין הרחבה
  if (firstEnd >= pageBottom) return strips; // שני הצדדים נמשכים עד תחתית הדף

  // Strip 2: צד אחד נגמר. הראשי מתפשט אליו (firstEnd → secondEnd)
  const firstEndedRight = right <= left;
  let strip2X, strip2Width;
  if (firstEndedRight) {
    strip2X = mainX;
    strip2Width = innerWidth - mainX;
  } else {
    strip2X = 0;
    strip2Width = mainX + mainWidth;
  }
  if (secondEnd > firstEnd) {
    const y_end = (secondEnd === Infinity) ? pageBottom : secondEnd;
    strips.push({ y_start: firstEnd, y_end, width: strip2Width, x: strip2X });
  }

  if (secondEnd === Infinity) return strips; // רק צד אחד נגמר
  if (secondEnd >= pageBottom) return strips;

  // Strip 3: שני הצדדים נגמרו. הראשי ברוחב מלא (secondEnd → pageBottom)
  strips.push({ y_start: secondEnd, y_end: pageBottom, width: innerWidth, x: 0 });

  return strips;
}

// ⭐⭐⭐⭐ משה 28–29/09/2026 — „אני לא רוצה שום חפיפות, הכול צריך
// לעבוד אוטומטי לחלוטין כאילו היתה פה תמונה — אם יש תמונה הטקסט הולך
// הצידה, כך זה צריך להתנהג".
//
// זו בדיוק הפונקציה הזאת: היא לוקחת את הרצועות של הטקסט הראשי ו„חותכת"
// אותן סביב כל קופסה תפוסה — כאילו כל זרם הוא תמונה שהטקסט חייב
// לזרום סביבה.
//
// ═══ למה גבול יחיד לא עבד ═══
// ניסיתי קודם להעביר מספר אחד: „עד כאן מותר להתפשט". זה נכשל קשות
// (44 ⟵ 68 חפיפות), כי footer יושב בתחתית העמוד — וגבול שנגזר ממנו
// מונע מהראשי להתפשט גם באמצע, שם השטח פנוי לגמרי.
//
// ⇒ החסימה חייבת להיות **פר-טווח אנכי**: בכל גובה בנפרד, לבדוק מי
//   תופס שם מקום ולצמצם רק שם.
//
// ═══ איך זה עובד ═══
// לכל רצועה של הראשי עוברים על הקופסאות התפוסות. קופסה שחופפת את
// הרצועה גם אנכית וגם אופקית — חותכת אותה לשלושה חלקים:
//   1. החלק שמעל הקופסה — נשאר ברוחב המלא
//   2. החלק שמקביל לקופסה — מצטמצם כדי לא לגעת בה
//   3. החלק שמתחת — נשאר ברוחב המלא
// אם אחרי הצמצום לא נשאר רוחב שמיש, אותו קטע פשוט נמחק — עדיף
// שהטקסט יזרום לקטע הבא מאשר שיידרס.
function carveStripsAroundBoxes(strips, boxes, minUsableWidth, gapPx) {
  if (!Array.isArray(strips) || !strips.length) return strips;
  // ⬛ נמדד: אחרי החיתוך נשארו חפיפות של **4 פיקסלים בלבד** — הרצועה
  //    נגעה בזרם בלי מרווח ביניהם. מרווח קטן מונע את המגע הזה.
  const gap = Number(gapPx) > 0 ? Number(gapPx) : 8;

  // התחום שכל קופסה תפוסה תופסת בפועל, לפי השורות שלה.
  const blockers = [];
  for (const b of (boxes || [])) {
    if (!b || !Array.isArray(b.lines) || !b.lines.length) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const l of b.lines) {
      const lx = Number(l?.x), lw = Number(l?.width), ly = Number(l?.y);
      const lh = Number(l?.lineHeightPx) > 0 ? Number(l.lineHeightPx) : 0;
      if (!Number.isFinite(lx) || !Number.isFinite(lw) || !Number.isFinite(ly)) continue;
      if (lx < x0) x0 = lx;
      if (lx + lw > x1) x1 = lx + lw;
      if (ly < y0) y0 = ly;
      if (ly + lh > y1) y1 = ly + lh;
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
    // כותרת הזרם יושבת מעל השורה הראשונה, וגם היא תופסת מקום.
    const th = Number(b.titleHeight) > 0 ? Number(b.titleHeight) : 0;
    const ty = Number(b.titleY);
    if (th > 0 && Number.isFinite(ty)) {
      if (ty < y0) y0 = ty;
      if (ty + th > y1) y1 = ty + th;
      // ⭐ 29/09 — כותרת „ברוחב מלא" רחבה מהטקסט שמתחתיה. בלי זה
      // החיתוך היה מודד את רוחב השורות בלבד, והשלט עצמו נשאר חשוף.
      const tx = Number(b.titleX), tw = Number(b.titleWidth);
      if (Number.isFinite(tx) && Number.isFinite(tw) && tw > 0) {
        if (tx < x0) x0 = tx;
        if (tx + tw > x1) x1 = tx + tw;
      }
    }
    blockers.push({ x0, x1, y0, y1 });
  }
  if (!blockers.length) return strips;

  const minW = Number(minUsableWidth) > 0 ? Number(minUsableWidth) : 24;
  let work = strips.map(s => ({ ...s }));

  for (const bl of blockers) {
    const next = [];
    for (const s of work) {
      const sy0 = Number(s.y_start), sy1 = Number(s.y_end);
      const sx0 = Number(s.x), sx1 = Number(s.x) + Number(s.width);

      const yOverlap = Math.min(sy1, bl.y1) - Math.max(sy0, bl.y0);
      const xOverlap = Math.min(sx1, bl.x1) - Math.max(sx0, bl.x0);
      if (yOverlap <= 0.5 || xOverlap <= 0.5) { next.push(s); continue; }

      // 1. מעל הקופסה — ללא שינוי
      if (bl.y0 > sy0 + 0.5) next.push({ ...s, y_end: bl.y0 });

      // 2. מקביל לקופסה — מצטמצם לצד הרחב שנשאר פנוי
      const midTop = Math.max(sy0, bl.y0);
      const midBot = Math.min(sy1, bl.y1);
      if (midBot > midTop + 0.5) {
        const leftFree = (bl.x0 - gap) - sx0;      // פנוי משמאל לקופסה
        const rightFree = sx1 - (bl.x1 + gap);     // פנוי מימין לקופסה
        if (leftFree >= rightFree && leftFree >= minW) {
          next.push({ ...s, y_start: midTop, y_end: midBot, width: leftFree });
        } else if (rightFree >= minW) {
          next.push({ ...s, y_start: midTop, y_end: midBot, x: bl.x1 + gap, width: rightFree });
        }
        // אין צד פנוי שמיש — הקטע נמחק, והטקסט ימשיך בקטע הבא.
      }

      // 3. מתחת לקופסה — ללא שינוי
      if (bl.y1 < sy1 - 0.5) next.push({ ...s, y_start: bl.y1 });
    }
    work = next;
  }

  work.sort((a, b) => a.y_start - b.y_start || a.x - b.x);
  return work;
}

function appendOverflowStream(overflow, sid, entry) {
  if (!overflow || !sid) return;

  const incoming = normalizeRichTextEntry(entry);
  if (!incoming.text) return;

  const prev = normalizeRichTextEntry((overflow.streams || {})[sid]);
  overflow.streams[sid] = prev.text
    ? appendRichTextPart(prev, incoming, " ")
    : incoming;
}


function debugV9OpeningWord(info) {
  if (typeof window === "undefined") return;
  window.__ravtextLastV9OpeningWord = {
    paragraphIndex: info.paragraphIndex ?? null,
    paragraphId: info.paragraphId ?? null,
    applied: !!info.applied,
    skippedReason: info.skippedReason || "",
    position: info.position || "",
    segment: info.segment || "",
    openingWordWidthPx: info.openingWordWidthPx || 0,
    reserveWidthPx: info.reserveWidthPx || 0,
    dropLines: info.dropLines || 0,
    windowApplied: !!info.windowApplied,
    continuedFromPrev: !!info.continuedFromPrev,
  };
}

function markV9ContinuationParagraph(p) {
  if (!p) return p;
  return {
    ...p,
    _continues: p._v9Source ? p._v9SourceEnd < p._v9Source.text.length : !!p._continues,
    _v9ContinuesFromSplit: true,
    _v9OpeningWordAllowed: false,
  };
}

// A render-scoped context snapshots styles and measures exactly what is painted.
function createMainInlineContext(cfg) {
  return createV9TextLayoutContext(cfg, {
    decorateBase(el) {
      applyStyleToElement(el, cfg.mainStyleId);
      if (cfg.mainInlineStyle) applyTextStyleObjectToElement(el, cfg.mainInlineStyle);
    },
    prepareTypography(entry, baseTypography) {
      return v9BlockTypography(entry?.blockType || entry?.source?.blockType, baseTypography);
    },
    prepareRuns(runs) {
      return v9MainBoldOverrideRuns(runs, cfg);
    },
    prepareRefs(refs) {
      return refs.flatMap(ref => {
        const holder = document.createElement("span");
        appendV9MainRefSpan(holder, ref);
        const span = holder.firstElementChild;
        if (!span || !span.textContent) return [];
        return [{ ...ref, formatted: span.textContent, cssText: span.style.cssText || "" }];
      });
    },
    openingStyle: styleIdToMarks,
  });
}

function resolveV9MainColumnCount(cfg = {}) {
  return getMainStreamColumnCount(cfg.mainCols);
}

function resolveV9MainColumnGap(cfg = {}) {
  const explicit = Number(cfg.mainColumnGap);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const shared = Number(cfg.streamHorizontalGap);
  return Number.isFinite(shared) && shared >= 0 ? shared : 8;
}

function splitV9MainStripsIntoColumns(mainStrips, gapPx) {
  const right = [], left = [];
  for (const strip of Array.isArray(mainStrips) ? mainStrips : []) {
    const width = Math.max(0, Number(strip.width) || 0);
    const gap = Math.min(Math.max(0, gapPx), Math.max(0, width - 2));
    const columnWidth = Math.max(1, (width - gap) / 2);
    const base = { ...strip, width: columnWidth };
    left.push({ ...base, x: Number(strip.x) || 0, mainColumn: "left" });
    right.push({ ...base, x: (Number(strip.x) || 0) + columnWidth + gap, mainColumn: "right" });
  }
  return { right, left };
}

function flowMainParagraphsThroughStrips(pageContent, mainStrips, mainMetrics, cfg, pageBottom) {
  const ownContext = !cfg.__v9InlineContext;
  const effectiveConfig = { ...cfg, openingWordSettings: cfg.openingWordSettings || getOpeningWordSettings() };
  const context = cfg.__v9InlineContext || createMainInlineContext(effectiveConfig);
  try {
    const raw = Array.isArray(pageContent.mainParagraphs) && pageContent.mainParagraphs.length
      ? pageContent.mainParagraphs
      : [{ id: "main-1", index: 1, text: pageContent.mainText || "", runs: pageContent.mainRuns || [],
          mainRefs: pageContent.mainRefs || [], continues: !!pageContent.mainStartsContinued }];
    const entries = raw.map(entry => context.prepareEntry({
      ...entry,
      text: String(entry.text ?? entry.rich?.text ?? ""),
      runs: entry.runs || entry.rich?.runs || [],
    }));
    const mainCols = resolveV9MainColumnCount(cfg);
    if (mainCols <= 1) {
      const single = layoutV9MainParagraphs(entries, mainStrips, context, pageBottom);
      return { ...single, mainColumnCount: 1, mainColumnGap: 0 };
    }

    const columnGap = resolveV9MainColumnGap(cfg);
    const columnStrips = splitV9MainStripsIntoColumns(mainStrips, columnGap);
    const rightFlow = layoutV9MainParagraphs(entries, columnStrips.right, context, pageBottom);
    const rightLines = (rightFlow.lines || []).map(line => ({ ...line, mainColumn: "right" }));

    let leftFlow = {
      lines: [],
      endY: columnStrips.left[0]?.y_start || mainStrips[0]?.y_start || 0,
      overflowText: "",
      overflowParagraphs: [],
      diagnostics: [],
      overflowReason: "",
      debug: null,
    };

    if (Array.isArray(rightFlow.overflowParagraphs) && rightFlow.overflowParagraphs.length) {
      leftFlow = layoutV9MainParagraphs(rightFlow.overflowParagraphs, columnStrips.left, context, pageBottom);
    }
    const leftLines = (leftFlow.lines || []).map(line => ({ ...line, mainColumn: "left" }));
    const stillOverflowing = Array.isArray(leftFlow.overflowParagraphs) && leftFlow.overflowParagraphs.length > 0;

    return {
      lines: [...rightLines, ...leftLines],
      endY: Math.max(Number(rightFlow.endY) || 0, Number(leftFlow.endY) || 0),
      overflowText: leftFlow.overflowText || "",
      overflowParagraphs: leftFlow.overflowParagraphs || [],
      diagnostics: [...(rightFlow.diagnostics || []), ...(leftFlow.diagnostics || [])],
      overflowReason: stillOverflowing ? (leftFlow.overflowReason || rightFlow.overflowReason || "two-column-page-full") : "",
      debug: rightFlow.debug || leftFlow.debug || null,
      mainColumnCount: 2,
      mainColumnGap: columnGap,
    };
  } finally { if (ownContext) context.dispose(); }
}

// =====================================================================
// בונה תוכנית עמוד
// =====================================================================
function buildPagePlan(pageContent, config = {}) {
  const perf = typeof window !== "undefined" && window.__ravtextPerfTrace
    ? (window.__ravtextV9Perf ||= {}) : null;
  const started = perf ? performance.now() : 0;
  if (perf) perf.buildPagePlanCalls = (perf.buildPagePlanCalls || 0) + 1;
  const ownContexts = !config.__v9StreamContexts;
  const contexts = config.__v9StreamContexts || new Map();
  const cfg = { ...config, __v9StreamContexts: contexts };
  try {
    const initial = buildPagePlanCore(pageContent, cfg);
    return reserveMeasuredFooterSpace(pageContent, cfg, initial);
  } finally {
    if (perf) perf.buildPagePlanMs = (perf.buildPagePlanMs || 0) + (performance.now() - started);
    if (ownContexts) for (const c of contexts.values()) c.dispose();
  }
}

function reserveMeasuredFooterSpace(content, cfg, initial) {
  const footers = (content.footerStreams || []).filter(s =>
    normalizeRichTextEntry(s.rich || { text:(s.items || []).join(' '), runs:s.runs || [] }).text);
  const ids = new Set(footers.map(s => String(s.id)));
  const blocked = initial.unstartedNotes || [];
  if (!ids.size || !blocked.length || blocked.some(n => !ids.has(String(n.stream))) ||
      normalizeRichTextEntry(initial.overflow?.mainText).text) return initial;
  // A side may fit in isolation but still leave no room for its anchored
  // footers. Existing overflow is not a prerequisite for legal continuation.
  const sides = (initial.streamBoxes || []).filter(b => (b.lines || []).length);
  if (!sides.length) return initial;

  const footerOnly = buildPagePlanCore({ ...content, mainText:'', mainRuns:[],
    mainParagraphs:[], mainRefs:[], mainContinues:false, mainStartsContinued:false,
    mainOpeningWordAllowed:false, rightStream:null, leftStream:null,
    footerStreams:footers,
    requiredNoteStarts:(content.requiredNoteStarts || []).filter(n => ids.has(String(n.stream)))
      .map(n => ({ ...n, requireMainAnchor:false })),
  }, cfg);
  // Do not sacrifice a side stream for a footer group that itself cannot fit.
  if ((footerOnly.unstartedNotes || []).length ||
      (footerOnly.streamCoverage || []).some(c => !c.exact || c.remainingCharacters)) return initial;
  const rows = footerOnly.footerBoxes.flatMap(b => b.lines || []);
  if (!rows.length) return initial;
  const footprint = Math.max(...rows.map(l => l.y + l.lineHeightPx)) - footerOnly.mainBottomGapPlan.baseY;
  const pageBottom = Number(initial.pageBox?.height) - Number(initial.pageBox?.padding) - (Number(cfg.reservedBottom) || 0);
  const limit = pageBottom - footprint;
  const mainBottom = Math.max(0, ...(initial.mainBox?.lines || []).map(l => l.y + l.lineHeightPx));
  const sideBottom = Math.max(...sides.map(b => Number(b.endY) || 0));
  if (!(footprint > 0 && Number.isFinite(limit) && limit >= mainBottom && limit < sideBottom - 1/64)) return initial;

  const candidate = buildPagePlanCore(content, { ...cfg, __v9FooterReservedSideBottom:limit });
  if (normalizeRichTextEntry(candidate.overflow?.mainText).text || candidate.overflow?.exceedsPage ||
      (candidate.unstartedNotes || []).length || hasUnsafeV9StreamOverflow(candidate) ||
      (candidate.streamCoverage || []).some(c => !c.exact || (ids.has(String(c.stream)) && c.remainingCharacters))) return initial;
  const all = [...(candidate.mainBox?.lines || []), ...candidate.streamBoxes.flatMap(b => b.lines || []),
    ...candidate.footerBoxes.flatMap(b => b.lines || [])];
  for (let i=0; i<all.length; i++) {
    const a=all[i];
    if (a.y + a.lineHeightPx > pageBottom + 1/64) return initial;
    for (let j=i+1; j<all.length; j++) {
      const b=all[j];
      if (Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1/64 &&
          Math.min(a.y+a.lineHeightPx,b.y+b.lineHeightPx)-Math.max(a.y,b.y)>1/64) return initial;
    }
  }
  candidate.footerSpaceReservation = { sideBottom:limit, measuredFooterHeight:footprint,
    previouslyUnstarted:blocked.length, completeFooters:true, allocationTrials:1 };
  return candidate;
}
function buildPagePlanCore(pageContent, config) {
  const unsplitPageContent = pageContent;
  const sourceStreams = [pageContent.rightStream, pageContent.leftStream, ...(pageContent.footerStreams || [])].filter(Boolean);
  pageContent = { ...pageContent }; // Same-stream splitting is local to this plan.
  const cfg = Object.assign({
    pageWidth: 559,
    pageHeight: 794,
    padding: 12,
    mainFontSize: 13,
    sideFontSize: 11,
    lineHeightRatio: 1.55,
    streamLineHeightRatio: null,
    mainFontFamily: 'serif',
    sideFontFamily: 'serif',
    crownLines: 4,
    mainWidthRatio: 0.42,
    // משה 2026-05-08: רווח בין הראשי לזרמי הצד (~1.5% מרוחב הדף הפנימי).
    // ניתן לעקוף ב-config.mainGap.
    mainGap: null,
    streamHorizontalGap: 8,
    titles: {},
    streamSettings: {},
    reservedTop: 0,
    reservedBottom: 0,
  }, config || {});

  const streamSettings = cfg.streamSettings || {};
  const streamLineHeightRatio = Number(cfg.streamLineHeightRatio) > 0
    ? Number(cfg.streamLineHeightRatio)
    : cfg.lineHeightRatio;
  cfg.streamLineHeightRatio = streamLineHeightRatio;
  const mainColumnCount = resolveV9MainColumnCount(cfg);
  const mainColumnGap = resolveV9MainColumnGap(cfg);
  cfg.mainCols = mainColumnCount;
  cfg.mainColumnGap = mainColumnGap;
  const reservedTop = cfg.reservedTop || 0;
  const reservedBottom = cfg.reservedBottom || 0;
  const effectivePageBottom = cfg.pageHeight - cfg.padding - reservedBottom;
  const innerWidth = cfg.pageWidth - 2 * cfg.padding;
  const halfWidth = Math.floor(innerWidth / 2);
  const mainWidth = Math.floor(innerWidth * cfg.mainWidthRatio);
  const mainX = Math.floor((innerWidth - mainWidth) / 2);
  const mainGap = (cfg.mainGap !== null && cfg.mainGap !== undefined)
    ? cfg.mainGap
    : Math.max(4, Math.floor(innerWidth * 0.015));
  // משה 2026-05-08: כל זרם צד תופס 49.5% מ-innerWidth (מראש), לא 50%.
  // הקצאה דומה לזה של הראשי (42%). הרווח של 1% במרכז הוא תוצר טבעי
  // של ההקצאה — כל אחד תופס מראש פחות, ולא צריך "לקצוץ" gap בנפרד.
  // חל גם על שורות הזרם וגם על פס הכותרת. במצב 4 (אחד שורד לרוחב מלא)
  // אין מרווח כי אין שני זרמים סמוכים.
  const sideHalfRatio = (cfg.sideHalfRatio !== null && cfg.sideHalfRatio !== undefined)
    ? cfg.sideHalfRatio
    : 0.49;
  const sideHalfWidth = Math.floor(innerWidth * sideHalfRatio);
  const sideRightX = innerWidth - sideHalfWidth;

  const mainMetrics = new VilnaMetrics({
    fontFamily: cfg.mainFontFamily,
    fontSize: cfg.mainFontSize,
    lineHeightRatio: cfg.lineHeightRatio,
  });
  const sideMetrics = new VilnaMetrics({
    fontFamily: cfg.sideFontFamily,
    fontSize: cfg.sideFontSize,
    lineHeightRatio: streamLineHeightRatio,
  });

  // משה 2026-05-13: cache של VilnaMetrics לפי styleId. כשמשתמש מחיל סגנון אישי
  // על זרם צדדי (פונט/גודל שונה), המדידה ב-Canvas חייבת להתאים לפונט/גודל
  // החדשים — אחרת המנוע מחשב כמה מילים נכנסות לפי ברירת המחדל, ואז כשה-DOM
  // מצויר עם הפונט הגדול יותר, מילים נחתכות מחוץ ל-strip ונעלמות לראייה.
  // 
  // הפונקציה מקבלת styleId ומחזירה VilnaMetrics שמשקף את הסגנון בפועל
  // (fontFamily, fontSize, lineHeight, bold, italic). אם אין styleId או הסגנון
  // לא נמצא — מחזירה את sideMetrics הברירת-מחדל.
  const sideMetricsCache = new Map();

  function composeStreamTextStyle(streamId) {
    const settings = streamSettings[streamId] || {};
    const registryStyle = settings.styleId ? resolveTextStyle(settings.styleId) : null;
    const inlineStyle = settings.inlineStyle || settings.manualStyle || null;

    // styleId הוא בסיס; סגנון ידני מהעורך גובר עליו.
    // אין כאן הגדרת line-height גלובלית.
    return normalizeTextStyle({
      ...(registryStyle || {}),
      ...(inlineStyle || {}),
    });
  }

  function metricsFromTextStyle(style, fallbackMetrics) {
    const st = normalizeTextStyle(style);
    if (!st) return fallbackMetrics || sideMetrics;

    return new VilnaMetrics({
      fontFamily: st.fontFamily || cfg.sideFontFamily,
      fontSize: Number(st.fontSize) > 0 ? Number(st.fontSize) : cfg.sideFontSize,
      lineHeightRatio: Number(st.lineHeight) > 0 ? Number(st.lineHeight) : streamLineHeightRatio,
      fontWeight: st.bold ? "700" : "normal",
      fontStyle: st.italic ? "italic" : "normal",
    });
  }

  function getSideMetricsForStream(streamId) {
    const st = composeStreamTextStyle(streamId);
    const c = streamContextForV9(cfg,streamId,streamSettings[streamId]?.styleId || '',st);
    const m = new VilnaMetrics({fontFamily:c.typography.fontFamily,fontSize:c.fontSize,
      lineHeightRatio:c.lineHeight/c.fontSize,fontWeight:c.typography.fontWeight,fontStyle:c.typography.fontStyle});
    m._v9TextContext=c;return m;
  }

  function getSideMetricsForStyle(styleId) {
    if (!styleId) return sideMetrics;
    if (sideMetricsCache.has(styleId)) return sideMetricsCache.get(styleId);
    let style = null;
    try {
      style = resolveTextStyle(styleId);
    } catch (_) {
      style = null;
    }
    if (!style) {
      sideMetricsCache.set(styleId, sideMetrics);
      return sideMetrics;
    }
    // משלב את הסגנון עם ברירות-מחדל של הצד
    const metrics = new VilnaMetrics({
      fontFamily: style.fontFamily || cfg.sideFontFamily,
      fontSize: Number(style.fontSize) > 0 ? Number(style.fontSize) : cfg.sideFontSize,
      lineHeightRatio: Number(style.lineHeight) > 0 ? Number(style.lineHeight) : streamLineHeightRatio,
      fontWeight: style.bold ? '700' : 'normal',
      fontStyle: style.italic ? 'italic' : 'normal',
    });
    sideMetricsCache.set(styleId, metrics);
    return metrics;
  }

  const sideLineH = sideMetrics.lineHeight;
  const titleHeight = Math.ceil(cfg.sideFontSize * 1.8);

  const result = {
    pageBox: {
      width: cfg.pageWidth,
      height: cfg.pageHeight,
      padding: cfg.padding,
      innerWidth: innerWidth,
      innerHeight: cfg.pageHeight - 2 * cfg.padding - reservedTop - reservedBottom,
      sideHalfWidth: sideHalfWidth,
      sideRightX: sideRightX,
    },
    mainBox: null,
    streamBoxes: [],
    footerBoxes: [],
    titleHeight: titleHeight,
    crownScenario: null,
    overflow: { mainText: '', streams: {} },
  };

  // 1. Crown scenario — measured with the exact typography that will paint
  // each stream. The old decision used generic Canvas sideMetrics, while crown
  // height/final rows used per-stream DOM measurement; custom fonts/sizes could
  // therefore be classified "short" by one engine and painted "long" by another.
  const crownStream = (stream) => {
    if (!stream) return null;
    const rich = stream.rich ? normalizeRichTextEntry(stream.rich)
      : makeRichText((stream.items || []).join(' '), Array.isArray(stream.runs) ? stream.runs : []);
    // Metadata alone is not a stream of text. Preserve the no-stream decision
    // for empty inputs, without stripping actual source whitespace or controls.
    return rich.text ? { id: stream.id, rich } : null;
  };
  const hasMeasuredCrownRows = (stream, width, rows) => {
    if (!stream) return false;
    const metrics = getSideMetricsForStream(stream.id);
    return hasAtLeastV9Rows(stream.rich, metrics._v9TextContext, width, rows);
  };

  let scenario = chooseCrownScenario(
    { right: crownStream(pageContent.rightStream), left: crownStream(pageContent.leftStream) },
    { halfWidth: sideHalfWidth, fullWidth: innerWidth, crownLines: cfg.crownLines, hasMeasuredRows: hasMeasuredCrownRows }
  );

  // משה 2026-05-15: הכרעה פר-זרם — אם המשתמש בחר במפורש פריסה לזרם
  // (layoutRole), הבחירה דורסת את ה-scenario ההיסטורי שהמערכת בחרה
  // אוטומטית. הקונברסיה האוטומטית של one_long_split → one_short_no_crown
  // הוסרה (ממצא 2). אם משתמש לא בחר ב-UI — נשאר התנהגות אוטומטית.
  //
  // מיפוי תפקידים → תרחישים:
  //   "gemara"     → one_long_split (כתר 2 טורים — קיים)
  //   "mishna"     → one_short_no_crown (צד הראשי — קיים)
  //   "onkelos"    → one_short_no_crown (כרגע כמו mishna; מיקום ופונט יוטמע)
  //   "side_notes" → one_short_no_crown (כרגע כמו mishna; פונט קטן בעתיד)
  //
  // הגבלת תקפות: gemara ⊥ onkelos. אם שניהם מופיעים — gemara גובר וכן
  // נרשם בקונסול הערה.
  const rStream = pageContent.rightStream;
  const lStream = pageContent.leftStream;
  const cfgStreamSettings = cfg.streamSettings || {};
  const rRole = rStream && cfgStreamSettings[rStream.id]
    ? cfgStreamSettings[rStream.id].layoutRole
    : "";
  const lRole = lStream && cfgStreamSettings[lStream.id]
    ? cfgStreamSettings[lStream.id].layoutRole
    : "";
  if (rRole || lRole) {
    // ולידציה: gemara + onkelos בו-זמנית — gemara גובר
    const roles = [rRole, lRole].filter(Boolean);
    const hasGemara = roles.includes("gemara");
    const hasOnkelos = roles.includes("onkelos");
    if (hasGemara && hasOnkelos && typeof console !== "undefined") {
      console.warn(
        "[v9] gemara ו-onkelos לא יכולים להופיע יחד. gemara גובר. " +
          "שנה את הבחירה לאחד מהם."
      );
    }
    const dominantRole = hasGemara ? "gemara" : (roles[0] || "");
    if (dominantRole === "gemara") {
      // ודא שנשאר one_long_split אם יש מספיק חומר, אחרת no_crown
      if (scenario.name !== "one_long_split" && scenario.name !== "two_long_parallel") {
        // כפיית כתר (אם יש זרם יחיד שמתאים)
        if ((rStream && !lStream) || (lStream && !rStream)) {
          scenario = { name: "one_long_split", streamSide: rStream ? "right" : "left" };
        }
      }
    } else if (dominantRole === "mishna" || dominantRole === "onkelos" || dominantRole === "side_notes") {
      // צד הראשי בלי כתר. כל ה-3 משתמשים ב-one_short_no_crown לעת עתה.
      // TODO (משה ביקש): onkelos ו-side_notes צריכים את המיקום הספציפי
      // (פנימי/חיצוני/ימין/שמאל) שהמשתמש בחר ב-layoutPosition, ופונט
      // ברירת מחדל קטן יותר ל-side_notes. כרגע משתמשים בפריסת no_crown
      // הקיימת כסקפולדינג.
      if ((rStream && !lStream) || (lStream && !rStream)) {
        scenario = {
          name: "one_short_no_crown",
          streamSide: rStream ? "right" : "left",
          v9LayoutRole: dominantRole, // לזיהוי עתידי
        };
      }
    }
  }

  result.crownScenario = scenario;

  // 2. מיקום ראשי
  let crownHeight = 0;
  if (scenario.name === 'two_long_parallel' ||
      scenario.name === 'one_full_one_short' ||
      scenario.name === 'one_long_split') {
    const streams=(scenario.name === 'one_full_one_short'
      ? [scenario.longSide === 'right' ? pageContent.rightStream : pageContent.leftStream]
      : [pageContent.rightStream,pageContent.leftStream]).filter(Boolean);
    crownHeight = Math.max(0,...streams.map(stream=> {
      const metrics=getSideMetricsForStream(stream.id);
      const width=scenario.name==='one_full_one_short' ? innerWidth : sideHalfWidth;
      return measureV9CrownHeight(stream.rich || makeRichText(stream.items.join(' '),stream.runs || []),
        metrics._v9TextContext,width,cfg.crownLines);
    }));
  }

  // A same-stream split may begin its second column in different rich-text
  // typography. Replans reserve the measured minimum before ANY geometry is
  // allocated; the final column split is recomputed on this same reservation.
  if (scenario.name === 'one_long_split') {
    crownHeight = Math.max(crownHeight, Number(cfg.__v9SplitCrownMinimumPx) || 0);
  }

  // משה 2026-05-10: צורה 4 — הזרם הארוך מקבל כתר ברוחב מלא של הדף.
  // הצד הקצר מדלג על הכתר ומתחיל ישר מתחת לאזור הכתר.
  const fullCrownSide = (scenario.name === 'one_full_one_short')
    ? scenario.longSide
    : null;

  const sideTopY = cfg.padding + titleHeight + reservedTop;
  // Crown→main clearance is VERTICAL geometry and must never inherit an
  // explicitly configured horizontal main↔side gap. Historically, a direct
  // buildPagePlan() call without app settings used the engine's 1.5%-of-page
  // default main gap for both axes. Preserve that legacy DIRECT-ENGINE default
  // for compatibility, but let the web app pass the semantically correct
  // mainStreamGap as crownMainGapPx.
  const defaultCrownMainGap = Math.max(4, Math.floor(innerWidth * 0.015));
  const crownMainGap = crownHeight > 0
    ? (Number.isFinite(Number(cfg.crownMainGapPx))
        ? Math.max(0, Number(cfg.crownMainGapPx))
        : defaultCrownMainGap)
    : 0;

  // The main stream title is real page geometry, not a post-render overlay.
  // Reserve one title row in the plan so a visible main title cannot overlap
  // the bottom of the crown.
  const mainTitleText = shouldShowStreamTitle(V9_MAIN_STREAM_CODE)
    ? String((cfg.titles || {}).main || "").trim()
    : "";
  const mainTitleReserve = (mainTitleText && pageContent.mainText) ? titleHeight : 0;

  const mainTopY = sideTopY + crownHeight + crownMainGap + mainTitleReserve;
  result.crownBottomY = sideTopY+crownHeight;
  result.crownMainGap = crownMainGap;
  result.mainTitleReserve = mainTitleReserve;

  // 3. ראשי — ניבוי אורך נאיבי כדי לחשב את הצדדים. הפלייאוט הסופי ייעשה
  // אחרי שהצדדים נמדדו, כדי לאפשר לראשי להתפשט לתוך מקום של פרשן שנגמר
  // (בר־מצרא, מצב 2 בדינמיקת הגוף).
  let naiveMainHeight = 0;
  if (pageContent.mainText) {
    const naiveWidth = mainColumnCount > 1
      ? Math.max(1, (mainWidth - mainColumnGap) / mainColumnCount)
      : mainWidth;
    const naiveLines = mainMetrics.layoutLines(pageContent.mainText, naiveWidth);
    naiveMainHeight = naiveLines.length * mainMetrics.lineHeight;
  }

  const naiveMainBottomY = mainTopY + naiveMainHeight;
  let mainBottomY = naiveMainBottomY; // יעודכן אחרי בר־מצרא

  // משה 2026-05-10: צורה 1 — זרם אחד מפוצל לשני טורים מקבילים.
  // לוקחים את הזרם היחיד שזוהה כארוך וחותכים את הטקסט בערך באמצע (לפי מילים).
  // החצי הראשון לטור הימני, החצי השני לשמאלי. שניהם עם אותו id (אותו שם זרם,
  // אותו צבע). מתקבל דפוס וילנא הקלאסי של פירוש אחד בשני טורים.
  //
  // משה 2026-05-13: החיתוך עכשיו מבוסס על מבנה הרצועות האמיתי של הטור הימני,
  // לא על "חצי השורות" ברוחב קבוע. הטור הימני מורכב מ-3 רצועות באורכים שונים
  // (strip 1 רחב, strip 2 צר ליד הראשי, strip 3a רחב חזרה). חיתוך לפי רוחב
  // קבוע יצר חיתוך מוטעה וגרם לרווח גדול בתחתית הטור הימני וקפיצות בקריאה.
  // הקטע הוזז לכאן (אחרי הגדרת mainTopY/naiveMainBottomY) כי הוא צריך אותם.
  if (scenario.name === 'one_long_split') {
    const single = pageContent.rightStream || pageContent.leftStream;
    if (single) {
      const allText = single.items.join(' ').trim();
      
      // pageBottomY מקומי לחישוב (יוגדר בהמשך אבל אנחנו צריכים אותו עכשיו)
      const _pageBottomYForSplit = effectivePageBottom;
      
      // בניית רצועות הטור הימני לצורך חישוב חיתוך מדויק.
      // משקפת בדיוק את הרצועות שייווצרו ב-buildSideStream עבור side='right'.
      const rightStrips = [];
      // strip 1: אזור הכתר
      if (crownHeight > 0 && mainTopY > sideTopY) {
        rightStrips.push({
          width: sideHalfWidth,
          height: Math.min(mainTopY, _pageBottomYForSplit) - sideTopY,
        });
      }
      // strip 2: צמוד לראשי (רוחב מצומצם)
      if (naiveMainHeight > 0) {
        const strip2BottomY = Math.min(naiveMainBottomY, _pageBottomYForSplit);
        const strip2Width = Math.max(0, innerWidth - (mainX + mainWidth) - mainGap);
        if (strip2BottomY > mainTopY && strip2Width > 0) {
          rightStrips.push({
            width: strip2Width,
            height: strip2BottomY - mainTopY,
          });
        }
      }
      // strip 3a: מתחת לראשי (חזרה ל-sideHalfWidth) - רק עד תחתית הדף
      // בתרחיש 1 הימני לא מקבל strip3 מלא (זה לשמאלי), אז חצי-רוחב בלבד
      if (naiveMainBottomY < _pageBottomYForSplit) {
        rightStrips.push({
          width: sideHalfWidth,
          height: _pageBottomYForSplit - naiveMainBottomY,
        });
      }
      
      // משה 2026-05-13: בתרחיש 1, שני הצדדים הם **אותו זרם** (single.id),
      // אז ה-metrics זהה. משתמש ב-metrics של הסגנון האישי של הזרם הזה,
      // כדי שהמדידה בקנבס תתאים לפונט/גודל שיוצגו בפועל ב-DOM.
      const splitMetricsForStream = getSideMetricsForStream(single.id);
      
      let parts = splitWordsByStripsWithLineEdgeGuard(allText, splitMetricsForStream, rightStrips, {
        minLineEdgeFill: 0.82,
        halfWidth: sideHalfWidth,
        fullWidth: innerWidth,
      });
      // fallback אם הפונקציה החדשה לא הצליחה (רצועות לא תקינות וכו')
      if (!parts) {
        parts = splitWordsAtVisualLine(allText, splitMetricsForStream, sideHalfWidth);
      }

      // ★ משה 13/09/2026: בצורת וילנא שני צדי הפירוש נגמרים באותו גובה.
      // בונים את הרצועות של שני הצדדים במצב "שניהם פעילים עד התחתית" —
      // שזה בדיוק המצב שאליו אנחנו מכוונים — ומאזנים לפיו.
      if (cfg.balanceSingleStreamSides !== false) {
        const yStrips = (side) => {
          const out = [];
          if (crownHeight > 0 && mainTopY > sideTopY) {
            out.push({ y_start: sideTopY, y_end: Math.min(mainTopY, _pageBottomYForSplit),
              width: sideHalfWidth, x: side === 'right' ? sideRightX : 0 });
          }
          if (naiveMainHeight > 0 && Math.min(naiveMainBottomY, _pageBottomYForSplit) > mainTopY) {
            const w = side === 'right'
              ? Math.max(0, innerWidth - (mainX + mainWidth) - mainGap)
              : Math.max(0, mainX - mainGap);
            out.push({ y_start: mainTopY, y_end: Math.min(naiveMainBottomY, _pageBottomYForSplit),
              width: w, x: side === 'right' ? (mainX + mainWidth + mainGap) : 0 });
          }
          if (naiveMainBottomY < _pageBottomYForSplit) {
            out.push({ y_start: naiveMainBottomY, y_end: _pageBottomYForSplit,
              width: sideHalfWidth, x: side === 'right' ? sideRightX : 0 });
          }
          return out;
        };
        // המרת רצועות-האמת של הטור הימני (רוחב+גובה) לצורת y מצטבר,
        // כדי שאפשר יהיה למדוד בהן היכן נגמרות השורות בפועל.
        let yCursor = sideTopY;
        const realRightStrips = rightStrips.map((st) => {
          const y_start = yCursor;
          const y_end = yCursor + (st.height || 0);
          yCursor = y_end;
          return { y_start, y_end, width: st.width, x: sideRightX };
        });
        const balanced = balanceOneLongSplitByHeight(
          allText, splitMetricsForStream, yStrips('right'), yStrips('left'), _pageBottomYForSplit,
          { lineStrips: realRightStrips }
        );
        if (balanced) parts = balanced;
      }
      // משה 2026-05-15: בעבר השורות האלה דרסו את single.runs (סימני פונט/בולד
      // פר-מילה) — וכך הפלט הציג פונט ברירת-מחדל גם כשהמשתמש סימן פונט אחר
      // בעורך. עכשיו ה-runs נחתכים ל-2 חצאים לפי אופסטים ב-allText (כולל
      // leading-trim) ועוברים יחד עם ה-items החדשים.
      const [firstRich,secondRich] = splitV9StreamAtWordCount(
        single.rich || makeRichText(single.items.join(' '),single.runs || []),
        (parts.first.match(/\S+/gu)||[]).length);
      const firstRuns = firstRich.runs, secondRuns = secondRich.runs;
      pageContent.rightStream = {
        id: single.id,
        items: [firstRich.text],
        rich: firstRich,
        runs: firstRuns,
        syntheticContinuationAfter: true,
        originalStreamWasSplit: true,
        columnSplitLineEdgeGuard: parts._v9ColumnSplitLineEdgeGuard || null,
      };
      pageContent.leftStream  = {
        id: single.id,
        items: [secondRich.text],
        rich: secondRich,
        runs: secondRuns,
        syntheticContinuationFrom: 'right',
        originalStreamWasSplit: true,
      };
    }
  }

  // Validate the actual column starts, not the pre-split source prefix. This
  // check runs before paint and preserves the original rich text and anchors.
  // A later carry from column A can change column B's start, so that input is
  // checked again below. Increasing the reservation is monotonic and bounded.
  function replanSplitCrown(columnInputs) {
    if (scenario.name !== 'one_long_split' || !(crownHeight > 0) || !(naiveMainHeight > 0)) return null;
    const required = Math.max(crownHeight, ...columnInputs.filter(Boolean).map(stream => {
      const rich = stream.rich || makeRichText(stream.items.join(' '), stream.runs || []);
      return measureV9CrownHeight(rich, getSideMetricsForStream(stream.id)._v9TextContext,
        sideHalfWidth, cfg.crownLines);
    }));
    if (required <= crownHeight + 1 / 64) return null;
    const pass = Math.max(0, Math.floor(Number(cfg.__v9SplitCrownPass) || 0));
    if (pass >= 8) throw new Error('V9_SPLIT_CROWN_DID_NOT_CONVERGE: no incomplete crown was published');
    return buildPagePlanCore(unsplitPageContent, {
      ...cfg, __v9SplitCrownMinimumPx: required, __v9SplitCrownPass: pass + 1,
    });
  }
  const splitCrownReplan = replanSplitCrown([pageContent.rightStream, pageContent.leftStream]);
  if (splitCrownReplan) return splitCrownReplan;
  if (scenario.name === 'one_long_split') result.splitCrownSizing = {
    passes: Number(cfg.__v9SplitCrownPass) || 0, reservedHeight: crownHeight,
  };

  // 4. זרמים צדיים
  // משה 2026-05-08: עכשיו מקבלת mainBottomY ו-otherSideEnded כפרמטרים,
  // כדי שאחרי בר־מצרא של הראשי נוכל לחשב את הצדדים מחדש עם:
  //   - mainBottomY עדכני (אם הראשי התקצר, strip 3 של הצד מתחיל גבוה יותר)
  //   - otherSideEnded — מצב 4: אם הצד השני נגמר ב-strips 1+2, הצד השורד
  //     מקבל רוחב מלא ב-strip 3 (במקום halfWidth).
  // משה 2026-05-08 (תיקון): כל y_start/y_end חסומים ב-pageBottom. אם
  // naiveMainBottomY ענק (כי הראשי הנאיבי דחוס), strip 2 חסום ב-pageBottom
  // ו-strip 3 לא נוצר (אין מקום).
  const pageBottomY = effectivePageBottom;
  // A short stream below a full-width crown joins an EXISTING row grid.
  // Its title/crown clearance used to start an independent grid, so equal-pitch
  // streams widened at different Ys. Measure eligibility with the same planner;
  // never force unequal or rich variable-height rows onto a guessed base pitch.
  let sharedUniformSidePitch;
  function uniformSidePitch() {
    if (sharedUniformSidePitch !== undefined) return sharedUniformSidePitch;
    sharedUniformSidePitch = 0;
    if (scenario.name !== 'one_full_one_short') return 0;
    const pitches = [pageContent.rightStream, pageContent.leftStream].map(stream => {
      if (!stream) return 0;
      const context = getSideMetricsForStream(stream.id)._v9TextContext;
      const rich = stream.rich || makeRichText(stream.items.join(' '), stream.runs || []);
      const probe = flowV9MeasuredStream(rich, [{x:0, width:Number.MAX_SAFE_INTEGER,
        y_start:0, y_end:Number.MAX_SAFE_INTEGER}], context, Number.MAX_SAFE_INTEGER);
      return !probe.overflowText && probe.lines.length && probe.lines.every(line =>
        Math.abs(line.lineHeightPx - context.lineHeight) < 1e-6) ? context.lineHeight : 0;
    });
    if (pitches.every(p => p > 0) && Math.abs(pitches[0] - pitches[1]) < 1e-6) {
      sharedUniformSidePitch = pitches[0];
    }
    return sharedUniformSidePitch;
  }
  function buildSideStream(streamData, side, opts) {
    if (!streamData) return null;
    const streamRich = streamData.rich
      ? normalizeRichTextEntry(streamData.rich)
      : makeRichText(streamData.items.join(' '), Array.isArray(streamData.runs) ? streamData.runs : []);
    const text = streamRich.text;
    if (!text) return null;
    const o = opts || {};

    // Resolve this stream's real typography BEFORE creating geometry. Manual
    // Page Tweaker note shifts are measured in rows of THIS stream, never in
    // main-text rows or a hard-coded 14pt desktop approximation.
    const streamStyleId = streamSettings[streamData.id]?.styleId || "";
    const streamResolvedStyle = composeStreamTextStyle(streamData.id);
    const streamMetrics = getSideMetricsForStream(streamData.id);
    streamMetrics._v9ContinuesAfter = !!streamData.syntheticContinuationAfter;
    const streamFontSize = Number(streamResolvedStyle?.fontSize) > 0
      ? Number(streamResolvedStyle.fontSize)
      : streamMetrics.fontSize;
    const streamLineH = Math.max(streamMetrics.lineHeight, streamFontSize * 1.35);
    const manualShift = resolveV9StreamShiftBottom(
      cfg.__v9PageConstraint,
      streamData.id,
      {
        pageBottom: pageBottomY,
        lineHeight: streamMetrics.lineHeight,
        minTop: sideTopY,
      }
    );
    const streamPageBottomY = Number.isFinite(cfg.__v9FooterReservedSideBottom)
      ? Math.min(manualShift.bottom, Math.max(sideTopY, cfg.__v9FooterReservedSideBottom))
      : manualShift.bottom;

    const rawMainBottomY = (o.mainBottomY !== undefined) ? o.mainBottomY : naiveMainBottomY;
    const effectiveMainBottomY = Math.min(rawMainBottomY, streamPageBottomY);
    // משה 2026-05-08: otherSideEndY הוא ה-y שבו הצד השני נגמר (מ-pass 1).
    // אם null/undefined — מתייחסים כאל "אין צד שני" → mainTopY (כל strip 3 בעצם
    // יקבל רוחב מלא). אם >= pageBottom — הצד השני ממשיך עד תחתית הדף → רק halfWidth.
    // בין לבין — נפצל את strip 3 לשניים: halfWidth עד otherEndY, fullWidth אחריו.
    const rawOtherEndY = (o.otherSideEndY !== undefined && o.otherSideEndY !== null)
      ? o.otherSideEndY
      : mainTopY;
    const otherEndY = Math.max(effectiveMainBottomY, Math.min(rawOtherEndY, streamPageBottomY));

    const strips = [];
    let bodyStartGrid;
    // Each column retains the requested number of wide crown rows. A taller
    // opposite prefix reserves more shared clearance for main, not a fifth
    // wide crown row in this column. The body continues on its existing grid.
    const streamCrownHeight = scenario.name === 'one_long_split' && naiveMainHeight > 0
      ? measureV9CrownHeight(streamRich, streamMetrics._v9TextContext, sideHalfWidth, cfg.crownLines)
      : crownHeight;

    if (crownHeight > 0 && mainTopY > sideTopY) {
      // משה 2026-05-10: צורה 4 — צד הארוך מקבל crown ברוחב מלא, השני מדלג על crown.
      if (fullCrownSide === side) {
        strips.push({
          y_start: sideTopY,
          y_end: Math.min(sideTopY + streamCrownHeight, streamPageBottomY),
          width: innerWidth,
          x: 0,
        });
      } else if (fullCrownSide && fullCrownSide !== side) {
        // הצד הקצר — מדלג על crown לגמרי, יתחיל מתחת לכתר
      } else {
        // משה 2026-05-08: כל צד 49.5% מראש (sideHalfWidth). מרווח 1% במרכז.
        strips.push({
          y_start: sideTopY,
          y_end: Math.min(sideTopY + streamCrownHeight, streamPageBottomY),
          width: sideHalfWidth,
          x: side === 'right' ? sideRightX : 0,
        });
      }
    }

    if (naiveMainHeight > 0 && effectiveMainBottomY > mainTopY) {
      // משה 2026-05-10: צורה 4 — צד הקצר מדלג על הכתר וצריך מקום לכותרת
      // משלו מתחת לכתר. לכן strip 2 שלו מתחיל ב-mainTopY + titleHeight.
      const underFullCrown = fullCrownSide && fullCrownSide !== side;
      const shortStreamGap = underFullCrown && shouldShowStreamTitle(streamData.id) && (cfg.titles || {})[streamData.id] ? titleHeight : 0;
      const stripTop = underFullCrown ? mainTopY + shortStreamGap : sideTopY + streamCrownHeight;
      // משה 2026-05-08: מרווח mainGap בין הראשי לטור הצד.
      if (side === 'right') {
        strips.push({
          y_start: stripTop,
          y_end: effectiveMainBottomY,
          width: Math.max(0, innerWidth - (mainX + mainWidth) - mainGap),
          x: mainX + mainWidth + mainGap,
          // Crown→body changes the available WIDTH, not the stream's vertical
          // baseline grid. crownHeight is shared between both side streams and
          // can come from the OTHER stream's larger pitch. Locking this raw Y
          // therefore creates an artificial blank row in the smaller-pitch
          // stream. Let rowGeometry intersect both regions for the one row that
          // straddles the boundary; the following row naturally uses body width.
          lockYStart: false,
        });
      } else {
        strips.push({
          y_start: stripTop,
          y_end: effectiveMainBottomY,
          width: Math.max(0, mainX - mainGap),
          x: 0,
          // Crown→body changes the available WIDTH, not the stream's vertical
          // baseline grid. crownHeight is shared between both side streams and
          // can come from the OTHER stream's larger pitch. Locking this raw Y
          // therefore creates an artificial blank row in the smaller-pitch
          // stream. Let rowGeometry intersect both regions for the one row that
          // straddles the boundary; the following row naturally uses body width.
          lockYStart: false,
        });
      }
    }

    // Strip 3 — שני סגמנטים אפשריים מתחת לראשי:
    //   3a (halfWidth, x צד) מ-effectiveMainBottomY עד otherEndY: שני הצדדים פעילים
    //   3b (innerWidth, x=0) מ-otherEndY עד pageBottomY: הצד השני כבר נגמר → השורד
    //                                                     לוקח את כל הרוחב
    // אם otherEndY <= effectiveMainBottomY: רק 3b (הצד השני נגמר ב-strips 1+2)
    // אם otherEndY >= pageBottomY: רק 3a (הצד השני מגיע עד תחתית הדף)
    const maxFullStrip3Lines = Number(o.maxFullStrip3Lines) > 0
      ? Math.max(1, Math.floor(Number(o.maxFullStrip3Lines)))
      : 0;
    const fullStrip3LineHeight = Math.max(0, getSideMetricsForStream(streamData.id)?.lineHeight || sideLineH);
    const fullStrip3StartY = (maxFullStrip3Lines > 0 && fullStrip3LineHeight > 0)
      ? Math.max(otherEndY, streamPageBottomY - fullStrip3LineHeight * maxFullStrip3Lines)
      : otherEndY;

    if (effectiveMainBottomY < fullStrip3StartY) {
      strips.push({
        y_start: effectiveMainBottomY,
        y_end: fullStrip3StartY,
        width: sideHalfWidth,
        x: side === 'right' ? sideRightX : 0,
        // v9-knee-row-grid: width changes do not create a new vertical grid.
        // A commentary row that crosses this Y stays narrow; the NEXT normal
        // row may widen. This avoids blank slots when main/crown spacing is not
        // an exact multiple of the commentary line pitch.
        lockYStart: false,
      });
    }
    // v9-limit-full-strip3-one-line: full-width continuation is still legal after the other side
    // really ends. The one-line cap is reserved only for same-stream split
    // bridge/orphan cases; distinct streams keep the full lower area.
    const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (fullStrip3StartY < streamPageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: fullStrip3StartY,
        y_end: streamPageBottomY,
        width: innerWidth,
        x: 0,
        // v9-knee-row-grid: ending of the other side changes WIDTH only.
        // Never manufacture a new baseline at its raw endY.
        lockYStart: false,
      });
    }

    const flow = () => flowStreamThroughStrips(
      streamRich,
      strips.map(s => ({
        x: s.x,
        y_start: s.y_start,
        y_end: s.y_end,
        width: s.width,
        lockYStart: s.lockYStart === true,
      })),
      streamMetrics,
      streamPageBottomY
    );
    let flowResult = flow();
    if (fullCrownSide && fullCrownSide !== side && rawOtherEndY > rawMainBottomY) {
      const first = flowResult.lines[0];
      const knee = first && flowResult.lines.find(line => line.y >= effectiveMainBottomY - 1 / 64 &&
        line.width > first.width + 1 / 64);
      const pitch = knee ? uniformSidePitch() : 0;
      if (pitch > 0 && first.y < effectiveMainBottomY && strips[0]?.y_start === first.y) {
        const requiredTop = strips[0].y_start;
        const alignedTop = sideTopY + Math.ceil((requiredTop - sideTopY) / pitch - V9_LINE_FIT_EPSILON) * pitch;
        // Keep title clearance, measured leading and at least one narrow row.
        // Only the short stream's initial allocation changes, before paint.
        if (alignedTop < effectiveMainBottomY - 1 / 64 && alignedTop > requiredTop + 1 / 64) {
          bodyStartGrid = {anchor:sideTopY, pitch, requiredTop, alignedTop};
          strips[0] = {...strips[0], y_start:alignedTop};
          flowResult = flow();
        }
      }
    }

    const lines = [];
    for (const line of flowResult.lines) {
      const strip = strips.find(s => line.y >= s.y_start - 0.1 && line.y < s.y_end - 0.1);
      if (!strip) continue;
      lines.push({
        _v9MeasuredStream: line._v9MeasuredStream,
        render: line.render,
        x: line._v9MeasuredStream ? line.x : strip.x,
        y: line.y,
        width: line._v9MeasuredStream ? line.width : strip.width,
        words: line.words,
        text: line.text,
        isLast: line.isLast,
        forcedBreak: line.forcedBreak,
        naturalWidth: line.naturalWidth,
        fontSize: streamFontSize,
        lineHeightPx: line._v9MeasuredStream ? line.lineHeightPx : streamLineH,
        runs: line.runs || [],
        wordTokens: line.wordTokens || [],
        mainRefs: line.mainRefs || [],
      });
    }

    // 2026-05-17: ה-flow החדש כבר מחשב line.runs לפי offsets מקוריים.
    // לא מריצים attachRunsToLines כאן כדי לא לשחזר לפי indexOf ולאבד כפילויות/overflow.
    for (const line of lines) {
      if (!Array.isArray(line.runs)) line.runs = [];
    }

    return {
      id: streamData.id,
      role: side,
      side: side,
      styleId: streamStyleId,
      inlineStyle: streamResolvedStyle || {},
      titleStyleId: streamSettings[streamData.id]?.titleStyleId || "",
      strips: strips,
      lines: lines,
      endY: flowResult.endY,
      overflowText: flowResult.overflowText,
      overflowRuns: flowResult.overflowRuns || [],
      overflowRich: flowResult.overflowRich || makeRichText(flowResult.overflowText || "", flowResult.overflowRuns || []),
      columnSplitLineEdgeGuard: streamData.columnSplitLineEdgeGuard || null,
      manualFootnoteShiftLines: manualShift.shiftLines,
      manualFootnoteShiftReservedPx: manualShift.reservedPx,
      streamPageBottomY,
      ...(bodyStartGrid ? {bodyStartGrid} : {}),
      syntheticContinuationAfter: !!streamData.syntheticContinuationAfter,
      syntheticContinuationFrom: streamData.syntheticContinuationFrom || "",
      originalStreamWasSplit: !!streamData.originalStreamWasSplit,
      continues: !!flowResult.overflowText || !!streamData.syntheticContinuationAfter,
    };
  }

  // Pass 1: צדדים נאיביים (mainBottomY = naiveMainBottomY, otherSideEnded=false).
  // הם משמשים לחישוב ה-bar-mitzra של הראשי בלבד.
  let pass1Right = null;
  let pass1Left = null;
  if (pageContent.rightStream) {
    pass1Right = buildSideStream(pageContent.rightStream, 'right');
  }
  if (pageContent.leftStream) {
    pass1Left = buildSideStream(pageContent.leftStream, 'left');
  }

  // ⛔⛔⛔⛔ משה 28–29/09/2026 — השינוי המבני, באישורו המפורש:
  // „מאשר שתשנה כל מה שצריך בשביל לפתור את הבעיות... כל דבר שאתה
  //  רואה צריך בניה מחדש תבנה בלי היסוס".
  //
  // ═══ מה שכלי המדידה החדש מצא ═══
  // `measure_strips_vs_streams_v1.0.mjs` מודד את הרצועות של הראשי מול
  // המיקום האמיתי של הזרמים. הוא הראה:
  //     רצועת ראשי  116 → 318  (רוחב 202), מ-y=31
  //     זרם הביאור  273 → 369,  מ-y=31 עד y=46.5
  //     ⇒ חפיפה של 45 פיקסלים
  // הרצועה הרחבה מתחילה **בדיוק כשהזרם מתחיל**.
  //
  // ═══ השורש ═══
  // יש כאן תלות מעגלית: הראשי צריך לדעת איפה הזרמים נגמרים, והזרמים
  // צריכים לדעת איפה הראשי נגמר. הפתרון הקיים הוא שני מעברים —
  // ולזרמים אף שלוש איטרציות של המעבר השני.
  //
  // אבל **הראשי נבנה רק פעם אחת**, לפי המעבר הראשון. המעבר השני של
  // הזרמים נבנה עם גבול אחר ויכול לצאת ארוך יותר — ואז הראשי כבר
  // תפס שטח שהזרם יתפוס בפועל. מכאן „טקסט בפירוש באמצע הטקסט הראשי".
  //
  // כמו שני פועלים שמחלקים חדר: הראשון מודד לפי איפה שהשני עמד
  // בהתחלה, והשני זז אחר כך — ואיש לא חוזר למדוד מחדש.
  //
  // ═══ התיקון ═══
  // בניית הראשי הוצאה לפונקציה, והיא נקראת **פעמיים**: פעם לפי המעבר
  // הראשון (כדי לתת לזרמים את הגבול שלהם), ופעם שנייה אחרי שהזרמים
  // התייצבו — בדיוק כמו שהזרמים עצמם נבנים שוב.
  // ⬛ זה „V9 ירוץ מחדש" שמשה דרש, והכול בתכנון.
  let runMainPass = null;

  // 4.5 ראשי — בר־מצרא: זורם דרך strips לפי endY של הצדדים.
  // אם פרשן נגמר באמצע (endY < naiveMainBottomY), הראשי מתפשט לתוך שטחו.
  // ★ הפונקציה מקבלת את שתי קופסאות הצד שלפיהן לחשב. במעבר הראשון
  // אלה pass1, ובמעבר השני — pass2, אחרי שהזרמים התייצבו.
  runMainPass = function runMainPass(sideRight, sideLeft) {
    const pass1Right = sideRight;
    const pass1Left = sideLeft;
    // אם אין צד בכלל — endY = mainTopY (פנוי מההתחלה).
    // אם צד קיים אבל endY עבר את naiveMainBottomY — נחשב Infinity (חוסם הכול).
    // ⛔⛔⛔ משה 28/09/2026 — „בעמוד ח' פתאום יש טקסט בפירוש באמצע
    // הטקסט הראשי, ואז הטקסט הראשי ממשיך אותו ואז שוב הפירוש",
    // ו„חפיפה של טקסטים של הטקסט הראשי על הטקסט של הזרם הכי תחתון".
    //
    // ═══ נמדד (שרת חי, 12 דפים) ═══
    //   זוגות שורות חופפות                     51
    //   מהן **בין הראשי לביאור**               25   <-- חצי מהבעיה
    //   מהן בתוך אותה קופסה                    26
    //
    // ═══ השורש, והוא בתכנון ולא בציור ═══
    // יש כאן כלל „בר מצרא": כשפרשן נגמר באמצע העמוד, הטקסט הראשי
    // מתפשט לתוך השטח שהתפנה. נקודת ההתפשטות היא ה-y שבו הפרשן
    // „נגמר" — אבל זה המיקום של השורה בלבד, **בלי הדיו שחורג ממנה**:
    // ניקוד יורד מתחת לשורה, וגליפים גבוהים חורגים אף הם.
    //
    // ⇒ הראשי התחיל בדיוק בגובה שבו הדיו של הפרשן עדיין נמצא, ושני
    //   הטקסטים נחתו זה על זה. בדיוק „טקסט בפירוש באמצע הטקסט הראשי".
    //
    // כמו לבנות קיר בדיוק בקו הגבול, ואז לגלות שגג השכן בולט מעליו.
    //
    // ═══ התיקון ═══
    // מרווח ביטחון אנכי קטן לפני שהראשי נכנס לשטח שהתפנה — שליש
    // מגובה שורה של הזרם. מספיק לניקוד ולגליף, וזניח מבחינת שטח.
    // ⬛ הכול בתכנון: `buildMainStrips` מקבל את הגבול המתוקן, ולכן
    //    V9 מחשב את כל העמוד לפיו. אין כאן שום הזזה אחרי מעשה.
    const sideLineH = Number(sideMetrics?.lineHeight) > 0
      ? Number(sideMetrics.lineHeight)
      : 0;
    // ⛔ נמדד ונפסל: הגדלת המרווח כאן **לא הורידה ולו חפיפה אחת**
    // (25 לפני, 25 אחרי, ללא שינוי בכלל), והיא דווקא הגדילה את
    // החפיפות בתוך הראשי עצמו מ-13 ל-16. כלומר החפיפה בין הראשי לזרם
    // אינה בגבול ההתפשטות. המרווח מוחזר לאפס, וההסבר למעלה נשמר כתיעוד
    // של מה שנבדק ונשלל.
    const inkSafetyY = 0;

    // ⛔⛔⛔ משה 28/09/2026 — „בעמוד ח' פתאום יש טקסט בפירוש באמצע
    // הטקסט הראשי", „חפיפה של הטקסט הראשי על הזרם הכי תחתון".
    //
    // ═══ מה שנמדד בדיוק (שרת חי, 12 דפים) ═══
    //   זוגות חופפים                           51
    //   מהן בין הראשי לביאור                   25
    //   דוגמה: שורת ראשי  116→318
    //          שורת ביאור 273→369, באותו גובה
    //          ⇒ חפיפה אופקית של 45 פיקסלים
    //
    // ═══ השורש ═══
    // יש כלל „בר מצרא": כשפרשן נגמר באמצע העמוד, הראשי מתפשט לרוחב
    // מלא לתוך השטח שהתפנה. נקודת ההתפשטות נלקחה מ-`endY` — ערך
    // שהזרימה **מדווחת**. אבל הערך המדווח אינו תמיד זהה למקום שבו
    // השורה האחרונה של הזרם באמת יושבת.
    //
    // ⇒ הראשי התפשט מוקדם מדי, בזמן שהזרם עוד תופס את השטח.
    //
    // ═══ התיקון ═══
    // הגבול נלקח מעכשיו מ**מיקום השורות עצמן** — התחתית האמיתית של
    // השורה הנמוכה ביותר — ולא מערך מדווח. אם הערך המדווח גדול יותר,
    // לוקחים אותו; תמיד הגדול מבין השניים, כדי לא להתפשט מוקדם.
    //
    // ⬛ הכול בתכנון: `buildMainStrips` מקבל את הגבול המתוקן, ולכן V9
    //    מחשב את כל העמוד לפיו. אין כאן שום הזזה אחרי מעשה.
    const realEndY = (box) => {
      if (!box) return null;
      const reported = Number(box.endY);
      let low = Number.isFinite(reported) ? reported : -Infinity;
      for (const l of (box.lines || [])) {
        const y = Number(l?.y);
        const h = Number(l?.lineHeightPx) > 0 ? Number(l.lineHeightPx) : 0;
        if (Number.isFinite(y)) {
          const bottom = y + (h > 0 ? h : 0);
          if (bottom > low) low = bottom;
        }
      }
      return Number.isFinite(low) ? low : reported;
    };

    // ⛔⛔⛔⛔ משה 29/09/2026 — השורש הסופי, שנמצא רק אחרי שחשפתי את
    // הרצועות עצמן למדידה.
    //
    // ═══ מה שנמדד ═══
    //   רצועת הראשי:  13 → 369  (רוחב מלא, 356)
    //                 מגובה 30 עד 525 — כלומר **כל העמוד**
    //   זרם 02:       13 → 369, מגובה 134 עד 150
    //   ⇒ חפיפה מלאה: הזרם יושב בתוך רצועת הראשי
    //
    // ═══ הסיבה ═══
    // הראשי מחשב את ההתפשטות שלו מול **שני זרמי הצד בלבד**
    // (rightStream / leftStream). כשאין כאלה, הוא מניח שכל העמוד פנוי
    // ובונה רצועה ברוחב מלא לכל גובה הדף — גם כשיש זרמים אחרים
    // שיושבים שם בפועל.
    //
    // כמו לפרוס שולחן על כל החדר אחרי שבדקת רק את שני הקירות הצדדיים,
    // בלי לראות את הרהיטים שבאמצע.
    //
    // ═══ התיקון ═══
    // הגבול נלקח מ**כל** הקופסאות שכבר נבנו ושחופפות את הראשי אופקית,
    // ולא משתיים בלבד. במעבר הראשון זה בדרך כלל ריק; במעבר השני —
    // שרץ אחרי שכל הזרמים התייצבו — זה התמונה המלאה.
    const otherBoxesBottom = (() => {
      let low = -Infinity;
      // ★ גם ה-footers נספרים. הם נבנים אחרי הראשי, ולכן במעבר הראשון
      // הרשימה ריקה — אבל במעבר האחרון היא מלאה, וזה בדיוק מה שמונע
      // מהראשי להתפשט לשטח שלהם.
      for (const b of [...(result.streamBoxes || []), ...(result.footerBoxes || [])]) {
        if (!b || b === pass1Right || b === pass1Left) continue;

        // ⚠️ ל-footer אין שדות x/width — הם קיימים רק על זרמי צד.
        // לכן התחום האופקי נלקח מהשורות עצמן. בלי זה הבדיקה נכשלה
        // בשקט וכל ה-footers נראו כאילו אינם מפריעים לראשי.
        let bx = Number(b.x), bw = Number(b.width);
        if (!Number.isFinite(bx) || !Number.isFinite(bw) || bw <= 0) {
          let lo = Infinity, hi = -Infinity;
          for (const l of (b.lines || [])) {
            const lx = Number(l?.x), lw = Number(l?.width);
            if (!Number.isFinite(lx) || !Number.isFinite(lw)) continue;
            if (lx < lo) lo = lx;
            if (lx + lw > hi) hi = lx + lw;
          }
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
          bx = lo; bw = hi - lo;
        }

        // רק קופסאות שחופפות את הראשי אופקית — אחרת הן לא מפריעות לו.
        const xo = Math.min(mainX + mainWidth, bx + bw) - Math.max(mainX, bx);
        if (xo <= 1) continue;
        const bottom = realEndY(b);
        if (Number.isFinite(bottom) && bottom > low) low = bottom;
      }
      return low;
    })();

    // ⛔ נמדד ונפסל: להשתמש ב-`otherBoxesBottom` כגבול **יחיד** להתפשטות.
    // התוצאה הייתה החמרה חדה — 44 ⟵ 68 חפיפות. הסיבה ברורה בדיעבד:
    // footer יושב בתחתית העמוד, ולכן גבול יחיד שנגזר ממנו מונע מהראשי
    // להתפשט גם באמצע העמוד, שם השטח פנוי לגמרי. הגבול חייב להיות
    // **פר-טווח אנכי**, ולא מספר אחד. ראה carveStripsAroundBoxes למטה.
    void otherBoxesBottom;

    const rawRight = pass1Right ? realEndY(pass1Right) + inkSafetyY : mainTopY;
    const rawLeft  = pass1Left  ? realEndY(pass1Left)  + inkSafetyY : mainTopY;
    const rightEnd = (rawRight >= naiveMainBottomY - 0.5) ? Infinity : rawRight;
    const leftEnd  = (rawLeft  >= naiveMainBottomY - 0.5) ? Infinity : rawLeft;

    const rawMainStrips = buildMainStrips({
      mainTopY,
      mainX,
      mainWidth,
      mainGap,
      innerWidth,
      rightEndY: rightEnd,
      leftEndY:  leftEnd,
      pageBottom: effectivePageBottom,
    });

    // ⭐ „כאילו היתה פה תמונה — הטקסט הולך הצידה".
    // הרצועות נחתכות סביב כל קופסה תפוסה בעמוד, בכל גובה בנפרד.
    // במעבר הראשון הרשימה כמעט ריקה; במעבר האחרון — אחרי שהזרמים
    // וה-footers כבר בנויים — זו התמונה המלאה, וזה מה שמונע את
    // „טקסט בפירוש באמצע הטקסט הראשי".
    //
    // ⭐⭐⭐ משה 29/09/2026 — „למה יש חריגים היוצאים מן הכלל שלא מבינים
    // שכל זרם הוא כמו תמונה שצריך לגלוש סביבה".
    //
    // ═══ מה שהיה, ולמה זה היה שגוי ═══
    // שני זרמי הכתר (הזרמים שנבנים **לפני** הראשי, מימין ומשמאל)
    // היו **מוחרגים** מרשימת „מה תפוס בעמוד". ההנחה הייתה שהמנוע
    // כבר יודע עליהם מהגובה שבו הם נגמרים (rightEnd / leftEnd).
    //
    // ⬛ נמדד, וההנחה קרסה: ב-149 עמודים מתוך 170 הגובה הזה חזר
    //    **ריק** — ואז המנוע פרס לטקסט הראשי רצועה ברוחב 149
    //    בדיוק במקום שבו שני הזרמים כבר יושבים. 264 שורות ראשי
    //    נחתו על הזרם הימני.
    //
    // ═══ הדימוי ═══
    // זה כמו לומר „אני יודע איפה הארון נגמר, אז אין צורך למדוד
    // אותו" — וכשמסתבר שאף אחד לא רשם איפה הוא נגמר, פשוט פורסים
    // את השטיח דרכו.
    //
    // ⇒ אין יותר חריגים. **כל** זרם בעמוד הוא „תמונה" שהראשי גולש
    //   סביבה. אם הגובה כבר נלקח בחשבון, החיתוך לא משנה כלום
    //   (הוא מסיר רק שטח שבאמת תפוס); ואם לא — הוא מציל את העמוד.
    const occupiedBoxes = [
      pass1Right,
      pass1Left,
      ...(result.streamBoxes || []),
      ...(result.footerBoxes || []),
    ].filter((b, i, arr) => b && Array.isArray(b.lines) && b.lines.length
      && arr.indexOf(b) === i);

    // ⭐⭐⭐ משה 29/09/2026 — „הכותרת של הזרם אבד והוסתר".
    //
    // ═══ מה שהיה ═══
    // שם הזרם מצויר מעל השורה הראשונה שלו, אבל התכנון לא ידע על כך
    // דבר: לקופסה של זרם צד לא היה שום שדה שאומר „יש מעליי שלט
    // בגובה 20 פיקסלים". רק ל-footers היה. לכן החיתוך „כמו סביב
    // תמונה" עקף את הטקסט של הזרם — ועבר בדיוק דרך השלט שמעליו.
    //
    // ⬛ נמדד: 16 כותרות מתוך 561 נדרסו.
    //
    // ═══ התיקון ═══
    // רושמים את רצועת הכותרת על הקופסה עצמה, באותו חישוב בדיוק
    // שהציור עושה — וכך יש **מקור אמת אחד**. משם החיתוך כבר יודע
    // לעקוף גם אותה.
    for (const b of occupiedBoxes) {
      if (!b || !Array.isArray(b.lines) || !b.lines.length) continue;
      if (Number(b.titleHeight) > 0 && Number.isFinite(Number(b.titleY))) continue; // footer — כבר רשום
      const label = shouldShowStreamTitle(b.id) ? (cfg.titles || {})[b.id] : "";
      if (!label) continue;
      const firstLine = b.lines[0];
      b.titleHeight = titleHeight;
      if (b.fullWidthTitle) {
        b.titleY = cfg.padding;
        b.titleX = 0;
        b.titleWidth = innerWidth;
      } else {
        b.titleY = Number(firstLine.y) - titleHeight;
        b.titleX = Number(firstLine.x);
        b.titleWidth = Number(firstLine.width);
      }
    }
    // מצב חירום: הטקסט הזה כבר נדחה שלוש פעמים ואין לו מקום פנוי
    // בשום עמוד. משה: „חייבים שאם משהו עולה שלפחות במקרה חירום
    // תהיה חפיפה בלי מחיקה". לכן כאן מוותרים על הגלישה — הטקסט
    // ייצא, גם אם הוא יעלה על משהו.
    const mainStrips = rawMainStrips;

    const mainFlow = flowMainParagraphsThroughStrips(
      pageContent,
      mainStrips,
      mainMetrics,
      cfg,
      effectivePageBottom
    );

    const mainLines = [];
    for (const line of mainFlow.lines) {
      if (line.layoutVersion === V9_INLINE_PLAN_VERSION) {
        // Already finalized, including source ranges and opening placement.
        mainLines.push(line);
        continue;
      }
      const strip = mainStrips.find(s =>
        line.y >= s.y_start - 0.1 && line.y < s.y_end - 0.1);
      if (!strip) continue;
      // Final V9 opening-word guard:
      // flowMainParagraphsThroughStrips already carries the analytically measured
      // line.width. Window lines have reduced width; the opening-word host line
      // is restored to full width before this point. Using strip.width here erases
      // the measured window during DOM render.
      const renderWidth = Number(line.width) > 0 ? line.width : strip.width;
      mainLines.push({
        x: strip.x,
        y: line.y,
        width: renderWidth,
        words: line.words,
        text: line.text,
        isLast: line.isLast,
        forcedBreak: line.forcedBreak,
        naturalWidth: line.naturalWidth,
        fontSize: cfg.mainFontSize,
        lineHeightPx: mainMetrics.lineHeight,
        openingWord: line.openingWord || null,
        openingHostFullWidth: line.openingHostFullWidth || null,
        // הרוחב הצר שבו תוכנן הטקסט לצד האות — הוא שמאפשר לדעת
        // אילו שתי שורות באמת שייכות לאותו חלון גלישה.
        openingNarrowWidth: line.openingNarrowWidth || null,
        openingWindow: !!line.openingWindow,
        runs: line.runs || [],
        wordTokens: line.wordTokens || [],
        mainRefs: line.mainRefs || [],
      });
    }
    const opwDebug = mainFlow.debug || null;
    debugV9OpeningWord({
      paragraphIndex: opwDebug?.entry?.index || null,
      paragraphId: opwDebug?.entry?.id || null,
      applied: !!opwDebug?.applied,
      skippedReason: opwDebug?.skippedReason || "",
      position: opwDebug?.model?.position || "",
      segment: opwDebug?.model?.parts?.segment || "",
      openingWordWidthPx: opwDebug?.model?.metrics?.openingWordWidthPx || 0,
      reserveWidthPx: opwDebug?.model?.metrics?.reserveWidthPx || 0,
      dropLines: opwDebug?.model?.metrics?.dropLines || 0,
      windowApplied: !!opwDebug?.applied,
      continuedFromPrev: !!opwDebug?.continued,
    });

    // 2026-05-17:
    // mainFlow כבר מחשב line.runs לפי wordTokens ו-offsets מקוריים.
    // אסור להריץ כאן attachRunsToLines, כי הוא משחזר לפי indexOf ויכול
    // להזיז bold/color למילים חוזרות או אחרי פיצולים. משאירים את line.runs
    // כפי שחושבו ב-flowStreamThroughStrips.
    for (const line of mainLines) {
      if (!Array.isArray(line.runs)) line.runs = [];
    }
    const actualMainHeight = mainFlow.endY - mainTopY;

    // ★ 29/09 — עקבות אבחון: מאיפה הראשי קיבל את גבולות ההתפשטות.
    // בלי זה אי אפשר לדעת אם המעבר השני בכלל שינה משהו.
    result._mainPassTrace = {
      pass: (result._mainPassTrace?.pass || 0) + 1,
      rightEnd, leftEnd,
      otherBoxesBottom: Number.isFinite(otherBoxesBottom) ? Math.round(otherBoxesBottom) : null,
      hadRight: !!pass1Right, hadLeft: !!pass1Left,
      stripCount: mainStrips.length,
      widest: Math.max(0, ...mainStrips.map(s => Math.round(s.width))),
    };

    result.mainBox = {
      id: 'main',
      role: 'main',
      x: mainX,
      y: mainTopY,
      width: mainWidth, // רוחב כולל של אזור הראשי; ב-2 טורים כל line מחזיק את רוחב הטור שלו
      columns: mainColumnCount,
      columnGap: mainColumnCount > 1 ? mainColumnGap : 0,
      height: actualMainHeight,
      endY: mainFlow.endY,
      lines: mainLines,
      barMitzraStrips: mainStrips,
      continues: !!mainFlow.overflowText || !!pageContent.mainContinues,
      // משה 2026-05-13: סגנון "טקסט ראשי" (מ-document_style_settings) חייב להגיע גם למנוע V9.
      // בלי זה, בולד שהוגדר בסגנון הראשי לא היה מופיע בתצוגה הסופית.
      styleId: cfg.mainStyleId || "",
      inlineStyle: cfg.mainInlineStyle || null,
    };

    // Reset on EVERY pass: a successful second pass must not inherit stale
    // overflow from the first. Paragraph identity/runs/refs are carried intact.
    result.overflow.mainText = mainFlow.overflowText || "";
    result.overflow.mainParagraphs = mainFlow.overflowParagraphs || [];
    result.overflow.mainReason = mainFlow.overflowReason || "";
    result.mainInlineDiagnostics = mainFlow.diagnostics || [];

    // חסימה ב-pageBottom: אם flow לא הצליח לדחוס הכול, mainBottomY עלול לחרוג.
    mainBottomY = Math.min(mainFlow.endY, effectivePageBottom);
  };

  // מעבר ראשון: לפי הזרמים כפי שחושבו בשלב 4. זה מה שנותן לזרמים את
  // `mainBottomY` שלפיו הם ייבנו שוב.
  if (pageContent.mainText) {
    runMainPass(pass1Right, pass1Left);
  }

  // 4.6 Pass 2 — חישוב מחדש של הצדדים עם:
  //   1. mainBottomY עדכני (אחרי בר־מצרא של הראשי) — strip 3 מתחיל גבוה יותר אם
  //      הראשי התקצר, ולכן הצד מקבל יותר מקום אנכי.
  //   2. otherSideEndY — ה-y שבו הצד השני נגמר. ב-strip 3 הצד השורד מקבל
  //      halfWidth עד otherSideEndY (שם השני עוד פעיל), ו-fullWidth אחריו
  //      (שם השני כבר נגמר). זה ה"ברך בכל מקום" — מילוי כל שטח ריק
  //      שיוצא ממנו השכן, גם אם הוא נגמר באמצע strip 3 ולא רק ב-strips 1+2.
  //
  // משה 2026-05-08: pass1.endY נדרש להיות מוגבל ל-pageBottomY כדי שהשורות
  // האחרונות לא ידחסו מעבר לדף.
  //
  // משה 2026-05-08 (תיקון איטרציה): ה-otherSideEndY מבוסס על pass1, אבל
  // pass1 חישב את הצדדים עם naive main bottom שונה מהאמיתי. אחרי שpass2
  // מחשב צד אחד עם mainBottomY האמיתי, ה-endY האמיתי שלו עשוי להיות שונה
  // מ-pass1. כדי שגם הצד השני יקבל otherSideEndY מדויק, אנחנו רצים את
  // pass2 ב-2 איטרציות:
  //   1. pass2 ימני עם pass1Left.endY (קירוב ראשון)
  //   2. pass2 שמאלי עם pass2Right.endY (יותר מדויק)
  //   3. pass2 ימני שוב עם pass2Left.endY (סופי, יציב)

  const cap = (v) => Math.min(v, pageBottomY);
  const occupiedSideEndY = (box) => {
    if (!box) return mainTopY;
    let bottom = Number.isFinite(Number(box.endY)) ? Number(box.endY) : mainTopY;
    for (const line of (box.lines || [])) {
      const y = Number(line?.y);
      const h = Number(line?.lineHeightPx);
      if (!Number.isFinite(y)) continue;
      bottom = Math.max(bottom, y + (Number.isFinite(h) && h > 0 ? h : 0));
    }
    return cap(bottom);
  };

  // איטרציה 1: pass2 ימני עם pass1 שמאלי
  // משה 2026-05-10: בתרחיש 1, הימני (חצי ראשון בסדר קריאה) לא מקבל strip 3
  // ברוחב מלא — אחרת הוא יחפוף עם strip 3 של השמאלי. השמאלי (חצי שני)
  // לוקח את הרוחב המלא בתחתית כי הוא ההמשך הטבעי של הקריאה.
  const isScenario1 = (scenario.name === 'one_long_split');
  const isSameStreamSideSplit = isScenario1 || (
    !!pageContent.rightStream &&
    !!pageContent.leftStream &&
    pageContent.rightStream.id === pageContent.leftStream.id
  );
  let pass2Right = null;
  if (pageContent.rightStream) {
    pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? occupiedSideEndY(pass1Left) : mainTopY,
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: isSameStreamSideSplit && pass1Left ? 1 : 0,
    });
  }
  // איטרציה 2: pass2 שמאלי עם pass2 ימני (אם קיים, אחרת pass1)
  let pass2Left = null;
  let leftAssumedRightEnd = null;
  if (pageContent.leftStream) {
    const otherEnd = pass2Right ? occupiedSideEndY(pass2Right)
                   : pass1Right ? occupiedSideEndY(pass1Right)
                   : mainTopY;
    leftAssumedRightEnd = otherEnd;
    pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      // Column B may expand after column A ends. The old one-line cap solved
      // centered orphan rows, but after source-continuation rendering exists it
      // incorrectly prevents the surviving second column from using full width.
      maxFullStrip3Lines: 0,
    });
  }
  // איטרציה 3: pass2 ימני עם pass2 שמאלי (סופי)
  if (pageContent.rightStream && pass2Left) {
    pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: occupiedSideEndY(pass2Left),
      // ★ משה 14/09/2026 — שורש "המרווחים הלבנים בלי סיבה":
      // הרצועה ברוחב מלא מתחת לטקסט הראשי הייתה חסומה בתרחיש הזה,
      // ולכן כשהגמרא נגמרה כל השטח שמתחתיה נשאר ריק (נמדד: מילוי 50%
      // בדף עם 26 שורות גמרא ו-31 שורות רש"י).
      // החסימה מוסרת לטור השמאלי בלבד — הוא הנסגר אחרון, ולכן המשך
      // רש"י יורד אליו בסדר הנכון וממלא את העמוד. הימני נשאר חסום כדי
      // שהרצף ימין→שמאל לא יישבר.
      suppressFullStrip3: false,
      maxFullStrip3Lines: isSameStreamSideSplit && pass2Left ? 1 : 0,
    });
  }

  // ★ משה 27/09/2026 — „חפיפה בטקסטים בין זרם ימני לשמאלי, ראה בעמוד הראשון".
  // ההתכנסות כאן נעצרה צעד אחד מוקדם מדי. איטרציה 3 מריצה את הימני מחדש,
  // והפעם מותר לו לקחת את הרצועה ברוחב מלא — ולכן הוא נגמר נמוך יותר מאשר
  // בחישוב שעליו התבסס השמאלי באיטרציה 2. השמאלי, שכבר לא חושב מחדש,
  // המשיך להניח שהימני נגמר גבוה, ופרש את הרצועה הרחבה שלו לתוך שטח
  // שהימני תפס בפועל.
  // נמדד על הייצוא של משה: 42 עמודים מתוך 55 עם חפיפה בין הזרמים,
  // והגרועות כולן `left+right` — בעמוד הראשון 174×15.5 פיקסל, ושתי
  // השורות התחילו באותו גובה בדיוק (372).
  // כאן מושלמת ההתכנסות: אם הימני זז, השמאלי מחושב שוב מול המיקום החדש.
  // פעם אחת בלבד — כדי שלא תיווצר לולאה.
  if (pass2Left && pass2Right && leftAssumedRightEnd !== null) {
    const actualRightEnd = occupiedSideEndY(pass2Right);
    if (Math.abs(actualRightEnd - leftAssumedRightEnd) > 0.5) {
      const relaid = buildSideStream(pageContent.leftStream, 'left', {
        mainBottomY,
        otherSideEndY: actualRightEnd,
        maxFullStrip3Lines: 0,
      });
      if (relaid) pass2Left = relaid;
    }
  }

  const sideRowsOverlap = (a, b) => a.lines.some(x => b.lines.some(y =>
    Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 1 / 64 &&
    Math.min(x.y + x.lineHeightPx, y.y + y.lineHeightPx) - Math.max(x.y, y.y) > 1 / 64));

  // Final ownership validation: a later left-side reflow can extend below the
  // clearance previously used by the right side. Replan from source only when
  // distinct side streams still overlap; never shift painted DOM.
  if (!isSameStreamSideSplit && pass2Right && pass2Left) {
    let rightFloor = occupiedSideEndY(pass2Left), leftFloor = occupiedSideEndY(pass2Right);
    let pass = 0;
    while (sideRowsOverlap(pass2Right, pass2Left) && pass < 8) {
      rightFloor = Math.max(rightFloor, occupiedSideEndY(pass2Left));
      leftFloor = Math.max(leftFloor, occupiedSideEndY(pass2Right));
      pass2Right = buildSideStream(pageContent.rightStream, 'right', {
        mainBottomY, otherSideEndY: rightFloor,
      });
      leftFloor = Math.max(leftFloor, occupiedSideEndY(pass2Right));
      pass2Left = buildSideStream(pageContent.leftStream, 'left', {
        mainBottomY, otherSideEndY: leftFloor,
      });
      pass++;
    }
    let conservativeFallback = false;
    if (sideRowsOverlap(pass2Right, pass2Left)) {
      conservativeFallback = true;
      // Conservative allocation if full-width ownership cannot converge.
      pass2Right = buildSideStream(pageContent.rightStream, 'right', {
        mainBottomY, otherSideEndY: pageBottomY, suppressFullStrip3: true,
      });
      pass2Left = buildSideStream(pageContent.leftStream, 'left', {
        mainBottomY, otherSideEndY: pageBottomY, suppressFullStrip3: true,
      });
    }
    if (pass > 0) result.sideWidthReconciliation = { passes: pass, conservativeFallback };
  }

  // Distinct streams can have different measured line pitches. Their strip
  // boundary below main is shared, but a purely independent row grid can make
  // the first visibly wider row start at different Y values. Synchronize only
  // that knee when both streams actually reach it and the adjustment is safe:
  // move the earlier continuation down to the later knee and absorb the delta
  // into the preceding narrow row's box. This keeps row boxes contiguous,
  // preserves source order/widths, and never changes already-synchronized pages.
  const synchronizeDistinctSideMainKnee = (rightBox, leftBox) => {
    if (!rightBox || !leftBox || rightBox.id === leftBox.id) return null;
    const kneeFor = (box) => {
      const lines = box.lines || [];
      for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1], line = lines[i];
        if (line.y < mainBottomY - 1 / 64) continue;
        if (line.width <= prev.width + 1 / 64) continue;
        return { box, lines, index: i, prev, line };
      }
      return null;
    };
    const knees = [kneeFor(rightBox), kneeFor(leftBox)];
    if (knees.some(k => !k)) return null;
    const targetY = Math.max(...knees.map(k => Number(k.line.y)));
    if (!Number.isFinite(targetY) || Math.abs(knees[0].line.y - knees[1].line.y) <= 0.05) return null;

    const snapshots = knees.map(k => ({
      k,
      endY: k.box.endY,
      rows: k.lines.map(line => ({ line, y: line.y, lineHeightPx: line.lineHeightPx })),
    }));
    const restore = () => {
      for (const snapshot of snapshots) {
        snapshot.k.box.endY = snapshot.endY;
        for (const row of snapshot.rows) {
          row.line.y = row.y;
          row.line.lineHeightPx = row.lineHeightPx;
        }
      }
    };

    for (const k of knees) {
      const delta = targetY - k.line.y;
      if (delta <= 0.05) continue;
      const previousBottom = k.prev.y + k.prev.lineHeightPx;
      const last = k.lines[k.lines.length - 1];
      const lastBottom = last.y + last.lineHeightPx;
      // Do not create a hidden whole-row spacer or push content off the page.
      if (Math.abs(previousBottom - k.line.y) > 0.05 ||
          delta >= k.prev.lineHeightPx - 0.05 ||
          lastBottom + delta > pageBottomY + 0.05) {
        restore();
        return null;
      }
      k.prev.lineHeightPx += delta;
      for (let i = k.index; i < k.lines.length; i++) k.lines[i].y += delta;
      if (Number.isFinite(Number(k.box.endY))) k.box.endY = Number(k.box.endY) + delta;
    }

    if (sideRowsOverlap(rightBox, leftBox)) {
      restore();
      return null;
    }
    const syncedY = knees.map(k => k.line.y);
    if (Math.abs(syncedY[0] - syncedY[1]) > 0.05) {
      restore();
      return null;
    }
    return { y: syncedY[0], deltas: knees.map((k, i) => syncedY[i] - snapshots[i].rows[k.index].y) };
  };
  if (!isSameStreamSideSplit && pass2Right && pass2Left) {
    const kneeSync = synchronizeDistinctSideMainKnee(pass2Right, pass2Left);
    if (kneeSync) result.sideMainKneeSync = kneeSync;
  }

  if (isSameStreamSideSplit && pass2Right?.overflowText && pageContent.leftStream) {
    const originalLeft = pageContent.leftStream.rich || makeRichText(pageContent.leftStream.items.join(' '), pageContent.leftStream.runs || []);
    const continuation = concatRichTextParts([pass2Right.overflowRich, originalLeft], '');
    const leftInput = { ...pageContent.leftStream, rich: continuation, items: [continuation.text], runs: continuation.runs };
    const carriedCrownReplan = replanSplitCrown([pageContent.rightStream, leftInput]);
    if (carriedCrownReplan) return carriedCrownReplan;
    pass2Left = buildSideStream(leftInput, 'left', { mainBottomY,
      otherSideEndY: occupiedSideEndY(pass2Right), maxFullStrip3Lines: 0 });
    pass2Right.overflowText = ''; pass2Right.overflowRuns = []; pass2Right.overflowRich = makeRichText('');
    pass2Right.continues = true;
  }

  if (pass2Right && pass2Left && pass2Right.id === pass2Left.id) {
    pass2Right.isColumnAContinuation = true;
    pass2Right.continues = true;
  }

  if (pass2Right) {
    // משה 2026-05-10: צורה 4 — סימון איזה צד מקבל כותרת ברוחב מלא ואיזה
    // מדלג על הכותרת בראש (יקבל אותה מתחת לכתר, מעל התוכן שלו).
    if (fullCrownSide === 'right') pass2Right.fullWidthTitle = true;
    if (fullCrownSide && fullCrownSide !== 'right') pass2Right.skipTopTitle = true;
    if (scenario.name === 'one_long_split') {
      pass2Right.isScenario1Split = true;
      pass2Right.continues = true;
    }
    result.streamBoxes.push(pass2Right);
    // משה 2026-05-10: בתרחיש 1, שני הצדדים = אותו זרם, אותו id. אם נכתוב שניהם
    // לאותו מפתח באוברפלאו — השני ידרוס את הראשון ותוכן ייאבד. במקום, נצרף.
    if (pass2Right.overflowText) {
      appendOverflowStream(result.overflow, pass2Right.id, pass2Right.overflowRich || {
        text: pass2Right.overflowText,
        runs: pass2Right.overflowRuns || [],
      });
    }
  }
  if (pass2Left) {
    if (fullCrownSide === 'left') pass2Left.fullWidthTitle = true;
    if (fullCrownSide && fullCrownSide !== 'left') pass2Left.skipTopTitle = true;
    if (scenario.name === 'one_long_split') pass2Left.isScenario1Split = true;
    result.streamBoxes.push(pass2Left);
    if (pass2Left.overflowText) {
      appendOverflowStream(result.overflow, pass2Left.id, pass2Left.overflowRich || {
        text: pass2Left.overflowText,
        runs: pass2Left.overflowRuns || [],
      });
    }
  }

  // ⭐⭐⭐ המעבר השני של הראשי — כאן נסגר המעגל.
  //
  // ⬛ המיקום קריטי: הוא **אחרי** ש-`result.streamBoxes` התמלא. בניסיון
  //    קודם הצבתי אותו קודם לכן, והרשימה עוד הייתה ריקה — ולכן הבדיקה
  //    „יש זרמים נוספים" תמיד נכשלה והמעבר השני מעולם לא רץ באמת.
  //
  // הזרמים סיימו להתייצב. אם הם נגמרים במקום אחר ממה שהמעבר הראשון
  // הניח — או אם יש בעמוד זרמים שהמעבר הראשון כלל לא הכיר — הראשי
  // נבנה על שטח שאינו פנוי. כאן הוא נבנה שוב, מול התמונה המלאה.
  if (pageContent.mainText && typeof runMainPass === "function") {
    const endOf = (b) => (b ? Number(b.endY) : null);
    const movedRight = Math.abs((endOf(pass2Right) ?? 0) - (endOf(pass1Right) ?? 0)) > 0.5;
    const movedLeft = Math.abs((endOf(pass2Left) ?? 0) - (endOf(pass1Left) ?? 0)) > 0.5;
    // ★ זרם שאינו אחד משני זרמי הצד — המעבר הראשון לא ידע עליו כלום.
    const hasOtherStreams = (result.streamBoxes || [])
      .some(b => b && b !== pass1Right && b !== pass1Left && b !== pass2Right && b !== pass2Left);
    if (movedRight || movedLeft || hasOtherStreams) {
      runMainPass(pass2Right || pass1Right, pass2Left || pass1Left);
    }
  }

  // 5. footers — חתוך לפי גבולות הדף.
  // משה 2026-05-08: כמו במנוע משנה ברורה: footer שלא נכנס מודחק לעמוד הבא.
  // כאן (אנליטי): חותכים שורות שעוברות את pageBottom, שומרים את הטקסט המודחק
  // ב-overflow.streams (כדי ש-buildPages יוכל לדחוף לעמוד הבא דרך carry-over
  // עתידי או דרך הפחתת פסקאות באיטרציה הבאה).
  const pageBottom = effectivePageBottom;
  // משה 2026-05-13: מרווח בין זרמים דינמי לפי גובה הכותרת. עם הכותרות
  // המודגשות (פס לבן-על-צבע), הם נראים דחוסים מדי ב-8px. 0.55 * titleHeight
  // ≈ 11–13px לזרמים בגודל ברירת מחדל, וגדל אוטומטית כשהפונט גדל.
  const interStreamGap = Math.max(10, Math.round(titleHeight * 0.55));
  const requestedMainBottomGap = Number.isFinite(Number(cfg.mainBottomGapPx))
    ? Math.max(0, Math.min(60, Number(cfg.mainBottomGapPx)))
    : DEFAULT_V9_MAIN_BOTTOM_GAP_PX;
  // ⛔⛔⛔ משה 28/09/2026 — „בעמ' י' ההערות וציונים עלה יותר גבוה
  // ממקומו, הוא אמור להיות מתחת, וכרגע הוא עולה על הטקסט הראשי ומוחק
  // חלק ממנו".
  //
  // ═══ השורש ═══
  // מיקום הזרמים התחתונים נקבע לפי `endY` — ערך ש**מדווח** על סוף כל
  // קופסה. אבל שורה יכולה לשבת נמוך יותר ממה שהערך אומר: מילת פתיח
  // יורדת לגובה שתי שורות, יישור מותח, וניקוד חורג מתחת לאות.
  //
  // ⇒ ה-footer התחיל בגובה שבו התוכן שמעליו עדיין נמצא — ולכן הוא
  //   „עלה גבוה ממקומו" ונחת על הטקסט הראשי.
  //
  // כמו לקבוע איפה מתחיל המדף הבא לפי הרשימה, בלי לבדוק כמה גבוה
  // באמת הספר האחרון שהונח.
  //
  // ═══ התיקון ═══
  // הגבול נלקח מ**המיקום האמיתי של השורות** — התחתית הנמוכה ביותר
  // שנמצאה בפועל — או מהערך המדווח, הגדול מביניהם. כך ה-footer לעולם
  // אינו מתחיל בתוך תוכן קיים.
  // ⬛ בתכנון, לפני שה-footer נבנה. אין כאן הזזה אחרי מעשה.
  const realBottomOf = (box) => {
    if (!box) return 0;
    let low = Number(box.endY) || 0;
    for (const l of (box.lines || [])) {
      const y = Number(l?.y);
      if (!Number.isFinite(y)) continue;
      const h = Number(l?.lineHeightPx) > 0 ? Number(l.lineHeightPx) : 0;
      const bottom = y + h;
      if (bottom > low) low = bottom;
    }
    return low;
  };
  const mainRealBottom = realBottomOf(result.mainBox);
  const mainFloor = Math.max(mainBottomY, mainRealBottom);
  const sideFloor = Math.max(0, ...result.streamBoxes.map(b => realBottomOf(b)));
  const footerBaseY = Math.max(mainFloor, sideFloor);

  // One geometry authority: reserve the requested main→apparatus gap HERE,
  // before footer lines are measured. If a side commentary continues below the
  // main stream, that side stream owns the vertical boundary and keeps the
  // ordinary inter-stream gap; mainBottomGap must never break its row grid.
  const mainOwnsFooterBoundary = !!(result.mainBox?.lines?.length)
    && mainFloor >= sideFloor - 0.5;
  const firstFooterGap = mainOwnsFooterBoundary
    ? Math.max(interStreamGap, requestedMainBottomGap)
    : interStreamGap;
  let footerY = footerBaseY + firstFooterGap;
  result.mainBottomGapPlan = {
    requested: requestedMainBottomGap,
    interStreamGap,
    planned: firstFooterGap,
    boundary: mainOwnsFooterBoundary ? "main" : "side-stream",
    baseY: footerBaseY,
  };
  let anyFooterTrimmed = false;

  if (pageContent.footerStreams && pageContent.footerStreams.length) {
    // The two configured Gapt/Talmud streams keep permanent ownership of the
    // side columns. Footer streams configured as a secondary Mishnah level —
    // or exactly two footer streams explicitly marked layoutRole="mishna" —
    // use the existing Mishnah float+flow geometry below the main/Talmud area.
    // This restores mixed 2+2 documents without allowing a footer stream to
    // opportunistically replace an empty Talmud side on individual pages.
    const footerGroups = groupV9FooterStreams(
      pageContent.footerStreams,
      streamSettings,
      cfg.levels,
      cfg.mishnaWrapOn,
      cfg.talmudStreams
    );

    const streamRich = (fs) => fs.rich || makeRichText((fs.items || []).join(" "), fs.runs || []);
    const streamText = (fs) => normalizeRichTextEntry(streamRich(fs)).text;

    const footerMeta = (fs) => {
      const settings = streamSettings[fs.id] || {};
      const resolvedStyle = composeStreamTextStyle(fs.id);
      const metrics = getSideMetricsForStream(fs.id);
      const fontSize = Number(resolvedStyle?.fontSize) > 0 ? Number(resolvedStyle.fontSize) : metrics.fontSize;
      const lineH = Math.max(metrics.lineHeight, fontSize * 1.35);
      return { fs, settings, resolvedStyle, metrics, lineH };
    };

    const footerShift = (meta, minTop = 0) => resolveV9StreamShiftBottom(
      cfg.__v9PageConstraint,
      meta?.fs?.id,
      {
        pageBottom,
        lineHeight: meta?.metrics?.lineHeight || meta?.lineH || sideLineH,
        minTop,
      }
    );

    const pushFooterBox = (meta, measured, titleY, titleX, titleWidth, extra = {}) => {
      const footerContinues = !!measured.overflowRich.text;
      if (footerContinues) {
        result.overflow.streams[meta.fs.id] = measured.overflowRich;
        anyFooterTrimmed = true;
      }
      result.footerBoxes.push({
        id: meta.fs.id,
        role: "stream",
        styleId: meta.settings.styleId || "",
        inlineStyle: meta.resolvedStyle || {},
        titleStyleId: meta.settings.titleStyleId || "",
        lines: measured.lines,
        titleY,
        titleX,
        titleWidth,
        titleHeight,
        continues: footerContinues,
        manualFootnoteShiftLines: Number(extra.manualFootnoteShiftLines) || 0,
        manualFootnoteShiftReservedPx: Number(extra.manualFootnoteShiftReservedPx) || 0,
        streamPageBottomY: Number(extra.streamPageBottomY) || pageBottom,
        ...extra,
      });
      return measured.endY;
    };

    const overflowWholeGroup = (metas) => {
      for (const meta of metas) {
        result.overflow.streams[meta.fs.id] = streamRich(meta.fs);
      }
      anyFooterTrimmed = true;
    };

    for (const group of footerGroups) {
      const active = group.streams.filter(fs => streamText(fs));
      if (!active.length) continue;
      const metas = active.map(footerMeta);

      // Exact analytical equivalent of the historical Mishnah-wrap level for
      // the common two-stream case: the shorter stream is a fixed float; the
      // longer stream flows beside it and then expands to full width below it.
      if (group.mishnaFlow === true && metas.length === 2) {
        const [a, b] = metas;
        const aLen = streamText(a.fs).length;
        const bLen = streamText(b.fs).length;
        const flowMeta = aLen >= bLen ? a : b;
        const floatMeta = flowMeta === a ? b : a;
        const maxLineH = Math.max(flowMeta.lineH, floatMeta.lineH);
        if (footerY + titleHeight + maxLineH > pageBottom) {
          overflowWholeGroup(metas);
          continue;
        }

        const gap = Math.max(0, Number(cfg.streamHorizontalGap) || 0);
        const requestedPercent = Number(floatMeta.settings.mishnaWidth);
        const floatWidth = Number.isFinite(requestedPercent) && requestedPercent > 0
          ? Math.max(24, Math.min(innerWidth - 24 - gap, innerWidth * Math.min(95, requestedPercent) / 100))
          : Math.max(24, (innerWidth - gap) / 2);
        const narrowWidth = Math.max(24, innerWidth - floatWidth - gap);
        const pageNo = (Number(cfg.__v9PageIndex) || 0) + 1;
        const pref = String(floatMeta.settings.mishnaSide || "auto");
        let floatRight = true;
        if (pref === "left") floatRight = false;
        else if (pref === "right") floatRight = true;
        else if (pref === "outer") floatRight = pageNo % 2 === 0;
        else if (pref === "inner") floatRight = pageNo % 2 === 1;

        const titleY = footerY;
        const bodyTop = footerY + titleHeight;
        const floatX = floatRight ? innerWidth - floatWidth : 0;
        const narrowX = floatRight ? 0 : floatWidth + gap;

        const floatShift = footerShift(floatMeta, bodyTop);
        const flowShift = footerShift(flowMeta, bodyTop);
        const floatBottom = floatShift.bottom;
        const flowBottom = flowShift.bottom;

        const floatFits = bodyTop + floatMeta.metrics.lineHeight <= floatBottom + 0.1;
        const flowFits = bodyTop + flowMeta.metrics.lineHeight <= flowBottom + 0.1;

        let floatMeasured = {
          lines: [],
          endY: bodyTop,
          overflowRich: streamRich(floatMeta.fs),
          overflowText: streamText(floatMeta.fs),
        };
        if (floatFits) {
          floatMeasured = flowV9MeasuredStream(
            streamRich(floatMeta.fs),
            [{ x: floatX, width: floatWidth, y_start: bodyTop, y_end: floatBottom }],
            floatMeta.metrics._v9TextContext,
            floatBottom
          );
        }
        // A base-height fit is only a preflight. Real styled text may produce
        // no row; its measured remainder must survive even without a box.
        if (floatMeasured.overflowText) {
          result.overflow.streams[floatMeta.fs.id] = floatMeasured.overflowRich;
          anyFooterTrimmed = true;
        }
        const floatEnd = Math.max(bodyTop, floatMeasured.endY || bodyTop);

        const flowStrips = [];
        if (flowFits) {
          if (floatFits && floatEnd > bodyTop + 0.1) {
            flowStrips.push({
              x: narrowX,
              width: narrowWidth,
              y_start: bodyTop,
              y_end: Math.min(floatEnd, flowBottom),
            });
          }
          if (!floatFits || floatEnd < flowBottom - 0.1) {
            flowStrips.push({
              x: 0,
              width: innerWidth,
              y_start: floatFits ? Math.max(bodyTop, floatEnd) : bodyTop,
              y_end: flowBottom,
            });
          }
        }

        let flowMeasured = {
          lines: [],
          endY: bodyTop,
          overflowRich: streamRich(flowMeta.fs),
          overflowText: streamText(flowMeta.fs),
        };
        if (flowFits) {
          flowMeasured = flowV9MeasuredStream(
            streamRich(flowMeta.fs),
            flowStrips.length
              ? flowStrips
              : [{ x: narrowX, width: narrowWidth, y_start: bodyTop, y_end: flowBottom }],
            flowMeta.metrics._v9TextContext,
            flowBottom
          );
        }
        // A base-height fit is only a preflight. Real styled text may produce
        // no row; its measured remainder must survive even without a box.
        if (flowMeasured.overflowText) {
          result.overflow.streams[flowMeta.fs.id] = flowMeasured.overflowRich;
          anyFooterTrimmed = true;
        }

        if (floatFits && floatMeasured.lines.length) {
          pushFooterBox(floatMeta, floatMeasured, titleY, floatX, floatWidth, {
            mishnaLevel: group.level >= 0 ? group.level + 1 : null,
            mishnaRole: "float",
            mishnaSource: group.source || "levels",
            manualFootnoteShiftLines: floatShift.shiftLines,
            manualFootnoteShiftReservedPx: floatShift.reservedPx,
            streamPageBottomY: floatBottom,
          });
        }
        if (flowFits && flowMeasured.lines.length) {
          pushFooterBox(flowMeta, flowMeasured, titleY, floatFits ? narrowX : 0, floatFits ? narrowWidth : innerWidth, {
            mishnaLevel: group.level >= 0 ? group.level + 1 : null,
            mishnaRole: "flow",
            mishnaSource: group.source || "levels",
            manualFootnoteShiftLines: flowShift.shiftLines,
            manualFootnoteShiftReservedPx: flowShift.reservedPx,
            streamPageBottomY: flowBottom,
          });
        }

        const renderedEnd = Math.max(
          floatFits && floatMeasured.lines.length ? (floatMeasured.endY || bodyTop) : bodyTop,
          flowFits && flowMeasured.lines.length ? (flowMeasured.endY || bodyTop) : bodyTop
        );
        footerY = renderedEnd > bodyTop ? renderedEnd + interStreamGap : footerY;
        continue;
      }

      // Non-Mishnah footers, and uncommon levels with more than two streams,
      // retain the stable full-width V9 path.
      for (const meta of metas) {
        const titleY = footerY;
        const bodyTop = footerY + titleHeight;
        const shift = footerShift(meta, bodyTop);
        const streamBottom = shift.bottom;

        if (bodyTop + meta.lineH > streamBottom + 0.1) {
          result.overflow.streams[meta.fs.id] = streamRich(meta.fs);
          anyFooterTrimmed = true;
          continue;
        }
        const footerCols = Math.max(1, Math.min(6, parseInt(meta.settings.cols || 1, 10) || 1));
        const colGap = Math.max(0, Number(cfg.streamHorizontalGap) || 0);
        const measured = flowV9MeasuredColumns(
          streamRich(meta.fs),
          meta.metrics._v9TextContext,
          { top: bodyTop, bottom: streamBottom, width: innerWidth, columns: footerCols, gap: colGap }
        );
        pushFooterBox(meta, measured, titleY, 0, innerWidth, {
          manualFootnoteShiftLines: shift.shiftLines,
          manualFootnoteShiftReservedPx: shift.reservedPx,
          streamPageBottomY: streamBottom,
        });
        footerY = measured.endY + interStreamGap;
      }
    }
  }

  // A commentary continuation is not a geometric page overflow. It is valid
  // for a long note to start beside its main-text anchor and continue on the
  // next page. Only actual geometry beyond the physical page is "exceedsPage".
  result.overflow.exceedsPage = footerY > cfg.pageHeight + 0.1;
  result.overflow.hasStreamContinuation = Object.values(result.overflow.streams || {})
    .some(entry => !!normalizeRichTextEntry(entry).text);

  // ⭐⭐⭐⭐ המעבר האחרון של הראשי — אחרי שכל הקופסאות בעמוד קיימות.
  //
  // ═══ מה שהעקבות חשפו ═══
  // הוספתי עקבות אבחון (`_mainPassTrace`) וראיתי שני דברים:
  //   1. **בכל העמודים pass = 1** — כלומר המעבר השני שהוספתי קודם
  //      מעולם לא רץ באמת.
  //   2. בעמוד הבעייתי: hadRight=false, hadLeft=false, stripCount=1,
  //      widest=356 — רצועה אחת ברוחב מלא לכל גובה העמוד.
  //
  // ═══ הסיבה ═══
  // הזרמים שחופפים את הראשי אינם זרמי צד כלל — הם **footers**, והם
  // נבנים בשלב 5, אחרי הראשי. בזמן שהראשי חושב איפה מותר לו
  // להתפשט, הם עוד לא קיימים, ולכן הוא מניח שכל העמוד פנוי.
  //
  // כמו לפרוס שולחן בחדר ריק, ורק אחר כך להכניס את הספה.
  //
  // ═══ התיקון ═══
  // מעבר אחרון של הראשי, כאן — אחרי שגם הזרמים וגם ה-footers כבר
  // בנויים. עכשיו `otherBoxesBottom` רואה את התמונה המלאה, והרצועות
  // נבנות רק על שטח שבאמת פנוי.
  //
  // ⬛ רץ רק כשיש בעמוד קופסאות שהמעבר הקודם לא הכיר — אחרת אין טעם.
  if (pageContent.mainText && typeof runMainPass === "function") {
    const known = new Set([pass1Right, pass1Left, pass2Right, pass2Left].filter(Boolean));
    const unseen = [...(result.streamBoxes || []), ...(result.footerBoxes || [])]
      .some(b => b && !known.has(b));
    if (unseen) {
      runMainPass(pass2Right || pass1Right, pass2Left || pass1Left);
    }
  }

  result.streamCoverage = verifyV9StreamCoverage(sourceStreams,result);
  result.unstartedNotes = auditV9NoteStarts(result,pageContent.requiredNoteStarts);
  return result;
}

// =====================================================================
// מצייר תוכנית עמוד ל-DOM
// =====================================================================
function ensureGlobalStyles() {
  if (document.getElementById('vilna-v9-styles')) return;
  const style = document.createElement('style');
  style.id = 'vilna-v9-styles';
  style.textContent = `
    .v9-page {
      background: #ffffff;
      position: relative;
      box-sizing: border-box;
      direction: rtl;
      overflow: hidden;
      border: 1px solid #888;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      margin: 12px auto;
    }
    .v9-line {
      position: absolute;
      direction: rtl;
      white-space: nowrap;
      overflow: visible;
    }
    /* משה 2026-05-13: באג ך' סופית — כשלכל שורה יש רקע מ-stream-color-N,
       השורה התחתונה מציירת מעל ה-descender של השורה שמעליה. ב-V9 רוצים את
       הצבע רק על פס הכותרת — לא על השורות הבודדות. */
    .v9-line[class*="stream-color-"] { background: transparent; }

    /* ⛔⛔⛔ משה 28/09/2026 — "עדיין שורות שעולים זה על זה ומוחקים
       חלקים מהשורות שהן עולים עליה. בדוק מה עושה את המחיקה — חייבים
       שאם משהו עולה שלפחות במקרה חירום יהיה חפיפה בלי מחיקה!!!"

       ⬛ נמדד: לכל שורה הוחל רקע לבן אטום ישירות על האלמנט, כחלק
          מסגנון המסמך. שורה עם רקע לבן שמצוירת מעל שורה אחרת מוחקת
          אותה לגמרי — הטקסט עדיין קיים, אבל צבוע עליו לבן.

       כמו להדביק פתק אטום על שורה בספר: השורה לא נמחקה, אבל אי אפשר
       לראות אותה.

       ⇒ שורות V9 לעולם אינן נושאות רקע. הרקע שייך לעמוד. כך חפיפה,
         אם בכל זאת קורית, נשארת חפיפה שאפשר לראות ולתקן — ולעולם
         לא מחיקה שקטה של טקסט.
       ⬛ צבע הטקסט, הגופן והגודל מהסגנון — נשארים כפי שהם. */
    .v9-line { background: transparent !important; }
    .v9-line.justify {
      white-space: normal;
      text-align: justify;
      text-align-last: justify;
    }
    .v9-line.center {
      white-space: normal;
      text-align: center;
    }
    .v9-stream-title {
      position: absolute;
      font-weight: 700;
      text-align: center;
      border-bottom: 1px solid #888;
      direction: rtl;
      color: #ffffff;
      letter-spacing: 0.02em;
    }
    /* משה 2026-05-13: ניגודיות גבוהה לכותרת מפרשים בתבנית תלמוד — לבן על
       צבע מלא חזק במקום כחול-בהיר על שחור. כל זרם בצבע משלו לזיהוי. */
    .v9-stream-title.stream-color-1 { background: #2c5aa0; }
    .v9-stream-title.stream-color-2 { background: #2a7a3a; }
    .v9-stream-title.stream-color-3 { background: #6b3b9c; }
    .v9-stream-title.stream-color-4 { background: #a87a2c; }
    .v9-stream-title.stream-color-5 { background: #a83c3c; }
    .v9-stream-title.stream-color-6 { background: #a8642c; }
    .v9-stream-title.stream-color-7 { background: #a83b6e; }
    .v9-stream-title.stream-color-8 { background: #5c6373; }
  `;
  document.head.appendChild(style);
}

// Post-paint geometry resolvers were intentionally removed on 30/09/2026.
// V9 has one geometry authority: the planner. Crown/body gaps, commentary
// knees, opening-word windows and main/footer spacing must all be resolved
// before paint. Reintroducing a DOM-measure-and-shift pass here would create a
// second Y-grid and can manufacture blank rows or desynchronise wide/narrow
// transitions.

// ★ משה 14/09/2026: מחזיר את הפונט ששולט ב-runs של השורה, אם כולם
// מסכימים עליו. בלי זה מילה שאין לה run נשארת בפונט ברירת-המחדל
// ונראית זרה בתוך השורה.
function dominantRunFontFamily(line) {
  const runs = Array.isArray(line && line.runs) ? line.runs : [];
  if (!runs.length) return "";
  const fonts = new Set();
  for (const r of runs) {
    const f = r && r.marks && (r.marks.fontFamily || r.marks.font);
    if (f) fonts.add(String(f).trim());
    else return "";        // יש run בלי פונט — אין הסכמה
  }
  return fonts.size === 1 ? [...fonts][0] : "";
}

function renderPagePlan(plan, pageEl, cfg) {
  ensureGlobalStyles();

  pageEl.classList.add('v9-page');
  // ★ 29/09 — עקבות התכנון של הראשי, לצורכי מדידה בלבד.
  if (plan._mainPassTrace) {
    try { pageEl.dataset.v9MainPass = JSON.stringify(plan._mainPassTrace); } catch (_) {}
  }
  pageEl.style.width = plan.pageBox.width + 'px';
  pageEl.style.height = plan.pageBox.height + 'px';
  pageEl.style.padding = plan.pageBox.padding + 'px';
  pageEl.style.position = 'relative';
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.overflow = 'hidden';

  const padding = plan.pageBox.padding;

  // משה 2026-05-08: לכל זרם יש צבע (stream-color-1..6) לפי הקוד שלו.
  // 6 צבעים מתחלפים — קוד 7 חוזר ל-1 וכו'. הצבעים מוגדרים ב-styles.css
  // עם רקע בהיר. נחיל את הצבע על כל שורה של הזרם וגם על הכותרת.
  function streamColorClass(streamId) {
    const n = parseInt(streamId, 10);
    if (!Number.isFinite(n) || n < 1) return '';
    return ' stream-color-' + (((n - 1) % 6) + 1);
  }

  function measureV9RenderedContentWidth(el) {
    try {
      if (!el || !el.firstChild) return 0;
      const r = document.createRange();
      r.selectNodeContents(el);
      const rect = r.getBoundingClientRect();
      r.detach && r.detach();
      return rect && Number.isFinite(rect.width) ? rect.width : 0;
    } catch (_) {
      return 0;
    }
  }

  function applyV9MeasuredStreamStretchGuard(lineEl, info) {
    if (!lineEl || !info || !info.isCandidate) return;
    if (lineEl.classList.contains('center')) return;
    if (lineEl.classList.contains('justify')) return;
    if (lineEl.classList.contains('v9-continuation-manual-stretch')) return;

    const targetWidth = Number(info.targetWidth) || Number.parseFloat(lineEl.style.width) || 0;
    if (!(targetWidth > 0)) return;

    const text = String(lineEl.textContent || '').trim();
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    if (wordCount < 2) return;

    const renderedWidth = measureV9RenderedContentWidth(lineEl);
    if (!(renderedWidth > 0)) return;

    const deficit = targetWidth - renderedWidth;
    const fill = renderedWidth / targetWidth;
    lineEl.dataset.v9RenderedFill = String(Math.max(0, Math.min(1, fill)).toFixed(4));

    // ★ אותה תקרת מתיחה כמו למעלה — ועכשיו באמת אותו מספר,
    // מתוך V9_MAX_EXTRA_PER_GAP_PX. קודם לכן כתוב היה כאן 6 בעוד שלמעלה
    // הועלה ל-12, והשומר פסל שורות שהבנייה כבר אישרה.
    const extraPerGap = deficit / Math.max(1, wordCount - 1);
    if (extraPerGap > V9_MAX_EXTRA_PER_GAP_PX) {
      lineEl.dataset.v9StretchCapped = String(Math.round(extraPerGap));
      return;
    }

    if (deficit > 1.5) {
      lineEl.classList.add('justify');
      lineEl.dataset.v9MeasuredStreamStretch = '1';
      lineEl.dataset.v9MeasuredStretchDeficitPx = String(Math.round(deficit * 100) / 100);
    }
  }

  // ⛔⛔⛔ משה 28/09/2026, דחיפות 1 — ההסבר שלו, מילה במילה:
  //
  // „אני אסביר לך אחת ולתמיד את הבעיה למה השורות החופפות: זה בגלל
  //  שאתה או הרובוטים שקדמו לזה החליטו לעשות לשורות החריגות (כמו
  //  אחרי מילת פתיח) מדידה כלשהי, והם רק הזיקו, משום שלא קלטו שמדובר
  //  במסמך דינמי שמשתנה ממסמך למסמך ומעיצוב לעיצוב, ולא ניתן לעשות
  //  מדידות כאלה ואחרות אלא רק להחזיר את זה למסלול הרגיל של מרחקים
  //  בין אותיות — וכמובן המרחק צריך להיות לפי האותיות הרגילות ולא לפי
  //  המילת פתיח שחי כביכול באטמוספירה אחרת ועשו בשבילו רווח מיוחד.
  //  אבל שאר השורות — הרווחים צריכים להיות אחידים בכל הקטע, כולל
  //  שורות חדשות שנוצרו עקב חריגות."
  //
  // ═══ המדידה שמוכיחה את זה מילה במילה (הייצוא שלו, 17:59) ═══
  //                    ערכי מרווח שונים   מינימום   צפופים מדי
  //   טקסט ראשי               32           6.53px       109
  //   ביאור (01)                7          17.05          0
  //   פשר דבר (02)              7          17.05          0
  //   מהר"ם (03)                1          17.05          0
  //   הערות (04)                1          15.50          0
  //
  // הזרמים אחידים לגמרי — ובהם אין ולו חפיפה אחת. רק הראשי שבור, ובו
  // כל החפיפות. שורה בגובה 20 שיושבת 11 פיקסלים מתחת לקודמת **חייבת**
  // לדרוך עליה. זה לא עניין של גובה הקופסה — זה מיקום שגוי.
  //
  // ═══ השורש ═══
  // הטקסט הראשי זורם דרך „רצועות" ברוחבים שונים (כי הפרשנים נגמרים
  // במקומות שונים). במעבר בין רצועה לרצועה המיקום האנכי נקבע מחדש
  // לפי תחילת הרצועה, במקום להמשיך את הרצף — והרצף נשבר.
  //
  // ═══ התיקון — בדיוק מה שמשה הורה ═══
  // אחרי בניית השורות, הרווחים בטור מיושרים חזרה ל„מסלול הרגיל":
  // כל שורה יושבת לפחות גובה-שורה אחד מתחת לקודמת. לא מדידה, לא
  // התאמה לתוכן — כלל אחד, אחיד, שנגזר מגובה השורה של האות הרגילה.
  // ⬛ שורה שכבר יושבת נכון או רחוק יותר — לא נוגעים בה בכלל.
  // ⬛ אם אין מקום לדחוף עד תחתית העמוד — משאירים כפי שהוא, כדי לא
  //    להוציא תוכן מהדף. עדיף חפיפה נדירה מאשר טקסט שנעלם.
  // ⚠️ `pitchPx` הוא המרווח **בפיקסלים**, לא היחס. זו הייתה טעות בגרסה
  // הראשונה של התיקון: הועבר לכאן `cfg.lineHeightRatio` (1.55), וכל
  // השורות כבר היו רחוקות מזה — כלומר הפונקציה רצה ולא הזיזה כלום.
  function enforceUniformLinePitch(box, pitchPx) {
    const lines = Array.isArray(box?.lines) ? box.lines : [];
    if (lines.length < 2) return 0;
    const pitch = Number(pitchPx);
    if (!(pitch > 1)) return 0;
    // ⛔⛔⛔ משה 28/09/2026 — „בעמוד ד' טקסט אבד והוסתר מעליו, **כולל
    // הכותרת של הזרם** אבד והוסתר", ו„בעמוד ו' יש בזרם הראשי טקסט
    // ששייך לעמוד הבא".
    //
    // ⬛ נמדד בייצוא שלו (22:25): **75 כותרות זרם מתוך 583** מכוסות
    //    על ידי שורות טקסט.
    //
    // ═══ הסיבה ═══
    // היישור דוחף שורות מטה כדי למנוע צפיפות, והגבול היה **תחתית
    // העמוד**. אבל בין הקופסאות יושבות כותרות הזרמים, והן אינן שורות
    // טקסט — ולכן היישור פשוט לא ראה אותן ודרס אותן.
    //
    // כמו לדחוף ספרים על מדף עד קצה הקיר, בלי לשים לב שבאמצע המדף
    // עומדת מסגרת תמונה.
    //
    // ═══ התיקון ═══
    // הגבול הוא **תחתית הקופסה עצמה**, לא תחתית העמוד: שורה לעולם
    // לא תידחף אל מחוץ לשטח שהמנוע הקצה לקופסה שלה. כך היא לא נכנסת
    // לשטח של קופסה אחרת ולא לכותרת שמעליה.
    // אם אין מקום בתוך הקופסה — משאירים כפי שהוא, כדי לא להוציא תוכן.
    const pageBottom = Number(plan.pageBox?.height) > 0
      ? Number(plan.pageBox.height) - padding
      : Infinity;
    const boxBottom = (() => {
      let low = -Infinity;
      for (const l of lines) {
        const y = Number(l?.y);
        if (Number.isFinite(y) && y > low) low = y;
      }
      return Number.isFinite(low) ? low + pitch : Infinity;
    })();
    const bottom = Math.min(pageBottom, boxBottom);

    // ★ 28/09 — מנקים תיקון-ציור קודם לפני שמחשבים מחדש. בלי זה, שורה
    // שכבר אינה זקוקה להזזה הייתה נשארת מוזזת לנצח.
    for (const l of lines) { if (l && l.renderY != null) delete l.renderY; }

    // מקבצים לטורים לפי חפיפה אופקית, בדיוק כמו שהעין רואה טור.
    // ⬛ `y` כאן הוא עותק מקומי לחישוב. התוכנית (`l.y`) אינה נוגעת.
    const byTop = lines
      .map((l, i) => ({ i, l, y: Number(l.y) || 0, x: Number(l.x) || 0, w: Number(l.width) || 0 }))
      .sort((a, b) => a.y - b.y);

    // ⚠️ מעבר אחד אינו מספיק. כשמזיזים שורה למטה, המרווח בינה לבין
    // **השורה שאחריה** מתקצר — ואז נוצרת צפיפות חדשה במקום אחר.
    // נמדד: אחרי מעבר יחיד ירדו החפיפות ל-0, אבל ערכי המרווח השונים
    // קפצו מ-2 ל-7 והופיעו שתי שורות צפופות חדשות.
    // לכן חוזרים עד שאין יותר מה להזיז: כל מעבר ממיין מחדש לפי הגובה
    // המעודכן. גבול של 6 מעברים כדי שלעולם לא ניתקע.
    let moved = 0;
    for (let pass = 0; pass < 6; pass++) {
      byTop.sort((a, b) => a.y - b.y);
      const movedBefore = moved;
      moved += passOnce();
      if (moved === movedBefore) break;
    }
    return moved;

    function passOnce() {
    let moved = 0;
    for (let i = 0; i < byTop.length; i++) {
      const cur = byTop[i];
      for (let j = i + 1; j < byTop.length; j++) {
        const nxt = byTop[j];
        const overlapX = Math.min(cur.x + cur.w, nxt.x + nxt.w) - Math.max(cur.x, nxt.x);
        if (overlapX <= 1) continue;             // טור אחר — לא נוגע

        // ⛔⛔ 28/09 — כאן היה `if (nxt.y <= cur.y + 0.5) continue`, שדילג
        // על שתי שורות שיושבות באותו גובה. זה נראה סביר — „אותה שורה" —
        // אבל הוא בדיוק מה שהשאיר את החפיפות האחרונות.
        //
        // ⬛ נמדד: שתי שורות מילת-פתיח **שונות** (30 תווים מול 5) נחתו
        //    שתיהן ב-top 471, עם אותו רוחב בדיוק, אחת על גבי השנייה.
        // שתי שורות של אותה קופסה שחופפות אופקית ויושבות באותו גובה הן
        // תמיד תקלה — לא „אותה שורה". לכן הן מטופלות ככל שורה צפופה.

        // ★ שורה שנושאת מילת פתיח **נפתחת** תופסת שתי שורות: האות
        // יורדת לגובה שתיים, והטקסט זורם לצידה. לכן השורה הנראית הבאה
        // חייבת לשבת במרווח כפול.
        // ⬛ זה עדיין „מרחק אחיד": פעמיים אותו מרווח יחיד, ולא מדידה
        //    של האות. בדיוק ההוראה — „המרחק לפי האותיות הרגילות".
        // ⛔⛔⛔ משה 28/09/2026 — „בעמוד א' נבלעו בין השורות הראשונות
        // מילים ששייכות לעמודים הבאים, לא ברור איך זזו אחורה".
        //
        // זו הייתה **רגרסיה שלי**. נתתי מרווח כפול לכל שורה שנושאת
        // מילת פתיח נפתחת — אבל אות יורדת שתי שורות רק כשיש לה שורה
        // שנייה לרדת אליה. בפסקה שכולה שורה אחת (כותרת, שורה יתומה)
        // אין מה לרדת, והמרווח הכפול פשוט פותח חלל ריק.
        //
        // ⬛ נמדד בעמוד א' של משה: **חמש** שורות רצופות, כל אחת מילת
        //    פתיח עם 1–3 מילים בלבד, במרווח 40px במקום 20 — חמש מילים
        //    שפרשׂו על עמוד שלם, ודחפו את שאר התוכן קדימה.
        //
        // ⇒ המרווח הכפול חל **רק** כשיש באמת שורה שנייה באותה פסקה
        //   ובאותו טור — כלומר בדיוק כשהאות באמת יורדת.
        const dropped = cur.l?.openingWord
          && (cur.l.openingWord.position || cur.l.openingWord.model?.position) === 'dropped';
        const nextIsOwnOpening = !!nxt.l?.openingWord;
        const hasSecondLineToWrap = dropped && !nextIsOwnOpening;
        const units = hasSecondLineToWrap ? 2 : 1;
        const needed = cur.y + pitch * units;
        if (nxt.y < needed - 0.5 && needed + pitch <= bottom + 0.5) {
          // ⛔⛔⛔ משה 28/09/2026 — „2b49a0d עדיין כולל את הבאג שבעמוד
          // הראשון השתחל תוכן מהעמוד השני", „לא ברור איך זזו אחורה".
          //
          // כאן היה גם `nxt.l.y = needed` — כלומר כתיבה **לתוך תוכנית
          // העימוד עצמה**. וזה בדיוק מה שמשה אסר: „הסידור של השורות
          // צריך לבצע V9 מחדש, מה שישפיע גם על מה התוכן שיישאר בעמוד
          // הזה ומה ימשיך לעמוד הבא".
          //
          // הנזק: הציור רץ שוב ושוב (רינדור חוזר, שינוי הגדרה, שינוי
          // גודל חלון), ובכל פעם ההזזה מתווספת על הקודמת. השורות זוחלות
          // מטה בהדרגה, והתוכנית שלפיה נקבע מה שייך לאיזה עמוד נדרסת.
          // מכאן התחושה שתוכן „השתחל" מעמוד לעמוד בלי סיבה.
          //
          // ⇒ מעכשיו היישור נוגע **רק במיקום שעל המסך**, ולא בתוכנית.
          //   `nxt.y` הוא עותק מקומי לחישוב בלבד; `nxt.l.y` המקורי
          //   נשאר כפי שהמנוע קבע אותו, ולכן הריצה הבאה מתחילה תמיד
          //   מאותה נקודה ואינה מצטברת.
          nxt.y = needed;
          nxt.l.renderY = needed;
          moved += 1;
        }
        break;                                   // רק השכנה הישירה
      }
    }
    return moved;
    }
  }

  function drawBox(box, fontSize, lineHeight, fontFamily, colorClass) {
    const innerW = plan.pageBox.innerWidth;

    // ★ 28/09 — קודם מחזירים את הרווחים למסלול הרגיל (ראה ההסבר המלא
    // למעלה), ורק אחר כך מציירים. כך אין יותר מה „לפצות" בציור.
    //
    // המרווח האחיד נלקח מהשורות עצמן (`lineHeightPx`), ורק אם אין —
    // מחושב מגודל האות כפול היחס. `lineHeight` שמגיע לכאן הוא **היחס**
    // (1.55) ולא פיקסלים, ולכן אסור להעביר אותו כמו שהוא.
    const uniformPitchPx = (() => {
      for (const l of (box.lines || [])) {
        const v = Number(l?.lineHeightPx);
        if (v > 1) return v;
      }
      const fs = Number(fontSize) > 0 ? Number(fontSize) : 13;
      const ratio = Number(lineHeight) > 0 ? Number(lineHeight) : 1.55;
      return fs * ratio;
    })();
    // ⛔⛔⛔⛔ משה 28/09/2026 — **מוחזר לאחור במלואו.**
    //
    // הוא נכתב כדי לתקן שורות חופפות, ואכן הוריד אותן — אבל הוא בדיוק
    // מה שמשה אסר: „אסור שמנוע ירוץ אחרי כל העימוד של V9". הוא הזיז
    // שורות אחרי שהמנוע כבר קבע איפה כל דבר יושב, ובכל פעם התגלה נזק
    // חדש:
    //   • 75 כותרות זרם מתוך 583 נדרסו על ידי שורות שנדחפו עליהן
    //   • „בעמוד ח' פתאום יש טקסט בפירוש באמצע הטקסט הראשי"
    //   • „הכותרת מופיעה מתחת המדור במקום מעליו"
    //   • „בעמוד הראשון השתחל תוכן מהעמוד השני"
    //
    // כל תיקון שלו הוליד תקלה אחרת, וזה הסימן שהגישה עצמה שגויה ולא
    // הפרטים שלה. הכלל של משה: „משהו נשבר אחרי שינוי? מחזירים לאחור,
    // לא מטליאים מעל השבר."
    //
    // ⇒ המרווחים חוזרים להיות בדיוק מה שהמנוע קבע. הטיפול הנכון
    //   בחפיפות שייך ל**תכנון** (buildPagePlan), לא לציור — וזו
    //   בדיוק ההוראה: „הסידור של השורות צריך לבצע V9 מחדש".
    //
    // ⬛ הפונקציה נשארת בקוד ולא נמחקת, כדי שהלקח והמדידות יישמרו,
    //    אבל היא אינה נקראת.
    void enforceUniformLinePitch;

    // המפה הזאת נשארת **רק** כרשת ביטחון לשורה שהיישור לא הצליח להזיז
    // (כי לא היה מקום עד תחתית העמוד). היא כבר לא הכלי הראשי.
    const byTop = box.lines
      .map((l, i) => ({ i, y: Number(l.y) || 0, x: Number(l.x) || 0, w: Number(l.width) || 0 }))
      .sort((a, b) => a.y - b.y);
    const gapToNext = new Map();
    for (let i = 0; i < byTop.length; i++) {
      const cur = byTop[i];
      for (let j = i + 1; j < byTop.length; j++) {
        const nxt = byTop[j];
        if (nxt.y <= cur.y + 0.5) continue;                 // אותה שורה
        const overlapX = Math.min(cur.x + cur.w, nxt.x + nxt.w) - Math.max(cur.x, nxt.x);
        if (overlapX <= 1) continue;                        // טור אחר — לא רלוונטי
        gapToNext.set(cur.i, nxt.y - cur.y);
        break;
      }
    }
    let __lineIdx = -1;
    // כששתי השורות הראשונות של פסקה עם מילת פתיח מצוירות כבלוק זורם
    // אחד, השורה השנייה כבר נמצאת בתוכו ואין לצייר אותה שוב.
    // ⛔ הסרת הדגל הזו (28/09) היא שגרמה ל-205 בלוקים לגלוש זה על זה.
    for (const line of box.lines) {
      __lineIdx += 1;
      if (line._v9MeasuredStream) {
        renderV9MeasuredStreamLine(line,box,pageEl,padding,colorClass || '');
        continue;
      }
      if (line.layoutVersion === V9_INLINE_PLAN_VERSION) {
        renderV9PlannedMainLine(line, pageEl, padding);
        continue;
      }
      const lineEl = document.createElement('div');
      lineEl.className = 'v9-line' + (colorClass || '');
      // משה 2026-05-10: שורה שמסתיימת בשבירה מאולצת (\n במקור) — לא מיושרת.
      // משה 2026-05-19: חיתוך מלאכותי של המנוע אינו סוף פסקה.
      // לכן גם אם השורה קצרה יחסית, לא מסמנים center. אם מתיחת word-gap
      // רגילה נראית מוגזמת, נשתמש במתיחה מאוזנת יותר בהמשך.
      const continuationFillRatio = line.width > 0
        ? Math.max(0, Math.min(1, (line.naturalWidth || 0) / line.width))
        : 1;
      const isV9StreamLikeStretchBox = String(box.role || box.type || box.kind || (box.id === "main" ? "main" : (box.id ? "stream" : ""))).toLowerCase() !== "main";
      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isSourceContinuationEnd = !!box.syntheticContinuationAfter && line.isLast && !line.forcedBreak;
      const isContinuationCandidate = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues)
        && line.isLast && !line.forcedBreak;
      const isMetricsShort = (Number(line.naturalWidth) || 0) < (Number(line.width) || 0) - 2;
      const isContinuationCut = isContinuationCandidate
        && line.words && line.words.length > 0
        && (isMetricsShort || isV9StreamLikeStretchBox);
      const useManualContinuationStretch = isContinuationCut && continuationFillRatio < 0.65;
      const isRegularMidLine = !line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1;
      const isV9ForcedStreamJustify = isV9StreamLikeStretchBox && isRegularMidLine && !isMetricsShort;
      const shouldJustify = (isRegularMidLine || isContinuationCut)
                             && !useManualContinuationStretch
                             && line.words && line.words.length > 1
                             && (isMetricsShort || isV9StreamLikeStretchBox);
      // משה 2026-05-10: שורה אחרונה ברוחב מלא ממורכזת (לפי כללי ספרי קודש).
      const isFullWidthOrphan = line.isLast && line.width >= innerW - 5;
      const isParagraphEnd = (line.isLast || line.forcedBreak)
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;
      // ★ משה, 24/09/2026: "חלק מהעמודים הוא עושה יותר רווח בין השורות או
      // אולי גם במילים, זה חמור מאוד, מעולם לא ביקשתי כזה דבר", ובאותה
      // נשימה הכלל: "גודל המילים והאותיות והרווחים והכל תמיד יישאר אותו
      // דבר, רק גודל הדף ישתנה בלבד".
      //
      // נמדד בפלט שלו מאותו יום (ravtext-debug-20260924_151247.html):
      // ההגדרות זהות בכל עשרת העמודים — אות 13, גובה שורה 20.15, מרווח
      // מילים 0, בלי מתיחה אופקית. כלומר מקור הרווחים אינו בהגדרות אלא
      // ב**יישור**: 49–95 שורות בכל עמוד מיושרות לרוחב מלא, והמתיחה
      // פותחת רווחים בין המילים. נמדד: 12 שורות עם תוספת מעל 8 פיקסלים
      // לכל רווח, והגרועה — **117 פיקסלים** בעמוד 8. זה חור שרואים בעין.
      //
      // התיקון: תקרת מתיחה. שורה שכדי ליישר אותה צריך להוסיף יותר מ-6
      // פיקסלים לכל רווח — לא מיושרת כלל, ונשארת ברווח הטבעי שלה. זה
      // בדיוק מה שנהוג בדפוס, וזה מסלק את החורים בלי לגעת בגודל האות.
      // משה, 25/09: "אין שום תוכנה שכשמבקשים יישור שורות חלק
      // מהשורות שבורות או יוצאות מרוחב העמוד".
      //
      // הסף הזה מבטל את היישור בשורה שדורשת מתיחה גדולה מדי, כדי
      // שלא ייפערו חורים בין המילים. אבל 6 פיקסלים היו מחמירים מדי:
      // נמדד ש-45 מתוך 97 השורות שבוטל בהן היישור דרשו 6–10 בלבד,
      // וזו מתיחה סבירה לגמרי — ולכן הן נראו "לא מיושרות משני
      // הצדדים" בלי סיבה. הסף הועלה ל-12; שורה שדורשת יותר מכך
      // עדיין לא תימתח.
      const MAX_EXTRA_PER_GAP_PX = V9_MAX_EXTRA_PER_GAP_PX;
      const gapCount = Math.max(1, ((line.words && line.words.length) || 1) - 1);
      const extraPerGap = ((Number(line.width) || 0) - (Number(line.naturalWidth) || 0)) / gapCount;
      // ⛔⛔⛔ משה 28/09/2026 — ההוראה, מילה במילה:
      // „צריך שלא יישארו שום שורות שאינן שלמות, כלומר שום שורה שאינה
      //  מסתיימת בגבול השמאלי של העמוד — למעט מה שמוגדר במקור כפיסקה
      //  נפרדת. בכל מקרה אחר המערכת תבדוק פתרונות עד לחיסול השבירה."
      //
      // ═══ מה היה ═══
      // הייתה תקרת מתיחה: שורה שדורשת יותר מ-20 פיקסלים תוספת לכל
      // רווח — לא מיושרת כלל, ונשארת קצרה. התקרה נולדה מדיווח קודם
      // („רווחים גדולים בין המילים"), והיא הייתה נכונה **אז**.
      //
      // ═══ למה מותר להסיר אותה עכשיו ═══
      // הסיבה שהיו שורות שדרשו מתיחה ענקית הייתה שורות בנות **מילה
      // אחת**, שנולדו מחלון צר מדי למילת פתיח. זה תוקן בשורש (284c554),
      // ונמדד: **0** שורות כאלה נותרו. החוסר החציוני בשורה קצרה הוא
      // עכשיו 18 פיקסלים בלבד — שנפרסים על 5–8 רווחים, כלומר 2–4
      // פיקסלים לרווח. בלתי מורגש לעין.
      //
      // ⇒ שורה שאינה סוף פסקה ואינה שבירה מהמקור **תמיד** נמתחת עד
      //   הקצה. אין יותר שורה „תלויה באוויר" באמצע פסקה.
      //
      // ⬛ שורה שכן מסתיימת פסקה, או שנשברה במקור — לא נגענו בה כלל.
      //    היא ממורכזת או טבעית, בדיוק כפי שהייתה.
      const isTrueParagraphEnd = !!(line.isLast || line.forcedBreak);
      const stretchTooWide = (extraPerGap > MAX_EXTRA_PER_GAP_PX) && isTrueParagraphEnd;
      if (extraPerGap > MAX_EXTRA_PER_GAP_PX) {
        lineEl.dataset.v9StretchWide = String(Math.round(extraPerGap));
      }
      if (stretchTooWide) lineEl.dataset.v9StretchCapped = String(Math.round(extraPerGap));

      // שורה באמצע פסקה שאינה נכנסת לאף קטגוריה אחרת — נמתחת בכוח,
      // כדי שלא תישאר שבורה. זה „חיסול השבירה" שמשה דורש.
      // ⚠️ בלי תנאי על `naturalWidth`. נמדד: ארבע שורות נשארו קצרות
      // למרות שהמנוע חישב אותן כמלאות — כי הוא מודד ברוחב משלו
      // והדפדפן מסדר קצת אחרת. הפער היה 11–23 פיקסלים, וזה בדיוק מה
      // שנראה כשורה „תלויה באוויר". לכן ההחלטה כאן נשענת רק על מה
      // שידוע בוודאות: האם זו סוף פסקה, וכמה מילים יש.
      const mustCompleteLine = !isTrueParagraphEnd
        && line.words && line.words.length > 1;

      if (useManualContinuationStretch) lineEl.className += ' v9-continuation-manual-stretch';
      else if (!isContinuationCut && (isFullWidthOrphan || isParagraphEnd)) lineEl.className += ' center';
      else if ((shouldJustify && !stretchTooWide) || mustCompleteLine) lineEl.className += ' justify';
      lineEl.style.left = (padding + line.x) + 'px';
      // Single geometry authority: the planner owns Y. Even if stale/debug
      // metadata contains a historical renderY value, final paint must ignore
      // it. A second post-plan Y authority is exactly how blank knee rows and
      // stream/main desynchronization were created in older builds.
      lineEl.style.top = line.y + 'px';
      lineEl.style.width = line.width + 'px';
      // ★ משה 14/09/2026 — סנכרון בין המנוע לרינדור.
      // המנוע חישב כמה מילים נכנסות בשורה לפי גודל האות של אותו זרם
      // ושמר אותו ב-line.fontSize. הרינדור, לעומתו, צייר את כל הקופסה
      // בגודל הגלובלי מ-cfg — שתי הוראות סותרות על אותה שורה: אם גודל
      // הציור גדול מזה שחושב הטקסט אינו נכנס ונחתך, ואם קטן — נוצר רווח
      // לבן. לכן מציירים בגודל שהמנוע חישב, ונופלים לגלובלי רק בהיעדרו.
      const drawFontSize = Number(line.fontSize) > 0 ? Number(line.fontSize) : fontSize;
      lineEl.style.height = (drawFontSize * lineHeight) + 'px';
      lineEl.style.fontSize = drawFontSize + 'px';
      lineEl.style.lineHeight = (drawFontSize * lineHeight) + 'px';
      // ★ משה 14/09/2026 — "הפונט בעמוד הראשון אינו הפונט שביקשתי".
      // נמדד בפלט אמיתי: 791 שורות ו-791 מופעים של פונט ברירת-המחדל
      // ברמת השורה, לצד 6,446 מופעים של הפונט האמיתי ברמת המילה.
      // כלומר מילה שאין לה run יורשת את פונט השורה ונראית שונה
      // משכנותיה. לכן: אם כל ה-runs בשורה מסכימים על פונט אחד — הוא
      // נקבע כפונט השורה, והמילים "היתומות" מתיישרות איתו.
      const runFont = dominantRunFontFamily(line);
      if (runFont) lineEl.style.fontFamily = runFont;
      else if (fontFamily) lineEl.style.fontFamily = fontFamily;
      applyStyleToElement(lineEl, box.styleId);
      if (box.inlineStyle) {
        applyTextStyleObjectToElement(lineEl, box.inlineStyle);
      }
      // ★ משה 14/09/2026 — שורש "השטח הלבן בלי סיבה הנראית לעין":
      // הסגנון שמוחל כאן הוא סגנון של **פסקה**, אבל V9 מפרק פסקה לשורות
      // ומחיל אותו על כל שורה בנפרד. התוצאה: margin-top/bottom של פסקה
      // (נמדד אצל משה: 7px + 16px) מופיע בין **כל שתי שורות** — כ-8,000
      // פיקסלים של רווח לבן בדף אחד. ה-margin גם מנפח את מלבן השורה
      // ולכן יוצר "חפיפות" מדומות.
      // שורות V9 ממוקמות ב-position:absolute עם top מחושב מראש, ולכן
      // מרווחי פסקה כאן רק מזיקים — ומנוטרלים.
      lineEl.style.marginTop = "0px";
      lineEl.style.marginBottom = "0px";
      lineEl.style.textIndent = "0px";

      // ★ 28/09/2026 — סימון אבחוני: למה השורה הזאת קצרה.
      // בלי זה אי אפשר למדוד את הדיווח „שורות חתוכות באמצע": מדידה
      // מבחוץ רואה שורה קצרה, אבל לא יודעת אם היא קצרה **כדין** —
      // סוף פסקה או שבירה שנכתבה במקור — או שהיא נשברה שלא לצורך.
      // אלה שני דברים הפוכים: באחד אסור לגעת, בשני חייבים.
      // ⬛ תכונת נתונים בלבד. אין לה שום השפעה על העיצוב או על המידות.
      if (line.forcedBreak) lineEl.dataset.v9ForcedBreak = "1";
      if (line.isLast) lineEl.dataset.v9ParaLast = "1";

      // ★ 29/09 — סימון אבחוני: הרצועה שממנה השורה נולדה.
      // בלי זה אפשר למדוד רק את השורות, ולא את השטח שהמנוע הקצה —
      // וכל הדיון על „הראשי נכנס לשטח של הזרם" נשאר ניחוש.
      // ⬛ תכונות נתונים בלבד. אפס השפעה על עיצוב או מידות.
      if (box.barMitzraStrips && Number.isFinite(Number(line.y))) {
        const st = box.barMitzraStrips.find(s =>
          Number(line.y) >= s.y_start - 0.1 && Number(line.y) < s.y_end - 0.1);
        if (st) {
          lineEl.dataset.v9StripX = String(Math.round(st.x));
          lineEl.dataset.v9StripW = String(Math.round(st.width));
          lineEl.dataset.v9StripY0 = String(Math.round(st.y_start));
          lineEl.dataset.v9StripY1 = String(Math.round(st.y_end));
        }
      }

      // משה 2026-05-13: הגנה נגד חיתוך אותיות/ניקוד.
      // אם הפונט בפועל גדול מגובה השורה המחושב, אסור להשאיר height נמוך.
      const actualFontSize = parseFloat(lineEl.style.fontSize) || line.fontSize || fontSize || 0;
      const requestedLineHeight = line.lineHeightPx || parseFloat(lineEl.style.lineHeight) || (actualFontSize * lineHeight);
      // ★ משה 14/09/2026 — "שיטה תמהונית למרוח תוכן": נמדד בפלט שלו
      // ש-71% משורות הראשי (407 מתוך 576) קיבלו גובה שורה של פי 1.9 עד
      // **3.3** מגודל האות, בעוד התקין הוא ~1.5. זה השטח הלבן.
      // המקור: גובה השורה נלקח מהמדידה בפועל של הפונט, ופונטים עבריים
      // מעוטרים (Guttman Vilna, Rashi DP) מדווחים גובה טבעי עצום. הייתה
      // רק הגנה מלמטה (נגד חיתוך אותיות) ולא תקרה מלמעלה.
      // עכשיו יש גם תקרה: הגובה לא יחרוג מהיחס שנקבע בהגדרות בתוספת 15%.
      const ratioForCap = Math.max(1.35, Number(lineHeight) > 0 ? Number(lineHeight) : 1.55);
      const lineHeightCap = actualFontSize * ratioForCap * 1.15;
      const safeLineHeight = Math.min(
        Math.max(requestedLineHeight, actualFontSize * 1.35),
        Math.max(lineHeightCap, actualFontSize * 1.35)
      );

      if (actualFontSize > 0) lineEl.style.fontSize = actualFontSize + 'px';
      if (safeLineHeight > 0) {
        // ★ משה 25/09: "שורה תחתונה עולה על חצי משורה שמעליה ומכסה
        // חצי ממנה" (עמ' ד' ועמ' ט').
        //
        // נמדד: 62 זוגות שורות חופפים ב-49 מתוך 55 עמודים, כולם
        // בטקסט הראשי. השורש — המנוע הקצה לשורה מרווח של 15.17
        // פיקסלים, ואז שלב הציור הגדיל את גובה הקופסה ל-20.15 כדי
        // להגן על הניקוד. אבל המיקום של השורה **הבאה** כבר נקבע לפי
        // 15.17, ולכן הקופסה הגדולה נכנסה לתוכה. ההפרש 4.98 הוא
        // בדיוק החפיפה שנמדדה.
        //
        // זה בדיוק מה שמשה תיאר: "מחשב חישובים ולאחר מכן לא מתקן את
        // הפלט שנוצר לפי החישובים שלו".
        //
        // התיקון: גובה **הקופסה** נשאר המרווח שהמנוע הקצה, כדי שלא
        // תיכנס לשכנתה. גובה **השורה** (line-height) נשאר הגדול,
        // והאות מצוירת בו במלואה — הדפדפן מצייר מעבר לקופסה כל עוד
        // אין חיתוך, ולכן שום ניקוד לא נעלם.
        // ★ משה 27/09/2026 — התקרה האמיתית היא המרחק **בפועל** לשורה
        // שמתחתיה, לא `lineHeightPx` שהוא קבוע 20.15 גם כשהשורות צפופות.
        const measuredGap = gapToNext.get(__lineIdx);
        const allottedHeight = Number.isFinite(measuredGap) && measuredGap > 0
          ? measuredGap
          : (Number(line.lineHeightPx) > 0 ? Number(line.lineHeightPx) : safeLineHeight);
        // גובה השורה לא יעלה על המרווח בפועל, אחרת האותיות נכנסות לשכנה.
        // רצפה של 1.05 מגודל האות כדי שהגליף עצמו לעולם לא ייחתך.
        const drawnLineHeight = Math.max(
          Math.min(safeLineHeight, allottedHeight),
          actualFontSize * 1.05
        );
        // בלוק זורם של מילת פתיח מחזיק שתי שורות בתוכו, ולכן התקרה
        // של שורה בודדת אינה חלה עליו — היא הייתה חותכת אותו לחצי.
        const isFlowBlock = lineEl.dataset.v9OpeningFlowBlock === '2';
        if (!isFlowBlock) {
          lineEl.style.lineHeight = drawnLineHeight + 'px';
          lineEl.style.height = Math.min(drawnLineHeight, allottedHeight) + 'px';
          if (allottedHeight < safeLineHeight) lineEl.style.overflow = 'visible';
        }
      }

      // 30/09/2026 — page-ending continuation is NOT a paragraph end.
      // The authoritative V9 inline planner now rebalances the whole final
      // paragraph segment before paint. This legacy fallback must therefore
      // never compensate by distorting one row with letter-spacing/scaleX.
      // If an old/non-unified box still reaches this path, allow only a
      // bounded word-gap adjustment; any remaining deficit stays visible
      // instead of turning the last row into a rubber band.
      if (useManualContinuationStretch) {
        const extra = Math.max(0, (Number(line.width) || 0) - (Number(line.naturalWidth) || 0));
        const wordsCount = Array.isArray(line.words) ? line.words.length : 0;
        const spaces = Math.max(0, wordsCount - 1);
        const gentleCap = Math.max(3.6, Math.min(8, actualFontSize * 0.65));

        if (spaces > 0) {
          const requested = extra / spaces;
          const wordExtra = Math.min(requested, gentleCap);
          if (wordExtra > 0) lineEl.style.wordSpacing = wordExtra.toFixed(2) + 'px';
          lineEl.dataset.v9LegacyTailRequestedWordSpacing = requested.toFixed(2);
          if (requested > gentleCap) lineEl.dataset.v9LegacyTailStretchCapped = gentleCap.toFixed(2);
        }
        lineEl.style.letterSpacing = '';
        lineEl.style.transform = '';
        lineEl.style.transformOrigin = '';
        lineEl.dataset.v9LegacyTailGentleOnly = '1';
      }

      lineEl.style.overflow = 'visible';

      const v9Role = String(box.role || box.type || box.kind || (box.id === "main" ? "main" : (box.id ? "stream" : "")) || "");
      if (v9Role) {
        lineEl.dataset.v9Role = v9Role;
        lineEl.classList.add("v9-role-" + v9Role.replace(/[^a-z0-9_-]/gi, "-").toLowerCase());
      }
      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (line.mainColumn) lineEl.dataset.v9MainColumn = String(line.mainColumn);
      // ★ משה 28/09/2026 — סימון לשורה שכבר צומצמה בזרימה עבור מילת הפתיח.
      // בלעדיו, המדידה מה-DOM שרצה אחרי הציור מצמצמת אותה **פעם שנייה**,
      // והנסיגה יוצאת כפולה מרוחב האות (נמדד: פער 106 מול אות ברוחב 49).
      if (line.openingWindow) lineEl.dataset.v9OpeningWindowApplied = "1";
      if (isV9ForcedStreamJustify) lineEl.dataset.v9ForcedStreamJustify = "1";
      if (isColumnAContinuation) lineEl.dataset.v9ColumnAContinuation = "1";
      if (isSourceContinuationEnd) {
        lineEl.dataset.v9SourceContinuationEnd = "1";
        if (box.columnSplitLineEdgeGuard) {
          lineEl.dataset.v9ColumnSplitLastFill = String(box.columnSplitLineEdgeGuard.lastFill || "");
          lineEl.dataset.v9ColumnSplitLastWords = String(box.columnSplitLineEdgeGuard.lastWords || "");
          lineEl.dataset.v9ColumnSplitLeftLongPenalty = String(box.columnSplitLineEdgeGuard.leftLongPenalty || "0");
        }
      }
      // משה 2026-05-13: רינדור עם inline runs — בולד/הדגשה/צבע פר-מילה.
      // אם line.runs ריק, appendTextWithRuns ייצור textNode רגיל (זהה ל-textContent).
      appendV9TextWithMainRefs(lineEl, line);
      pageEl.appendChild(lineEl);
      applyV9MeasuredStreamStretchGuard(lineEl, {
        isCandidate: isV9StreamLikeStretchBox && (isRegularMidLine || isContinuationCandidate),
        targetWidth: line.width,
      });
    }
  }

  function drawTitle(text, x, y, width, colorClass, styleId, streamId) {
    const t = document.createElement('div');
    t.className = 'v9-stream-title' + (colorClass || '');
    t.style.left = (padding + x) + 'px';
    t.style.top = y + 'px';
    t.style.width = width + 'px';
    t.style.height = plan.titleHeight + 'px';
    t.style.fontSize = (cfg.sideFontSize || 11) + 'px';
    t.style.lineHeight = plan.titleHeight + 'px';
    applyStyleToElement(t, styleId);
    // משה 2026-05-13: שליטה בפס מעל המפרש דרך applyBarStyleToElement —
    // לוגיקה מאוחדת עם המנוע הרגיל (תומכת barShow/barPreset/barColor/barThickness).
    // משה 13/09/2026 — תיקון "כיביתי את הפס והוא עדיין שם":
    // ל-.v9-stream-title יש border-bottom קבוע ב-CSS, והוא מוסר רק כאן.
    // קודם הקריאה הותנתה בקיום רשומת הגדרות ב-cfg — ולזרם חדש (למשל זה
    // שנוצר בייבוא) אין רשומה כזו, ולכן הפס נשאר תמיד. עכשיו נופלים חזרה
    // להגדרות האפקטיביות, וכך הכיבוי עובד בכל זרם.
    const settings = streamId
      ? ((cfg.streamSettings || {})[streamId] || getEffectiveStreamSettings(streamId))
      : null;
    if (settings) applyBarStyleToElement(t, settings);
    t.textContent = text;
    pageEl.appendChild(t);
  }

  // ראשי — בלי צבע זרם (הראשי הוא הטקסט המרכזי, לא זרם)
  if (plan.mainBox) {
    drawBox(plan.mainBox, cfg.mainFontSize || 13, cfg.lineHeightRatio || 1.55, cfg.mainFontFamily, '');

    // ★ משה 28/09/2026 — „הצג כותרת זרם בראשי לא עובד".
    //
    // ═══ הסיבה ═══
    // הטקסט הראשי צויר כאן בלי שום קריאה לציור כותרת. כלומר ההגדרה
    // לא „לא עבדה" — היא פשוט לא הייתה קיימת עבורו. לכל זרם צד יש
    // שורת שם מעליו, ולראשי מעולם לא הייתה.
    //
    // ═══ למה זה בטוח ═══
    // הכותרת מצוירת **רק** אם משה הקליד כותרת ל„זרם ראשי" בהגדרות.
    // מי שלא הקליד — הערך ריק, ושום דבר לא משתנה בעמוד.
    // בנוסף: אם אין מקום פנוי מעל השורה הראשונה (למשל כשהכתר יושב
    // שם), לא מציירים — עדיף בלי כותרת מאשר כותרת שדורכת על התוכן.
    const mainTitle = shouldShowStreamTitle(V9_MAIN_STREAM_CODE)
      ? String((cfg.titles || {}).main || "").trim()
      : "";
    if (mainTitle && plan.mainBox.lines && plan.mainBox.lines.length > 0) {
      const firstLine = plan.mainBox.lines[0];
      const titleY = firstLine.y - plan.titleHeight;
      // רק אם השורה נשארת בתוך הדף ולא נכנסת לשטח שמעליה.
      if (titleY >= padding - 0.5) {
        const mainSettings = getEffectiveStreamSettings(V9_MAIN_STREAM_CODE) || {};
        const titleX = plan.mainBox.columns > 1 ? plan.mainBox.x : firstLine.x;
        const titleWidth = plan.mainBox.columns > 1 ? plan.mainBox.width : firstLine.width;
        drawTitle(mainTitle, titleX, titleY, titleWidth, '',
                  mainSettings.titleStyleId || '', V9_MAIN_STREAM_CODE);
      }
    }
  }

  // זרמים צדיים + כותרות — כל זרם בצבע משלו
  for (const box of plan.streamBoxes) {
    const colorClass = streamColorClass(box.id);
    drawBox(box, cfg.sideFontSize || 11, cfg.lineHeightRatio || 1.55, cfg.sideFontFamily, colorClass);

    // משה 13/09/2026: זרם שכבתה בו "הצג כותרת זרם" — לא מציירים שם בכלל.
    const title = shouldShowStreamTitle(box.id) ? (cfg.titles || {})[box.id] : "";
    if (title && box.lines.length > 0) {
      const firstLine = box.lines[0];
      // משה 2026-05-10: צורה 4 —
      //   fullWidthTitle: צד הארוך מקבל כותרת ברוחב מלא של הדף
      //   skipTopTitle: צד הקצר מקבל כותרת מתחת לכתר, מעל התוכן שלו,
      //                 ברוחב + מיקום של עמודת הזרם האמיתית מתחתיה
      if (box.fullWidthTitle) {
        drawTitle(title, 0, padding, plan.pageBox.innerWidth, colorClass, box.titleStyleId, box.id);
      } else if (box.skipTopTitle) {
        drawTitle(title, firstLine.x, firstLine.y - plan.titleHeight, firstLine.width, colorClass, box.titleStyleId, box.id);
      } else {
        drawTitle(title, firstLine.x, firstLine.y - plan.titleHeight, firstLine.width, colorClass, box.titleStyleId, box.id);
      }
    }
  }

  // footers — כל footer בצבע הזרם שלו
  for (const fb of plan.footerBoxes) {
    const colorClass = streamColorClass(fb.id);
    drawBox(fb, cfg.sideFontSize || 11, cfg.lineHeightRatio || 1.55, cfg.sideFontFamily, colorClass);
    const title = shouldShowStreamTitle(fb.id) ? (cfg.titles || {})[fb.id] : "";
    if (title) {
      const titleX = Number.isFinite(Number(fb.titleX)) ? Number(fb.titleX) : 0;
      const titleWidth = Number(fb.titleWidth) > 0 ? Number(fb.titleWidth) : plan.pageBox.innerWidth;
      drawTitle(title, titleX, fb.titleY, titleWidth, colorClass, fb.titleStyleId, fb.id);
    }
  }

  // משה 2026-05-14: פס בין הראשי לכל המפרשים — גם ב-V9.
  // מצייר קו אופקי בקצה התחתון של mainBox אם המשתמש הפעיל את ההגדרה.
  if (plan.mainBox && plan.footerBoxes && plan.footerBoxes.length > 0) {
    const firstFooterId = plan.footerBoxes[0].id;
    const settings = (cfg.streamSettings || {})[firstFooterId] || {};
    if (settings.mainSepShow) {
      const px = Math.max(0, Math.min(6, Number(settings.mainSepThickness) || 1));
      const color = String(settings.mainSepColor || "#888").trim() || "#888";
      if (px > 0) {
        const sep = document.createElement('div');
        sep.className = 'v9-main-separator';
        const mainBottom = plan.mainBox.y + (plan.mainBox.height || 0);
        const firstFooterTop = plan.footerBoxes[0].titleY || mainBottom + 4;
        const sepY = Math.round((mainBottom + firstFooterTop) / 2) - Math.ceil(px / 2);
        sep.style.position = 'absolute';
        sep.style.left = padding + 'px';
        sep.style.top = sepY + 'px';
        sep.style.width = plan.pageBox.innerWidth + 'px';
        sep.style.height = px + 'px';
        sep.style.background = color;
        sep.style.pointerEvents = 'none';
        pageEl.appendChild(sep);
      }
    }
  }

  // V9 page geometry is final at paint time. No post-render routine may
  // change line/title Y coordinates. mainBottomGap is already part of footerY
  // planning above; later passes may diagnose but never move the page.
}

function normalizeV9RequestedPageRange(raw) {
  if (!raw || raw.enabled === false) return null;
  const fromPage = Math.max(1, Math.floor(Number(raw.fromPage) || 1));
  const rawTo = Number(raw.toPage);
  const toPage = Number.isFinite(rawTo) && rawTo > 0
    ? Math.max(fromPage, Math.floor(rawTo))
    : Number.MAX_SAFE_INTEGER;
  return { enabled: true, fromPage, toPage };
}

function currentV9RequestedPageRange(cfg) {
  try {
    const raw = typeof cfg?.pageRangeProvider === "function"
      ? cfg.pageRangeProvider()
      : cfg?.pageRange;
    return normalizeV9RequestedPageRange(raw);
  } catch (_) {
    return null;
  }
}

function v9PageNumberInRange(pageIdx, range) {
  if (!range) return true;
  const pageNumber = Math.max(1, Math.floor(Number(pageIdx) || 0) + 1);
  return pageNumber >= range.fromPage && pageNumber <= range.toPage;
}

function makeV9RangePlaceholder(pageEl, plan, cfg, pageIdx) {
  pageEl.classList.remove("v9-page");
  pageEl.classList.add("page-placeholder", "ravtext-range-skipped");
  pageEl.dataset.realized = "0";
  pageEl.style.width = plan.pageBox.width + "px";
  pageEl.style.height = plan.pageBox.height + "px";
  pageEl.style.boxSizing = "border-box";
  pageEl.style.position = "relative";
  pageEl.style.display = "flex";
  pageEl.style.alignItems = "center";
  pageEl.style.justifyContent = "center";
  pageEl.style.color = "#64748b";
  pageEl.style.background = "rgba(248,250,252,.72)";
  pageEl.style.border = "1px dashed rgba(100,116,139,.35)";
  pageEl.setAttribute("hidden", "");
  pageEl.style.display = "none";
  pageEl.textContent = `עמוד ${pageIdx + 1} — מחוץ לטווח שנבחר`;
  pageEl.__ravtextV9Plan = plan;
  pageEl.__ravtextV9Config = cfg;
  return pageEl;
}

function realizeV9RangePlaceholder(pageEl) {
  if (!pageEl?.classList?.contains("ravtext-range-skipped")) return pageEl;
  const plan = pageEl.__ravtextV9Plan;
  const cfg = pageEl.__ravtextV9Config;
  if (!plan || !cfg || !pageEl.parentNode) return pageEl;

  const real = document.createElement("div");
  real.className = "page v9-page";
  real.setAttribute("dir", "rtl");
  for (const attr of Array.from(pageEl.attributes || [])) {
    if (!attr.name.startsWith("data-")) continue;
    if (attr.name === "data-realized") continue;
    real.setAttribute(attr.name, attr.value);
  }
  real.dataset.realized = "1";
  renderPagePlan(plan, real, cfg);
  const pageIdx = Math.max(0, Math.floor(Number(real.dataset.pageIndex) || 0));
  runV9PageDecoratorsDuringRender(real, pageIdx);
  pageEl.parentNode.replaceChild(real, pageEl);
  return real;
}

export function syncV9PageRange(container, rawRange = null, options = {}) {
  if (!container?.querySelectorAll) return;
  const range = normalizeV9RequestedPageRange(rawRange);
  const realizeIncluded = options.realizeIncluded === true;
  const pages = Array.from(container.querySelectorAll(".page"));
  for (const original of pages) {
    const pageIdx = Math.max(0, Math.floor(Number(original.dataset.pageIndex) || 0));
    const included = v9PageNumberInRange(pageIdx, range);
    let page = original;

    // Realizing a skipped V9 page is expensive. During typing/checkbox changes
    // we only update visibility; the final render pass realizes the selected
    // skipped pages once, after the user's range has settled.
    if (realizeIncluded && included && page.classList.contains("ravtext-range-skipped")) {
      page = realizeV9RangePlaceholder(page);
    }
    if (!page) continue;

    const outside = !!range && !included;
    page.classList.toggle("ravtext-range-outside", outside);
    if (outside) {
      page.setAttribute("hidden", "");
      page.style.display = "none";
    } else if (page.classList.contains("ravtext-range-skipped")) {
      // Keep the lightweight placeholder hidden until final realization.
      page.setAttribute("hidden", "");
      page.style.display = "none";
    } else {
      page.removeAttribute("hidden");
      page.style.display = "";
    }
  }
}

// =====================================================================
// API ראשי - בונה עמוד יחיד או רב-עמודי
// =====================================================================
//
// buildSinglePage: בונה עמוד יחיד מתוכן נתון
//   - container: האלמנט להוסיף את העמוד
//   - pageContent: { mainText, rightStream, leftStream, footerStreams, titles }
//   - config: הגדרות
//   החזרה: { pageEl, plan }

export function buildSinglePage(pageEl, pageContent, config) {
  const plan = buildPagePlan(pageContent, config || {});
  renderPagePlan(plan, pageEl, config || {});
  return plan;
}

function mainLineEndCandidates(text, metrics, widthPx) {
  if (!text || !metrics || !widthPx) return [];
  const out = [];
  const re = /\S+/g;
  let match;
  let lineWidth = 0;
  let wordsInLine = 0;
  let lastEnd = 0;
  const spaceW = metrics.spaceWidth;
  while ((match = re.exec(text)) !== null) {
    const word = match[0];
    const wordW = metrics.measureWord(word);
    const addW = wordsInLine === 0 ? wordW : lineWidth + spaceW + wordW;
    if (addW <= widthPx || wordsInLine === 0) {
      lineWidth = addW;
      wordsInLine++;
      lastEnd = match.index + word.length;
      continue;
    }
    if (lastEnd > 0) out.push(lastEnd);
    lineWidth = wordW;
    wordsInLine = 1;
    lastEnd = match.index + word.length;
  }
  if (lastEnd > 0) out.push(lastEnd);
  return out;
}

function wordEndCandidates(text) {
  if (!text) return [];
  const out = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    out.push(match.index + match[0].length);
  }
  return out;
}

// V9 safe break policy:
// סוף מילה באמצע שורה אינו fallback רגיל.
// במסלולים רגילים: סוף שורה טבעי, סוף משפט, סוף פיסוק.
// סוף מילה רגיל נשאר רק למסלול emergency.
function uniqueSortedBreakOffsets(candidates, min = 1, max = Infinity) {
  return [...new Set((candidates || []).filter(n =>
    Number.isFinite(n) && n >= min && n < max
  ))].sort((a, b) => a - b);
}

function sentenceEndCandidates(text) {
  if (!text) return [];
  const out = [];
  const re = /[.!?…׃:;][\s\u00A0]*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = re.lastIndex;
    if (n > 0 && n < text.length) out.push(n);
  }
  return out;
}

function punctuationEndCandidates(text) {
  if (!text) return [];
  const out = [];
  const re = /[,،؛][\s\u00A0]*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = re.lastIndex;
    if (n > 0 && n < text.length) out.push(n);
  }
  return out;
}

function wordGapCandidates(text) {
  return wordEndCandidates(text);
}

function classifyV9SafeBreakOffset(text, offset, visualLineEnds) {
  if (!text || offset <= 0 || offset >= text.length) return "invalid";
  if ((visualLineEnds || []).includes(offset)) return "visual-line-end";

  const before = text.slice(0, offset);
  const after = text.slice(offset);

  if (/[.!?…׃:;][\s\u00A0]*$/.test(before)) return "sentence-end";
  if (/[,،؛][\s\u00A0]*$/.test(before)) return "punctuation-end";
  if (/\s$/.test(before) || /^\s/.test(after)) return "word-gap";

  return "mid-word-or-bad";
}

// משה 2026-05-17: היררכיית ציונים לחיתוכים — לפי המסמך המלא של ההיררכיה.
// סדר מהזול (גבוה) ליקר (נמוך). ההיררכיה משמשת לבחירת candidates ב-priority
// class — בתוך כל class בוחרים לפי meta.score (fill), אבל class גבוה תמיד
// מנצח class נמוך, ללא תלות ב-fill.
//
//   paragraph-end (1000) — סוף פיסקה. תמיד מועדף.
//   visual-line-end (900) — סוף שורה טבעי של הדפדפן/קנבס.
//   visual-line-end-spread (820) — אחרי פיזור רווחים קל. *לא נפלט עדיין*
//   visual-line-end-shrink (780) — אחרי צמצום רווחים קל.   *לא נפלט עדיין*
//   visual-line-end-letter (700) — אחרי שינוי letter-spacing קל. *לא נפלט עדיין*
//   sentence-end (600) — סוף משפט.
//   punctuation-end (580) — סימן פיסוק.
//   word-gap (100) — סוף מילה באמצע שורה. רק חירום.
//   mid-word-or-bad (-1000) — באמצע מילה. לעולם לא.
//
// PR זה לא מוסיף priority bonus לציון (PR #350 ניסה את זה ושיבר sense של
// rescue thresholds). במקום, ה-priority משמש bucket — chooseStepwiseSplit
// בוחר את ה-bucket הגבוה ביותר שיש בו clean candidate.
const BREAK_PRIORITY = {
  "paragraph-end": 1000,
  "visual-line-end": 900,
  "visual-line-end-spread": 820,
  "visual-line-end-shrink": 780,
  "visual-line-end-letter": 700,
  "sentence-end": 600,
  "punctuation-end": 580,
  "word-gap": 100,
  "mid-word-or-bad": -1000,
  "invalid": -1000,
};

function priorityForBreakKind(kind) {
  const v = BREAK_PRIORITY[kind];
  return Number.isFinite(v) ? v : -1000;
}

function classifiedBreakCandidates(text, offsets, visualLineEnds) {
  const seen = new Set();
  const list = [];
  for (const offset of offsets || []) {
    if (!Number.isFinite(offset) || seen.has(offset)) continue;
    seen.add(offset);
    const kind = classifyV9SafeBreakOffset(text, offset, visualLineEnds || []);
    const priority = priorityForBreakKind(kind);
    if (priority <= 0) continue;
    list.push({ offset, kind, priority });
  }
  list.sort((a, b) => b.priority - a.priority || b.offset - a.offset);
  return list;
}

function safeBreakCandidates(text, visualLineEnds, opts = {}) {
  const min = opts.min || 1;
  const max = opts.max || (text ? text.length : Infinity);
  const includeVisual = opts.includeVisual !== false;
  const includeSentence = opts.includeSentence !== false;
  const includePunctuation = opts.includePunctuation !== false;
  const includeWordGap = opts.includeWordGap === true;

  const out = [];
  if (includeVisual) out.push(...(visualLineEnds || []));
  if (includeSentence) out.push(...sentenceEndCandidates(text));
  if (includePunctuation) out.push(...punctuationEndCandidates(text));
  if (includeWordGap) out.push(...wordGapCandidates(text));

  return uniqueSortedBreakOffsets(out, min, max)
    .filter(n => {
      const kind = classifyV9SafeBreakOffset(text, n, visualLineEnds || []);
      if (kind === "invalid" || kind === "mid-word-or-bad") return false;
      if (!includeWordGap && kind === "word-gap") return false;
      return true;
    });
}

// buildPages: בונה דפים מרובים מרצף פסקאות (כמו V8)
//   - container: האלמנט שאליו יוסיפו דפים
//   - paragraphs: רשימת פסקאות (mainText + notes)
//   - config: הגדרות
//   החזרה: { pages: [pageEl, ...] }

export async function buildPages(container, paragraphs, config = {}) {
  if (!container || !Array.isArray(paragraphs) || !paragraphs.length) return { pages: [] };
  const input = paragraphs.map((p, i) => prepareV9SourceParagraph(p, i));
  const cfg = { ...config, openingWordSettings: config.openingWordSettings || getOpeningWordSettings() };
  // Resolve the fonts used by notes, number labels and bold overrides before
  // creating either main or stream measurement caches. Source notes stay intact.
  const fontStyles = [cfg.mainInlineStyle, resolveTextStyle(cfg.mainStyleId)];
  const streamIds = new Set(['main', ...Object.keys(cfg.streamSettings || {})]);
  const collectStreams = entry => {
    if (!entry || typeof entry !== 'object') return;
    const id = entry.stream || entry.streamId || entry.streamCode;
    if (id) streamIds.add(String(id));
    for (const child of [...(entry.notes || []), ...(entry.children || [])]) collectStreams(child);
  };
  for (const entry of input) collectStreams(entry);
  for (const id of streamIds) {
    for (const settings of [getEffectiveStreamSettings(id), cfg.streamSettings?.[id]]) {
      if (!settings) continue;
      fontStyles.push(settings.inlineStyle, settings.manualStyle);
      for (const [key, value] of Object.entries(settings))
        if (/styleId$/i.test(key) && typeof value === 'string' && value) fontStyles.push(resolveTextStyle(value));
    }
  }
  await waitForV9LayoutFonts(input, { ...cfg, __v9ResolvedFontStyles: fontStyles });
  if (typeof cfg.isCurrent === "function" && !cfg.isCurrent()) return { pages: [], aborted: true };
  // ⛔⛔⛔⛔ משה 29/09/2026 — „שגיאת רינדור: V9_FONT_CHANGED: fonts
  // changed during layout; rerender is required".
  //
  // ═══ מה קורה כאן ═══
  // גופן יכול לסיים להיטען **באמצע** העימוד. אז המידות שנמדדו בתחילת
  // הדרך כבר אינן נכונות, והקוד זיהה זאת נכון.
  //
  // ═══ מה היה שבור ═══
  // התגובה הייתה לזרוק שגיאה — כלומר לזרוק לפח מסמך **גמור** ולהציג
  // למשה מסך ריק עם בקשה שיעשה רינדור מחדש בעצמו.
  //
  // כמו טבח שגילה באמצע הבישול שהמאזניים היו מכוילים לא נכון — ובמקום
  // לבשל שוב, הגיש לסועד פתק שכתוב בו „תבשל בעצמך".
  //
  // ⇒ ההודעה עצמה אמרה מה הפתרון: „rerender is required". אז המערכת
  //   עושה זאת **לבד**, פעם אחת, עכשיו כשהגופנים כבר יציבים. ואם גם
  //   בפעם השנייה הם זזו — מגישים את מה שנבנה, כי מסמך שנמדד בגופן
  //   שהשתנה קצת טוב לאין ערוך ממסמך שאינו קיים.
  const V9_FONT_SETTLE_ATTEMPTS = 2;
  let lastResult = null;
  for (let attempt = 1; attempt <= V9_FONT_SETTLE_ATTEMPTS; attempt++) {
    const context = createMainInlineContext(cfg), streamContexts = new Map();
    try {
      if (attempt > 1) container.innerHTML = "";   // בנייה נקייה, בלי כפילות
      const result = await buildPagesWithInlineContext(container, input,
        { ...cfg, __v9InlineContext: context, __v9StreamContexts: streamContexts });
      lastResult = result;
      if (context.generation === 0) return result;           // הגופנים היו יציבים
      if (result?.aborted) return result;
      if (typeof cfg.isCurrent === "function" && !cfg.isCurrent()) return result;
    } finally {
      context.dispose();
      for (const c of streamContexts.values()) c.dispose();
    }
  }
  if (typeof window !== "undefined") window.__ravtextLastV9FontSettleRetry = true;
  return lastResult || { pages: [] };
}

async function buildPagesWithInlineContext(container, paragraphs, config) {
  if (!container || !Array.isArray(paragraphs) || paragraphs.length === 0) return { pages: [] };

  const cfg = Object.assign({
    pageWidth: 559,
    pageHeight: 794,
    padding: 12,
    mainFontSize: 13,
    sideFontSize: 11,
    lineHeightRatio: 1.55,
    mainFontFamily: 'serif',
    sideFontFamily: 'serif',
    crownLines: 4,
    mainWidthRatio: 0.42,
    mainGap: null,
    streamHorizontalGap: 8,
    gapFillMinRatio: 0.82,
    gapFillMaxMainLines: null,
    carryOnlyMinRatio: 0.78,
    titles: {},
    streamSettings: {},
    levels: [],
    noMidLineSplits: false,
    noMidParagraphSoft: false,
    // משה 13/09/2026: זרם הערות יחיד שעוטף את הראשי — שני הצדדים נגמרים
    // באותו גובה (כמו בדף וילנא). כיבוי מחזיר את ההתנהגות הישנה
    // ("הימני מתמלא ראשון").
    balanceSingleStreamSides: true,
    // משה 2026-05-15: דגל — מונע חיתוכי טקסט באמצע שורה. מטפל רק ברמת
    // השורה, לא ברמת פסקה (זה תפקיד noMidLineSplits).
    //
    // 2026-05-17 (v3): ברירת מחדל חוזרת ל-true. בלי הדגל לא היה ויזואלית
    // טוב יותר — הוא רק חשף חיתוכים שונים. עם הדגל לפחות אין חיתוכים
    // הנראים לעין. מי שרוצה זרימה חופשית של הדפדפן יכבה את ה-checkbox.
    preventMidLineSplit: true,
    pageIndexOffset: 0,
    maxPages: Number.MAX_SAFE_INTEGER,
  }, config || {});
  // משה 2026-05-16: מדיניות פיצול פסקאות/שורות.
  // noMidLineSplits = לא לפצל פיסקה באמצע במצב קשיח.
  // noMidParagraphSoft = לא לפצל פיסקה, אבל מותר למלא חורים עם פסקאות שלמות בלבד.
  // preventMidLineSplit = רלוונטי רק כשכבר מותר לפצל פיסקה; אז מונע חיתוך באמצע שורה.
  // חריג מכוון: גם כש-noMidParagraph פעיל, מותר prefix split אם הוא נדרש
  // כדי שהערות מעוגנות לתחילת הקטע יישארו עם הטקסט שלהן.
  const v9SplitPolicy = buildV9SplitPolicy(cfg);

  const noMidParagraphHard = !!cfg.noMidLineSplits;
  const noMidParagraphSoft = !!cfg.noMidParagraphSoft;
  const noMidParagraph = noMidParagraphHard || noMidParagraphSoft;

  const allowParagraphSplit = !noMidParagraph;
  const allowMidLineSplit = allowParagraphSplit && !cfg.preventMidLineSplit;


  // משה 2026-05-15: ה-while-loop של buildPages רץ באופן סינכרוני וכבד —
  // ללא הפסקות הוא חוסם את ה-main thread לכל זמן הרינדור, כך שהמשתמש
  // לא יכול לשנות הגדרות תוך כדי. הפתרון: בין עמוד לעמוד מוסרים שליטה
  // ל-event loop (setTimeout 0) כדי שאירועי-קלט יטופלו, ובודקים isCurrent
  // — אם התחיל רינדור חדש (עם token גבוה יותר), קוטעים את הנוכחי.
  const isCurrent = typeof cfg.isCurrent === "function" ? cfg.isCurrent : () => true;
  // משה 24/09/2026: „מרנדר רק כשהדף בחזית — צריך להמשיך ברקע.”
  // ההפסקה הזאת רצה **בין עמוד לעמוד**. כשהחלון יורד לרקע הדפדפן
  // מותח כל setTimeout לשנייה שלמה לפחות (ואחרי חמש דקות — לדקה),
  // כך שעמוד אחד לשנייה. yieldToBrowser המשותף עובר שם לצינור
  // ההודעות הפנימי, שאינו נחנק, והקצב נשאר מלא.
  const yieldToBrowser = yieldToBrowserShared;

  const pages = [];
  let cursor = 0;
  let pageIdx = Math.max(0, Math.floor(Number(cfg.pageIndexOffset) || 0));
  let renderedPageCount = 0;
  const splitMetrics = new VilnaMetrics({
    fontFamily: cfg.mainFontFamily,
    fontSize: cfg.mainFontSize,
    lineHeightRatio: cfg.lineHeightRatio,
  });
  const splitInnerWidth = cfg.pageWidth - 2 * cfg.padding;
  const splitMainAreaWidth = Math.floor(splitInnerWidth * cfg.mainWidthRatio);
  const splitMainCols = resolveV9MainColumnCount(cfg);
  const splitMainColumnGap = resolveV9MainColumnGap(cfg);
  const splitMainWidth = splitMainCols > 1
    ? Math.max(1, Math.floor((splitMainAreaWidth - splitMainColumnGap) / splitMainCols))
    : splitMainAreaWidth;

  // משה 2026-05-08: carry-over של טקסט שנחתך מעמוד לעמוד הבא.
  // streamId → string. בכל עמוד, הטקסט נשמר ב-overflow.streams ומועבר
  // לתחילת הזרם בעמוד הבא (לפני ההערות מהפסקאות החדשות).
  let carryOver = {};

  // משה 2026-05-08: pendingParagraph = החצי השני של פסקה שפוצלה בעמוד הקודם.
  // כשמפצלים פסקה, החצי הראשון (עם הערות) הולך לעמוד הנוכחי, והחצי השני
  // (טקסט בלבד, ללא הערות — הן כבר ניתנו) נשמר ל-pendingParagraph לעמוד הבא.
  let pendingParagraph = null;

  // Split candidates must come from the same geometry that will paint them.
  // A static splitMainWidth describes the narrow central column, but a real V9
  // row may widen later on the page after a knee. Using only static-width line
  // ends can therefore propose a "full line" that is barely half of the actual
  // wide row, while the next static candidate already overflows the page.
  //
  // This probe is bounded to underfilled split/final-gap rescue. It never
  // commits geometry; it only exposes source offsets of rows V9 itself planned.
  const actualV9LineEndCandidates = (baseSlice, fragment, {
    relativeSourceOffset = null,
    maxLength = null,
    source = "actual-v9-geometry",
  } = {}) => {
    try {
      if (!fragment?._v9Source || !String(fragment.mainText || "")) return [];
      const probeContent = aggregateForV9(
        [...(baseSlice || []), fragment],
        cfg.titles,
        cfg.streamSettings,
        cfg.levels,
        streamsForPage(pageIdx),
        carryOver
      );
      const probe = buildPagePlan(probeContent, cfg);
      const sourceId = String(fragment._v9Source?.id || fragment.id || "");
      const relativeBase = Number.isFinite(Number(relativeSourceOffset))
        ? Number(relativeSourceOffset)
        : (Number(fragment._v9SourceOffset) || 0);
      const limit = Number.isFinite(Number(maxLength))
        ? Math.max(0, Number(maxLength))
        : String(fragment.mainText || "").length;
      const out = [];
      for (const line of (probe?.mainBox?.lines || [])) {
        if (String(line?.source?.paragraphId || "") !== sourceId) continue;
        const absoluteEnd = Number(line?.source?.end);
        if (!Number.isFinite(absoluteEnd)) continue;
        const offset = absoluteEnd - relativeBase;
        if (!(offset > 0 && offset < limit)) continue;
        out.push({
          kind: "visual-line-end",
          offset,
          priority: 900,
          source,
          reason: "line end from actual V9 strip geometry",
          _v9ActualGeometry: true,
        });
      }
      return out;
    } catch (_) {
      // Geometry-derived candidates are an enhancement. Existing static
      // candidates remain available if a diagnostic probe cannot be built.
      return [];
    }
  };

  // ★ משה 28/09/2026 — "בהגדרות מצוין פנימי/חיצוני... בעמוד אי-זוגי הוא
  // היה צריך להיות ימני ובעמוד זוגי הוא היה צריך להיות שמאלי!!"
  // ההגדרה נשמרה ומעולם לא נקראה — חיפוש חישוב זוגיות עמוד בכל הקובץ
  // החזיר אפס תוצאות, ולכן הראשון ברשימה תמיד ישב מימין.
  // כאן, כשהמצב "פנימי/חיצוני", הצדדים מתחלפים בעמודים הזוגיים בדיוק
  // כפי שמשה תיאר. בשאר המצבים ("ימין/שמאל", "אוטומטי") שום דבר לא זז.
  const streamsForPage = (pageNo) => {
    const list = cfg.talmudStreams;
    if (!Array.isArray(list) || list.length < 2) return list;
    if (cfg.sideMode !== "inner-outer") return list;
    const isOdd = (pageNo + 1) % 2 === 1;      // pageIdx 0 = עמוד א = אי-זוגי
    return isOdd ? list : [list[1], list[0], ...list.slice(2)];
  };

  // „חייבים שאם משהו עולה שלפחות במקרה חירום יהיה חפיפה בלי מחיקה".
  // אם אותו טקסט ראשי נדחה שלוש פעמים ברציפות ואינו מתקצר, זה אומר
  // שאין לו מקום פיזי בשום עמוד. אז — ורק אז — מוותרים על הגלישה
  // סביב הזרמים לעמוד אחד, כדי שהטקסט ייצא. חפיפה גלויה עדיפה
  // אלף מונים על מחיקה שקטה.
  let __mainStuckLen = -1;
  let __mainStuckCount = 0;

  // כל מקרה שבו הערה לא הצליחה להישאר באותו עמוד עם המקור שלה נרשם
  // כאן במקום להפיל את הרינדור. הרשימה נחשפת בסוף, כדי שהתקלה תישאר
  // גלויה וניתנת לספירה — ולא תיעלם בשקט.
  const __v9NoteAnchorFallbacks = [];
  const __v9BaseReservedBottom = Math.max(0, Number(cfg.reservedBottom) || 0);

  while ((cursor < paragraphs.length || hasCarryOver(carryOver) || pendingParagraph) && renderedPageCount < cfg.maxPages) {
    cfg.__v9PageIndex = pageIdx;
    cfg.__v9AllowMainOverlap = __mainStuckCount >= 3;

    // One page = one immutable capacity contract. Apply it BEFORE trialAtN,
    // rescue probes and final plan construction so every planner sees exactly
    // the same physical bottom. Never mutate geometry after render.
    const __v9PageConstraint = resolveV9PageConstraint(cfg.pageTweaks, pageIdx, {
      baseReservedBottom: __v9BaseReservedBottom,
      pageHeight: cfg.pageHeight,
      padding: cfg.padding,
      lineHeight: (Number(cfg.mainFontSize) || 13) * (Number(cfg.lineHeightRatio) || 1.55),
    });
    cfg.__v9PageConstraint = __v9PageConstraint;
    cfg.reservedBottom = __v9PageConstraint.reservedBottom;
    // אורך הזמינות הכולל = pendingParagraph (אם קיים) + פסקאות שלא נצרכו
    const totalAvail = (pendingParagraph ? 1 : 0) + (paragraphs.length - cursor);

    // getSlice(n) = n פסקאות מהראש של רשימת הזמינות (pending קודם, אחר כך paragraphs[cursor..])
    const getSlice = (n) => {
      const out = [];
      let need = n;
      if (pendingParagraph && need > 0) { out.push(pendingParagraph); need--; }
      if (need > 0) out.push(...paragraphs.slice(cursor, cursor + need));
      return out;
    };

    const trialAtN = (n) => {
      const slice = getSlice(n);
      const aggContent = aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver);
      return buildPagePlan(aggContent, cfg);
    };

    // A plan is clean when main text fits and every required note has actually
    // STARTED on its anchor page. The remainder of an already-started long note
    // may legally continue to the next page; rejecting that remainder was the
    // root of V9_NOTE_ANCHOR_NO_FIT and of severely underfilled pages.
    const fitsClean = (tp) => {
      if (!tp || !tp.overflow) return false;
      if (tp.overflow.exceedsPage) return false;
      if (tp.overflow.mainText) return false;
      if (tp.unstartedNotes?.length) return false;
      if (hasUnsafeV9StreamOverflow(tp)) return false;
      return true;
    };

    const planBottomY = (tp) => {
      if (!tp) return 0;
      let bottom = 0;
      const visitLines = (lines) => {
        for (const line of (lines || [])) {
          bottom = Math.max(bottom, (line.y || 0) + (line.lineHeightPx || line.height || 0));
        }
      };
      visitLines(tp.mainBox && tp.mainBox.lines);
      for (const box of (tp.streamBoxes || [])) visitLines(box && box.lines);
      for (const box of (tp.footerBoxes || [])) {
        bottom = Math.max(bottom, (box.titleY || 0) + (box.titleHeight || 0));
        visitLines(box && box.lines);
      }
      return bottom;
    };

    const pageBottomForFill = cfg.pageHeight - cfg.padding - (cfg.reservedBottom || 0);
    const fillsPageEnough = (tp, minRatio = 0.82) => {
      if (!pageBottomForFill) return false;
      return planBottomY(tp) / pageBottomForFill >= minRatio;
    };

    const planFillRatio = (tp) => {
      const pb = Math.max(1, pageBottomForFill);
      return planBottomY(tp) / pb;
    };
    const rescueMinFillRatio = Math.max(cfg.gapFillMinRatio || 0, 0.82);

    const planHasCommentaryStart = (tp) => {
      const streamCount = (tp && tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
      const footerCount = (tp && tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
      return streamCount + footerCount > 0;
    };
    const planCommentaryLineCount = (tp) => {
      const streamCount = (tp && tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
      const footerCount = (tp && tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
      return streamCount + footerCount;
    };
    const planMainLineCount = (tp) =>
      (tp && tp.mainBox && Array.isArray(tp.mainBox.lines)) ? tp.mainBox.lines.length : 0;
    const carryActive = hasCarryOver(carryOver);

    const dynamicGapFillMaxMainLines = () => {
      const explicit = parseInt(cfg.gapFillMaxMainLines, 10);
      if (Number.isFinite(explicit) && explicit > 0) return explicit;
      const lineH = cfg.mainFontSize * cfg.lineHeightRatio;
      const availableLines = Math.max(1, v9LinesThatFit(cfg.pageHeight - 2 * cfg.padding, lineH));
      return Math.max(4, Math.min(9, Math.round(availableLines * 0.22)));
    };
    const carryGapMaxMainLines = () => Math.max(3, Math.min(5, dynamicGapFillMaxMainLines()));

    // 1. מצא bestN_clean = מקסימום פסקאות שנכנסות נקי (כולל כל ההערות שלהן)
    let bestN_clean = 0;
    let bestCleanPlan = null;
    for (let n = 1; n <= 50 && n <= totalAvail; n++) {
      const tp = trialAtN(n);
      if (!fitsClean(tp)) break;
      bestN_clean = n;
      bestCleanPlan = tp;
    }

    // 2. אם נשארו פסקאות שלא נכנסו נקי — ננסה לקחת prefix של הבאה.
    // משה 2026-05-09: ★ פיצול מעוגן — ההערות מתחלקות לפי anchor (מיקום בטקסט).
    // ההערות שמעוגנות לפני נקודת הפיצול הולכות לעמוד הזה, השאר לעמוד הבא.
    // כך כל עמוד מקבל רק את הפרשנים של השורות שעליו (כמו במנוע הרגיל).
    let splitInfo = null;
    const cleanFill = planFillRatio(bestCleanPlan);
    const splitTargets = (allowParagraphSplit || noMidParagraph)

      ? [
          ...(bestN_clean < totalAvail ? [bestN_clean] : []),
        ]
      : [];
    for (const targetSliceIdx of splitTargets) {
      if (splitInfo) break;
      const sliceIdx = targetSliceIdx;
      const baseN = Math.max(0, sliceIdx);
      const fromArrayOffset = pendingParagraph ? sliceIdx - 1 : sliceIdx;
      const target = (pendingParagraph && sliceIdx === 0)
        ? pendingParagraph
        : paragraphs[cursor + fromArrayOffset];
      const fullText = (target?.mainText || '').trim();
      // משה 2026-05-09: MIN_SPLIT=8 — מאפשר פיצולים אגרסיביים של פסקאות עם הרבה
      // הערות. גבוה מדי = pendings שלא מצליחים להתפצל; נמוך מדי = רעש.
      const MIN_SPLIT = 8;
      // משה 2026-05-09: פיצול הערות לפי anchor + חלוקה פרופורציונלית של חסרות-anchor.
      // הערות עם anchor (number) מתחלקות לפי המיקום בטקסט.
      // הערות חסרות-anchor (undefined/null) מתחלקות לפי יחס prefix/total — אחרת
      // הן כולן מצטברות לחצי ראשון וגורמות לחריגה שמונעת פיצול נוסף.
      const allNotes = target?.notes || [];
      const anchored = allNotes.filter(n => typeof n.anchor === 'number');
      const anchorless = allNotes.filter(n => typeof n.anchor !== 'number');
      const notesBeforeAnchor = (len) => {
        const ratio = fullText.length > 0 ? len / fullText.length : 0;
        const anchorlessShare = Math.round(anchorless.length * ratio);
        const anchoredBefore = anchored.filter(n => n.anchor < len || (n.anchor === len && n.anchorAffinity === 'backward'));
        const before = [...anchorless.slice(0, anchorlessShare), ...anchoredBefore]
          .sort((a, b) => (typeof a.anchor === 'number' ? a.anchor : -1) - (typeof b.anchor === 'number' ? b.anchor : -1));
        return before;
      };
      const notesFromAnchor = (len, movedNotes) => {
        const moved = new Set(movedNotes || []);
        const ratio = fullText.length > 0 ? len / fullText.length : 0;
        const anchorlessShare = Math.round(anchorless.length * ratio);
        const anchorlessFrom = anchorless.slice(anchorlessShare).filter(n => !moved.has(n));
        const anchoredFrom = anchored
          .filter(n => !moved.has(n))
          .map(n => ({ ...n, anchor: n.anchor >= len ? n.anchor - len : 0 }));
        return [...anchorlessFrom, ...anchoredFrom];
      };
      if (fullText.length >= MIN_SPLIT) {
        const baseSlice = getSlice(baseN);
        const tryPrefix = (len) => {
          const half = sliceV9Paragraph(target, 0, len, { notes: notesBeforeAnchor(len) });
          const slice = [...baseSlice, half];
          return buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
        };
        const splitPlanMeta = (tp, movedNotes) => {
          if (!tp || !tp.overflow || tp.overflow.mainText || tp.unstartedNotes?.length) return null;
          const lineCount = planMainLineCount(tp);
          const streamCount = (tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
          const footerCount = (tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
          const commentaryCount = streamCount + footerCount;
          const movedHasAnchoredNote = Array.isArray(movedNotes)
            && movedNotes.some(n => typeof n.anchor === "number");

          // משה 2026-05-17:
          // noMidParagraph לא אמור להרוג split הכרחי שמטרתו להצמיד
          // הערות לתחילת הקטע שלהן. לכן במצב noMidParagraph מותר split
          // רק אם prefix החיתוך באמת מעביר הערה מעוגנת.
          if (noMidParagraph && !movedHasAnchoredNote) return null;

          const ovs = tp.overflow.streams || {};
          const hasNoteOverflow = Object.keys(ovs).some(k => ovs[k]);
          if (hasNoteOverflow) {
            if (!Array.isArray(movedNotes) || movedNotes.length === 0) return null;
            if (commentaryCount === 0) return null;
          } else if (!fitsClean(tp)) {
            return null;
          }
          if (

            !movedHasAnchoredNote &&

            bestN_clean > 0 &&

            !hasNoteOverflow &&

            commentaryCount === 0 &&

            fillsPageEnough(bestCleanPlan, 0.72)

          ) return null;


          const fill = planFillRatio(tp);

          if (

            !movedHasAnchoredNote &&

            bestN_clean > 0 &&

            fill <= cleanFill + 0.03

          ) return null;
          const belowTargetPenalty = hasNoteOverflow && fill < cfg.gapFillMinRatio
            ? (cfg.gapFillMinRatio - fill) * 0.25
            : 0;
          const overflowPenalty = hasNoteOverflow ? 0.02 : 0;
          const extraMainPenalty = hasNoteOverflow
            ? Math.max(0, lineCount - dynamicGapFillMaxMainLines()) * 0.01
            : 0;
          const carryMainPenalty = carryActive && hasNoteOverflow ? Math.max(0, lineCount - 2) * 0.04 : 0;
          const score = fill - overflowPenalty - belowTargetPenalty - extraMainPenalty - carryMainPenalty;
          return { score, hasNoteOverflow, fill, lineCount, commentaryCount };
        };
        const makeSplit = (len, movedNotes) => {
          const splitText = splitMainTextAtOffset(fullText, len);
          const splitNotes = splitNotesByAnchor(
            target?.notes || [],
            splitText.splitOffset,
            fullText.length,
            splitText.suffixBaseOffset
          );
          return {
            ...splitV9Paragraph(target, splitText, movedNotes || splitNotes.before, splitNotes.after),
            sliceIdx,
            baseN,
          };
        };
        // משה 2026-05-17 (v4): chooseStepwiseSplit עובד על מועמדים עם priority.
        // ההיררכיה: visual-line-end (900) תמיד מנצח sentence-end (600) אם
        // יש לו clean candidate. בתוך אותו priority class, meta.score (fill)
        // משמש tie-break. אין bonus משולב לציון — priority הוא bucket, לא
        // תוסף. ככה הסיפים של rescue/extension לא נשברים.
        // noteOverflow הוא fallback אחרון — מועדף על "כלום" אבל גרוע מכל
        // candidate נקי, לא משנה באיזה priority.
        const chooseStepwiseSplit = (prioritizedCandidates) => {
          const v9PolicyDebug = {
            pageIdx,
            targetSliceIdx: sliceIdx,
            bestN_clean,
            fullTextLength: fullText.length,
            candidates: [],
            selected: null,
          };
          if (!prioritizedCandidates || !prioritizedCandidates.length) {
            debugV9SplitDecision({ ...v9PolicyDebug, reason: "no-candidates" });
            return null;
          }
          const bestCleanByPriority = new Map();
          const firstOverflowByPriority = new Map();
          for (const cand of prioritizedCandidates) {
            const movedNotes = notesBeforeAnchor(cand.offset);
            const tp = tryPrefix(cand.offset);
            const meta = splitPlanMeta(tp, movedNotes);
            const policyScore = scoreV9PageCandidate(tp, cand, v9SplitPolicy, {
              cfg,
              movedNotes,
              pageIdx,
              targetSliceIdx: sliceIdx,
            });
            v9PolicyDebug.candidates.push({
              offset: cand.offset,
              kind: cand.kind,
              priority: cand.priority,
              meta,
              policyScore,
            });
            if (!meta || policyScore.accept === false) continue;
            if (meta.hasNoteOverflow) {
              if (!firstOverflowByPriority.has(cand.priority)) {
                firstOverflowByPriority.set(cand.priority, makeSplit(cand.offset, movedNotes));
              }
              continue;
            }
            const entry = bestCleanByPriority.get(cand.priority);
            if (!entry || meta.score > entry.score) {
              bestCleanByPriority.set(cand.priority, {
                score: meta.score,
                split: makeSplit(cand.offset, movedNotes),
              });
            }
          }
          const cleanPriorities = [...bestCleanByPriority.keys()].sort((a, b) => b - a);
          if (cleanPriorities.length) {
            const selected = bestCleanByPriority.get(cleanPriorities[0]).split;
            debugV9SplitDecision({ ...v9PolicyDebug, selected, selectedPriority: cleanPriorities[0], selectedMode: "clean" });
            return selected;
          }
          const overflowPriorities = [...firstOverflowByPriority.keys()].sort((a, b) => b - a);
          if (overflowPriorities.length) {
            const selected = firstOverflowByPriority.get(overflowPriorities[0]);
            debugV9SplitDecision({ ...v9PolicyDebug, selected, selectedPriority: overflowPriorities[0], selectedMode: "overflow-fallback" });
            return selected;
          }
          debugV9SplitDecision({ ...v9PolicyDebug, reason: "no-accepted-candidate" });
          return null;
        };
        const lineEnds = mainLineEndCandidates(fullText, splitMetrics, splitMainWidth)
          .filter(n => n >= MIN_SPLIT && n < fullText.length);
        const semanticEnds = safeBreakCandidates(fullText, lineEnds, {
          min: MIN_SPLIT,
          max: fullText.length,
          includeVisual: false,
          includeSentence: true,
          includePunctuation: true,
          includeWordGap: false,
        });
        // PR #374 wiring: generate candidates through centralized V9 split policy.
        // The old lineEnds/semanticEnds variables remain above for fallback/debug parity.
        const policyCandidates = buildParagraphBreakCandidates(
          fullText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "primary" }
        );
        const unifiedCandidates = (allowParagraphSplit
          ? policyCandidates
          : policyCandidates.filter(c => c.kind === "visual-line-end" || c.kind === "adjusted-line-end")
        );
        splitInfo = chooseStepwiseSplit(unifiedCandidates);
        if (!splitInfo && bestN_clean === 0 && sliceIdx === 0) {
          const fallbackCandidate = buildParagraphBreakCandidates(
            fullText,
            splitMetrics,
            splitMainWidth,
            v9SplitPolicy,
            { source: "fallback" }
          ).find(c => c.offset >= MIN_SPLIT && c.offset < fullText.length);

          const fallbackLen = fallbackCandidate?.offset || null;
          if (fallbackLen) {

            const movedNotes = notesBeforeAnchor(fallbackLen);

            const movedHasAnchoredNote = movedNotes.some(n => typeof n.anchor === "number");

            if (allowParagraphSplit || movedHasAnchoredNote) {
              const splitText = splitMainTextAtOffset(fullText, fallbackLen);
              const splitNotes = splitNotesByAnchor(
                target?.notes || [],
                splitText.splitOffset,
                fullText.length,
                splitText.suffixBaseOffset
              );

              const firstHalf = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).firstHalf;

              const secondHalf = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).secondHalf;

              const fallbackPlan = buildPagePlan(
                aggregateForV9([...getSlice(baseN), firstHalf], cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver),
                cfg
              );
              const fallbackScore = scoreV9PageCandidate(
                fallbackPlan,
                fallbackCandidate,
                v9SplitPolicy,
                { cfg, movedNotes: splitNotes.before, pageIdx, source: "fallback" }
              );

              if (fallbackScore.accept) {
                splitInfo = { firstHalf, secondHalf, sliceIdx, baseN };
              }
}

          }
        }
      }
    }

    // Gap rescue: only after the clean/anchored policy has a weak page, try a
    // line-first split that carries real notes and materially improves fill.
    // V9 note fit priority:
    // הערות ששייכות לעמוד קודמות ל-fill. אם יש גלישת הערות, rescue חייב
    // לנסות להוריד שורות מהראשי כדי להכניס את ההערות, ולא לפסול candidate
    // רק בגלל ירידה קטנה במילוי העמוד.
    // V9 partial note fill:
    // רק אחרי שאין גלישת הערות קיימת בעמוד, מותר למשוך שורה מהעמוד הבא
    // ואת תחילת ההערות שלה כדי לסתום רווח. אסור להשתמש בזה כדי לגרש
    // הערות שכבר שייכות לעמוד הנוכחי.
    // משה 2026-05-17:
    // anchored rescue/extension גם כש-noMidParagraph פעיל, כדי להחזיר את
    // מנגנון האיזון: מורידים עוד שורות מהראשי כדי לפנות מקום להערות שלהן,
    // אבל לא מפצלים סתם בלי הערה מעוגנת.
    if (allowParagraphSplit || noMidParagraph) {
      const currentSlice = splitInfo
        ? [...getSlice(splitInfo.baseN), splitInfo.firstHalf]
        : getSlice(bestN_clean);
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      const currentHasNoteOverflow = Object.keys((currentPlan && currentPlan.overflow && currentPlan.overflow.streams) || {})
        .some(k => currentPlan.overflow.streams[k]);
      if ((currentHasNoteOverflow || currentFill < rescueMinFillRatio) && totalAvail > 0) {
        let rescueBest = null;
        let rescueBestScore = currentHasNoteOverflow ? -Infinity : currentFill;
        for (let sliceIdx = 0; sliceIdx < Math.min(totalAvail, 3); sliceIdx++) {
          const baseN = Math.max(0, sliceIdx);
          const fromArrayOffset = pendingParagraph ? sliceIdx - 1 : sliceIdx;
          const target = (pendingParagraph && sliceIdx === 0)
            ? pendingParagraph
            : paragraphs[cursor + fromArrayOffset];
          const fullText = (target?.mainText || '').trim();
          if (fullText.length < 2) continue;

          const allNotes = target?.notes || [];
          if (!allNotes.length) continue;
          const anchored = allNotes.filter(n => typeof n.anchor === 'number');
          const anchorless = allNotes.filter(n => typeof n.anchor !== 'number');
          const notesBeforeAnchor = (len) => {
            const ratio = fullText.length > 0 ? len / fullText.length : 0;
            const anchorlessShare = Math.round(anchorless.length * ratio);
            const anchoredBefore = anchored.filter(n => n.anchor < len || (n.anchor === len && n.anchorAffinity === 'backward'));
            return [...anchorless.slice(0, anchorlessShare), ...anchoredBefore]
              .sort((a, b) => (typeof a.anchor === 'number' ? a.anchor : -1) - (typeof b.anchor === 'number' ? b.anchor : -1));
          };
          const notesFromAnchor = (len, movedNotes) => {
            const moved = new Set(movedNotes || []);
            const ratio = fullText.length > 0 ? len / fullText.length : 0;
            const anchorlessShare = Math.round(anchorless.length * ratio);
            const anchorlessFrom = anchorless.slice(anchorlessShare).filter(n => !moved.has(n));
            const anchoredFrom = anchored
              .filter(n => !moved.has(n))
              .map(n => ({ ...n, anchor: n.anchor >= len ? n.anchor - len : 0 }));
            return [...anchorlessFrom, ...anchoredFrom];
          };

          const baseSlice = getSlice(baseN);
          const rescueCandidates = buildParagraphBreakCandidates(
            fullText,
            splitMetrics,
            splitMainWidth,
            v9SplitPolicy,
            { source: "gap-rescue" }
          ).filter(c => c.offset >= 2 && c.offset < fullText.length);

          const limitedRescueCandidates = carryActive
            ? selectV9GapFillCandidates(rescueCandidates, {
                remainingPx: Math.max(0, pageBottomForFill - planBottomY(currentPlan)),
                lineHeight: (Number(cfg.mainFontSize) || 13) * (Number(cfg.lineHeightRatio) || 1.55),
                // In carry mode this setting is a real MAIN-LINE budget. The
                // candidate list is priority/offset-descending by default, so
                // slicing it directly accidentally inspected the deepest cuts.
                // Reorder by source offset first, then cap the number of rows.
                maxCandidates: carryGapMaxMainLines() + 1,
              })
            : rescueCandidates;

          for (const rescueCandidate of limitedRescueCandidates) {
            const len = rescueCandidate.offset;
            const movedNotes = notesBeforeAnchor(len);
            if (!movedNotes.length) continue;
            const movedHasAnchoredNote = movedNotes.some(n => typeof n.anchor === "number");
            if (noMidParagraph && !movedHasAnchoredNote) continue;
          const splitText = splitMainTextAtOffset(fullText, len);
            const splitNotes = splitNotesByAnchor(
              target?.notes || [],
              splitText.splitOffset,
              fullText.length,
              splitText.suffixBaseOffset
            );

            const firstHalf = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).firstHalf;

            const slice = [...baseSlice, firstHalf];
            const tp = buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
            if (!tp || !tp.overflow || tp.overflow.mainText) continue;

            const rescueScore = scoreV9PageCandidate(
              tp,
              rescueCandidate,
              v9SplitPolicy,
              { cfg, movedNotes: splitNotes.before, pageIdx, source: "gap-rescue" }
            );
            if (!rescueScore.accept) continue;

            const commentaryCount = (tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0)
              + (tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
            if (commentaryCount === 0) continue;
            const fill = planFillRatio(tp);
            if (!currentHasNoteOverflow && fill < currentFill - 0.04) continue;
            const noteOverflow = hasV9StreamOverflow(tp);

            // A note that has already started on its source page may continue.
            // Reject only a continuation that did not establish legal ownership
            // (unstarted note / zero commentary progress).
            if (noteOverflow && hasUnsafeV9StreamOverflow(tp)) continue;

            const mainProgressBonus = carryActive ? 0 : Math.min(0.12, (len / Math.max(1, fullText.length)) * 0.12);

            const score =

              (currentHasNoteOverflow ? 1 : 0) +

              fill + mainProgressBonus;

            if (score < rescueBestScore) continue;
            rescueBestScore = score;
            rescueBest = {
              firstHalf,
              secondHalf: splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).secondHalf,
              sliceIdx,
              baseN,
            };
          }
        }
        if (rescueBest) splitInfo = rescueBest;
      }
    }

    if (splitInfo && (allowParagraphSplit || noMidParagraph)) {
      const currentSlice = [...getSlice(splitInfo.baseN), splitInfo.firstHalf];
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      const currentHasNoteOverflow = Object.keys((currentPlan && currentPlan.overflow && currentPlan.overflow.streams) || {})
        .some(k => currentPlan.overflow.streams[k]);
      const secondText = (splitInfo.secondHalf?.mainText || '').trim();
      const extensionBottom = planBottomY(currentPlan);
      const extensionRemainingPx = Math.max(0, pageBottomForFill - extensionBottom);
      const extensionLineH = (Number(cfg.mainFontSize) || 13) * (Number(cfg.lineHeightRatio) || 1.55);
      const extensionTrigger = evaluateV9PhysicalGapFillTrigger({
        remainingPx: extensionRemainingPx,
        lineHeight: extensionLineH,
        beforeFill: currentFill,
        cfg,
        manualPull: false,
      });

      // A page may be globally "full enough" by ratio while still wasting a
      // visible physical row. Probe extension only when the old sparse-page
      // rule allows it OR there is measured physical room. Candidate safety,
      // source ownership and the historical score floor remain authoritative.
      if ((currentFill < rescueMinFillRatio || extensionTrigger.ok) && secondText.length > 0) {
        const secondNotes = splitInfo.secondHalf.notes || [];
        const anchored = secondNotes.filter(n => typeof n.anchor === 'number');
        const anchorless = secondNotes.filter(n => typeof n.anchor !== 'number');
        const notesBeforeAnchor = (len) => {
          const ratio = secondText.length > 0 ? len / secondText.length : 0;
          const anchorlessShare = Math.round(anchorless.length * ratio);
          const anchoredBefore = anchored.filter(n => n.anchor < len || (n.anchor === len && n.anchorAffinity === 'backward'));
          return [...anchorless.slice(0, anchorlessShare), ...anchoredBefore]
            .sort((a, b) => (typeof a.anchor === 'number' ? a.anchor : -1) - (typeof b.anchor === 'number' ? b.anchor : -1));
        };
        const notesFromAnchor = (len, movedNotes) => {
          const moved = new Set(movedNotes || []);
          const ratio = secondText.length > 0 ? len / secondText.length : 0;
          const anchorlessShare = Math.round(anchorless.length * ratio);
          const anchorlessFrom = anchorless.slice(anchorlessShare).filter(n => !moved.has(n));
          const anchoredFrom = anchored
            .filter(n => !moved.has(n))
            .map(n => ({ ...n, anchor: n.anchor >= len ? n.anchor - len : 0 }));
          return [...anchorlessFrom, ...anchoredFrom];
        };
        let actualGeometryCandidates = [];
        try {
          const reconstructed = joinV9ParagraphFragments(splitInfo.firstHalf, splitInfo.secondHalf);
          // The second half is normally canonical with no edge trim. If it ever
          // is not, fall back to the static candidates rather than invent an
          // offset in a different string domain.
          if (String(splitInfo.secondHalf?.mainText || "") === secondText) {
            actualGeometryCandidates = actualV9LineEndCandidates(
              getSlice(splitInfo.baseN),
              reconstructed,
              {
                relativeSourceOffset: Number(splitInfo.secondHalf?._v9SourceOffset) || 0,
                maxLength: secondText.length,
                source: "extension-rescue-actual-geometry",
              }
            );
          }
        } catch (_) {
          actualGeometryCandidates = [];
        }

        const extendCandidates = selectV9GapFillCandidates(
          [
            ...buildParagraphBreakCandidates(
              secondText,
              splitMetrics,
              splitMainWidth,
              v9SplitPolicy,
              { source: "extension-rescue" }
            ),
            ...actualGeometryCandidates,
          ].filter(c => c.offset >= 2 && c.offset <= secondText.length),
          {
            remainingPx: extensionRemainingPx,
            lineHeight: extensionLineH,
            maxCandidates: cfg.extensionGapFillMaxCandidates,
          }
        );
        let bestExtended = null;
        let bestExtendedScore = currentFill;
        for (const extendCandidate of extendCandidates) {
          const len = extendCandidate.offset;
          const movedNotes = notesBeforeAnchor(len);
          const movedHasAnchoredNote = movedNotes.some(n => typeof n.anchor === "number");
          if (noMidParagraph && !movedHasAnchoredNote) continue;
          const splitText = splitMainTextAtOffset(secondText, len);
          const splitNotes = splitNotesByAnchor(
            secondNotes,
            splitText.splitOffset,
            secondText.length,
            splitText.suffixBaseOffset
          );

          const prefix = splitText.prefixText;
          if (!prefix) continue;

          const extension = splitV9Paragraph(splitInfo.secondHalf, splitText, splitNotes.before, splitNotes.after);
          const firstHalf = joinV9ParagraphFragments(splitInfo.firstHalf, extension.firstHalf,
            [...(splitInfo.firstHalf.notes || []), ...splitNotes.before]);
          const secondHalf = extension.secondHalf;
          const slice = [...getSlice(splitInfo.baseN), firstHalf];
          const tp = buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
          if (!tp || !tp.overflow || tp.overflow.mainText) continue;

          const extensionScore = scoreV9PageCandidate(
            tp,
            extendCandidate,
            v9SplitPolicy,
            { cfg, movedNotes: splitNotes.before, pageIdx, source: "extension-rescue" }
          );
          if (!extensionScore.accept) continue;

          const noteOverflow = hasV9StreamOverflow(tp);

          // Same ownership rule as the rest of V9: an already-started long note
          // may continue; only an unsafe/unstarted continuation blocks extension.
          if (noteOverflow && hasUnsafeV9StreamOverflow(tp)) continue;

          const fill = planFillRatio(tp);
          const candidateBottom = planBottomY(tp);
          const physicalGain = evaluateV9PhysicalGapFillGain({
            beforeBottom: extensionBottom,
            afterBottom: candidateBottom,
            lineHeight: extensionLineH,
            beforeFill: currentFill,
            afterFill: fill,
            cfg,
            manualPull: false,
          });
          if (!physicalGain.ok) continue;

          const movedAnchoredCount = movedNotes.filter(n => typeof n.anchor === "number").length;

          const partialNextNoteFillBonus = Math.min(0.12, movedAnchoredCount * 0.04 + movedNotes.length * 0.02);

          const score =

            fill +

            partialNextNoteFillBonus +

            (carryActive ? 0 : Math.min(0.08, (len / Math.max(1, secondText.length)) * 0.08));

          if (score < bestExtendedScore) continue;
          bestExtendedScore = score;
          bestExtended = { firstHalf, secondHalf };
        }
        if (bestExtended) {
          splitInfo = { ...splitInfo, ...bestExtended };
        }
      }
    }


    // משה 2026-05-16: מסלול חירום בלבד.
    // אם המשתמש ביקש לא לפצל פיסקאות, אנחנו מכבדים זאת במצב רגיל.
    // אבל אם אפילו פיסקה ראשונה לא נכנסת לעמוד שלם, אין ברירה פיזית:
    // קודם מנסים לחתוך בסוף שורה טבעית; רק אם preventMidLineSplit כבוי
    // ואין סוף שורה מתאים, מותר fallback לסוף מילה.
    if (!splitInfo && noMidParagraph && bestN_clean === 0 && totalAvail > 0) {
      const sliceIdx = 0;
      const baseN = 0;
      const target = pendingParagraph || paragraphs[cursor];
      const fullText = (target?.mainText || '').trim();
      const MIN_EMERGENCY_SPLIT = 8;

      const allNotes = target?.notes || [];
      const anchored = allNotes.filter(n => typeof n.anchor === 'number');
      const anchorless = allNotes.filter(n => typeof n.anchor !== 'number');

      const notesBeforeAnchor = (len) => {
        const ratio = fullText.length > 0 ? len / fullText.length : 0;
        const anchorlessShare = Math.round(anchorless.length * ratio);
        const anchoredBefore = anchored.filter(n => n.anchor < len || (n.anchor === len && n.anchorAffinity === 'backward'));
        return [...anchorless.slice(0, anchorlessShare), ...anchoredBefore]
          .sort((a, b) => (typeof a.anchor === 'number' ? a.anchor : -1) - (typeof b.anchor === 'number' ? b.anchor : -1));
      };

      const notesFromAnchor = (len, movedNotes) => {
        const moved = new Set(movedNotes || []);
        const ratio = fullText.length > 0 ? len / fullText.length : 0;
        const anchorlessShare = Math.round(anchorless.length * ratio);
        const anchorlessFrom = anchorless.slice(anchorlessShare).filter(n => !moved.has(n));
        const anchoredFrom = anchored
          .filter(n => !moved.has(n))
          .map(n => ({ ...n, anchor: n.anchor >= len ? n.anchor - len : 0 }));
        return [...anchorlessFrom, ...anchoredFrom];
      };

      if (fullText.length >= MIN_EMERGENCY_SPLIT) {
        const emergencyCandidates = selectV9GapFillCandidates(
          buildParagraphBreakCandidates(
            fullText,
            splitMetrics,
            splitMainWidth,
            v9SplitPolicy,
            { source: "emergency", emergency: true }
          ).filter(c => c.offset >= MIN_EMERGENCY_SPLIT && c.offset < fullText.length),
          {
            remainingPx: Math.max(0, pageBottomForFill - cfg.padding),
            lineHeight: (Number(cfg.mainFontSize) || 13) * (Number(cfg.lineHeightRatio) || 1.55),
            maxCandidates: cfg.emergencySplitMaxCandidates,
          }
        );

        let bestEmergency = null;
        for (const emergencyCandidate of emergencyCandidates) {
          const fallbackLen = emergencyCandidate.offset;
          const movedNotes = notesBeforeAnchor(fallbackLen);
          const splitText = splitMainTextAtOffset(fullText, fallbackLen);
          const splitNotes = splitNotesByAnchor(
            target?.notes || [],
            splitText.splitOffset,
            fullText.length,
            splitText.suffixBaseOffset
          );

          const firstHalf = splitV9Paragraph(
            target,
            splitText,
            splitNotes.before,
            splitNotes.after,
            { _emergencySplit: true }
          ).firstHalf;
          const secondHalf = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).secondHalf;
          const emergencyPlan = buildPagePlan(
            aggregateForV9([firstHalf], cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver),
            cfg
          );
          const emergencyScore = scoreV9PageCandidate(
            emergencyPlan,
            emergencyCandidate,
            v9SplitPolicy,
            {
              cfg,
              movedNotes: splitNotes.before,
              pageIdx,
              source: "emergency",
              isPhysicallyUnavoidable: true,
            }
          );

          if (!emergencyScore.accept) continue;
          if (!bestEmergency || emergencyScore.fill > bestEmergency.score.fill) {
            bestEmergency = {
              score: emergencyScore,
              candidate: emergencyCandidate,
              firstHalf,
              secondHalf,
            };
          }
        }

        if (bestEmergency) {
          if (typeof console !== "undefined") {
            console.warn(
              "[v9] emergency paragraph split: paragraph is larger than one page; " +
              "using " + bestEmergency.candidate.kind + " split."
            );
          }
          splitInfo = {
            firstHalf: bestEmergency.firstHalf,
            secondHalf: bestEmergency.secondHalf,
            sliceIdx,
            baseN,
          };
        } else if (typeof console !== "undefined") {
          console.warn(
            "[v9] no-mid-paragraph: first paragraph does not fit, but no legal emergency split point was found."
          );
        }
      }

    }

    let overflowTakeN = 0;
    if (!carryActive && !noMidParagraph && bestN_clean < totalAvail) {
      const candidateN = bestN_clean + 1;
      const tp = trialAtN(candidateN);
      const ovs = (tp && tp.overflow && tp.overflow.streams) || {};
      const hasNoteOverflow = Object.keys(ovs).some(k => ovs[k]);
      const fill = planFillRatio(tp);
      const currentSlice = splitInfo
        ? [...getSlice(splitInfo.baseN), splitInfo.firstHalf]
        : getSlice(bestN_clean);
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      const currentHasNoteOverflow = Object.keys((currentPlan && currentPlan.overflow && currentPlan.overflow.streams) || {})
        .some(k => currentPlan.overflow.streams[k]);
      if (
        tp && tp.overflow &&
        !tp.overflow.mainText &&
        hasNoteOverflow &&
        !tp.unstartedNotes?.length &&
        !currentHasNoteOverflow &&
        planMainLineCount(tp) <= carryGapMaxMainLines() &&
        planHasCommentaryStart(tp) &&
        (fill > currentFill + 0.08 || (currentFill < rescueMinFillRatio && fill >= currentFill - 0.04))
      ) {
        overflowTakeN = candidateN;
        splitInfo = null;
      }
    }

    // ★ משה, 08/09 + 14/09/2026: "יש הרבה רווח לא מובן" / "עדיין מאוד בעייתי
    // מבחינת השטח הלבן".
    //
    // מה נמדד (24/09, הרצה חיה, 26 עמודים): רוב העמודים מלאים 95%–98%, אבל
    // שישה עמודים צנחו ל-13%–50%. ולכל אחד מהם, אילו היה לוקח **עוד פסקה
    // אחת**, העמוד היה מתמלא 97%–99%:
    //
    //     עמוד 5  — 38.7% → 97.3%       עמוד 19 — 48.0% → 97.2%
    //     עמוד 13 — 50.2% → 99.0%       עמוד 20 — 12.7% → 97.2%
    //     עמוד 18 — 79.6% → 99.5%       עמוד 23 — 45.6% → 99.0%
    //
    // ומה עצר? הפסקה הנוספת גררה גלישה של פרשן אחד — לפעמים 945 תווים בלבד —
    // ו-fitsClean פוסל כל גלישה. מסלול ההצלה שקיים כאן (overflowTakeN) היה
    // אמור להציל בדיוק את זה, אבל הוא נבנה למטרה אחרת — "למלא פער קטן" —
    // ולכן הוא כבוי כשיש carry, ותקרתו חמש שורות ראשי. שני הכללים האלה
    // נכונים למילוי-פער, ושגויים כשהעמוד עצמו חצי ריק.
    //
    // ⭐ ההחלטה: עמוד חצי ריק גרוע בהרבה מפרשן שממשיך בעמוד הבא — וגלישת
    // פרשן ממילא כבר קורית בכל עמוד "מלא" רגיל. לכן נוסף כאן מסלול שני,
    // נפרד וצר: הוא נכנס **רק** כשהעמוד באמת רזה, **רק** אם הפסקה הנוספת
    // באמת ממלאת אותו, ולעולם לא כשהטקסט הראשי עצמו נחתך.
    const UNDERFILLED_PAGE = 0.72;   // מתחת לזה העמוד נראה שבור
    const RESCUE_TARGET_FILL = 0.85; // והתוספת חייבת באמת לפתור את זה
    if (!overflowTakeN && !noMidParagraph && bestN_clean > 0 && bestN_clean < totalAvail) {
      const currentSlice = splitInfo
        ? [...getSlice(splitInfo.baseN), splitInfo.firstHalf]
        : getSlice(bestN_clean);
      const currentPlan = buildPagePlan(
        aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver),
        cfg,
      );
      const currentFill = planFillRatio(currentPlan);
      if (currentFill < UNDERFILLED_PAGE) {
        const candidateN = bestN_clean + 1;
        const tp = trialAtN(candidateN);
        const fill = planFillRatio(tp);
        const mainCut = normalizeRichTextEntry(tp?.overflow?.mainText || "").text.trim();
        if (tp && tp.overflow && !mainCut && fitsClean(tp) && fill >= RESCUE_TARGET_FILL && fill > currentFill + 0.08) {
          overflowTakeN = candidateN;
          splitInfo = null;
        }
      }
    }

    // משה 2026-05-09: ★ drain-alone — אם יש pending + carry-over שלבד חורג, נריץ
    // עמוד drain רק עם ה-carry (בלי pending). זה משחרר את ה-carry שיוצר אצטמולציה
    // ומאפשר ל-pending להירנדר נקי בעמוד הבא. אחרת ה-carry חונק את כל הפסקאות הבאות.
    let drainAloneMode = false;
    if (!splitInfo && hasCarryOver(carryOver)) {
      // בדוק אם carry לבד (slice ריק) חורג
      const carryAloneTrial = buildPagePlan(
        aggregateForV9([], cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver),
        cfg
      );
      // אם carry לבד חורג, או שהוא ממלא את העמוד דינמית, ננקז אותו לבד.
      // אם הוא קצר, מצרפים אליו מהראשי הבא; סף שורות קשיח יצר עמודים כמעט ריקים.
      drainAloneMode = !!(
        carryAloneTrial?.overflow?.exceedsPage ||
        fillsPageEnough(carryAloneTrial, cfg.carryOnlyMinRatio || 0.78)
      );
    }

    // 3. קביעת bestN סופי
    let bestN;
    if (splitInfo) {
      bestN = splitInfo.baseN + 1;
    } else if (overflowTakeN > 0) {
      bestN = overflowTakeN;
    } else if (bestN_clean > 0) {
      bestN = bestN_clean;
    } else if (noMidParagraph) {
      // לא עוקפים את "לא לפצל פיסקאות" ע"י הכנסת פיסקה בכוח.
      // אם היה צורך פיזי אמיתי, emergency split כבר היה אמור ליצור splitInfo.
      // אם לא נוצר — נשתמש בפיסקה אחת רק כמוצא אחרון כדי לא להיתקע בלולאה,
      // עם אזהרה ברורה.
      if (typeof console !== "undefined") {
        console.warn("[v9] no-mid-paragraph fallback: forcing one paragraph to avoid pagination stall.");
      }
      bestN = totalAvail > 0 ? 1 : 0;
    } else if (bestN_clean < totalAvail) {
      bestN = 1;
    } else {
      // אין clean fit ואין split אפשרי וגם אין פסקאות — שום דבר לקחת
      bestN = totalAvail > 0 ? 1 : 0;
    }

    // משה 2026-05-10: לולאת הגנה — אם הקומפוזיציה הסופית מורידה footer לחלוטין,
    // נצמצם (קודם מבטלים split, אחר כך מורידים bestN ב-1) עד שלא נופל footer.
    // לעולם לא יורדים מתחת ל-1 פסקה — זה יעצור את הקרסור (לולאה אינסופית).
    const sliceForN = (n) => {
      const out = [];
      let need = n;
      if (pendingParagraph && need > 0) { out.push(pendingParagraph); need--; }
      if (need > 0) out.push(...paragraphs.slice(cursor, cursor + need));
      return out;
    };
    const droppedFootersOf = (slice) => {
      const agg = aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver);
      const tp = buildPagePlan(agg, cfg);
      const dropped = [];
      for (const fs of (agg.footerStreams || [])) {
        const totalText = (fs.items || []).join(' ').trim();
        if (!totalText) continue;
        const overflowEntry = (tp.overflow && tp.overflow.streams && tp.overflow.streams[fs.id]) || "";
        const overflowText = normalizeRichTextEntry(overflowEntry).text.trim();
        if (overflowText && overflowText.length >= totalText.length * 0.95) dropped.push(fs.id);
      }
      return dropped;
    };
    let safetyTries = 0;
    while (safetyTries < 5 && bestN > 1) {
      if (overflowTakeN > 0 && bestN === overflowTakeN) break;
      const checkSlice = splitInfo ? [...sliceForN(splitInfo.baseN), splitInfo.firstHalf] : sliceForN(bestN);
      const dropped = droppedFootersOf(checkSlice);
      if (dropped.length === 0) break;
      if (splitInfo) {
        const tp = buildPagePlan(aggregateForV9(checkSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver), cfg);
        const commentaryCount = (tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0)
          + (tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
        if (commentaryCount > 0 && fillsPageEnough(tp, Math.min(0.62, cfg.gapFillMinRatio))) break;
        splitInfo = null; bestN = bestN_clean;
      }
      else { bestN--; }
      safetyTries++;
    }

    // Guard סופי לפני סגירת עמוד:
    // לא מספיק לסנן candidates. אם final pagePlan עדיין יוצר mainText overflow,
    // זה אומר שהעמוד נסגר באמצע שורת ראשי דרך דלת צדדית. במקרה כזה דוחים
    // את ה-pagePlan ומנסים עמוד קטן/נקי יותר לפני שמציירים DOM.
    const mainOverflowTextOf = (plan) => {
      const entry = plan?.overflow?.mainText;
      if (!entry) return "";
      if (typeof entry === "string") return entry.trim();
      return normalizeRichTextEntry(entry).text.trim();
    };

    const buildFinalSlice = () => drainAloneMode
      ? []
      : (splitInfo ? [...getSlice(splitInfo.baseN), splitInfo.firstHalf] : getSlice(bestN));

    let finalSlice = buildFinalSlice();
    let finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver);
    let finalProbe = buildPagePlan(finalContent, cfg);
    let finalGuardTries = 0;

    while (
      !drainAloneMode &&
      finalGuardTries < 4 &&
      mainOverflowTextOf(finalProbe)
    ) {
      if (typeof console !== "undefined") {
        console.warn("[v9] final page commit guard rejected pagePlan with mainText overflow", {
          pageIdx,
          bestN,
          hadSplit: !!splitInfo,
          overflowLength: mainOverflowTextOf(finalProbe).length,
        });
      }

      if (splitInfo) {
        bestN = Math.max(0, splitInfo.baseN || 0);
        splitInfo = null;
      } else if (bestN > 1) {
        bestN -= 1;
      } else {
        break;
      }

      finalSlice = buildFinalSlice();
      finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings, cfg.levels, streamsForPage(pageIdx), carryOver);
      finalProbe = buildPagePlan(finalContent, cfg);
      finalGuardTries++;
    }

    const writeFinalGapFillDebug = (info = {}) => {
      if (typeof window === "undefined") return;
      window.__ravtextLastV9GapFill = {
        pageIdx,
        beforeFill: Number.isFinite(info.beforeFill) ? info.beforeFill : null,
        afterFill: Number.isFinite(info.afterFill) ? info.afterFill : null,
        remainingPxBefore: Number.isFinite(info.remainingPxBefore) ? info.remainingPxBefore : null,
        bottomBefore: Number.isFinite(info.bottomBefore) ? info.bottomBefore : null,
        bottomAfter: Number.isFinite(info.bottomAfter) ? info.bottomAfter : null,
        bottomGainPx: Number.isFinite(info.bottomGainPx) ? info.bottomGainPx : null,
        accepted: !!info.accepted,
        rejectedReasons: Array.isArray(info.rejectedReasons) ? info.rejectedReasons : [],
        candidateCount: Number.isFinite(info.candidateCount) ? info.candidateCount : 0,
        selectedOffset: Number.isFinite(info.selectedOffset) ? info.selectedOffset : null,
        selectedKind: info.selectedKind || "",
        pulledTextPreview: info.pulledTextPreview || "",
        pulledNotesCount: Number.isFinite(info.pulledNotesCount) ? info.pulledNotesCount : 0,
      };
    };

    const tryFinalGapFillRescue = () => {
      const beforeFill = planFillRatio(finalProbe);
      const bottom = planBottomY(finalProbe);
      const remainingPxBefore = pageBottomForFill - bottom;
      const rejectedReasons = [];

      const finish = (debug, result = null) => {
        writeFinalGapFillDebug({
          beforeFill,
          afterFill: beforeFill,
          remainingPxBefore,
          bottomBefore: bottom,
          bottomAfter: bottom,
          bottomGainPx: 0,
          accepted: false,
          rejectedReasons,
          candidateCount: 0,
          ...debug,
        });
        return result;
      };

      const reject = (reason, extra = {}) => {
        rejectedReasons.push({ reason, ...extra });
        return finish(extra);
      };

      const rejectCandidate = (candidate, reason, extra = {}) => {
        rejectedReasons.push({
          offset: candidate?.offset ?? null,
          kind: candidate?.kind || "",
          reason,
          ...extra,
        });
      };

      if (cfg.finalGapFillEnabled === false) return reject("disabled");
      if (drainAloneMode) return reject("drain-alone");
      if (splitInfo) return reject("split-already-active");
      if (!allowParagraphSplit) return reject("split-disabled");
      if (bestN >= totalAvail) return reject("no-next-paragraph");
      if (!finalProbe || !finalProbe.overflow) return reject("missing-final-probe");
      if (finalProbe.overflow.exceedsPage) return reject("page-overflow");
      if (mainOverflowTextOf(finalProbe)) return reject("main-overflow");

      const lineH = (Number(cfg.mainFontSize) || 13) * (Number(cfg.lineHeightRatio) || 1.55);
      const manualPullLines = Math.max(0, Number(cfg.__v9PageConstraint?.pullLines) || 0);
      const manualPull = manualPullLines > 0;
      const trigger = evaluateV9PhysicalGapFillTrigger({
        remainingPx: remainingPxBefore,
        lineHeight: lineH,
        beforeFill,
        cfg,
        manualPull,
      });

      if (!trigger.ok) {
        return reject(trigger.reason, {
          manualPullLines,
          minRemainingPx: trigger.minRemainingPx,
        });
      }

      const nextAvailable = getSlice(bestN + 1);
      const target = nextAvailable[bestN] || null;
      const fullText = (target?.mainText || "").trim();
      if (!target || fullText.length < 2) return reject("no-next-paragraph");

      let actualGeometryCandidates = [];
      if (String(target?.mainText || "") === fullText) {
        actualGeometryCandidates = actualV9LineEndCandidates(
          getSlice(bestN),
          target,
          {
            relativeSourceOffset: Number(target?._v9SourceOffset) || 0,
            maxLength: fullText.length,
            source: "final-gap-fill-actual-geometry",
          }
        );
      }

      const allCandidates = [
        ...buildParagraphBreakCandidates(
          fullText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "final-gap-fill" }
        ),
        ...actualGeometryCandidates,
      ].filter(c => c.offset >= 2 && c.offset < fullText.length);

      let candidates;
      if (manualPull && actualGeometryCandidates.length) {
        // Actual geometry emits one candidate per real V9 row. +N therefore
        // means "at most N additional visual rows", not N semantic breakpoints.
        candidates = [...actualGeometryCandidates]
          .sort((a, b) => a.offset - b.offset)
          .slice(0, manualPullLines);
      } else {
        candidates = selectV9GapFillCandidates(allCandidates, {
          remainingPx: manualPull
            ? Math.min(remainingPxBefore, manualPullLines * lineH)
            : remainingPxBefore,
          lineHeight: lineH,
          maxCandidates: manualPull
            ? manualPullLines
            : cfg.finalGapFillMaxCandidates,
        });
      }

      if (!candidates.length) {
        return reject("no-candidates", { candidateCount: 0 });
      }

      const baseSlice = getSlice(bestN);
      let best = null;

      for (const candidate of candidates) {
        const splitText = splitMainTextAtOffset(fullText, candidate.offset);
        if (!splitText.prefixText || !splitText.suffixText) {
          rejectCandidate(candidate, "empty-split");
          continue;
        }

        const splitNotes = splitNotesByAnchor(
          target?.notes || [],
          splitText.splitOffset,
          fullText.length,
          splitText.suffixBaseOffset
        );

        const firstHalf = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).firstHalf;

        const secondHalf = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after).secondHalf;

        const testSlice = [...baseSlice, firstHalf];
        const testContent = aggregateForV9(
          testSlice,
          cfg.titles,
          cfg.streamSettings,
          cfg.levels,
          cfg.talmudStreams,
          carryOver
        );
        const testPlan = buildPagePlan(testContent, cfg);

        if (!testPlan || !testPlan.overflow) {
          rejectCandidate(candidate, "missing-plan");
          continue;
        }
        if (testPlan.overflow.exceedsPage) {
          rejectCandidate(candidate, "page-overflow");
          continue;
        }
        if (mainOverflowTextOf(testPlan)) {
          rejectCandidate(candidate, "main-overflow");
          continue;
        }

        const noteOverflow = hasV9StreamOverflow(testPlan);

        if (noteOverflow && hasUnsafeV9StreamOverflow(testPlan)) {
          rejectCandidate(candidate, "unsafe-note-overflow");
          continue;
        }

        const dropped = droppedFootersOf(testSlice);
        if (dropped.length) {
          rejectCandidate(candidate, "dropped-footer", { dropped });
          continue;
        }

        const candidateScore = scoreV9PageCandidate(
          testPlan,
          candidate,
          v9SplitPolicy,
          {
            cfg,
            movedNotes: splitNotes.before,
            pageIdx,
            source: "final-gap-fill",
          }
        );

        if (!candidateScore.accept) {
          rejectCandidate(candidate, "line-guard-rejected", {
            policyReason: candidateScore.reason || "",
          });
          continue;
        }

        const afterFill = planFillRatio(testPlan);
        const afterBottom = planBottomY(testPlan);
        const physicalGain = evaluateV9PhysicalGapFillGain({
          beforeBottom: bottom,
          afterBottom,
          lineHeight: lineH,
          beforeFill,
          afterFill,
          cfg,
          manualPull,
        });
        if (!physicalGain.ok) {
          rejectCandidate(candidate, physicalGain.reason, {
            afterFill,
            afterBottom,
            bottomGainPx: physicalGain.gainPx,
            minGainPx: physicalGain.minGainPx,
          });
          continue;
        }

        const score =
          afterFill +
          Math.min(0.08, (candidate.offset / Math.max(1, fullText.length)) * 0.08) +
          Math.min(0.08, splitNotes.before.length * 0.02);

        if (!best || score > best.score) {
          best = {
            score,
            afterFill,
            afterBottom,
            bottomGainPx: physicalGain.gainPx,
            firstHalf,
            secondHalf,
            testContent,
            testPlan,
            candidate,
            pulledNotesCount: splitNotes.before.length,
          };
        }
      }

      if (!best) {
        return finish({
          candidateCount: candidates.length,
          rejectedReasons,
        });
      }

      rejectedReasons.push({
        offset: best.candidate.offset,
        kind: best.candidate.kind,
        reason: "accepted",
      });

      return finish({
        afterFill: best.afterFill,
        bottomAfter: best.afterBottom,
        bottomGainPx: best.bottomGainPx,
        accepted: true,
        rejectedReasons,
        candidateCount: candidates.length,
        selectedOffset: best.candidate.offset,
        selectedKind: best.candidate.kind,
        pulledTextPreview: (best.firstHalf.mainText || "").trim().slice(0, 80),
        pulledNotesCount: best.pulledNotesCount,
      }, {
        finalSlice: [...getSlice(bestN), best.firstHalf],
        finalContent: best.testContent,
        finalProbe: best.testPlan,
        splitInfo: {
          firstHalf: best.firstHalf,
          secondHalf: best.secondHalf,
          sliceIdx: bestN,
          baseN: bestN,
          _finalGapFill: true,
        },
        bestN: bestN + 1,
      });
    };

    const finalGapFill = tryFinalGapFillRescue();
    if (finalGapFill) {
      finalSlice = finalGapFill.finalSlice;
      finalContent = finalGapFill.finalContent;
      finalProbe = finalGapFill.finalProbe;
      splitInfo = finalGapFill.splitInfo;
      bestN = finalGapFill.bestN;
    }
    if (!drainAloneMode && finalProbe.unstartedNotes?.length) {
      let accepted = null;
      // Prefer a clean boundary; only allow a genuinely started long note to
      // continue when no clean prefix exists. Never move a complete new note.
      const candidates=[];
      for(let i=0;i<finalSlice.length;i++) {
        const p=finalSlice[i];
        if(!p._v9Source || !p.mainText)continue;
        const ends=(finalProbe.mainBox?.lines || []).filter(l=>l.source?.paragraphId===p._v9Source.id)
          .map(l=>l.source.end-p._v9SourceOffset).filter(n=>n>0 && n<p.mainText.length);
        // At an orphan anchor move the whole referenced word, not only its ref.
        for(const note of finalProbe.unstartedNotes.filter(n=>n.paragraphId===p._v9Source.id)) {
          const at=Math.max(0,Math.min(p.mainText.length,note.anchor-p._v9SourceOffset));
          const word=/\S+\s*$/u.exec(p.mainText.slice(0,at));
          if(word?.index>0)ends.push(word.index);
        }
        for(const n of [...new Set(ends)].sort((a,b)=>b-a))candidates.push({i,p,n});
      }
      // ⛔⛔⛔⛔ משה 29/09/2026 — „יש משהו חדש שמייצר עמודים ריקים
      // ברובם... פשוט שופך את השארית לעמוד חדש במקום למזג עם העמוד
      // הבא, וגם עברת על הכלל שאסור להמשיך לעמוד הבא לפני שהכול
      // הסתיים עם העמוד הקודם".
      //
      // ═══ מה נמדד בייצוא שלו (20:23) ═══
      //     עמודים                       243
      //     מילוי ממוצע                  77.2%
      //     עמודים מתחת ל-50%             18
      //     עמודים מתחת ל-25%              7
      //     הגרועים ביותר: **שורה אחת** בעמוד שלם (7.6% מילוי)
      //
      // ═══ השורש ═══
      // הבחירה כאן העדיפה „הערה נקייה" על פני „עמוד מלא" — **בלי שום
      // רצפה**. מועמד „נקי" ניצח תמיד, גם כשהוא מותיר בעמוד שורה אחת.
      // כלומר כדי לשמור הערה אחת צמודה למקור שלה, המנוע היה מוכן
      // לחתוך עמוד שלם ולשפוך את כל השאר לעמוד הבא.
      //
      // ═══ הדימוי ═══
      // כמו לארוז מזוודה, לגלות שגרב אחת לא נכנסת — ולהוציא את כל
      // הבגדים כדי שהגרב תשב לבד בנוחות.
      //
      // ⇒ נוספה רצפת מילוי: מועמד שמשאיר בעמוד פחות ממחצית השורות
      //   שהעמוד כבר החזיק — נדחה, גם אם הוא „נקי". רק אם אין שום
      //   מועמד שעומד ברצפה, חוזרים להעדפה הישנה. כך העמוד הנוכחי
      //   נגמר לפני שמתחילים את הבא, בדיוק כפי שמשה קבע.
      const baseMainLines = Number(finalProbe.mainBox?.lines?.length) || 0;
      const fillFloor = baseMainLines > 0 ? Math.max(1, Math.ceil(baseMainLines * 0.5)) : 0;
      const betterThan = (cand, cur) => {
        if (!cur) return true;
        if (cand.keepsEnough !== cur.keepsEnough) return cand.keepsEnough;
        if (cand.clean !== cur.clean) return cand.clean;
        return cand.score > cur.score;
      };
      for(const {i,p,n} of candidates.reverse()) {
        const st=splitMainTextAtOffset(p.mainText,n);
        const ns=splitNotesByAnchor(p.notes || [],n,p.mainText.length,st.suffixBaseOffset);
        const halves=splitV9Paragraph(p,st,ns.before,ns.after);
        const candidateSlice=[...finalSlice.slice(0,i),halves.firstHalf];
        const content=aggregateForV9(candidateSlice,cfg.titles,cfg.streamSettings,cfg.levels,streamsForPage(pageIdx),carryOver);
        const probe=buildPagePlan(content,cfg);
        if(probe.overflow.mainText || probe.unstartedNotes?.length || !probe.mainBox?.lines?.length)continue;
        const clean=!hasUnsafeV9StreamOverflow(probe);
        const score=i*100000000+n;
        const candLines=Number(probe.mainBox?.lines?.length) || 0;
        const keepsEnough = fillFloor === 0 || candLines >= fillFloor;
        const cand={slice:candidateSlice,content,probe,halves,i,clean,score,keepsEnough,candLines};
        if(betterThan(cand, accepted)) accepted=cand;
      }
      if(accepted) {
        // Preserve the tail of an already split source paragraph.
        if(splitInfo && accepted.i===finalSlice.length-1 &&
           accepted.halves.secondHalf._v9Source===splitInfo.secondHalf._v9Source &&
           accepted.halves.secondHalf._v9SourceEnd===splitInfo.secondHalf._v9SourceOffset)
          accepted.halves.secondHalf=joinV9ParagraphFragments(accepted.halves.secondHalf,splitInfo.secondHalf);
        finalSlice=accepted.slice;finalContent=accepted.content;finalProbe=accepted.probe;
        splitInfo={...accepted.halves,sliceIdx:accepted.i,baseN:accepted.i};bestN=accepted.i+1;
      } else if(bestN_clean>0) {
        splitInfo=null;bestN=bestN_clean;finalSlice=getSlice(bestN);
        finalContent=aggregateForV9(finalSlice,cfg.titles,cfg.streamSettings,cfg.levels,streamsForPage(pageIdx),carryOver);
        finalProbe=buildPagePlan(finalContent,cfg);
      } else {
        // ⛔⛔⛔⛔ משה 29/09/2026 — „שגיאת רינדור: V9_NOTE_ANCHOR_NO_FIT".
        //
        // ═══ מה הכלל הזה בא לשמור ═══
        // הערה צריכה להתחיל באותו עמוד שבו נמצאת השורה שהיא מוצמדת
        // אליה. זה כלל **נכון** ולא נוגעים בו.
        //
        // ═══ מה היה שבור ═══
        // כשלא נמצאה שום דרך לקיים אותו בעמוד מסוים, הקוד זרק שגיאה
        // — והשגיאה הרגה את **כל** הרינדור. כלומר עמוד בעייתי אחד
        // מתוך מאתיים מחק למשה את המסמך כולו מהמסך.
        //
        // ═══ הדימוי ═══
        // כמו ספרן שמצא ספר אחד לא במקומו, ובתגובה סגר את כל
        // הספרייה. המחיר גדול פי אלף מהתקלה.
        //
        // ⇒ הכלל נשמר, אבל הכישלון מדווח ואינו הורג: בונים את
        //   העמוד הטוב ביותר שיש, מסמנים בדיוק איזו הערה לא הצליחה
        //   להישאר עם המקור שלה, וממשיכים. משה יראה מסמך שלם ואת
        //   ההערה הבודדת שזזה — במקום מסך ריק עם הודעת שגיאה.
        //   זה בדיוק הכלל שמשה קבע: „במקרה חירום — חפיפה בלי מחיקה".
        __v9NoteAnchorFallbacks.push({
          pageIndex: pageIdx,
          reason: 'no-fit',
          notes: (finalProbe.unstartedNotes || []).length,
        });
      }
    }
    if (finalProbe.unstartedNotes?.length) {
      // אותו היגיון בדיוק: לא מפרקים הערה מהמקור שלה אם אפשר להימנע,
      // אבל אם כבר קרה — מדווחים וממשיכים, לא הורגים את המסמך.
      __v9NoteAnchorFallbacks.push({
        pageIndex: pageIdx,
        reason: 'mismatch',
        notes: finalProbe.unstartedNotes.length,
      });
    }
    // ⭐⭐⭐ משה 29/09/2026 — „יש עמודים עם מעט מאוד תוכן... שופך את
    // השארית לעמוד חדש במקום למזג את זה עם העמוד הבא".
    //
    // ═══ מה נמדד בשני הייצואים שלו (20:23 ו-20:38) ═══
    // שמונה עמודים עם שורה אחת בלבד. בכל אחד מהם:
    //     הקופסה     ראשי בלבד
    //     כותרות     0
    //     השורה      **סוף פסקה**
    //     מילים      1, 4, 5
    // כלומר **זנב של פסקה — לפעמים מילה בודדת — קיבל עמוד משלו**.
    //
    // ═══ הדימוי ═══
    // כמו לסיים לצבוע קיר, לגלות שנשארה נקודה אחת — ולפתוח בשבילה
    // פחית צבע חדשה בחדר אחר.
    //
    // ═══ התיקון, ובתוך V9 עצמו ═══
    // לא נוסף שום מנוע ולא שום חישוב חיצוני. אני רק **מציע** ל-V9
    // מועמד אחד: „מה אם הזנב יישאר בעמוד הזה?", ו-V9 בונה אותו
    // בעצמו (`buildPagePlan`) ומכריע. אם הוא אומר שהכול נכנס בלי
    // חריגה ובלי לנתק הערה מהמקור — לוקחים. אם לא — לא נוגעים.
    // כך ההחלטה נשארת של V9, והעמוד נגמר לפני שמתחילים את הבא.
    if (splitInfo && splitInfo.secondHalf && typeof joinV9ParagraphFragments === "function") {
      const tailText = String(splitInfo.secondHalf.mainText || '').trim();
      // ⛔ 29/09 — כאן היה סף של 12 מילים, וזו הייתה טעות: נמדד עמוד
      // עם **16 מילים** שנשאר דליל כי הוא חרג מהסף. קבוע שרירותי אינו
      // תשובה — השאלה היחידה היא „האם זה נכנס", ורק V9 יודע לענות.
      // ⇒ מציעים לו את המועמד **תמיד**, והוא מכריע. זנב ארוך פשוט לא
      //   ייכנס, ואז שום דבר לא משתנה.
      if (tailText) {
        try {
          const joined = joinV9ParagraphFragments(splitInfo.firstHalf, splitInfo.secondHalf);
          const trySlice = [...finalSlice.slice(0, -1), joined];
          const tryContent = aggregateForV9(trySlice, cfg.titles, cfg.streamSettings,
            cfg.levels, streamsForPage(pageIdx), carryOver);
          const tryProbe = buildPagePlan(tryContent, cfg);
          const fits = tryProbe
            && !tryProbe.overflow?.mainText
            && !(tryProbe.unstartedNotes || []).length
            && (tryProbe.mainBox?.lines?.length || 0) > 0;
          if (fits) {
            finalSlice = trySlice;
            finalContent = tryContent;
            finalProbe = tryProbe;
            splitInfo = null;
          }
        } catch (_) {
          // אם משהו לא הסתדר — משאירים את ההחלטה המקורית של V9.
        }
      }
    }

    // Final sparse-page guard.
    //
    // The real 2026-09-30 snapshot exposed three cases that ordinary gap fill
    // did not cover: a one-line heading page, a one-line carry-only stream page,
    // and a short pending tail. Before publishing any intermediate page below
    // 50% fill, offer V9 the next source paragraph (whole first, then safe
    // line-boundary prefixes). Note ownership remains authoritative.
    const trySparseIntermediateRescue = () => {
      if (!finalProbe || !finalProbe.overflow) return null;
      if (drainAloneMode) return null;

      // Source-order invariant: when the current page already contains the
      // first half of a split source paragraph, its secondHalf is the NEXT
      // source content. Pulling a later paragraph here would leapfrog that
      // pending tail and can lose/reorder source when pagination state advances.
      // Active splits are handled only by extension-rescue / tail rejoin above.
      if (splitInfo) return null;
      const beforeFill = planFillRatio(finalProbe);
      if (beforeFill >= 0.50) return null;
      if (bestN >= totalAvail) return null;
      if (mainOverflowTextOf(finalProbe)) return null;
      if (finalProbe.unstartedNotes?.length) return null;

      const nextAvailable = getSlice(bestN + 1);
      const target = nextAvailable[bestN] || null;
      const fullText = String(target?.mainText || "");
      if (!target || !fullText.trim()) return null;

      const baseSlice = [...finalSlice];
      let best = null;

      const consider = (testSlice, testPlan, info) => {
        if (!testPlan || !testPlan.overflow) return;
        if (testPlan.overflow.exceedsPage) return;
        if (mainOverflowTextOf(testPlan)) return;
        if (testPlan.unstartedNotes?.length) return;
        if (hasUnsafeV9StreamOverflow(testPlan)) return;
        const fill = planFillRatio(testPlan);
        if (fill <= beforeFill + 0.06) return;

        const candidateScore = scoreV9PageCandidate(
          testPlan,
          info.candidate || { kind: info.kind || "sparse-rescue", priority: 900 },
          v9SplitPolicy,
          {
            cfg,
            movedNotes: info.movedNotes || [],
            pageIdx,
            source: "final-sparse-rescue",
          }
        );
        if (!candidateScore.accept && fill < 0.68) return;

        const score = fill + Math.min(0.08, (info.offset || fullText.length) / Math.max(1, fullText.length) * 0.08);
        if (!best || score > best.score) best = { score, fill, testSlice, testPlan, ...info };
      };

      // Whole next paragraph — especially important for short headings.
      {
        const wholeSlice = [...baseSlice, target];
        const wholeContent = aggregateForV9(
          wholeSlice, cfg.titles, cfg.streamSettings, cfg.levels,
          streamsForPage(pageIdx), carryOver
        );
        const wholePlan = buildPagePlan(wholeContent, cfg);
        consider(wholeSlice, wholePlan, {
          kind: "whole-paragraph",
          offset: fullText.length,
          whole: true,
          testContent: wholeContent,
        });
      }

      // If whole paragraph does not fit, try all useful V9 break candidates,
      // not only the first 2-3. Sparse pages are expensive enough to justify
      // the extra bounded search.
      const candidates = selectV9GapFillCandidates(
        buildParagraphBreakCandidates(
          fullText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "final-sparse-rescue" }
        ).filter(c => c.offset >= 2 && c.offset < fullText.length),
        {
          remainingPx: Math.max(0, pageBottomForFill - planBottomY(finalProbe)),
          lineHeight: (Number(cfg.mainFontSize) || 13) * (Number(cfg.lineHeightRatio) || 1.55),
          maxCandidates: cfg.finalSparseRescueMaxCandidates,
        }
      );

      for (const candidate of candidates) {
        const splitText = splitMainTextAtOffset(fullText, candidate.offset);
        if (!splitText.prefixText || !splitText.suffixText) continue;
        const splitNotes = splitNotesByAnchor(
          target?.notes || [],
          splitText.splitOffset,
          fullText.length,
          splitText.suffixBaseOffset
        );
        const halves = splitV9Paragraph(target, splitText, splitNotes.before, splitNotes.after);
        const testSlice = [...baseSlice, halves.firstHalf];
        const testContent = aggregateForV9(
          testSlice, cfg.titles, cfg.streamSettings, cfg.levels,
          streamsForPage(pageIdx), carryOver
        );
        const testPlan = buildPagePlan(testContent, cfg);
        consider(testSlice, testPlan, {
          kind: candidate.kind,
          candidate,
          offset: candidate.offset,
          movedNotes: splitNotes.before,
          whole: false,
          halves,
          testContent,
        });
      }

      if (!best) return null;
      if (best.whole) {
        return {
          finalSlice: best.testSlice,
          finalContent: best.testContent,
          finalProbe: best.testPlan,
          bestN: bestN + 1,
          splitInfo: null,
          fill: best.fill,
          mode: "whole",
        };
      }
      return {
        finalSlice: best.testSlice,
        finalContent: best.testContent,
        finalProbe: best.testPlan,
        bestN: bestN + 1,
        splitInfo: {
          firstHalf: best.halves.firstHalf,
          secondHalf: best.halves.secondHalf,
          sliceIdx: bestN,
          baseN: bestN,
          _finalSparseRescue: true,
        },
        fill: best.fill,
        mode: "prefix",
      };
    };

    const sparseRescue = trySparseIntermediateRescue();
    if (sparseRescue) {
      finalSlice = sparseRescue.finalSlice;
      finalContent = sparseRescue.finalContent;
      finalProbe = sparseRescue.finalProbe;
      bestN = sparseRescue.bestN;
      splitInfo = sparseRescue.splitInfo;
    }

    const finalHasText = !!(
      (finalContent.mainText || '').trim() ||
      (finalContent.rightStream && (finalContent.rightStream.items || []).join(' ').trim()) ||
      (finalContent.leftStream && (finalContent.leftStream.items || []).join(' ').trim()) ||
      (finalContent.footerStreams || []).some(fs => (fs.items || []).join(' ').trim())
    );
    if (!finalHasText) break;

    const pageEl = document.createElement('div');
    pageEl.className = 'page v9-page';
    pageEl.setAttribute('dir', 'rtl');
    pageEl.dataset.pageIndex = String(pageIdx);
    pageEl.dataset.realized = '1';
    container.appendChild(pageEl);

    const plan = finalProbe;
    pageEl.dataset.v9PageFill = String(Math.round(planFillRatio(plan) * 10000) / 10000);
    pageEl.dataset.v9SparseRescue = sparseRescue?.mode || "";
    pageEl.dataset.v9PageLinesDiff = String(__v9PageConstraint.linesDiff || 0);
    pageEl.dataset.v9PagePushLines = String(__v9PageConstraint.pushLines || 0);
    pageEl.dataset.v9PagePullLines = String(__v9PageConstraint.pullLines || 0);
    pageEl.dataset.v9PageReservedBottom = String(__v9PageConstraint.reservedBottom || 0);
    pageEl.dataset.v9PageTweakStatus = String(__v9PageConstraint.status || "pending");
    pageEl.dataset.v9CarryInChars = String(totalCarrySize(carryOver));
    pageEl.dataset.v9PendingIn = pendingParagraph ? "1" : "0";

    // ⭐ משה 29/09/2026 — נמדד עמוד אחרון עם **אפס שורות**.
    // עמוד בלי שורה אחת אינו עמוד; הוא רק נייר ריק בסוף המסמך.
    // ⬛ הבדיקה נעשית על התוכנית של V9 עצמה, לפני הציור.
    const plannedLineCount =
      (plan?.mainBox?.lines?.length || 0) +
      (plan?.streamBoxes || []).reduce((a, b) => a + (b?.lines?.length || 0), 0) +
      (plan?.footerBoxes || []).reduce((a, b) => a + (b?.lines?.length || 0), 0);
    if (plannedLineCount === 0) {
      pageEl.remove();
      break;
    }

    const requestedRange = currentV9RequestedPageRange(cfg);
    if (v9PageNumberInRange(pageIdx, requestedRange)) {
      renderPagePlan(plan, pageEl, cfg);
      // Document overlays that affect the page (notably page numbers) are painted
      // while this page is being built, not by an engine-rendered/observer pass later.
      runV9PageDecoratorsDuringRender(pageEl, pageIdx);
    } else {
      makeV9RangePlaceholder(pageEl, plan, cfg, pageIdx);
    }
    pages.push(pageEl);
    pageEl.dataset.v9StreamCoverage = JSON.stringify(plan.streamCoverage || []);
    pageEl.dataset.v9CrownGap = JSON.stringify({bottom:plan.crownBottomY,gap:plan.crownMainGap});

    // עדכון carryOver — טקסטים שנחתכו בעמוד הזה יעברו לעמוד הבא.
    // 2026-05-17: שומרים גם runs, לא רק string.
    const nextCarry = {};
    if (plan && plan.overflow && plan.overflow.streams) {
      for (const [sid, entry] of Object.entries(plan.overflow.streams)) {
        const rich = normalizeRichTextEntry(entry);
        if (rich.text) nextCarry[sid] = rich;
      }
    }

    // התקדמות מצב: pendingParagraph + cursor מתעדכנים לפי הצריכה
    const hadPending = !!pendingParagraph;
    if (drainAloneMode) {
      // עמוד drain בלי שום פסקה — pending נשאר כמו שהוא, cursor לא זז
      // carry-over יתעדכן מהעמוד; כשיתרוקן ה-pending יוכל להירנדר נקי
    } else if (splitInfo) {
      // sliceIdx = איפה הפיצול במערך הזמינות. צרכנו slice[0..sliceIdx-1] במלואם
      // וגם את slice[sliceIdx] חצי ראשון. החצי השני יוצא ל-pendingParagraph.
      const sliceIdx = splitInfo.sliceIdx;
      if (hadPending && sliceIdx === 0) {
        // הפיצול על pending עצמו — pending מתחלף, cursor לא זז
        pendingParagraph = markV9ContinuationParagraph(splitInfo.secondHalf);
      } else if (hadPending) {
        // pending נצרך במלואו (slice[0]) + sliceIdx-1 פסקאות מהמערך + 1 פסקה מפוצלת
        pendingParagraph = markV9ContinuationParagraph(splitInfo.secondHalf);
        cursor += sliceIdx;
      } else {
        // אין pending — sliceIdx פסקאות מהמערך נצרכו במלואן + 1 מפוצלת
        pendingParagraph = markV9ContinuationParagraph(splitInfo.secondHalf);
        cursor += sliceIdx + 1;
      }
    } else {
      // צריכה רגילה: bestN פסקאות מרשימת הזמינות
      let consumed = bestN;
      if (hadPending && consumed > 0) {
        pendingParagraph = null;
        consumed -= 1;
      }
      cursor += consumed;
    }

    // ⛔⛔⛔⛔ משה 29/09/2026 — **טקסט ראשי שלא נכנס לעמוד היה נמחק בשקט.**
    //
    // ═══ מה נמדד ═══
    // ספרתי את כל התווים שהגיעו למסך בשתי גרסאות של אותו מסמך:
    //     לפני התיקון בגיאומטריה   316,473 תווים
    //     אחרי                     313,348 תווים
    //   ⇒ **3,125 תווים נעלמו**, 2,814 מהם מהטקסט הראשי.
    //
    // ═══ איך זה קרה ═══
    // המנוע מחליט מראש כמה פסקאות „נכנסות" לעמוד, ורק אחר כך בונה
    // אותו באמת. כשהבנייה האמיתית הצליחה להכניס פחות — מה שנשאר
    // (`plan.overflow.mainText`) פשוט לא נלקח לשום מקום: הרשימה
    // שמעבירה שאריות לעמוד הבא הכילה **רק זרמים**, לא את הראשי.
    // ומיד אחר כך הסמן קפץ לפסקה הבאה, וזהו — הפסקה ההיא נעלמה.
    //
    // ═══ הדימוי ═══
    // כמו מוביל שמעריך שכל הארגזים ייכנסו למשאית, מגלה שלא — ובמקום
    // להשאיר את הנותרים לנסיעה הבאה, זורק אותם לפח וממשיך.
    //
    // ⇒ מעכשיו: מה שלא נכנס **ממתין לעמוד הבא**. אף תו לא נמחק.
    const __mainLeftover = (() => {
      const entry = plan?.overflow?.mainText;
      if (!entry) return null;
      const rich = normalizeRichTextEntry(entry);
      return (rich.text && rich.text.trim()) ? rich : null;
    })();
    if (__mainLeftover) {
      const len = __mainLeftover.text.length;
      if (__mainStuckLen >= 0 && len >= __mainStuckLen) __mainStuckCount++;
      else __mainStuckCount = 0;
      __mainStuckLen = len;
    } else {
      __mainStuckLen = -1;
      __mainStuckCount = 0;
    }
    if (__mainLeftover) {
      const fragments = plan?.overflow?.mainParagraphs;
      if (!Array.isArray(fragments) || !fragments.length) {
        throw new Error("V9 main overflow is missing source fragments");
      }
      const queued = fragments.map(e => ({
        id: e.id, mainText: e.text, mainRuns: e.runs || [], runs: e.runs || [],
        mainRefs: e.mainRefs || [], notes: [],
        _v9Source: e.source, _v9SourceOffset: e.sourceOffset || 0,
        _v9SourceEnd: (e.sourceOffset || 0) + e.text.length,
        _v9ContinuesFromSplit: !!e.continues,
        _v9OpeningWordAllowed: e._v9OpeningWordAllowed !== false && !e.continues,
        _continues: !!e.continuesAfter,
      }));
      if (pendingParagraph) queued.push(pendingParagraph);
      pendingParagraph = null;
      paragraphs.splice(cursor, 0, ...queued);
      if (__mainStuckCount >= 3 && !plan.mainBox?.lines?.length && totalCarrySize(nextCarry) >= totalCarrySize(carryOver)) {
        const error = new Error("V9_LAYOUT_NO_PROGRESS: " + (plan.overflow.mainReason || "content does not fit"));
        error.remainingParagraphs = paragraphs.slice(cursor);
        throw error;
      }
    }

    // Carry-over no longer creates an artificial empty pending paragraph.
    // Note ownership is tracked explicitly by _v9NoteKey/auditV9NoteStarts:
    // a note must START with its source, but its continuation may share the
    // next page with new main text. The old drain marker deliberately created
    // carry-only pages and is therefore obsolete.
    // משה 2026-05-08: הגנה מלולאה אינסופית — אם לא הייתה צריכה (bestN=0, אין split)
    // וגם carry-over לא קטן, נכפה קידום של פסקה כדי לא להיתקע.
    if (bestN === 0 && !splitInfo && !hadPending && cursor < paragraphs.length) {
      const prevSize = totalCarrySize(carryOver);
      const newSize = totalCarrySize(nextCarry);
      if (newSize >= prevSize) {
        const error = new Error("V9_LAYOUT_NO_PROGRESS: refusing to skip an unconsumed source paragraph");
        error.remainingParagraphs = paragraphs.slice(cursor);
        throw error;
      }
    }
    carryOver = nextCarry;

    pageIdx++;
    renderedPageCount++;

    // משה 2026-05-15: בין עמוד לעמוד — שחרור ה-main thread כדי שהמשתמש
    // יוכל ללחוץ/להקליד/לשנות הגדרות גם תוך כדי רינדור. אם התחיל בינתיים
    // רינדור חדש (token חדש), עוצרים כאן ומחזירים את העמודים שכבר נבנו
    // (הם נשארים על המסך עד שהרינדור החדש יחליף אותם).
    if (renderedPageCount < cfg.maxPages && (cursor < paragraphs.length || hasCarryOver(carryOver) || pendingParagraph)) {
      await yieldToBrowser();
      if (!isCurrent()) return { pages, aborted: true };
    }
  }

  // התקלה נשארת גלויה: מי שרוצה לדעת כמה הערות לא הצליחו להישאר עם
  // המקור שלהן — הנתון כאן, ולא בהודעת שגיאה שמוחקת את המסמך.
  if (typeof window !== "undefined") {
    window.__ravtextLastV9NoteAnchorFallbacks = __v9NoteAnchorFallbacks;
  }

  return { pages, complete: cursor >= paragraphs.length && !pendingParagraph && !hasCarryOver(carryOver),
    remainingParagraphs: [...(pendingParagraph ? [pendingParagraph] : []), ...paragraphs.slice(cursor)],
    remainingStreams: carryOver, mainLayoutVersion: V9_INLINE_PLAN_VERSION,
    noteAnchorFallbacks: __v9NoteAnchorFallbacks };
}

function hasCarryOver(co) {
  if (!co) return false;
  for (const k in co) {
    if (normalizeRichTextEntry(co[k]).text) return true;
  }
  return false;
}

function totalCarrySize(co) {
  if (!co) return 0;
  let total = 0;
  for (const k in co) {
    total += normalizeRichTextEntry(co[k]).text.length;
  }
  return total;
}

// משה 2026-05-08: ניקוי markers שלא הוצאו (`@05`, `{@05 ...}`).
// אם הקלט מ-paneManagerToPackerContent השאיר marker בראשי (כי לא הייתה
// הערה תואמת בזרם), אנחנו לפחות לא מציגים אותו למשתמש.
function stripStreamMarkers(text) {
  if (!text) return '';
  // משה 2026-05-10: שומרים \n (שבירות שורה אמיתיות מהמקור) — מאחדים רק
  // רווחים וטאבים. ה-flow יזהה \n כשבירת שורה מאולצת.
  return text
    .replace(/\{@\d+[^}]*\}/g, '')
    .replace(/@\d+/g, '')
    // Word reference runs may carry NBSP/thin/narrow spaces. Once the label
    // itself is gone these are not a reserved number slot; collapse them just
    // like ordinary spaces, without touching real line breaks.
    .replace(/[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/gu, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// אוסף פסקאות לתוכן עמוד יחיד (בדומה ל-V8)
// משה 2026-05-08: carryOver = טקסט מ-overflow של העמוד הקודם, מסודר לפי id
// של הזרם. נשרשר אותו לפני ההערות מהפסקאות החדשות, כדי שייופיע ראשון
// בעמוד הנוכחי (כמו במנוע משנ"ב — מה שנחתך מעמוד אחד עובר לראש העמוד הבא).
function aggregateForV9(paragraphs, titles, streamSettings, levels, talmudStreams, carryOver) {
  // משה 2026-05-10: מצרפים פסקאות עם \n כדי לשמור את שבירת השורה ביניהן.
  // ה-flow יראה \n ויעבור לשורה חדשה. גם שבירות שורה בתוך פסקה (\n ב-mainText)
  // יישמרו.
  //
  // משה 2026-05-13: טבלאות מומרות לטקסט שורה אחר שורה (תאים מופרדים ברווחים),
  // כדי שהן יופיעו בפלט (במקום להיעלם). זה לא ציור טבלה אמיתי, אבל לפחות
  // התוכן מוצג. שיפור עתידי: ציור טבלה אמיתי ב-V9.
  const blockToText = (p) => {
    if (p.blockType === "table" && Array.isArray(p.tableRows) && p.tableRows.length > 0) {
      // המרת טבלה לטקסט: כל שורה = שורה אחת, תאים מופרדים ב-' | '
      return p.tableRows
        .map(row => row.join('  |  '))
        .join('\n');
    }
    return (p.mainText || '').trim();
  };
  // משה 2026-05-13: אגירת mainText + mainRuns יחד. כל פסקה מצורפת ל-mainText
  // עם '\n' בין פסקאות; ה-runs שלה ממופים לאופסט המתאים בתוך mainText.
  const mainPieces = [];
  const mainRunsAccum = [];
  const mainParagraphs = [];
  let mainOffset = 0;
  let mainParagraphIndex = 0;
  for (const p of paragraphs) {
    const prepared = prepareV9SourceParagraph(p, mainParagraphIndex);
    const piece = prepared.mainText;
    if (!piece) continue;
    const cleanPiece = piece;
    const localRuns = prepared.mainRuns || [];
    mainParagraphIndex += 1;
    mainParagraphs.push({
      id: prepared._v9Source.id,
      index: prepared._v9Source.index,
      source: prepared._v9Source,
      sourceOffset: prepared._v9SourceOffset,
      continuesAfter: !!prepared._continues,
      isHeading: prepared.blockType === "heading" || prepared.isHeading === true,
      blockType: prepared.blockType || "paragraph",
      headingLevel: prepared.headingLevel || null,
      text: cleanPiece,
      runs: localRuns,
      rich: makeRichText(cleanPiece, localRuns),
      mainRefs: v9MainRefsFromParagraph(prepared, cleanPiece.length),
      continues: !!(p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),
      _v9ContinuesFromSplit: !!p._v9ContinuesFromSplit,
      _v9OpeningWordAllowed: p._v9OpeningWordAllowed,
    });
    if (mainPieces.length > 0) mainOffset += 1; // for the '\n' separator
    mainPieces.push(piece);
    if (localRuns.length) {
      // הסר את stripStreamMarkers שעשוי לשנות תוכן בתוך הפסקה — לפסקאות
      // טיפוסיות זה רק מנקה רווחים, ה-runs יישארו רוב הזמן נכונים.
      for (const r of localRuns) {
        if (r.end > r.start) {
          mainRunsAccum.push({
            start: mainOffset + r.start,
            end: mainOffset + r.end,
            marks: r.marks,
          });
        }
      }
    }
    mainOffset += piece.length;
  }
  const mainText = stripStreamMarkers(mainPieces.join('\n'));
  const mainRuns = mainRunsAccum;
  const mainContinues = paragraphs.some(p => p && p._continues);
  const firstMainParagraph = mainParagraphs.find(p => p.text);
  const mainStartsContinued = !!firstMainParagraph?.continues;
  const mainOpeningWordAllowed = !!firstMainParagraph && !mainStartsContinued;

  const streamMap = new Map(); // sid → rich parts
  const requiredNoteStarts = [];

  function pushStreamRich(map, sid, entry) {
    if (!sid) return;
    const rich = normalizeRichTextEntry(entry);
    if (!rich.text) return;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(rich);
  }

  // קודם — carryOver מהעמוד הקודם.
  // 2026-05-17: תומך גם בפורמט ישן string וגם בפורמט חדש { text, runs }.
  if (carryOver) {
    for (const sid in carryOver) {
      pushStreamRich(streamMap, sid, carryOver[sid]);
    }
  }

  // משה 2026-05-15: ההערה עוברת דרך buildNoteContentNodes — אותו מנגנון של
  // המנוע הרגיל. מקבלים מספר הערה ("[N] "), הבלטת דיבור המתחיל, סוגרי גוף
  // וילדים מקוננים — כל ההגדרות מהזרם מכובדות ב-V9 בלי כפילות לוגיקה.
  for (const para of paragraphs) {
    for (const note of (para.notes || [])) {
      const sid = note.stream || note.streamId || note.streamCode;
      if (!sid) continue;
      if (!streamMap.has(sid)) streamMap.set(sid, []);
      const parts = streamMap.get(sid);
      const isCont = note.isContinuation === true || note.cont === 1 || note.cont === true;
      const num = typeof note.num === "number" && note.num > 0 ? note.num : (parts.length + 1);
      const nodes = buildNoteContentNodes(
        sid,
        num,
        note.text || "",
        Array.isArray(note.runs) ? note.runs : [],
        {
          isCont,
          place: "note",
          leadingSpace: false,
          children: Array.isArray(note.children) ? note.children : [],
        }
      );
      const { text: formattedText, runs: formattedRuns } = nodesToTextRuns(nodes);
      if (note._v9NoteKey && !isCont && String(note.text || '').trim()) requiredNoteStarts.push({
        key:note._v9NoteKey, paragraphId:note._v9ParentParagraphId,
        anchor:note._v9ParentAnchor, anchorAffinity:note.anchorAffinity, stream:sid,
        requireMainAnchor:note.nested !== true && !!para.mainText,
        sourceLength:para._v9Source?.text?.length || para.mainText?.length || 0
      });
      pushStreamRich(streamMap, sid, {
        text: formattedText,
        runs: markV9NoteRuns(formattedText,formattedRuns,nodes,note),
      });
    }
  }

  // משה 2026-05-13: סדר זרמים מקבל עדיפות מ-ravtext.streamOrder.v1 — אם
  // המשתמש שינה סדר ידנית, נכבד אותו במקום סדר ההופעה הראשונה במסמך.
  let savedOrder = [];
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem("ravtext.streamOrder.v1");
    if (raw) savedOrder = JSON.parse(raw) || [];
    if (!Array.isArray(savedOrder)) savedOrder = [];
  } catch (_) { savedOrder = []; }
  const orderRank = new Map();
  savedOrder.forEach((c, i) => orderRank.set(String(c), i));

  const rawAllStreams = Array.from(streamMap.entries()).map(([id, parts]) => {
    const rich = concatRichTextParts(parts, " ");
    return {
      id,
      items: parts.map(p => normalizeRichTextEntry(p).text).filter(Boolean),
      runs: rich.runs,
      rich,
    };
  });
  const allStreams = rawAllStreams.sort((a, b) => {
    const ra = orderRank.has(a.id) ? orderRank.get(a.id) : Infinity;
    const rb = orderRank.has(b.id) ? orderRank.get(b.id) : Infinity;
    if (ra !== rb) return ra - rb;
    return parseInt(a.id, 10) - parseInt(b.id, 10);
  });

  let rightStream = null;
  let leftStream = null;
  const footerStreams = [];

  // משה 2026-05-08: עדיפות גבוהה — talmudStreams מהקלט "talmud-streams-input"
  // (קוד הזרמים שהמשתמש בחר לעימוד גפ"ת). הראשון = ימני, השני = שמאלי.
  // אם הוגדרו → אלה הצדדים. כל זרם אחר → footer.
  if (Array.isArray(talmudStreams) && talmudStreams.length > 0) {
    const wantRightId = talmudStreams[0];
    const wantLeftId  = talmudStreams.length >= 2 ? talmudStreams[1] : null;
    const wantedSet = new Set(talmudStreams.slice(0, 2));

    // Mixed layout rule: these two IDs alone own the Gapt/Talmud side columns.
    // Other streams remain footers here. Their per-stream layoutRole is applied
    // later by groupV9FooterStreams, where two explicit "mishna" streams become
    // a Mishnah float+flow pair below the fixed side columns.
    for (const s of allStreams) {
      if (s.id === wantRightId && !rightStream) {
        rightStream = s;
      } else if (s.id === wantLeftId && !leftStream) {
        leftStream = s;
      } else if (!wantedSet.has(s.id)) {
        footerStreams.push(s);
      }
    }
    return { mainText, mainRuns, mainParagraphs, requiredNoteStarts, mainRefs: mainParagraphs.flatMap(p => p.mainRefs || []), mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };
  }

  // Fallback ישן: levels של משנ"ב + mishnaSide. נשאר לתאימות עם מצבי
  // הקודם ואם talmudStreams לא הוגדר.
  // ★ משה 28/09/2026 — שני דיווחים, שורש אחד:
  //   "יש מדורי הערות אחרים במקום ה'פשר דבר'" (דחיפות 1)
  //   "מצוין בהגדרות ששאר הזרמים יהיו במצב משנה ברורה — ובפועל לא קורה"
  //
  // נמדד בייצוא שלו: הצד הימני יציב (זרם 01 ב-149 מתוך 155 עמודים),
  // אבל בצד השמאלי התחלפו חמישה זרמים שונים — 03 ב-60 עמודים, 04 ב-42,
  // 02 ב-29, 05 ב-18 ו-01 בשניים.
  //
  // בהגדרות שלו: `talmudLayout.streams = "01,02"`, `mishnaWrap = 1`,
  // ו-`mishnaWrap.levels = "01,02 | 03,04"`.
  //
  // שני שלבים הובילו לתקלה:
  //   1. `vilna_v9_apply.js` שולח `talmudStreams: []` כשמשנ"ב דלוק, ולכן
  //      המסלול היציב (הראשון=ימני, השני=שמאלי) מדולג לגמרי.
  //   2. כאן, בפולבאק, **כל** הרמות נאספו ל-`sideCodes` — כלומר גם 03
  //      ו-04 נחשבו מועמדים לצדדים, ותפסו מקום פנוי בכל עמוד שבו
  //      הזרם המיועד היה ריק.
  //
  // הרמות אינן רשימת מועמדים שווה: **רמה 1 היא הצדדים**, והרמות שאחריה
  // הן בדיוק מה שמשה קורא לו "מצב משנה ברורה" — הן יורדות מתחת לטקסט
  // ואינן עולות לצדדים. זה גם מסביר למה שני הדיווחים הם אותה תקלה.
  const sideCodes = new Set();
  if (Array.isArray(levels) && levels.length) {
    for (const code of (levels[0] || [])) sideCodes.add(code);
  }

  const sideCandidates = [];

  for (const s of allStreams) {
    const setting = streamSettings[s.id] || {};
    const explicitSide = setting.mishnaSide;
    const isInLevel = sideCodes.has(s.id);

    if (!isInLevel && !explicitSide) {
      footerStreams.push(s);
    } else {
      sideCandidates.push({ s, side: explicitSide || 'auto' });
    }
  }

  for (const c of sideCandidates) {
    if (c.side === 'right' && !rightStream) rightStream = c.s;
    else if (c.side === 'left' && !leftStream) leftStream = c.s;
  }
  for (const c of sideCandidates) {
    if (c.s === rightStream || c.s === leftStream) continue;
    if (!rightStream) rightStream = c.s;
    else if (!leftStream) leftStream = c.s;
    else footerStreams.push(c.s);
  }

  if (!rightStream && !leftStream && sideCandidates.length === 0 && footerStreams.length >= 1) {
    rightStream = footerStreams.shift();
    if (footerStreams.length >= 1) leftStream = footerStreams.shift();
  }

  return { mainText, mainRuns, mainParagraphs, requiredNoteStarts, mainRefs: mainParagraphs.flatMap(p => p.mainRefs || []), mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };
}


