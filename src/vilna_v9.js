// vilna_v9.js — מנוע פריסת דף וילנא, V9.
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
  }

  get lineHeight() {
    return this.fontSize * this.lineHeightRatio;
  }

  get spaceWidth() {
    if (this._spaceWidth === undefined) {
      this._spaceWidth = this._ctx.measureText(' ').width;
    }
    return this._spaceWidth;
  }

  measureWord(word) {
    if (this._wordWidthCache.has(word)) {
      return this._wordWidthCache.get(word);
    }
    const w = this._ctx.measureText(word).width;
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
function flowStreamThroughStrips(text, strips, metrics, maxY) {
  const lineH = metrics.lineHeight;
  const allLines = [];
  let curY = strips[0].y_start;

  // משה 2026-05-10: tokenize — מילים רגילות + מרקרים של שבירת שורה ('\n').
  // כש-buildOneLine נתקל ב-'\n', הוא עוצר השורה הנוכחית והמרקר נצרך בלי טקסט.
  const tokens = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ws = lines[i].split(/[\t ]+/).filter(Boolean);
    for (const w of ws) tokens.push(w);
    if (i < lines.length - 1) tokens.push('\n');
  }
  let tokenIdx = 0;

  for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
    const strip = strips[stripIdx];
    const nextStripY = (stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY;

    if (curY < strip.y_start) curY = strip.y_start;

    const availableHeight = nextStripY - curY;
    const availableLines = Math.floor(availableHeight / lineH);
    if (availableLines <= 0) continue;

    let linesInStrip = 0;
    const linesConsumed = [];

    while (linesInStrip < availableLines && tokenIdx < tokens.length) {
      const line = buildOneLine(tokens, tokenIdx, strip.width, metrics);
      if (line.tokensConsumed === 0) break;
      // משה 2026-05-10: \n בודד בלי מילים = שורה ריקה. צרכים את הטוקן אבל
      // לא מציירים שורה — אחרת רואים פער ויזואלי בלי תוכן.
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
        text: line.words.join(' '),
        naturalWidth: line.width,
        isLast: isLastLine,
        forcedBreak: line.forcedBreak,
      });
    }

    curY += linesConsumed.length * lineH;

    // משה 2026-05-10: לולאת מילוי-פערים — אחרי הלולאה הראשית, אם יש פער
    // ויזואלי (אפילו קטן) לפני ה-strip הבא, מוסיפים שורה אחת ברוחב ה-strip
    // הנוכחי. השורה עלולה להיכנס מעט לאזור ה-strip הבא (חפיפה של פיקסלים
    // בודדים) — זה עדיף על פער ריק נראה לעין.
    if (tokenIdx < tokens.length && curY < nextStripY && stripIdx < strips.length - 1) {
      const fillLine = buildOneLine(tokens, tokenIdx, strip.width, metrics);
      if (fillLine.tokensConsumed > 0) {
        if (fillLine.words.length === 0 && fillLine.forcedBreak) {
          tokenIdx += fillLine.tokensConsumed;
        } else {
          const isLastFillLine = (tokenIdx + fillLine.tokensConsumed >= tokens.length);
          allLines.push({
            y: curY,
            width: strip.width,
            words: fillLine.words,
            text: fillLine.words.join(' '),
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

  // overflowText — שחזור הטקסט שנשאר עם \n בנקודות הנכונות
  const remainingTokens = tokens.slice(tokenIdx);
  let overflowText = '';
  for (const t of remainingTokens) {
    if (t === '\n') overflowText += '\n';
    else overflowText += (overflowText && !overflowText.endsWith('\n') ? ' ' : '') + t;
  }

  return {
    lines: allLines,
    overflowText: overflowText.trim(),
    consumedWords: tokenIdx,
    totalWords: tokens.length,
    endY: curY,
  };
}

function buildOneLine(tokens, startIdx, widthPx, metrics) {
  const spaceW = metrics.spaceWidth;
  let curWidth = 0;
  const lineWords = [];
  let forcedBreak = false;
  let tokensConsumed = 0;

  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '\n') {
      // שבירת שורה מאולצת — נצרך גם אם לא הוסיף תוכן, ועוצרים השורה.
      tokensConsumed++;
      forcedBreak = true;
      // משה 2026-05-10: שורה לפני שבירה נחשבת "אחרונה לוגית" — לא תיושר.
      break;
    }
    const wordW = metrics.measureWord(tok);
    const addW = lineWords.length === 0 ? wordW : curWidth + spaceW + wordW;

    if (addW <= widthPx || lineWords.length === 0) {
      lineWords.push(tok);
      curWidth = addW;
      tokensConsumed++;
    } else {
      break;
    }
  }
  return { words: lineWords, wordCount: lineWords.length, tokensConsumed, width: curWidth, forcedBreak };
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
    titles: {},
  }, config || {});

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

  const sideLineH = sideMetrics.lineHeight;
  const titleHeight = Math.ceil(cfg.sideFontSize * 1.8);

  const result = {
    pageBox: {
      width: cfg.pageWidth,
      height: cfg.pageHeight,
      padding: cfg.padding,
      innerWidth: innerWidth,
      innerHeight: cfg.pageHeight - 2 * cfg.padding,
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

  const scenario = chooseCrownScenario(
    { right: rText, left: lText },
    { metrics: sideMetrics, halfWidth, fullWidth: innerWidth, crownLines: cfg.crownLines }
  );
  result.crownScenario = scenario;

  // משה 2026-05-10: צורה 1 — זרם אחד מפוצל לשני טורים מקבילים.
  // לוקחים את הזרם היחיד שזוהה כארוך וחותכים את הטקסט בערך באמצע (לפי מילים).
  // החצי הראשון לטור הימני, החצי השני לשמאלי. שניהם עם אותו id (אותו שם זרם,
  // אותו צבע). מתקבל דפוס וילנא הקלאסי של פירוש אחד בשני טורים.
  if (scenario.name === 'one_long_split') {
    const single = pageContent.rightStream || pageContent.leftStream;
    if (single) {
      const allText = single.items.join(' ').trim();
      const words = allText.split(/\s+/).filter(Boolean);
      const midIdx = Math.ceil(words.length / 2);
      pageContent.rightStream = { id: single.id, items: [words.slice(0, midIdx).join(' ')] };
      pageContent.leftStream  = { id: single.id, items: [words.slice(midIdx).join(' ')] };
    }
  }

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

  const sideTopY = cfg.padding + titleHeight;
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

  // 4. זרמים צדיים
  // משה 2026-05-08: עכשיו מקבלת mainBottomY ו-otherSideEnded כפרמטרים,
  // כדי שאחרי בר־מצרא של הראשי נוכל לחשב את הצדדים מחדש עם:
  //   - mainBottomY עדכני (אם הראשי התקצר, strip 3 של הצד מתחיל גבוה יותר)
  //   - otherSideEnded — מצב 4: אם הצד השני נגמר ב-strips 1+2, הצד השורד
  //     מקבל רוחב מלא ב-strip 3 (במקום halfWidth).
  // משה 2026-05-08 (תיקון): כל y_start/y_end חסומים ב-pageBottom. אם
  // naiveMainBottomY ענק (כי הראשי הנאיבי דחוס), strip 2 חסום ב-pageBottom
  // ו-strip 3 לא נוצר (אין מקום).
  const pageBottomY = cfg.pageHeight - cfg.padding;
  function buildSideStream(streamData, side, opts) {
    if (!streamData) return null;
    const text = streamData.items.join(' ');
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

    const flowResult = flowStreamThroughStrips(
      text,
      strips.map(s => ({ y_start: s.y_start, width: s.width })),
      sideMetrics,
      cfg.pageHeight - cfg.padding
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
        fontSize: cfg.sideFontSize,
        lineHeightPx: sideLineH,
      });
    }

    return {
      id: streamData.id,
      role: side,
      side: side,
      strips: strips,
      lines: lines,
      endY: flowResult.endY,
      overflowText: flowResult.overflowText,
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
      pageBottom: cfg.pageHeight - cfg.padding,
    });

    const mainFlow = flowStreamThroughStrips(
      pageContent.mainText,
      mainStrips,
      mainMetrics,
      cfg.pageHeight - cfg.padding
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
      });
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
    };

    if (mainFlow.overflowText) {
      result.overflow.mainText = mainFlow.overflowText;
    }

    // חסימה ב-pageBottom: אם flow לא הצליח לדחוס הכול, mainBottomY עלול לחרוג.
    mainBottomY = Math.min(mainFlow.endY, cfg.pageHeight - cfg.padding);
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
      const prev = result.overflow.streams[pass2Right.id] || '';
      result.overflow.streams[pass2Right.id] = prev ? (prev + ' ' + pass2Right.overflowText) : pass2Right.overflowText;
    }
  }
  if (pass2Left) {
    if (fullCrownSide === 'left') pass2Left.fullWidthTitle = true;
    if (fullCrownSide && fullCrownSide !== 'left') pass2Left.skipTopTitle = true;
    if (scenario.name === 'one_long_split') pass2Left.isScenario1Split = true;
    result.streamBoxes.push(pass2Left);
    if (pass2Left.overflowText) {
      const prev = result.overflow.streams[pass2Left.id] || '';
      result.overflow.streams[pass2Left.id] = prev ? (prev + ' ' + pass2Left.overflowText) : pass2Left.overflowText;
    }
  }

  // 5. footers — חתוך לפי גבולות הדף.
  // משה 2026-05-08: כמו במנוע משנה ברורה: footer שלא נכנס מודחק לעמוד הבא.
  // כאן (אנליטי): חותכים שורות שעוברות את pageBottom, שומרים את הטקסט המודחק
  // ב-overflow.streams (כדי ש-buildPages יוכל לדחוף לעמוד הבא דרך carry-over
  // עתידי או דרך הפחתת פסקאות באיטרציה הבאה).
  const pageBottom = cfg.pageHeight - cfg.padding;
  let footerY = Math.max(
    ...result.streamBoxes.map(b => b.endY || 0),
    mainBottomY
  ) + 8;
  let anyFooterTrimmed = false;

  if (pageContent.footerStreams && pageContent.footerStreams.length) {
    for (const fs of pageContent.footerStreams) {
      const text = fs.items.join(' ');
      if (!text) continue;

      // אם אין מקום אפילו לכותרת + שורה אחת, כל ה-footer הזה ל-overflow.
      if (footerY + titleHeight + sideLineH > pageBottom) {
        result.overflow.streams[fs.id] = text;
        anyFooterTrimmed = true;
        continue;
      }

      const allLines = sideMetrics.layoutLines(text, innerWidth);
      const titleY = footerY;
      footerY += titleHeight;

      // כמה שורות נכנסות אחרי הכותרת?
      const remainingY = pageBottom - footerY;
      const maxLinesFit = Math.max(1, Math.floor(remainingY / sideLineH));
      const linesToRender = allLines.slice(0, maxLinesFit);
      const overflowLines = allLines.slice(maxLinesFit);

      if (overflowLines.length > 0) {
        const overflowWords = overflowLines.flatMap(l => l.words);
        result.overflow.streams[fs.id] = overflowWords.join(' ');
        anyFooterTrimmed = true;
      }

      const linesData = [];
      for (let i = 0; i < linesToRender.length; i++) {
        linesData.push({
          x: 0,
          y: footerY + i * sideLineH,
          width: innerWidth,
          words: linesToRender[i].words,
          text: linesToRender[i].words.join(' '),
          isLast: i === linesToRender.length - 1,
          naturalWidth: linesToRender[i].width,
          fontSize: cfg.sideFontSize,
          lineHeightPx: sideLineH,
        });
      }

      result.footerBoxes.push({
        id: fs.id,
        lines: linesData,
        titleY: titleY,
        titleHeight: titleHeight,
      });
      footerY += linesToRender.length * sideLineH + 8;
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
      overflow: hidden;
    }
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
      font-weight: bold;
      text-align: center;
      border-bottom: 1px solid #888;
      direction: rtl;
    }
  `;
  document.head.appendChild(style);
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
      const shouldJustify = !line.isLast && !line.forcedBreak && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);
      // משה 2026-05-10: שורה אחרונה ברוחב מלא ממורכזת (לפי כללי ספרי קודש).
      const isFullWidthOrphan = line.isLast && line.width >= innerW - 5;
      const isParagraphEnd = (line.isLast || line.forcedBreak)
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;
      if (isFullWidthOrphan || isParagraphEnd) lineEl.className += ' center';
      else if (shouldJustify) lineEl.className += ' justify';
      lineEl.style.left = (padding + line.x) + 'px';
      lineEl.style.top = line.y + 'px';
      lineEl.style.width = line.width + 'px';
      lineEl.style.height = (fontSize * lineHeight) + 'px';
      lineEl.style.fontSize = fontSize + 'px';
      lineEl.style.lineHeight = (fontSize * lineHeight) + 'px';
      if (fontFamily) lineEl.style.fontFamily = fontFamily;
      lineEl.textContent = line.text;
      pageEl.appendChild(lineEl);
    }
  }

  function drawTitle(text, x, y, width, colorClass) {
    const t = document.createElement('div');
    t.className = 'v9-stream-title' + (colorClass || '');
    t.style.left = (padding + x) + 'px';
    t.style.top = y + 'px';
    t.style.width = width + 'px';
    t.style.height = plan.titleHeight + 'px';
    t.style.fontSize = (cfg.sideFontSize || 11) + 'px';
    t.style.lineHeight = plan.titleHeight + 'px';
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
      const sideHalfW = plan.pageBox.sideHalfWidth ||
        Math.floor(plan.pageBox.innerWidth / 2);
      const titleRightX = plan.pageBox.sideRightX ||
        (plan.pageBox.innerWidth - sideHalfW);
      const titleX = box.side === 'right' ? titleRightX : 0;
      // משה 2026-05-10: צורה 4 —
      //   fullWidthTitle: צד הארוך מקבל כותרת ברוחב מלא של הדף
      //   skipTopTitle: צד הקצר מקבל כותרת מתחת לכתר, מעל התוכן שלו,
      //                 ברוחב + מיקום של עמודת הזרם האמיתית מתחתיה
      if (box.fullWidthTitle) {
        drawTitle(title, 0, padding, plan.pageBox.innerWidth, colorClass);
      } else if (box.skipTopTitle) {
        const firstLine = box.lines[0];
        drawTitle(title, firstLine.x, firstLine.y - plan.titleHeight, firstLine.width, colorClass);
      } else {
        drawTitle(title, titleX, padding, sideHalfW, colorClass);
      }
    }
  }

  // footers — כל footer בצבע הזרם שלו
  for (const fb of plan.footerBoxes) {
    const colorClass = streamColorClass(fb.id);
    drawBox(fb, cfg.sideFontSize || 11, cfg.lineHeightRatio || 1.55, cfg.sideFontFamily, colorClass);
    const title = (cfg.titles || {})[fb.id];
    if (title) {
      drawTitle(title, 0, fb.titleY, plan.pageBox.innerWidth, colorClass);
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
    gapFillMinRatio: 0.82,
    gapFillMaxMainLines: null,
    carryOnlyMinRatio: 0.78,
    titles: {},
    streamSettings: {},
    levels: [],
    maxPages: 100,
  }, config || {});

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

    const fillsPageEnough = (tp, minRatio = 0.82) => {
      const pageBottom = cfg.pageHeight - cfg.padding;
      if (!pageBottom) return false;
      return planBottomY(tp) / pageBottom >= minRatio;
    };

    const planFillRatio = (tp) => {
      const pageBottom = Math.max(1, cfg.pageHeight - cfg.padding);
      return planBottomY(tp) / pageBottom;
    };
    const rescueMinFillRatio = Math.max(cfg.gapFillMinRatio || 0, 0.82);

    const planHasCommentaryStart = (tp) => {
      const streamCount = (tp && tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
      const footerCount = (tp && tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
      return streamCount + footerCount > 0;
    };

    const dynamicGapFillMaxMainLines = () => {
      const explicit = parseInt(cfg.gapFillMaxMainLines, 10);
      if (Number.isFinite(explicit) && explicit > 0) return explicit;
      const lineH = cfg.mainFontSize * cfg.lineHeightRatio;
      const availableLines = Math.max(1, Math.floor((cfg.pageHeight - 2 * cfg.padding) / lineH));
      return Math.max(4, Math.min(9, Math.round(availableLines * 0.22)));
    };

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
    const splitTargets = [
      ...(bestN_clean < totalAvail ? [bestN_clean] : []),
    ];
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
        const splitPlanScore = (tp, movedNotes) => {
          if (!tp || !tp.overflow || tp.overflow.mainText) return -Infinity;
          const lineCount = (tp.mainBox && Array.isArray(tp.mainBox.lines)) ? tp.mainBox.lines.length : 0;
          const streamCount = (tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
          const footerCount = (tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
          const commentaryCount = streamCount + footerCount;
          const ovs = tp.overflow.streams || {};
          const hasNoteOverflow = Object.keys(ovs).some(k => ovs[k]);
          if (hasNoteOverflow) {
            if (!Array.isArray(movedNotes) || movedNotes.length === 0) return -Infinity;
            if (commentaryCount === 0) return -Infinity;
          } else if (!fitsClean(tp)) {
            return -Infinity;
          }
          if (bestN_clean > 0 && !hasNoteOverflow && commentaryCount === 0 && fillsPageEnough(bestCleanPlan, 0.72)) return -Infinity;
          const fill = planFillRatio(tp);
          if (bestN_clean > 0 && fill <= cleanFill + 0.03) return -Infinity;
          const belowTargetPenalty = hasNoteOverflow && fill < cfg.gapFillMinRatio
            ? (cfg.gapFillMinRatio - fill) * 0.25
            : 0;
          const overflowPenalty = hasNoteOverflow ? 0.02 : 0;
          const extraMainPenalty = hasNoteOverflow
            ? Math.max(0, lineCount - dynamicGapFillMaxMainLines()) * 0.01
            : 0;
          return fill - overflowPenalty - belowTargetPenalty - extraMainPenalty;
        };
        const lineEnds = mainLineEndCandidates(fullText, splitMetrics, splitMainWidth)
          .filter(n => n >= MIN_SPLIT && n < fullText.length);
        let bestLineSplit = null;
        let bestLineScore = -Infinity;
        for (const len of lineEnds) {
          const movedNotes = notesBeforeAnchor(len);
          const score = splitPlanScore(tryPrefix(len), movedNotes);
          if (!Number.isFinite(score) || score < bestLineScore) continue;
          const firstHalf = { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes };
          const secondHalf = { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) };
          bestLineSplit = { firstHalf, secondHalf, sliceIdx, baseN };
          bestLineScore = score;
        }
        if (bestLineSplit) splitInfo = bestLineSplit;
        if (!splitInfo) {
          const candidates = wordEndCandidates(fullText)
            .filter(n => n >= MIN_SPLIT && n < fullText.length)
            .sort((a, b) => a - b);
          let bestWordSplit = null;
          let bestWordScore = -Infinity;
          for (const len of candidates) {
            const movedNotes = notesBeforeAnchor(len);
            const score = splitPlanScore(tryPrefix(len), movedNotes);
            if (!Number.isFinite(score) || score < bestWordScore) continue;
            const firstHalf = { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes };
            const secondHalf = { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) };
            bestWordSplit = { firstHalf, secondHalf, sliceIdx, baseN };
            bestWordScore = score;
          }
          if (bestWordSplit) splitInfo = bestWordSplit;
        }
        if (!splitInfo && bestN_clean === 0 && sliceIdx === 0) {
          const fallbackLen = lineEnds[0] || wordEndCandidates(fullText).find(n => n >= MIN_SPLIT && n < fullText.length);
          if (fallbackLen) {
            const movedNotes = notesBeforeAnchor(fallbackLen);
            const firstHalf = { ...target, mainText: fullText.substring(0, fallbackLen).trimEnd(), notes: movedNotes };
            const secondHalf = { ...target, mainText: fullText.substring(fallbackLen).trimStart(), notes: notesFromAnchor(fallbackLen, movedNotes) };
            splitInfo = { firstHalf, secondHalf, sliceIdx, baseN };
          }
        }
      }
    }

    // Gap rescue: only after the clean/anchored policy has a weak page, try a
    // line-first split that carries real notes and materially improves fill.
    {
      const currentSlice = splitInfo
        ? [...getSlice(splitInfo.baseN), splitInfo.firstHalf]
        : getSlice(bestN_clean);
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      if (currentFill < rescueMinFillRatio && totalAvail > 0) {
        let rescueBest = null;
        let rescueBestScore = currentFill;
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
          const rescueEnds = [...new Set([
            ...mainLineEndCandidates(fullText, splitMetrics, splitMainWidth),
            ...wordEndCandidates(fullText),
          ])]
            .filter(n => n >= 2 && n < fullText.length)
            .sort((a, b) => a - b);
          for (const len of rescueEnds) {
            const movedNotes = notesBeforeAnchor(len);
            if (!movedNotes.length) continue;
            const firstHalf = { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes };
            const slice = [...baseSlice, firstHalf];
            const tp = buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
            if (!tp || !tp.overflow || tp.overflow.mainText) continue;
            const commentaryCount = (tp.streamBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0)
              + (tp.footerBoxes || []).reduce((sum, box) => sum + ((box && box.lines && box.lines.length) || 0), 0);
            if (commentaryCount === 0) continue;
            const fill = planFillRatio(tp);
            if (fill < currentFill - 0.04) continue;
            const noteOverflow = Object.keys(tp.overflow.streams || {}).some(k => tp.overflow.streams[k]);
            const mainProgressBonus = Math.min(0.12, (len / Math.max(1, fullText.length)) * 0.12);
            const score = fill + mainProgressBonus - (noteOverflow ? 0.01 : 0);
            if (score < rescueBestScore) continue;
            rescueBestScore = score;
            rescueBest = {
              firstHalf,
              secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },
              sliceIdx,
              baseN,
            };
          }
        }
        if (rescueBest) splitInfo = rescueBest;
      }
    }

    if (splitInfo) {
      const currentSlice = [...getSlice(splitInfo.baseN), splitInfo.firstHalf];
      const currentPlan = buildPagePlan(aggregateForV9(currentSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
      const currentFill = planFillRatio(currentPlan);
      const secondText = (splitInfo.secondHalf?.mainText || '').trim();
      if (currentFill < rescueMinFillRatio && secondText.length > 0) {
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
        const visualLineEnds = mainLineEndCandidates(secondText, splitMetrics, splitMainWidth)
          .filter(n => n >= 2 && n <= secondText.length)
          .sort((a, b) => a - b);
        const firstVisualEnd = visualLineEnds[0];
        const secondVisualEnd = visualLineEnds[1];
        const extendEnds = [...new Set([
          firstVisualEnd,
          secondVisualEnd && secondVisualEnd <= Math.max(firstVisualEnd || 0, 1) * 2 ? secondVisualEnd : null,
          secondText.length <= 90 ? secondText.length : null,
        ])]
          .filter(n => n && n >= 2 && n <= secondText.length)
          .sort((a, b) => a - b);
        let bestExtended = null;
        let bestExtendedScore = currentFill;
        for (const len of extendEnds) {
          const movedNotes = notesBeforeAnchor(len);
          const prefix = secondText.substring(0, len).trim();
          const rest = secondText.substring(len).trim();
          if (!prefix) continue;
          const firstHalf = {
            ...splitInfo.firstHalf,
            mainText: `${(splitInfo.firstHalf.mainText || '').trim()} ${prefix}`.trim(),
            notes: [...(splitInfo.firstHalf.notes || []), ...movedNotes],
          };
          const secondHalf = {
            ...splitInfo.secondHalf,
            mainText: rest,
            notes: notesFromAnchor(len, movedNotes),
          };
          const slice = [...getSlice(splitInfo.baseN), firstHalf];
          const tp = buildPagePlan(aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver), cfg);
          if (!tp || !tp.overflow || tp.overflow.mainText) continue;
          const fill = planFillRatio(tp);
          if (fill < currentFill - 0.04) continue;
          const score = fill + Math.min(0.12, (len / Math.max(1, secondText.length)) * 0.12);
          if (score < bestExtendedScore) continue;
          bestExtendedScore = score;
          bestExtended = { firstHalf, secondHalf };
        }
        if (bestExtended) {
          splitInfo = { ...splitInfo, ...bestExtended };
        }
      }
    }

    let overflowTakeN = 0;
    if (bestN_clean < totalAvail) {
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
      if (
        tp && tp.overflow &&
        !tp.overflow.mainText &&
        hasNoteOverflow &&
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
    if (!splitInfo && pendingParagraph && hasCarryOver(carryOver)) {
      // בדוק אם carry לבד (slice ריק) חורג
      const carryAloneTrial = buildPagePlan(
        aggregateForV9([], cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver),
        cfg
      );
      // אם carry לבד חורג, או שהוא מספיק מלא, ננקז אותו לבד.
      // אם הוא קצר, עדיף לצרף אליו מעט מהראשי הבא כדי לא ליצור עמוד חצי ריק.
      if (carryAloneTrial.overflow.exceedsPage) {
        drainAloneMode = true;
      } else {
        drainAloneMode = fillsPageEnough(carryAloneTrial, cfg.carryOnlyMinRatio);
      }
    }

    // 3. קביעת bestN סופי
    let bestN;
    if (splitInfo) {
      bestN = splitInfo.baseN + 1;
    } else if (overflowTakeN > 0) {
      bestN = overflowTakeN;
    } else if (bestN_clean > 0) {
      bestN = bestN_clean;
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
        const overflowText = ((tp.overflow && tp.overflow.streams && tp.overflow.streams[fs.id]) || '').trim();
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

    // רינדור סופי לעמוד
    // אם drainAloneMode — slice ריק (רק carry-over)
    const finalSlice = drainAloneMode
      ? []
      : (splitInfo ? [...getSlice(splitInfo.baseN), splitInfo.firstHalf] : getSlice(bestN));
    const finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver);

    const pageEl = document.createElement('div');
    pageEl.className = 'page v9-page';
    pageEl.setAttribute('dir', 'rtl');
    pageEl.dataset.pageIndex = String(pageIdx);
    pageEl.dataset.realized = '1';
    container.appendChild(pageEl);

    const plan = buildSinglePage(pageEl, finalContent, cfg);
    pages.push(pageEl);

    // עדכון carryOver — טקסטים שנחתכו בעמוד הזה יעברו לעמוד הבא
    const nextCarry = {};
    if (plan && plan.overflow && plan.overflow.streams) {
      for (const [sid, text] of Object.entries(plan.overflow.streams)) {
        if (text && typeof text === 'string') nextCarry[sid] = text;
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
  }

  return { pages };
}

function hasCarryOver(co) {
  if (!co) return false;
  for (const k in co) if (co[k]) return true;
  return false;
}

function totalCarrySize(co) {
  if (!co) return 0;
  let total = 0;
  for (const k in co) total += (co[k] ? co[k].length : 0);
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
  const mainText = stripStreamMarkers(
    paragraphs.map(p => (p.mainText || '').trim()).filter(Boolean).join('\n')
  );

  const streamMap = new Map();

  // קודם — carryOver מהעמוד הקודם
  if (carryOver) {
    for (const sid in carryOver) {
      const text = carryOver[sid];
      if (!text) continue;
      if (!streamMap.has(sid)) streamMap.set(sid, []);
      streamMap.get(sid).push(text);
    }
  }

  // אחר כך — ההערות מהפסקאות החדשות
  for (const para of paragraphs) {
    for (const note of (para.notes || [])) {
      const sid = note.stream || note.streamId || note.streamCode;
      if (!sid) continue;
      if (!streamMap.has(sid)) streamMap.set(sid, []);
      streamMap.get(sid).push(note.text || '');
    }
  }

  const allStreams = Array.from(streamMap.entries()).map(([id, items]) => ({ id, items }));

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
    return { mainText, rightStream, leftStream, footerStreams, titles };
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

  return { mainText, rightStream, leftStream, footerStreams, titles };
}
