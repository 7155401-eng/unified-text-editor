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

  const remainingWords = text.split(/\s+/).filter(Boolean);
  let wordIdx = 0;

  for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
    const strip = strips[stripIdx];
    const nextStripY = (stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY;

    if (curY < strip.y_start) curY = strip.y_start;

    const availableHeight = nextStripY - curY;
    const availableLines = Math.floor(availableHeight / lineH);
    if (availableLines <= 0) continue;

    let linesInStrip = 0;
    const linesConsumed = [];

    while (linesInStrip < availableLines && wordIdx < remainingWords.length) {
      const line = buildOneLine(remainingWords, wordIdx, strip.width, metrics);
      if (line.wordCount === 0) break;
      linesConsumed.push(line);
      wordIdx += line.wordCount;
      linesInStrip++;
    }

    for (let i = 0; i < linesConsumed.length; i++) {
      const line = linesConsumed[i];
      const isLastLine = (i === linesConsumed.length - 1) && (wordIdx >= remainingWords.length);
      allLines.push({
        y: curY + i * lineH,
        width: strip.width,
        words: line.words,
        text: line.words.join(' '),
        naturalWidth: line.width,
        isLast: isLastLine,
      });
    }

    curY += linesConsumed.length * lineH;
    if (wordIdx >= remainingWords.length) break;
  }

  return {
    lines: allLines,
    overflowText: remainingWords.slice(wordIdx).join(' '),
    consumedWords: wordIdx,
    totalWords: remainingWords.length,
    endY: curY,
  };
}

