// vilna_v9.js — מנוע פריסת דף וילנא, V9.
import { applyStyleToElement, resolveTextStyle, applyTextStyleObjectToElement, normalizeTextStyle } from "./style_registry.js";
import { applyBarStyleToElement } from "./original_stream_columns.js";
import { appendTextWithRuns, sliceRuns } from "./engine/runs_dom.js";
import {
  makeRichText,
  normalizeRichTextEntry,
  trimRichText,
  concatRichTextParts,
  appendRichTextPart,
} from "./engine/rich_text_runs.js";
import { buildNoteContentNodes, nodesToTextRuns } from "./engine/note_content_builder.js";
import {
  buildV9SplitPolicy,
  buildParagraphBreakCandidates,
  scoreV9PageCandidate,
  splitMainTextAtOffset,
  splitNotesByAnchor,
  debugV9SplitDecision,
} from "./engine/v9_split_policy.js";

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
const V9_SAFETY_MAX = 1.30;
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
  const m = opts.metrics;
  const halfW = opts.halfWidth;
  const fullW = opts.fullWidth;

  const r = streams.right;
  const l = streams.left;

  function hasMinLines(text, width) {
    if (!text) return false;
    return m.countLines(text, width) >= minLines;
  }

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
    const longText = longSide === 'right' ? r : l;
    if (hasMinLines(longText, fullW)) {
      return {
        name: 'one_full_one_short',
        longSide: longSide,
        shortSide: longSide === 'right' ? 'left' : 'right',
      };
    }
  }

  return { name: 'two_short_no_crown' };
}

// =====================================================================
// מזרים טקסט בפסים אנכיים בעלי רוחבים שונים
// =====================================================================
function tokenizeRichTextForV9(entry) {
  const rt = normalizeRichTextEntry(entry);
  const tokens = [];
  const re = /\n|[^\s]+/g;
  let m;

  while ((m = re.exec(rt.text)) !== null) {
    const value = m[0];
    tokens.push({
      type: value === "\n" ? "break" : "word",
      text: value,
      start: m.index,
      end: m.index + value.length,
    });
  }

  return tokens;
}

function runsForLineFromWordTokens(wordTokens, sourceRuns) {
  const lineRuns = [];
  let lineCursor = 0;

  for (let i = 0; i < wordTokens.length; i++) {
    const tok = wordTokens[i];
    if (i > 0) lineCursor += 1;

    const wordRuns = sliceRuns(sourceRuns || [], tok.start, tok.end);
    for (const r of wordRuns) {
      if (!r || r.end <= r.start) continue;
      lineRuns.push({
        start: lineCursor + r.start,
        end: lineCursor + r.end,
        marks: r.marks || {},
      });
    }

    lineCursor += tok.text.length;
  }

  return lineRuns;
}

function richTextFromRemainingTokens(tokens, startIdx, sourceRuns) {
  let text = "";
  const runs = [];

  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === "break") {
      if (!text.endsWith("\n")) text += "\n";
      continue;
    }

    if (text && !text.endsWith("\n")) text += " ";

    const offset = text.length;
    text += tok.text;

    const wordRuns = sliceRuns(sourceRuns || [], tok.start, tok.end);
    for (const r of wordRuns) {
      if (!r || r.end <= r.start) continue;
      runs.push({
        start: offset + r.start,
        end: offset + r.end,
        marks: r.marks || {},
      });
    }
  }

  return trimRichText({ text, runs });
}

// =====================================================================
// מזרים טקסט בפסים אנכיים בעלי רוחבים שונים
// =====================================================================
function flowStreamThroughStrips(input, strips, metrics, maxY) {
  const rich = normalizeRichTextEntry(input);
  const lineH = metrics.lineHeight;
  const allLines = [];

  if (!Array.isArray(strips) || strips.length === 0 || !rich.text) {
    return {
      lines: [],
      overflowText: rich.text,
      overflowRuns: rich.runs,
      overflowRich: rich,
      consumedWords: 0,
      totalWords: 0,
      endY: 0,
    };
  }

  let curY = strips[0].y_start;
  const tokens = tokenizeRichTextForV9(rich);
  let tokenIdx = 0;

  for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
    const strip = strips[stripIdx];
    const nextStripY = (stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY;

    if (curY < strip.y_start) curY = strip.y_start;

    const availableHeight = nextStripY - curY;
    const availableLines = Math.floor(availableHeight / lineH);

    if (availableLines <= 0) {
      if (
        tokenIdx < tokens.length &&
        availableHeight > 0 &&
        stripIdx + 1 < strips.length &&
        strips[stripIdx + 1].width > strip.width
      ) {
        const bridgeLine = buildOneLine(tokens, tokenIdx, strip.width, metrics);
        if (bridgeLine.tokensConsumed > 0) {
          if (bridgeLine.words.length === 0 && bridgeLine.forcedBreak) {
            tokenIdx += bridgeLine.tokensConsumed;
          } else {
            allLines.push({
              y: curY,
              width: strip.width,
              words: bridgeLine.words,
              wordTokens: bridgeLine.wordTokens,
              text: bridgeLine.words.join(" "),
              runs: runsForLineFromWordTokens(bridgeLine.wordTokens, rich.runs),
              naturalWidth: bridgeLine.width,
              isLast: tokenIdx + bridgeLine.tokensConsumed >= tokens.length,
              forcedBreak: bridgeLine.forcedBreak,
            });
            tokenIdx += bridgeLine.tokensConsumed;
            curY += lineH;
          }
        }
      }
      continue;
    }

    let linesInStrip = 0;
    const linesConsumed = [];

    while (linesInStrip < availableLines && tokenIdx < tokens.length) {
      const line = buildOneLine(tokens, tokenIdx, strip.width, metrics);
      if (line.tokensConsumed === 0) break;

      if (line.words.length === 0 && line.forcedBreak) {
        tokenIdx += line.tokensConsumed;
        continue;
      }

      linesConsumed.push(line);
      tokenIdx += line.tokensConsumed;
      linesInStrip++;
    }

    for (let i = 0; i < linesConsumed.length; i++) {
      const line = linesConsumed[i];
      const isLastLine = (i === linesConsumed.length - 1) && (tokenIdx >= tokens.length);

      allLines.push({
        y: curY + i * lineH,
        width: strip.width,
        words: line.words,
        wordTokens: line.wordTokens,
        text: line.words.join(" "),
        runs: runsForLineFromWordTokens(line.wordTokens, rich.runs),
        naturalWidth: line.width,
        isLast: isLastLine,
        forcedBreak: line.forcedBreak,
      });
    }

    curY += linesConsumed.length * lineH;

    if (
      stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].width > strip.width
    ) {
      strips[stripIdx + 1].y_start = curY;
    }

    if (tokenIdx < tokens.length && curY < nextStripY && stripIdx < strips.length - 1) {
      const fillLine = buildOneLine(tokens, tokenIdx, strip.width, metrics);

      if (fillLine.tokensConsumed > 0) {
        if (fillLine.words.length === 0 && fillLine.forcedBreak) {
          tokenIdx += fillLine.tokensConsumed;
        } else {
          const isLastFillLine = tokenIdx + fillLine.tokensConsumed >= tokens.length;

          allLines.push({
            y: curY,
            width: strip.width,
            words: fillLine.words,
            wordTokens: fillLine.wordTokens,
            text: fillLine.words.join(" "),
            runs: runsForLineFromWordTokens(fillLine.wordTokens, rich.runs),
            naturalWidth: fillLine.width,
            isLast: isLastFillLine,
            forcedBreak: fillLine.forcedBreak,
          });

          tokenIdx += fillLine.tokensConsumed;
          curY += lineH;
        }
      }
    }

    if (tokenIdx >= tokens.length) break;
  }

  const overflowRich = richTextFromRemainingTokens(tokens, tokenIdx, rich.runs);

  return {
    lines: allLines,
    overflowText: overflowRich.text,
    overflowRuns: overflowRich.runs,
    overflowRich,
    consumedWords: tokenIdx,
    totalWords: tokens.length,
    endY: curY,
  };
}

