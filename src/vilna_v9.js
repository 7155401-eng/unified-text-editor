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

  // 3. ראשי
  let mainHeight = 0;
  if (pageContent.mainText) {
    const lines = mainMetrics.layoutLines(pageContent.mainText, mainWidth);
    mainHeight = lines.length * mainMetrics.lineHeight;

    const mainLines = [];
    for (let i = 0; i < lines.length; i++) {
      mainLines.push({
        x: mainX,
        y: mainTopY + i * mainMetrics.lineHeight,
        width: mainWidth,
        words: lines[i].words,
        text: lines[i].words.join(' '),
        isLast: i === lines.length - 1,
        naturalWidth: lines[i].width,
        fontSize: cfg.mainFontSize,
        lineHeightPx: mainMetrics.lineHeight,
      });
    }

    result.mainBox = {
      id: 'main',
      role: 'main',
      x: mainX,
      y: mainTopY,
      width: mainWidth,
      height: mainHeight,
      lines: mainLines,
    };
  }

  const mainBottomY = mainTopY + mainHeight;

  // 4. זרמים צדיים
  function buildSideStream(streamData, side) {
    if (!streamData) return null;
    const text = streamData.items.join(' ');
    if (!text) return null;

    const strips = [];

    if (crownHeight > 0) {
      strips.push({
        y_start: sideTopY,
        y_end: mainTopY,
        width: halfWidth,
        x: side === 'right' ? halfWidth : 0,
      });
    }

    if (mainHeight > 0) {
      // משה 2026-05-08: מרווח mainGap בין הראשי לטור הצד.
      if (side === 'right') {
        strips.push({
          y_start: mainTopY,
          y_end: mainBottomY,
          width: Math.max(0, innerWidth - (mainX + mainWidth) - mainGap),
          x: mainX + mainWidth + mainGap,
        });
      } else {
        strips.push({
          y_start: mainTopY,
          y_end: mainBottomY,
          width: Math.max(0, mainX - mainGap),
          x: 0,
        });
      }
    }

    strips.push({
      y_start: mainBottomY,
      y_end: cfg.pageHeight - cfg.padding,
      width: halfWidth,
      x: side === 'right' ? halfWidth : 0,
    });

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

  if (pageContent.rightStream) {
    const box = buildSideStream(pageContent.rightStream, 'right');
    if (box) {
      result.streamBoxes.push(box);
      if (box.overflowText) result.overflow.streams[box.id] = box.overflowText;
    }
  }
  if (pageContent.leftStream) {
    const box = buildSideStream(pageContent.leftStream, 'left');
    if (box) {
      result.streamBoxes.push(box);
      if (box.overflowText) result.overflow.streams[box.id] = box.overflowText;
    }
  }

  // 5. footers
  let footerY = Math.max(
    ...result.streamBoxes.map(b => b.endY || 0),
    mainBottomY
  ) + 8;

  if (pageContent.footerStreams && pageContent.footerStreams.length) {
    for (const fs of pageContent.footerStreams) {
      const text = fs.items.join(' ');
      if (!text) continue;
      const lines = sideMetrics.layoutLines(text, innerWidth);
      const titleY = footerY;
      footerY += titleHeight;

      const linesData = [];
      for (let i = 0; i < lines.length; i++) {
        linesData.push({
          x: 0,
          y: footerY + i * sideLineH,
          width: innerWidth,
          words: lines[i].words,
          text: lines[i].words.join(' '),
          isLast: i === lines.length - 1,
          naturalWidth: lines[i].width,
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
      footerY += lines.length * sideLineH + 8;
    }
  }

  // האם יש overflow מהעמוד?
  result.overflow.exceedsPage = footerY > cfg.pageHeight;

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

  // לכל עמוד: התחלה עם 1 פסקה, ואם נכנס - לוקחים יותר עד שלא נכנס
  while (cursor < paragraphs.length && pageIdx < cfg.maxPages) {
    let bestN = 1;
    let n = 1;

    while (n <= 50 && cursor + n <= paragraphs.length) {
      const slice = paragraphs.slice(cursor, cursor + n);
      const aggContent = aggregateForV9(slice, cfg.titles, cfg.streamSettings, cfg.levels);

      // בדיקה: האם נכנס בעמוד?
      const trialPlan = buildPagePlan(aggContent, cfg);
      if (trialPlan.overflow.exceedsPage) {
        if (n === 1) bestN = 1;
        break;
      }
      bestN = n;
      n++;
    }

    // רינדור סופי לעמוד
    const finalSlice = paragraphs.slice(cursor, cursor + bestN);
    const finalContent = aggregateForV9(finalSlice, cfg.titles, cfg.streamSettings);

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