function buildOneLine(words, startIdx, widthPx, metrics) {
  const spaceW = metrics.spaceWidth;
  let curWidth = 0;
  const lineWords = [];

  for (let i = startIdx; i < words.length; i++) {
    const word = words[i];
    const wordW = metrics.measureWord(word);
    const addW = lineWords.length === 0 ? wordW : curWidth + spaceW + wordW;

    if (addW <= widthPx || lineWords.length === 0) {
      lineWords.push(word);
      curWidth = addW;
    } else {
      break;
    }
  }
  return { words: lineWords, wordCount: lineWords.length, width: curWidth };
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
  // משה 2026-05-08: מרווח ~1% בין שני זרמי צד שעומדים זה ליד זה (כתר, או strip 3
  // במצב 5 שבו שני הצדדים ממשיכים מתחת לראשי). במצב 4 (אחד שורד לרוחב מלא)
  // אין מרווח כי אין שני זרמים סמוכים.
  const sideGap = (cfg.sideGap !== null && cfg.sideGap !== undefined)
    ? cfg.sideGap
    : Math.max(2, Math.floor(innerWidth * 0.01));
  const halfMinusGap = Math.max(0, halfWidth - Math.ceil(sideGap / 2));

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

  // 2. מיקום ראשי
  let crownHeight = 0;
  if (scenario.name === 'two_long_parallel' ||
      scenario.name === 'one_full_one_short' ||
      scenario.name === 'one_long_split') {
    crownHeight = cfg.crownLines * sideLineH;
  }

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
    const otherSideEnded = !!o.otherSideEnded;

    const strips = [];

    if (crownHeight > 0 && mainTopY > sideTopY) {
      // משה 2026-05-08: מרווח sideGap בין שני הכתרים. הימני זז ימינה,
      // השמאלי מצטמצם מקצהו הפנימי.
      strips.push({
        y_start: sideTopY,
        y_end: Math.min(mainTopY, pageBottomY),
        width: halfMinusGap,
        x: side === 'right' ? halfWidth + sideGap - Math.ceil(sideGap / 2) : 0,
      });
    }

    if (naiveMainHeight > 0 && effectiveMainBottomY > mainTopY) {
      // משה 2026-05-08: מרווח mainGap בין הראשי לטור הצד.
      if (side === 'right') {
        strips.push({
          y_start: mainTopY,
          y_end: effectiveMainBottomY,
          width: Math.max(0, innerWidth - (mainX + mainWidth) - mainGap),
          x: mainX + mainWidth + mainGap,
        });
      } else {
        strips.push({
          y_start: mainTopY,
          y_end: effectiveMainBottomY,
          width: Math.max(0, mainX - mainGap),
          x: 0,
        });
      }
    }

    // Strip 3: רק אם יש מקום מתחת לראשי בתוך הדף.
    // אם הצד השני נגמר ב-strips 1+2 → רוחב מלא (אין מרווח, אין שני זרמים);
    // אחרת halfWidth − מרווח 1% בין השניים.
    if (effectiveMainBottomY < pageBottomY) {
      if (otherSideEnded) {
        strips.push({
          y_start: effectiveMainBottomY,
          y_end: pageBottomY,
          width: innerWidth,
          x: 0,
        });
      } else {
        strips.push({
          y_start: effectiveMainBottomY,
          y_end: pageBottomY,
          width: halfMinusGap,
          x: side === 'right' ? halfWidth + sideGap - Math.ceil(sideGap / 2) : 0,
        });
      }
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
  //   2. otherSideEnded — מצב 4 בדינמיקה: אם הצד השני נגמר ב-strips 1+2
  //      (לפני naiveMainBottomY), הצד השורד מקבל strip 3 ברוחב מלא של הדף.
  //
  // משה 2026-05-08: זה ה"ברך בכל מקום" — כשיש מקום פנוי, הצד השורד מתרחב אליו.
  const rightEndedEarly = pass1Right
    ? pass1Right.endY < naiveMainBottomY - 0.5
    : true; // אם אין צד ימני — הצד השמאלי מתייחס ל"שני נגמר" כל הזמן
  const leftEndedEarly = pass1Left
    ? pass1Left.endY < naiveMainBottomY - 0.5
    : true;

  if (pageContent.rightStream) {
    const box = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEnded: leftEndedEarly,
    });
    if (box) {
      result.streamBoxes.push(box);
      if (box.overflowText) result.overflow.streams[box.id] = box.overflowText;
    }
  }
  if (pageContent.leftStream) {
    const box = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEnded: rightEndedEarly,
    });
    if (box) {
      result.streamBoxes.push(box);
      if (box.overflowText) result.overflow.streams[box.id] = box.overflowText;
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

  function drawBox(box, fontSize, lineHeight, fontFamily) {
    for (const line of box.lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'v9-line';
      const shouldJustify = !line.isLast && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);
      if (shouldJustify) lineEl.className += ' justify';
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

  function drawTitle(text, x, y, width) {
    const t = document.createElement('div');
    t.className = 'v9-stream-title';
    t.style.left = (padding + x) + 'px';
    t.style.top = y + 'px';
    t.style.width = width + 'px';
    t.style.height = plan.titleHeight + 'px';
    t.style.fontSize = (cfg.sideFontSize || 11) + 'px';
    t.style.lineHeight = plan.titleHeight + 'px';
    t.textContent = text;
    pageEl.appendChild(t);
  }

  // ראשי
  if (plan.mainBox) {
    drawBox(plan.mainBox, cfg.mainFontSize || 13, cfg.lineHeightRatio || 1.55, cfg.mainFontFamily);
  }

  // זרמים צדיים + כותרות
  for (const box of plan.streamBoxes) {
    drawBox(box, cfg.sideFontSize || 11, cfg.lineHeightRatio || 1.55, cfg.sideFontFamily);

    const title = (cfg.titles || {})[box.id];
    if (title && box.lines.length > 0) {
      const halfW = Math.floor(plan.pageBox.innerWidth / 2);
      const titleX = box.side === 'right' ? halfW : 0;
      drawTitle(title, titleX, padding, halfW);
    }
  }

  // footers
  for (const fb of plan.footerBoxes) {
    drawBox(fb, cfg.sideFontSize || 11, cfg.lineHeightRatio || 1.55, cfg.sideFontFamily);
    const title = (cfg.titles || {})[fb.id];
    if (title) {
      drawTitle(title, 0, fb.titleY, plan.pageBox.innerWidth);
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
    titles: {},
    streamSettings: {},
    levels: [],
    maxPages: 100,
  }, config || {});

  const pages = [];
  let cursor = 0;
  let pageIdx = 0;

  // משה 2026-05-08: לכל עמוד מובטח לפחות פסקה אחת עם הערות (אם יש כזו עוד
  // בקלט). מונע עמוד עם רק שורות ראשי באמצע בלי שום מפרשים בצדדים.
  // אחרי minN, מנסים לסיפח עוד פסקאות עד שמגיעים ל-overflow.
  while (cursor < paragraphs.length && pageIdx < cfg.maxPages) {
    let bestN = 1;

    // 1. מצא minN — האינדקס של הפסקה הראשונה עם הערות מ-cursor והלאה
    let minN = 1;
    let foundWithNotes = false;
    for (let i = cursor; i < paragraphs.length && i < cursor + 50; i++) {
      const hasNotes = paragraphs[i].notes && paragraphs[i].notes.length > 0;
      if (hasNotes) {
        minN = i - cursor + 1;
        foundWithNotes = true;
        break;
      }
    }
    if (!foundWithNotes) {
      // כל הפסקאות שנותרו בלי הערות. ניקח אותן כולן בעמוד אחד (אם יחרגו
      // ה-overflow loop של הצינור החיצוני יזרוק אותן לעמוד הבא).
      minN = paragraphs.length - cursor;
    }

    // 2. בדיקה: כמה פסקאות נוספות מעבר ל-minN נכנסות?
    let n = minN;
    while (n <= 50 && cursor + n <= paragraphs.length) {
      const slice = paragraphs.slice(cursor, cursor + n);
      const aggContent = aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels);

      const trialPlan = buildPagePlan(aggContent, cfg);
      if (trialPlan.overflow.exceedsPage) {
        if (n === minN) bestN = minN; // לפחות minN, גם אם חורג קצת
        break;
      }
      bestN = n;
      n++;
    }
    if (bestN < minN) bestN = minN;

    // רינדור סופי לעמוד
    const finalSlice = paragraphs.slice(cursor, cursor + bestN);
    const finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings, cfg.levels);

    const pageEl = document.createElement('div');
    pageEl.className = 'page v9-page';
    pageEl.setAttribute('dir', 'rtl');
    pageEl.dataset.pageIndex = String(pageIdx);
    pageEl.dataset.realized = '1';
    container.appendChild(pageEl);

    const plan = buildSinglePage(pageEl, finalContent, cfg);
    pages.push(pageEl);

    cursor += bestN;
    pageIdx++;
  }

  return { pages };
}