function buildOneLine(tokens, startIdx, widthPx, metrics) {
  const spaceW = metrics.spaceWidth;
  let curWidth = 0;
  const lineWords = [];
  const lineWordTokens = [];
  let forcedBreak = false;
  let tokensConsumed = 0;

  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === "break") {
      tokensConsumed++;
      forcedBreak = true;
      break;
    }

    const wordW = metrics.measureWord(tok.text);
    const addW = lineWords.length === 0 ? wordW : curWidth + spaceW + wordW;

    if (addW <= widthPx || lineWords.length === 0) {
      lineWords.push(tok.text);
      lineWordTokens.push(tok);
      curWidth = addW;
      tokensConsumed++;
    } else {
      break;
    }
  }

  return {
    words: lineWords,
    wordTokens: lineWordTokens,
    wordCount: lineWords.length,
    tokensConsumed,
    width: curWidth,
    forcedBreak,
  };
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
    s && s.width > 0 && s.height > 0 && Math.floor(s.height / lineH) > 0
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
      
      const maxLines = Math.floor(strip.height / lineH);
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

  // הגנה: לפחות מילה אחת בכל צד (אחרת אין טעם בפיצול)
  const splitIdx = Math.min(words.length - 1, Math.max(1, finalSplit));
  
  return {
    first: words.slice(0, splitIdx).join(' '),
    second: words.slice(splitIdx).join(' '),
  };
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