// משה 2026-05-08: ניקוי markers שלא הוצאו (`@05`, `{@05 ...}`).
// אם הקלט מ-paneManagerToPackerContent השאיר marker בראשי (כי לא הייתה
// הערה תואמת בזרם), אנחנו לפחות לא מציגים אותו למשתמש.
function stripStreamMarkers(text) {
  if (!text) return '';
  return text
    .replace(/\{@\d+[^}]*\}/g, '')
    .replace(/@\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// אוסף פסקאות לתוכן עמוד יחיד (בדומה ל-V8)
function aggregateForV9(paragraphs, titles, streamSettings, levels) {
  const mainText = stripStreamMarkers(
    paragraphs.map(p => (p.mainText || '').trim()).filter(Boolean).join('  ')
  );

  const streamMap = new Map();
  for (const para of paragraphs) {
    for (const note of (para.notes || [])) {
      const sid = note.stream || note.streamId || note.streamCode;
      if (!sid) continue;
      if (!streamMap.has(sid)) streamMap.set(sid, []);
      streamMap.get(sid).push(note.text || '');
    }
  }

  const allStreams = Array.from(streamMap.entries()).map(([id, items]) => ({ id, items }));

  // משה 2026-05-08: כיבוד בחירת המשתמש — זרמים שב-levels = side, אחרים = footer.
  // מיועד למקרה שהמשתמש בחר במפורש איזה זרמים יהיו "סופיים" (footers).
  const sideCodes = new Set();
  if (Array.isArray(levels)) {
    for (const level of levels) {
      for (const code of level) sideCodes.add(code);
    }
  }

  let rightStream = null;
  let leftStream = null;
  const footerStreams = [];
  const sideCandidates = [];

  for (const s of allStreams) {
    const setting = streamSettings[s.id] || {};
    const explicitSide = setting.mishnaSide; // right/left/auto/outer/inner
    const isInLevel = sideCodes.has(s.id);

    if (!isInLevel && !explicitSide) {
      footerStreams.push(s);
    } else {
      sideCandidates.push({ s, side: explicitSide || 'auto' });
    }
  }

  // צד מפורש קודם
  for (const c of sideCandidates) {
    if (c.side === 'right' && !rightStream) rightStream = c.s;
    else if (c.side === 'left' && !leftStream) leftStream = c.s;
  }
  // אז auto/outer/inner למלא מה שנשאר
  for (const c of sideCandidates) {
    if (c.s === rightStream || c.s === leftStream) continue;
    if (!rightStream) rightStream = c.s;
    else if (!leftStream) leftStream = c.s;
    else footerStreams.push(c.s);
  }

  // Fallback אחרון: אם אין levels, אין settings, ויש רק footers — נמלא
  if (!rightStream && !leftStream && sideCandidates.length === 0 && footerStreams.length >= 1) {
    rightStream = footerStreams.shift();
    if (footerStreams.length >= 1) leftStream = footerStreams.shift();
  }

  return { mainText, rightStream, leftStream, footerStreams, titles };
}