function buildMainStrips(opts) {
  const { mainTopY, mainX, mainWidth, mainGap, innerWidth,
          rightEndY, leftEndY, pageBottom } = opts;

  // משה 2026-05-08: כל ה-y חסומים ב-pageBottom. אם פאס 1 נתן endY מעבר לדף
  // (כי naiveMainBottomY היה ענק), חוסמים כדי שה-strips לא ייצרו טווח שלילי.
  const cap = (v) => (v === Infinity ? Infinity : Math.min(v, pageBottom));
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

function appendOverflowStream(overflow, sid, entry) {
  if (!overflow || !sid) return;

  const incoming = normalizeRichTextEntry(entry);
  if (!incoming.text) return;

  const prev = normalizeRichTextEntry((overflow.streams || {})[sid]);
  overflow.streams[sid] = prev.text
    ? appendRichTextPart(prev, incoming, " ")
    : incoming;
}

// =====================================================================
// בונה תוכנית עמוד
// =====================================================================
function buildPagePlan(pageContent, config) {
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
    lineHeightRatio: cfg.lineHeightRatio,
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
      lineHeightRatio: Number(st.lineHeight) > 0 ? Number(st.lineHeight) : cfg.lineHeightRatio,
      fontWeight: st.bold ? "700" : "normal",
      fontStyle: st.italic ? "italic" : "normal",
    });
  }

  function getSideMetricsForStream(streamId) {
    const st = composeStreamTextStyle(streamId);
    if (!st) return sideMetrics;
    return metricsFromTextStyle(st, sideMetrics);
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
      lineHeightRatio: Number(style.lineHeight) > 0 ? Number(style.lineHeight) : cfg.lineHeightRatio,
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

  // 1. תרחיש כתר
  const rText = pageContent.rightStream ? pageContent.rightStream.items.join(' ') : null;
  const lText = pageContent.leftStream ? pageContent.leftStream.items.join(' ') : null;

  let scenario = chooseCrownScenario(
    { right: rText, left: lText },
    { metrics: sideMetrics, halfWidth, fullWidth: innerWidth, crownLines: cfg.crownLines }
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
    crownHeight = cfg.crownLines * sideLineH;
  }

  // משה 2026-05-10: צורה 4 — הזרם הארוך מקבל כתר ברוחב מלא של הדף.
  // הצד הקצר מדלג על הכתר ומתחיל ישר מתחת לאזור הכתר.
  const fullCrownSide = (scenario.name === 'one_full_one_short')
    ? scenario.longSide
    : null;

  const sideTopY = cfg.padding + titleHeight + reservedTop;
  const mainTopY = sideTopY + crownHeight;

  // 3. ראשי — ניבוי אורך נאיבי כדי לחשב את הצדדים. הפלייאוט הסופי ייעשה
  // אחרי שהצדדים נמדדו, כדי לאפשר לראשי להתפשט לתוך מקום של פרשן שנגמר
  // (בר־מצרא, מצב 2 בדינמיקת הגוף).
  let naiveMainHeight = 0;
  if (pageContent.mainText) {
    const naiveLines = mainMetrics.layoutLines(pageContent.mainText, mainWidth);
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
      
      let parts = splitWordsByStrips(allText, splitMetricsForStream, rightStrips);
      // fallback אם הפונקציה החדשה לא הצליחה (רצועות לא תקינות וכו')
      if (!parts) {
        parts = splitWordsAtVisualLine(allText, splitMetricsForStream, sideHalfWidth);
      }
      // משה 2026-05-15: בעבר השורות האלה דרסו את single.runs (סימני פונט/בולד
      // פר-מילה) — וכך הפלט הציג פונט ברירת-מחדל גם כשהמשתמש סימן פונט אחר
      // בעורך. עכשיו ה-runs נחתכים ל-2 חצאים לפי אופסטים ב-allText (כולל
      // leading-trim) ועוברים יחד עם ה-items החדשים.
      const rawText = single.items.join(' ');
      const leadingWs = rawText.length - rawText.replace(/^\s+/, "").length;
      const allRuns = Array.isArray(single.runs) ? single.runs : [];
      const firstLen = parts.first.length;
      const firstRuns = sliceRuns(allRuns, leadingWs, leadingWs + firstLen);
      const secondRuns = sliceRuns(allRuns, leadingWs + firstLen + 1, leadingWs + allText.length);
      pageContent.rightStream = { id: single.id, items: [parts.first], runs: firstRuns };
      pageContent.leftStream  = { id: single.id, items: [parts.second], runs: secondRuns };
    }
  }

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
  function buildSideStream(streamData, side, opts) {
    if (!streamData) return null;
    const streamRich = streamData.rich
      ? normalizeRichTextEntry(streamData.rich)
      : makeRichText(streamData.items.join(' '), Array.isArray(streamData.runs) ? streamData.runs : []);
    const text = streamRich.text;
    if (!text) return null;
    const o = opts || {};
    const rawMainBottomY = (o.mainBottomY !== undefined) ? o.mainBottomY : naiveMainBottomY;
    const effectiveMainBottomY = Math.min(rawMainBottomY, pageBottomY);
    // משה 2026-05-08: otherSideEndY הוא ה-y שבו הצד השני נגמר (מ-pass 1).
    // אם null/undefined — מתייחסים כאל "אין צד שני" → mainTopY (כל strip 3 בעצם
    // יקבל רוחב מלא). אם >= pageBottom — הצד השני ממשיך עד תחתית הדף → רק halfWidth.
    // בין לבין — נפצל את strip 3 לשניים: halfWidth עד otherEndY, fullWidth אחריו.
    const rawOtherEndY = (o.otherSideEndY !== undefined && o.otherSideEndY !== null)
      ? o.otherSideEndY
      : mainTopY;
    const otherEndY = Math.max(effectiveMainBottomY, Math.min(rawOtherEndY, pageBottomY));

    const strips = [];

    if (crownHeight > 0 && mainTopY > sideTopY) {
      // משה 2026-05-10: צורה 4 — צד הארוך מקבל crown ברוחב מלא, השני מדלג על crown.
      if (fullCrownSide === side) {
        strips.push({
          y_start: sideTopY,
          y_end: Math.min(mainTopY, pageBottomY),
          width: innerWidth,
          x: 0,
        });
      } else if (fullCrownSide && fullCrownSide !== side) {
        // הצד הקצר — מדלג על crown לגמרי, יתחיל מתחת לכתר
      } else {
        // משה 2026-05-08: כל צד 49.5% מראש (sideHalfWidth). מרווח 1% במרכז.
        strips.push({
          y_start: sideTopY,
          y_end: Math.min(mainTopY, pageBottomY),
          width: sideHalfWidth,
          x: side === 'right' ? sideRightX : 0,
        });
      }
    }

    if (naiveMainHeight > 0 && effectiveMainBottomY > mainTopY) {
      // משה 2026-05-10: צורה 4 — צד הקצר מדלג על הכתר וצריך מקום לכותרת
      // משלו מתחת לכתר. לכן strip 2 שלו מתחיל ב-mainTopY + titleHeight.
      const shortStreamGap = (fullCrownSide && fullCrownSide !== side) ? titleHeight : 0;
      const stripTop = mainTopY + shortStreamGap;
      // משה 2026-05-08: מרווח mainGap בין הראשי לטור הצד.
      if (side === 'right') {
        strips.push({
          y_start: stripTop,
          y_end: effectiveMainBottomY,
          width: Math.max(0, innerWidth - (mainX + mainWidth) - mainGap),
          x: mainX + mainWidth + mainGap,
        });
      } else {
        strips.push({
          y_start: stripTop,
          y_end: effectiveMainBottomY,
          width: Math.max(0, mainX - mainGap),
          x: 0,
        });
      }
    }

    // Strip 3 — שני סגמנטים אפשריים מתחת לראשי:
    //   3a (halfWidth, x צד) מ-effectiveMainBottomY עד otherEndY: שני הצדדים פעילים
    //   3b (innerWidth, x=0) מ-otherEndY עד pageBottomY: הצד השני כבר נגמר → השורד
    //                                                     לוקח את כל הרוחב
    // אם otherEndY <= effectiveMainBottomY: רק 3b (הצד השני נגמר ב-strips 1+2)
    // אם otherEndY >= pageBottomY: רק 3a (הצד השני מגיע עד תחתית הדף)
    if (effectiveMainBottomY < otherEndY) {
      strips.push({
        y_start: effectiveMainBottomY,
        y_end: otherEndY,
        width: sideHalfWidth,
        x: side === 'right' ? sideRightX : 0,
      });
    }
    // משה 2026-05-10: בתרחיש 1, רק לצד אחד (השמאלי = החצי השני בסדר הקריאה)
    // יש strip 3 ברוחב מלא. אחרת שני הצדדים יציירו על אותו אזור (חפיפה).
    // הימני (החצי הראשון) — אם יש לו עודף, הוא ייכנס ל-carry-over.
    const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (otherEndY < pageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: otherEndY,
        y_end: pageBottomY,
        width: innerWidth,
        x: 0,
      });
    }

    // משה 2026-05-13: בחירת ה-metrics המתאים לסגנון של הזרם הזה.
    // אם המשתמש החיל סגנון אישי עם פונט/גודל שונה — המדידה חייבת להתאים,
    // אחרת ה-DOM יראה משהו שונה ממה שמוחשב, ומילים יחתכו/יעלמו.
    const streamStyleId = streamSettings[streamData.id]?.styleId || "";
    const streamResolvedStyle = composeStreamTextStyle(streamData.id);
    const streamMetrics = getSideMetricsForStream(streamData.id);
    const streamFontSize = Number(streamResolvedStyle?.fontSize) > 0 ? Number(streamResolvedStyle.fontSize) : streamMetrics.fontSize;
    const streamLineH = Math.max(streamMetrics.lineHeight, streamFontSize * 1.35);

    const flowResult = flowStreamThroughStrips(
      streamRich,
      strips.map(s => ({ y_start: s.y_start, width: s.width })),
      streamMetrics,
      pageBottomY
    );

    const lines = [];
    for (const line of flowResult.lines) {
      const strip = strips.find(s => line.y >= s.y_start - 0.1 && line.y < s.y_end - 0.1);
      if (!strip) continue;
      lines.push({
        x: strip.x,
        y: line.y,
        width: strip.width,
        words: line.words,
        text: line.text,
        isLast: line.isLast,
        forcedBreak: line.forcedBreak,
        naturalWidth: line.naturalWidth,
        fontSize: streamFontSize,
        lineHeightPx: streamLineH,
        runs: line.runs || [],
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
      continues: !!flowResult.overflowText,
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

  // 4.5 ראשי — בר־מצרא: זורם דרך strips לפי endY של הצדדים.
  // אם פרשן נגמר באמצע (endY < naiveMainBottomY), הראשי מתפשט לתוך שטחו.
  if (pageContent.mainText) {
    // אם אין צד בכלל — endY = mainTopY (פנוי מההתחלה).
    // אם צד קיים אבל endY עבר את naiveMainBottomY — נחשב Infinity (חוסם הכול).
    const rawRight = pass1Right ? pass1Right.endY : mainTopY;
    const rawLeft  = pass1Left  ? pass1Left.endY  : mainTopY;
    const rightEnd = (rawRight >= naiveMainBottomY - 0.5) ? Infinity : rawRight;
    const leftEnd  = (rawLeft  >= naiveMainBottomY - 0.5) ? Infinity : rawLeft;

    const mainStrips = buildMainStrips({
      mainTopY,
      mainX,
      mainWidth,
      mainGap,
      innerWidth,
      rightEndY: rightEnd,
      leftEndY:  leftEnd,
      pageBottom: effectivePageBottom,
    });

    const mainFlow = flowStreamThroughStrips(
      makeRichText(pageContent.mainText, pageContent.mainRuns || []),
      mainStrips,
      mainMetrics,
      effectivePageBottom
    );

    const mainLines = [];
    for (const line of mainFlow.lines) {
      const strip = mainStrips.find(s =>
        line.y >= s.y_start - 0.1 && line.y < s.y_end - 0.1);
      if (!strip) continue;
      mainLines.push({
        x: strip.x,
        y: line.y,
        width: strip.width,
        words: line.words,
        text: line.text,
        isLast: line.isLast,
        forcedBreak: line.forcedBreak,
        naturalWidth: line.naturalWidth,
        fontSize: cfg.mainFontSize,
        lineHeightPx: mainMetrics.lineHeight,
        runs: line.runs || [],
      });
    }
    // 2026-05-17:
    // mainFlow כבר מחשב line.runs לפי wordTokens ו-offsets מקוריים.
    // אסור להריץ כאן attachRunsToLines, כי הוא משחזר לפי indexOf ויכול
    // להזיז bold/color למילים חוזרות או אחרי פיצולים. משאירים את line.runs
    // כפי שחושבו ב-flowStreamThroughStrips.
    for (const line of mainLines) {
      if (!Array.isArray(line.runs)) line.runs = [];
    }
    const actualMainHeight = mainFlow.endY - mainTopY;

    result.mainBox = {
      id: 'main',
      role: 'main',
      x: mainX,
      y: mainTopY,
      width: mainWidth, // רוחב בסיסי; שורות יחידות עשויות להיות רחבות יותר
      height: actualMainHeight,
      lines: mainLines,
      barMitzraStrips: mainStrips,
      continues: !!mainFlow.overflowText || !!pageContent.mainContinues,
      // משה 2026-05-13: סגנון "טקסט ראשי" (מ-document_style_settings) חייב להגיע גם למנוע V9.
      // בלי זה, בולד שהוגדר בסגנון הראשי לא היה מופיע בתצוגה הסופית.
      styleId: cfg.mainStyleId || "",
      inlineStyle: cfg.mainInlineStyle || null,
    };

    if (mainFlow.overflowText) {
      result.overflow.mainText = mainFlow.overflowText;
    }

    // חסימה ב-pageBottom: אם flow לא הצליח לדחוס הכול, mainBottomY עלול לחרוג.
    mainBottomY = Math.min(mainFlow.endY, effectivePageBottom);
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

  // איטרציה 1: pass2 ימני עם pass1 שמאלי
  // משה 2026-05-10: בתרחיש 1, הימני (חצי ראשון בסדר קריאה) לא מקבל strip 3
  // ברוחב מלא — אחרת הוא יחפוף עם strip 3 של השמאלי. השמאלי (חצי שני)
  // לוקח את הרוחב המלא בתחתית כי הוא ההמשך הטבעי של הקריאה.
  const isScenario1 = (scenario.name === 'one_long_split');
  let pass2Right = null;
  if (pageContent.rightStream) {
    pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
    });
  }
  // איטרציה 2: pass2 שמאלי עם pass2 ימני (אם קיים, אחרת pass1)
  let pass2Left = null;
  if (pageContent.leftStream) {
    const otherEnd = pass2Right ? cap(pass2Right.endY)
                   : pass1Right ? cap(pass1Right.endY)
                   : mainTopY;
    pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
    });
  }
  // איטרציה 3: pass2 ימני עם pass2 שמאלי (סופי)
  if (pageContent.rightStream && pass2Left) {
    pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
    });
  }

  if (pass2Right) {
    // משה 2026-05-10: צורה 4 — סימון איזה צד מקבל כותרת ברוחב מלא ואיזה
    // מדלג על הכותרת בראש (יקבל אותה מתחת לכתר, מעל התוכן שלו).
    if (fullCrownSide === 'right') pass2Right.fullWidthTitle = true;
    if (fullCrownSide && fullCrownSide !== 'right') pass2Right.skipTopTitle = true;
    if (scenario.name === 'one_long_split') pass2Right.isScenario1Split = true;
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
  let footerY = Math.max(
    ...result.streamBoxes.map(b => b.endY || 0),
    mainBottomY
  ) + interStreamGap;
  let anyFooterTrimmed = false;

  if (pageContent.footerStreams && pageContent.footerStreams.length) {
    for (const fs of pageContent.footerStreams) {
      const text = fs.items.join(' ');
      if (!text) continue;

      const settings = streamSettings[fs.id] || {};
      // משה 2026-05-13: footer גם משתמש ב-metrics לפי הסגנון של הזרם.
      // אם המשתמש החיל סגנון עם פונט/גודל שונה — המדידה חייבת להתאים,
      // אחרת מילים יחתכו/יעלמו.
      const fsResolvedStyle = composeStreamTextStyle(fs.id);
      const fsMetrics = getSideMetricsForStream(fs.id);
      const fsFontSize = Number(fsResolvedStyle?.fontSize) > 0 ? Number(fsResolvedStyle.fontSize) : fsMetrics.fontSize;
      const fsLineH = Math.max(fsMetrics.lineHeight, fsFontSize * 1.35);

      // אם אין מקום אפילו לכותרת + שורה אחת, כל ה-footer הזה ל-overflow.
      if (footerY + titleHeight + fsLineH > pageBottom) {
        result.overflow.streams[fs.id] = makeRichText(text, Array.isArray(fs.runs) ? fs.runs : []);
        anyFooterTrimmed = true;
        continue;
      }

      const footerCols = Math.max(1, Math.min(6, parseInt(settings.cols || 1, 10) || 1));
      const colGap = Math.max(0, Number(cfg.streamHorizontalGap) || 0);
      const colWidth = footerCols > 1
        ? Math.max(24, (innerWidth - colGap * (footerCols - 1)) / footerCols)
        : innerWidth;
      const allLines = fsMetrics.layoutLines(text, colWidth);
      const titleY = footerY;
      footerY += titleHeight;

      // כמה שורות נכנסות אחרי הכותרת?
      const remainingY = pageBottom - footerY;
      const rowsPerCol = Math.max(1, Math.floor(remainingY / fsLineH));
      const maxLinesFit = rowsPerCol * footerCols;
      const linesToRender = allLines.slice(0, maxLinesFit);
      const overflowLines = allLines.slice(maxLinesFit);

      if (overflowLines.length > 0) {
        const overflowWords = overflowLines.flatMap(l => l.words);
        const overflowText = overflowWords.join(' ');
        const sourceRuns = Array.isArray(fs.runs) ? fs.runs : [];
        const overflowStart = text.indexOf(overflowText);
        const overflowRuns = overflowStart >= 0
          ? sliceRuns(sourceRuns, overflowStart, overflowStart + overflowText.length)
          : [];
        result.overflow.streams[fs.id] = makeRichText(overflowText, overflowRuns);
        anyFooterTrimmed = true;
      }

      const linesData = [];
      for (let i = 0; i < linesToRender.length; i++) {
        const col = Math.floor(i / rowsPerCol);
        const row = i % rowsPerCol;
        const rtlCol = footerCols - 1 - Math.min(col, footerCols - 1);
        const x = footerCols > 1 ? rtlCol * (colWidth + colGap) : 0;
        linesData.push({
          x,
          y: footerY + row * fsLineH,
          width: colWidth,
          words: linesToRender[i].words,
          text: linesToRender[i].words.join(' '),
          isLast: i === linesToRender.length - 1,
          naturalWidth: linesToRender[i].width,
          fontSize: fsFontSize,
          lineHeightPx: fsLineH,
        });
      }

      // משה 2026-05-13: inline runs לרגל הזרם (footer) — אותו רעיון כמו בזרמי צד.
      attachRunsToLines(linesData, text, Array.isArray(fs.runs) ? fs.runs : []);

      result.footerBoxes.push({
        id: fs.id,
        styleId: settings.styleId || "",
        inlineStyle: fsResolvedStyle || {},
        titleStyleId: settings.titleStyleId || "",
        lines: linesData,
        titleY: titleY,
        titleHeight: titleHeight,
      });
      const renderedRows = footerCols > 1
        ? Math.min(rowsPerCol, linesToRender.length)
        : linesToRender.length;
      footerY += renderedRows * fsLineH + interStreamGap;
    }
  }

  // העמוד נחשב חורג אם footerY עבר את הגובה (לא צריך לקרות עם החיתוך)
  // או אם נחתך משהו (כדי ש-buildPages יקטין פסקאות וייתן לתוכן הבא להיכנס לעמוד הבא).
  result.overflow.exceedsPage = footerY > cfg.pageHeight || anyFooterTrimmed;

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

// משה 2026-05-13: פתרון דינמי אמיתי לחפיפת אלמנטים.
// אין נוסחאות; אין ספים. מודדים את ה-bounding box של הטקסט בפועל אחרי
// הציור (Range.getBoundingClientRect — כולל descenders/ascenders אמיתיים),
// ומזיזים אלמנטים תחתונים עד שאין יותר חפיפה ויזואלית. איטרציה חוזרת עד
// שהפריסה יציבה. עובד לכל פונט, גודל, ושפה.
function autoResolveV9CrownMainOverlap(pageEl) {
  if (!pageEl || !pageEl.querySelectorAll) return;

  const lines = Array.from(pageEl.querySelectorAll(".v9-line, [data-v9-role]"));
  const titles = Array.from(pageEl.querySelectorAll(".v9-stream-title"));
  const allElements = [...lines, ...titles];
  if (!allElements.length) return;

  function n(v) {
    const x = Number.parseFloat(v);
    return Number.isFinite(x) ? x : 0;
  }

  function roleOf(el) {
    return String(el.dataset.v9Role || el.className || "").toLowerCase();
  }

  function isMainLine(el) {
    return roleOf(el).includes("main");
  }

  function isTitle(el) {
    return el.classList && el.classList.contains("v9-stream-title");
  }

  // מודד את הקופסה האמיתית של הטקסט באמצעות Range — כולל descender של
  // ך'/ץ'/ם' שיוצא מחוץ ל-line-height. אם אין טקסט (כותרת ריקה), נופל
  // ל-getBoundingClientRect של האלמנט עצמו.
  function measure(el) {
    let rect;
    try {
      if (el.firstChild) {
        const r = document.createRange();
        r.selectNodeContents(el);
        rect = r.getBoundingClientRect();
        r.detach && r.detach();
      }
    } catch (_) { rect = null; }
    if (!rect || (!rect.width && !rect.height)) {
      rect = el.getBoundingClientRect();
    }
    return rect;
  }

  // המרת קואורדינטות מ-viewport ל-coordinates של pageEl (top:absolute).
  // אנחנו דוחפים אנכית בלבד, אז ה-x-axis לא משנה — נחזיר רק top/bottom יחסיים.
  function relTopBottom(rect, pageRect) {
    return {
      top: rect.top - pageRect.top,
      bottom: rect.bottom - pageRect.top,
    };
  }

  function relLeftRight(rect, pageRect) {
    return {
      left: rect.left - pageRect.left,
      right: rect.right - pageRect.left,
    };
  }

  function overlapsXY(a, b) {
    const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return xOverlap > 0.5 && yOverlap > 0.5;
  }

  const padding = n(pageEl.style.padding);
  const pageHeight = n(pageEl.style.height);
  const topLimit = padding;
  const bottomLimit = pageHeight ? pageHeight - padding : Infinity;

  // === שלב א': אכיפת גבול עליון על כל אלמנט (מעל ה-padding).
  let upperShifts = 0;
  for (const el of allElements) {
    const top = n(el.style.top);
    if (top < topLimit - 0.5) {
      el.style.top = topLimit + "px";
      upperShifts++;
    }
  }

  // === שלב ב': מדידה איטרטיבית של חפיפות ויזואליות אמיתיות.
  // לכל איטרציה: בדוק כל זוג (לא-ראשי / כותרת) ↔ (ראשי), אם יש חפיפה
  // ויזואלית — דחוף את הראשי למטה בדיוק הכמות הדרושה. אם כותרת חופפת ראשי,
  // דחוף את הכותרת. עוצרים כשאין יותר חפיפה או אחרי MAX_ITERS.
  const MAX_ITERS = 8;
  let totalMainShift = 0;
  let totalTitleShifts = 0;
  let iteration = 0;
  let changed = true;

  while (changed && iteration < MAX_ITERS) {
    changed = false;
    iteration++;
    const pageRect = pageEl.getBoundingClientRect();

    // מדידה טריה של כל האלמנטים אחרי כל איטרציה (הזזות קודמות שינו מצב).
    const measured = allElements.map(el => {
      const rect = measure(el);
      return {
        el,
        isMain: isMainLine(el),
        isTitle: isTitle(el),
        topBot: relTopBottom(rect, pageRect),
        leftRight: relLeftRight(rect, pageRect),
      };
    });

    const mains = measured.filter(m => m.isMain && !m.isTitle);
    const others = measured.filter(m => !m.isMain || m.isTitle);

    // לכל ראשי, בדוק כל "אחר" שלא-ראשי שחופף אותו ויזואלית.
    for (const m of mains) {
      const a = { ...m.topBot, ...m.leftRight };
      let maxPush = 0;
      for (const o of others) {
        const b = { ...o.topBot, ...o.leftRight };
        if (!overlapsXY(a, b)) continue;
        // אם ה"אחר" נמצא מעל הראשי (top שלו קטן יותר), דוחפים את הראשי למטה.
        // אם ה"אחר" כותרת footer שמתחת לראשי, דוחפים אותה למטה (שלב ג').
        if (b.top <= a.top + 0.5) {
          // האחר מעל — דוחפים ראשי למטה כדי לעבור אותו
          const push = b.bottom - a.top + 0.5; // 0.5px ביטחון נגד אנטי-אלייסינג
          if (push > maxPush) maxPush = push;
        }
      }
      if (maxPush > 0.5) {
        const oldTop = n(m.el.style.top);
        m.el.style.top = (oldTop + maxPush) + "px";
        totalMainShift += maxPush;
        changed = true;
      }
    }

    if (changed) continue; // נמדוד מחדש לפני שמטפלים בכותרות

    // שלב ג': כותרת footer/stream שחופפת שורת ראשי — דחוף את הכותרת למטה
    // (הראשי כבר מעוגן; הכותרת מתחת אמורה לעבור את שורת הראשי האחרונה).
    const titlesMeasured = measured.filter(m => m.isTitle);
    for (const t of titlesMeasured) {
      const tb = { ...t.topBot, ...t.leftRight };
      let maxPush = 0;
      for (const m of mains) {
        const mb = { ...m.topBot, ...m.leftRight };
        if (!overlapsXY(tb, mb)) continue;
        // אם הראשי מעל הכותרת (mb.top < tb.top), דוחפים את הכותרת למטה.
        if (mb.top <= tb.top + 0.5) {
          const push = mb.bottom - tb.top + 0.5;
          if (push > maxPush) maxPush = push;
        }
      }
      if (maxPush > 0.5) {
        const oldTop = n(t.el.style.top);
        const newTop = oldTop + maxPush;
        if (newTop <= bottomLimit - 2) {
          t.el.style.top = newTop + "px";
          totalTitleShifts++;
          changed = true;
        }
      }
    }
  }

  pageEl.dataset.v9LayoutGuard = JSON.stringify({
    mainShift: Math.round(totalMainShift * 100) / 100,
    upperShifts,
    titleShifts: totalTitleShifts,
    iterations: iteration,
  });
}

function renderPagePlan(plan, pageEl, cfg) {
  ensureGlobalStyles();

  pageEl.classList.add('v9-page');
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

  function drawBox(box, fontSize, lineHeight, fontFamily, colorClass) {
    const innerW = plan.pageBox.innerWidth;
    for (const line of box.lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'v9-line' + (colorClass || '');
      // משה 2026-05-10: שורה שמסתיימת בשבירה מאולצת (\n במקור) — לא מיושרת.
      const isContinuationCut = box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1
        && line.naturalWidth >= line.width * 0.65
        && line.naturalWidth < line.width - 2;
      const shouldJustify = ((!line.isLast && !line.forcedBreak) || isContinuationCut)
                             && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);
      // משה 2026-05-10: שורה אחרונה ברוחב מלא ממורכזת (לפי כללי ספרי קודש).
      const isFullWidthOrphan = line.isLast && line.width >= innerW - 5;
      const isParagraphEnd = (line.isLast || line.forcedBreak)
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;
      if (!isContinuationCut && (isFullWidthOrphan || isParagraphEnd)) lineEl.className += ' center';
      else if (shouldJustify) lineEl.className += ' justify';
      lineEl.style.left = (padding + line.x) + 'px';
      lineEl.style.top = line.y + 'px';
      lineEl.style.width = line.width + 'px';
      lineEl.style.height = (fontSize * lineHeight) + 'px';
      lineEl.style.fontSize = fontSize + 'px';
      lineEl.style.lineHeight = (fontSize * lineHeight) + 'px';
      if (fontFamily) lineEl.style.fontFamily = fontFamily;
      applyStyleToElement(lineEl, box.styleId);
      if (box.inlineStyle) {
        applyTextStyleObjectToElement(lineEl, box.inlineStyle);
      }

      // משה 2026-05-13: הגנה נגד חיתוך אותיות/ניקוד.
      // אם הפונט בפועל גדול מגובה השורה המחושב, אסור להשאיר height נמוך.
      const actualFontSize = parseFloat(lineEl.style.fontSize) || line.fontSize || fontSize || 0;
      const requestedLineHeight = line.lineHeightPx || parseFloat(lineEl.style.lineHeight) || (actualFontSize * lineHeight);
      const safeLineHeight = Math.max(requestedLineHeight, actualFontSize * 1.35);

      if (actualFontSize > 0) lineEl.style.fontSize = actualFontSize + 'px';
      if (safeLineHeight > 0) {
        lineEl.style.lineHeight = safeLineHeight + 'px';
        lineEl.style.height = safeLineHeight + 'px';
      }
      lineEl.style.overflow = 'visible';

      const v9Role = String(box.role || box.type || box.kind || (box.id === "main" ? "main" : (box.id ? "stream" : "")) || "");
      if (v9Role) {
        lineEl.dataset.v9Role = v9Role;
        lineEl.classList.add("v9-role-" + v9Role.replace(/[^a-z0-9_-]/gi, "-").toLowerCase());
      }
      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      // משה 2026-05-13: רינדור עם inline runs — בולד/הדגשה/צבע פר-מילה.
      // אם line.runs ריק, appendTextWithRuns ייצור textNode רגיל (זהה ל-textContent).
      appendTextWithRuns(lineEl, line.text, line.runs);
      pageEl.appendChild(lineEl);
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
    const settings = streamId ? (cfg.streamSettings || {})[streamId] : null;
    if (settings) applyBarStyleToElement(t, settings);
    t.textContent = text;
    pageEl.appendChild(t);
  }

  // ראשי — בלי צבע זרם (הראשי הוא הטקסט המרכזי, לא זרם)
  if (plan.mainBox) {
    drawBox(plan.mainBox, cfg.mainFontSize || 13, cfg.lineHeightRatio || 1.55, cfg.mainFontFamily, '');
  }

  // זרמים צדיים + כותרות — כל זרם בצבע משלו
  for (const box of plan.streamBoxes) {
    const colorClass = streamColorClass(box.id);
    drawBox(box, cfg.sideFontSize || 11, cfg.lineHeightRatio || 1.55, cfg.sideFontFamily, colorClass);

    const title = (cfg.titles || {})[box.id];
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
    const title = (cfg.titles || {})[fb.id];
    if (title) {
      drawTitle(title, 0, fb.titleY, plan.pageBox.innerWidth, colorClass, fb.titleStyleId, fb.id);
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

  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => autoResolveV9CrownMainOverlap(pageEl));
  } else {
    setTimeout(() => autoResolveV9CrownMainOverlap(pageEl), 0);
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

export async function buildPages(container, paragraphs, config) {
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
    // משה 2026-05-15: דגל — מונע חיתוכי טקסט באמצע שורה. מטפל רק ברמת
    // השורה, לא ברמת פסקה (זה תפקיד noMidLineSplits).
    //
    // 2026-05-17 (v3): ברירת מחדל חוזרת ל-true. בלי הדגל לא היה ויזואלית
    // טוב יותר — הוא רק חשף חיתוכים שונים. עם הדגל לפחות אין חיתוכים
    // הנראים לעין. מי שרוצה זרימה חופשית של הדפדפן יכבה את ה-checkbox.
    preventMidLineSplit: true,
    maxPages: 100,
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
  const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

  const pages = [];
  let cursor = 0;
  let pageIdx = 0;
  const splitMetrics = new VilnaMetrics({
    fontFamily: cfg.mainFontFamily,
    fontSize: cfg.mainFontSize,
    lineHeightRatio: cfg.lineHeightRatio,
  });
  const splitInnerWidth = cfg.pageWidth - 2 * cfg.padding;
  const splitMainWidth = Math.floor(splitInnerWidth * cfg.mainWidthRatio);

  // משה 2026-05-08: carry-over של טקסט שנחתך מעמוד לעמוד הבא.
  // streamId → string. בכל עמוד, הטקסט נשמר ב-overflow.streams ומועבר
  // לתחילת הזרם בעמוד הבא (לפני ההערות מהפסקאות החדשות).
  let carryOver = {};

  // משה 2026-05-08: pendingParagraph = החצי השני של פסקה שפוצלה בעמוד הקודם.
  // כשמפצלים פסקה, החצי הראשון (עם הערות) הולך לעמוד הנוכחי, והחצי השני
  // (טקסט בלבד, ללא הערות — הן כבר ניתנו) נשמר ל-pendingParagraph לעמוד הבא.
  let pendingParagraph = null;

  while ((cursor < paragraphs.length || hasCarryOver(carryOver) || pendingParagraph) && pageIdx < cfg.maxPages) {
    if (pendingParagraph?._drainMarker && !hasCarryOver(carryOver)) {
      pendingParagraph = null;
      if (cursor >= paragraphs.length) break;
    }

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
      const aggContent = aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver);
      return buildPagePlan(aggContent, cfg);
    };

    // משה 2026-05-08: "fits clean" = העמוד לא חורג ויזואלית וגם אף הערה לא נחתכה.
    // אם הערות נחתכות אבל העמוד לא חורג ויזואלית — זה גורם ל-carry-over של
    // הערות לעמוד הבא בלי הפסקה שלהן (חוסר קישור הערות-ראשי). אז נדחה.
    const fitsClean = (tp) => {
      if (!tp || !tp.overflow) return false;
      if (tp.overflow.exceedsPage) return false;
      if (tp.overflow.mainText) return false;
      const ovs = tp.overflow.streams || {};
      for (const k in ovs) if (ovs[k]) return false;
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
      const availableLines = Math.max(1, Math.floor((cfg.pageHeight - 2 * cfg.padding) / lineH));
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
        const anchoredBefore = anchored.filter(n => n.anchor < len);
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
          const half = { ...target, mainText: fullText.substring(0, len), notes: notesBeforeAnchor(len) };
          const slice = [...baseSlice, half];
          return buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
        };
        const splitPlanMeta = (tp, movedNotes) => {
          if (!tp || !tp.overflow || tp.overflow.mainText) return null;
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
            firstHalf: { ...target, mainText: splitText.prefixText, notes: movedNotes || splitNotes.before, _continues: true },
            secondHalf: { ...target, mainText: splitText.suffixText, notes: splitNotes.after },
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

              const firstHalf = {
                ...target,
                mainText: splitText.prefixText,
                notes: splitNotes.before,
                _continues: true,
              };

              const secondHalf = {
                ...target,
                mainText: splitText.suffixText,
                notes: splitNotes.after,
              };

              const fallbackPlan = buildPagePlan(
                aggregateForV9([...getSlice(baseN), firstHalf], cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver),
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
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
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
            const anchoredBefore = anchored.filter(n => n.anchor < len);
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
            ? rescueCandidates.slice(0, carryGapMaxMainLines() + 1)
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

            const firstHalf = {
              ...target,
              mainText: splitText.prefixText,
              notes: splitNotes.before,
              _continues: true,
            };

            const slice = [...baseSlice, firstHalf];
            const tp = buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
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
            const noteOverflow = Object.keys(tp.overflow.streams || {}).some(k => tp.overflow.streams[k]);

            // משה 2026-05-17 (v4): noteOverflow = פסילה מוחלטת ב-Gap rescue.
            // הערות חייבות להישאר באותו עמוד של ההפניה אליהן. מועמד שיוצר
            // note overflow גורש את ההערות לעמוד הבא — זה ההפך מהמטרה.
            // קנס קטן של 0.25 לא הספיק כי fill מספיק גבוה יכל לנצח אותו.
            // עכשיו פסילה מוחלטת בכל המקרים (carryActive כלול), בלי קנסות
            // נוספים בציון. ההגנה הזו לבד, בלי connector strip הקודם.

            if (noteOverflow) continue;

            const mainProgressBonus = carryActive ? 0 : Math.min(0.12, (len / Math.max(1, fullText.length)) * 0.12);

            const score =

              (currentHasNoteOverflow ? 1 : 0) +

              fill + mainProgressBonus;

            if (score < rescueBestScore) continue;
            rescueBestScore = score;
            rescueBest = {
              firstHalf,
              secondHalf: {
                ...target,
                mainText: splitText.suffixText,
                notes: splitNotes.after,
              },
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
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      const currentHasNoteOverflow = Object.keys((currentPlan && currentPlan.overflow && currentPlan.overflow.streams) || {})
        .some(k => currentPlan.overflow.streams[k]);
      const secondText = (splitInfo.secondHalf?.mainText || '').trim();
      if (!currentHasNoteOverflow && currentFill < rescueMinFillRatio && secondText.length > 0) {
        const secondNotes = splitInfo.secondHalf.notes || [];
        const anchored = secondNotes.filter(n => typeof n.anchor === 'number');
        const anchorless = secondNotes.filter(n => typeof n.anchor !== 'number');
        const notesBeforeAnchor = (len) => {
          const ratio = secondText.length > 0 ? len / secondText.length : 0;
          const anchorlessShare = Math.round(anchorless.length * ratio);
          const anchoredBefore = anchored.filter(n => n.anchor < len);
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
        const extendCandidates = buildParagraphBreakCandidates(
          secondText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "extension-rescue" }
        )
          .filter(c => c.offset >= 2 && c.offset <= secondText.length)
          .slice(0, 2)
          .sort((a, b) => a.offset - b.offset);
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

          const firstHalf = {
            ...splitInfo.firstHalf,
            mainText: ((splitInfo.firstHalf.mainText || '').trim() + " " + prefix).trim(),
            notes: [...(splitInfo.firstHalf.notes || []), ...splitNotes.before],
            _continues: true,
          };

          const secondHalf = {
            ...splitInfo.secondHalf,
            mainText: splitText.suffixText,
            notes: splitNotes.after,
          };
          const slice = [...getSlice(splitInfo.baseN), firstHalf];
          const tp = buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
          if (!tp || !tp.overflow || tp.overflow.mainText) continue;

          const extensionScore = scoreV9PageCandidate(
            tp,
            extendCandidate,
            v9SplitPolicy,
            { cfg, movedNotes: splitNotes.before, pageIdx, source: "extension-rescue" }
          );
          if (!extensionScore.accept) continue;

          const noteOverflow = Object.keys(tp.overflow.streams || {}).some(k => tp.overflow.streams[k]);

          // משה 2026-05-17 (v4): כאן Extension מנסה לסחוב שורה מהעמוד הבא
          // לעמוד הנוכחי כדי לסתום רווח. אסור שזה ידחוף את ההערות הקיימות
          // לעמוד הבא — ההערות חייבות להישאר עם הטקסט שאליו הן שייכות.
          // אם משיכת השורה גורמת ל-note overflow → פסילה מוחלטת, לא קנס.
          // ככה מודדים שורה-שורה ועוצרים ברגע שהמשיכה הבאה תפגע בהערות.

          if (noteOverflow) continue;

          const fill = planFillRatio(tp);

          if (fill < currentFill - 0.04) continue;

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
        const anchoredBefore = anchored.filter(n => n.anchor < len);
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
        const emergencyCandidate = buildParagraphBreakCandidates(
          fullText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "emergency", emergency: true }
        ).find(c => c.offset >= MIN_EMERGENCY_SPLIT && c.offset < fullText.length);

        const fallbackLen = emergencyCandidate?.offset || null;
        if (fallbackLen) {
          const movedNotes = notesBeforeAnchor(fallbackLen);
          if (typeof console !== "undefined") {
            console.warn(
              "[v9] emergency paragraph split: paragraph is larger than one page; " +
              (emergencyCandidate
                ? ("using " + emergencyCandidate.kind + " split.")
                : "no legal emergency split point.")
            );
          }
          const splitText = splitMainTextAtOffset(fullText, fallbackLen);
          const splitNotes = splitNotesByAnchor(
            target?.notes || [],
            splitText.splitOffset,
            fullText.length,
            splitText.suffixBaseOffset
          );

          const firstHalf = {
            ...target,
            mainText: splitText.prefixText,
            notes: splitNotes.before,
            _continues: true,
            _emergencySplit: true,
          };
          const secondHalf = {
            ...target,
            mainText: splitText.suffixText,
            notes: splitNotes.after,
          };
          const emergencyPlan = buildPagePlan(
            aggregateForV9([firstHalf], cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver),
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

          if (emergencyScore.accept) {
            splitInfo = {
              firstHalf,
              secondHalf,
              sliceIdx,
              baseN,
            };
          }
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
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      const currentHasNoteOverflow = Object.keys((currentPlan && currentPlan.overflow && currentPlan.overflow.streams) || {})
        .some(k => currentPlan.overflow.streams[k]);
      if (
        tp && tp.overflow &&
        !tp.overflow.mainText &&
        hasNoteOverflow &&
        !currentHasNoteOverflow &&
        planMainLineCount(tp) <= carryGapMaxMainLines() &&
        planHasCommentaryStart(tp) &&
        (fill > currentFill + 0.08 || (currentFill < rescueMinFillRatio && fill >= currentFill - 0.04))
      ) {
        overflowTakeN = candidateN;
        splitInfo = null;
      }
    }

    // משה 2026-05-09: ★ drain-alone — אם יש pending + carry-over שלבד חורג, נריץ
    // עמוד drain רק עם ה-carry (בלי pending). זה משחרר את ה-carry שיוצר אצטמולציה
    // ומאפשר ל-pending להירנדר נקי בעמוד הבא. אחרת ה-carry חונק את כל הפסקאות הבאות.
    let drainAloneMode = false;
    if (!splitInfo && hasCarryOver(carryOver)) {
      // בדוק אם carry לבד (slice ריק) חורג
      const carryAloneTrial = buildPagePlan(
        aggregateForV9([], cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver),
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
      const agg = aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver);
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
        const tp = buildPagePlan(aggregateForV9(checkSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
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
    let finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver);
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
      finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver);
      finalProbe = buildPagePlan(finalContent, cfg);
      finalGuardTries++;
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

    const plan = buildSinglePage(pageEl, finalContent, cfg);
    pages.push(pageEl);

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
    const wasDrainMarker = !!pendingParagraph?._drainMarker;
    if (drainAloneMode) {
      // עמוד drain בלי שום פסקה — pending נשאר כמו שהוא, cursor לא זז
      // carry-over יתעדכן מהעמוד; כשיתרוקן ה-pending יוכל להירנדר נקי
    } else if (splitInfo) {
      // sliceIdx = איפה הפיצול במערך הזמינות. צרכנו slice[0..sliceIdx-1] במלואם
      // וגם את slice[sliceIdx] חצי ראשון. החצי השני יוצא ל-pendingParagraph.
      const sliceIdx = splitInfo.sliceIdx;
      if (hadPending && sliceIdx === 0) {
        // הפיצול על pending עצמו — pending מתחלף, cursor לא זז
        pendingParagraph = splitInfo.secondHalf;
      } else if (hadPending) {
        // pending נצרך במלואו (slice[0]) + sliceIdx-1 פסקאות מהמערך + 1 פסקה מפוצלת
        pendingParagraph = splitInfo.secondHalf;
        cursor += sliceIdx;
      } else {
        // אין pending — sliceIdx פסקאות מהמערך נצרכו במלואן + 1 מפוצלת
        pendingParagraph = splitInfo.secondHalf;
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

    // משה 2026-05-09: ★ סמן ניקוז (drain marker) — אם בוצע force-take עם הערות שעלו,
    // יוצרים pendingParagraph ריק (mainText="") שמייצג "המשך הערות הפסקה הקודמת".
    // זה מונע מקריירי-אובר לזרום לעמוד עם פסקה חדשה (חוסר קישור). העמוד הבא
    // יהיה drain עם carry-over בלבד, אבל הוא יהיה צמוד לפסקה המקור.
    const hasOverflowNotes = Object.keys(nextCarry).some(k => nextCarry[k]);
    if (hasOverflowNotes && !splitInfo && !pendingParagraph && !drainAloneMode) {
      pendingParagraph = { mainText: '', notes: [], _drainMarker: true };
    }
    // אם זה היה drain marker וה-carry-over כבר התרוקן — נקה גם את ה-marker
    if (wasDrainMarker && pendingParagraph?._drainMarker && !hasOverflowNotes) {
      pendingParagraph = null;
    }

    // משה 2026-05-08: הגנה מלולאה אינסופית — אם לא הייתה צריכה (bestN=0, אין split)
    // וגם carry-over לא קטן, נכפה קידום של פסקה כדי לא להיתקע.
    if (bestN === 0 && !splitInfo && !hadPending && cursor < paragraphs.length) {
      const prevSize = totalCarrySize(carryOver);
      const newSize = totalCarrySize(nextCarry);
      if (newSize >= prevSize) cursor += 1;
    }
    carryOver = nextCarry;

    pageIdx++;

    // משה 2026-05-15: בין עמוד לעמוד — שחרור ה-main thread כדי שהמשתמש
    // יוכל ללחוץ/להקליד/לשנות הגדרות גם תוך כדי רינדור. אם התחיל בינתיים
    // רינדור חדש (token חדש), עוצרים כאן ומחזירים את העמודים שכבר נבנו
    // (הם נשארים על המסך עד שהרינדור החדש יחליף אותם).
    if (pageIdx < cfg.maxPages && (cursor < paragraphs.length || hasCarryOver(carryOver) || pendingParagraph)) {
      await yieldToBrowser();
      if (!isCurrent()) return { pages, aborted: true };
    }
  }

  return { pages };
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
    .replace(/[\t ]+/g, ' ')
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
  let mainOffset = 0;
  for (const p of paragraphs) {
    const piece = blockToText(p);
    if (!piece) continue;
    if (mainPieces.length > 0) mainOffset += 1; // for the '\n' separator
    mainPieces.push(piece);
    if (Array.isArray(p.mainRuns) && p.mainRuns.length) {
      // הסר את stripStreamMarkers שעשוי לשנות תוכן בתוך הפסקה — לפסקאות
      // טיפוסיות זה רק מנקה רווחים, ה-runs יישארו רוב הזמן נכונים.
      for (const r of p.mainRuns) {
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

  const streamMap = new Map(); // sid → rich parts

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
      pushStreamRich(streamMap, sid, {
        text: formattedText,
        runs: formattedRuns,
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
    for (const s of allStreams) {
      if (s.id === wantRightId && !rightStream) {
        rightStream = s;
      } else if (s.id === wantLeftId && !leftStream) {
        leftStream = s;
      } else if (!wantedSet.has(s.id)) {
        footerStreams.push(s);
      }
    }
    return { mainText, mainRuns, mainContinues, rightStream, leftStream, footerStreams, titles };
  }

  // Fallback ישן: levels של משנ"ב + mishnaSide. נשאר לתאימות עם מצבי
  // הקודם ואם talmudStreams לא הוגדר.
  const sideCodes = new Set();
  if (Array.isArray(levels)) {
    for (const level of levels) {
      for (const code of level) sideCodes.add(code);
    }
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

  return { mainText, mainRuns, mainContinues, rightStream, leftStream, footerStreams, titles };
}
