// vilna_v8.js — מנוע פריסת דף וילנא, V8
//
// ארכיטקטורה: זרם ארוך הוא host, זרם קצר הוא guest float, ראשי absolute במרכז.
// גלישה אמיתית של ה-host סביב ה-guest והראשי, בלי חיתוך ידני.
//
// שימוש:
//   const result = await VilnaV8.buildPage(container, {
//     mainText: '...',                                      // טקסט הראשי
//     rightStream: { id: '02', items: [...] },              // זרם ימני
//     leftStream:  { id: '05', items: [...] },              // זרם שמאלי
//     footerStreams: [{ id: '01', items: [...] }, ...],     // זרמים תחתונים
//     titles: { '02': 'משנה ברורה', '05': 'כף החיים', ... }
//   }, {
//     pageWidth: 559,                  // ברירת מחדל A5 ב-96dpi
//     pageHeight: 794,
//     mainFontSize: 13,
//     sideFontSize: 11,
//     lineHeightRatio: 1.55,
//     padding: 12,
//     mainWidthRatio: 0.33,
//     crownLines: 4,
//   });

(function (root) {

  // =====================================================================
  // פרסר — מפצל טקסט גולמי לזרמים לפי markers {@NN ...}
  // =====================================================================
  function parseRawText(text) {
    const lines = text.split('\n');
    const main = [];
    const streams = {};
    let buf = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (buf.length) { main.push(buf.join(' ')); buf = []; }
        continue;
      }
      let mainLine = '';
      let i = 0;
      while (i < trimmed.length) {
        const m = trimmed.substring(i).match(/^\{@(\d+)\s+/);
        if (m) {
          const sid = m[1];
          let depth = 1, j = i + m[0].length;
          while (j < trimmed.length && depth > 0) {
            if (trimmed[j] === '{') depth++;
            else if (trimmed[j] === '}') depth--;
            if (depth > 0) j++;
          }
          if (!streams[sid]) streams[sid] = [];
          streams[sid].push(trimmed.substring(i + m[0].length, j));
          i = j + 1;
        } else {
          mainLine += trimmed[i];
          i++;
        }
      }
      if (mainLine.trim()) buf.push(mainLine.trim());
    }
    if (buf.length) main.push(buf.join(' '));
    return { main, streams };
  }

  // =====================================================================
  // מודד גובה טקסט ברוחב נתון
  // =====================================================================
  function measureHeight(text, widthPx, fontSizePx, lineHeightRatio) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;' +
      'direction:rtl;text-align:justify;word-wrap:break-word;';
    probe.style.fontSize = fontSizePx + 'px';
    probe.style.lineHeight = lineHeightRatio;
    probe.style.width = widthPx + 'px';
    probe.textContent = text;
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    document.body.removeChild(probe);
    return h;
  }

  // =====================================================================
  // זריקת CSS גלובלי לאחת בלבד בעמוד
  // =====================================================================
  function ensureGlobalStyles() {
    if (document.getElementById('vilna-v8-styles')) return;
    const style = document.createElement('style');
    style.id = 'vilna-v8-styles';
    style.textContent = `
      .vilna-v8-page * { box-sizing: border-box; margin: 0; padding: 0; }
      .vilna-v8-page {
        background: #faf6e8;
        margin: 12px auto;
        border: 2px solid #333;
        direction: rtl;
        position: relative;
        box-sizing: border-box;
      }
      .vilna-v8-host-container {
        direction: rtl;
        text-align: justify;
      }
      .vilna-v8-host-container::after { content: ''; display: block; clear: both; }
      .vilna-v8-guest {
        direction: rtl;
        text-align: justify;
      }
      .vilna-v8-main {
        position: absolute;
        background: #fff8e0;
        border: 1px solid #888;
        padding: 6px 8px;
        text-align: justify;
        direction: rtl;
        box-sizing: border-box;
        z-index: 5;
      }
      .vilna-v8-stream-title {
        font-weight: bold;
        text-align: center;
        border-bottom: 1px solid #888;
        margin-bottom: 3px;
        padding: 2px;
      }
      .vilna-v8-footer {
        clear: both;
        border-top: 1px solid #888;
        margin-top: 6px;
        padding: 6px;
        text-align: justify;
        direction: rtl;
      }
    `;
    document.head.appendChild(style);
  }

  // =====================================================================
  // יצירת אלמנט הראשי
  // =====================================================================
  function createMainElement(text, leftPx, topPx, widthPx, fontSizePx, lineHeightRatio) {
    const el = document.createElement('div');
    el.className = 'vilna-v8-main';
    el.style.left = leftPx + 'px';
    el.style.top = topPx + 'px';
    el.style.width = widthPx + 'px';
    el.style.fontSize = fontSizePx + 'px';
    el.style.lineHeight = lineHeightRatio;
    el.textContent = text;
    return el;
  }

  // =====================================================================
  // יצירת אלמנט guest float
  // =====================================================================
  function createGuestElement(stream, side, halfWidth, mainHalfWidth, mainHeight,
                                titles, fontSizePx, lineHeightRatio) {
    const el = document.createElement('div');
    el.className = 'vilna-v8-guest vilna-v8-guest-' + side;
    el.style.cssText =
      'float:' + side + ';' +
      'width:' + halfWidth + 'px;' +
      'padding-' + (side === 'right' ? 'left' : 'right') + ':6px;' +
      'font-size:' + fontSizePx + 'px;' +
      'line-height:' + lineHeightRatio + ';';

    // כותרת
    if (titles[stream.id]) {
      const t = document.createElement('div');
      t.className = 'vilna-v8-stream-title';
      t.style.fontSize = fontSizePx + 'px';
      t.textContent = titles[stream.id];
      el.appendChild(t);
    }

    // spacer של הראשי בתוך ה-guest — float לכיוון פנימה
    const sp = document.createElement('div');
    sp.className = 'vilna-v8-guest-main-spacer';
    sp.style.cssText =
      'float:' + (side === 'right' ? 'left' : 'right') + ';' +
      'width:' + mainHalfWidth + 'px;' +
      'height:' + mainHeight + 'px;';
    el.appendChild(sp);

    // טקסט
    const txt = document.createElement('div');
    txt.textContent = stream.items.join(' ');
    el.appendChild(txt);

    return el;
  }

  // =====================================================================
  // יצירת אלמנט host (זה שזורם בכל הדף)
  // =====================================================================
  function createHostElement(stream, hostSide, halfWidth, mainHalfWidth, mainHeight,
                              titles, fontSizePx, lineHeightRatio) {
    const container = document.createElement('div');
    container.className = 'vilna-v8-host-container';
    container.style.cssText =
      'font-size:' + fontSizePx + 'px;' +
      'line-height:' + lineHeightRatio + ';';

    // spacer של הראשי בתוך ה-host — float לכיוון ההפוך מהguest
    // (אם guest ימין, הראשי באמצע, אז ה-spacer בתוך ה-host צף שמאלה)
    const guestSide = hostSide === 'right' ? 'left' : 'right';
    const hostMainSpacer = document.createElement('div');
    hostMainSpacer.className = 'vilna-v8-host-main-spacer';
    hostMainSpacer.style.cssText =
      'float:' + (guestSide === 'right' ? 'left' : 'right') + ';' +
      'width:' + mainHalfWidth + 'px;' +
      'height:' + mainHeight + 'px;';
    container.appendChild(hostMainSpacer);

    // כותרת host — בצד של host (לא ברוחב מלא)
    if (titles[stream.id]) {
      const t = document.createElement('div');
      t.className = 'vilna-v8-stream-title';
      t.style.cssText =
        'font-size:' + fontSizePx + 'px;' +
        'width:' + halfWidth + 'px;' +
        'float:' + hostSide + ';';
      t.textContent = titles[stream.id];
      container.appendChild(t);
    }

    // טקסט ה-host
    const txt = document.createElement('div');
    txt.textContent = stream.items.join(' ');
    container.appendChild(txt);

    return { container, hostMainSpacer };
  }

  // =====================================================================
  // יצירת footer-stream
  // =====================================================================
  function createFooterElement(stream, titles, fontSizePx, lineHeightRatio) {
    const el = document.createElement('div');
    el.className = 'vilna-v8-footer';
    el.style.cssText =
      'font-size:' + fontSizePx + 'px;' +
      'line-height:' + lineHeightRatio + ';';
    if (titles[stream.id]) {
      const t = document.createElement('div');
      t.className = 'vilna-v8-stream-title';
      t.style.fontSize = fontSizePx + 'px';
      t.textContent = titles[stream.id];
      el.appendChild(t);
    }
    const txt = document.createElement('div');
    txt.textContent = stream.items.join(' ');
    el.appendChild(txt);
    return el;
  }

  // =====================================================================
  // בניית עמוד שלם
  // =====================================================================
  // קלט:
  //   container — אלמנט DOM שאליו יוסף העמוד
  //   pageContent: { mainText, rightStream, leftStream, footerStreams, titles }
  //   userCfg: אופציונלי
  // מחזיר Promise שנפתר ל-{ pageEl, mainBox }

  async function buildPage(container, pageContent, userCfg) {
    ensureGlobalStyles();

    const cfg = Object.assign({
      pageWidth: 559,
      pageHeight: 794,
      mainFontSize: 13,
      sideFontSize: 11,
      lineHeightRatio: 1.55,
      padding: 12,
      mainWidthRatio: 0.33,
      crownLines: 4,
    }, userCfg || {});

    const titles = pageContent.titles || {};
    const pageInnerWidth = cfg.pageWidth - 2 * cfg.padding;
    const halfWidth = pageInnerWidth / 2;
    const mainWidth = Math.floor(pageInnerWidth * cfg.mainWidthRatio);
    const mainHalfWidth = Math.ceil(mainWidth / 2);

    // יצירת העמוד
    const pageEl = document.createElement('div');
    pageEl.className = 'vilna-v8-page';
    pageEl.style.cssText =
      'width:' + cfg.pageWidth + 'px;' +
      'min-height:' + cfg.pageHeight + 'px;' +
      'padding:' + cfg.padding + 'px;';
    container.appendChild(pageEl);

    // ===== שלב 1: מדידה ובחירת host/guest =====
    let hostStream = null;
    let guestStream = null;
    let hostSide = null;
    let guestSide = null;

    if (pageContent.rightStream && pageContent.leftStream) {
      // שני זרמים — בוחרים לפי אורך
      const rText = pageContent.rightStream.items.join(' ');
      const lText = pageContent.leftStream.items.join(' ');
      const rH = measureHeight(rText, halfWidth, cfg.sideFontSize, cfg.lineHeightRatio);
      const lH = measureHeight(lText, halfWidth, cfg.sideFontSize, cfg.lineHeightRatio);

      if (rH >= lH) {
        hostStream = pageContent.rightStream;
        hostSide = 'right';
        guestStream = pageContent.leftStream;
        guestSide = 'left';
      } else {
        hostStream = pageContent.leftStream;
        hostSide = 'left';
        guestStream = pageContent.rightStream;
        guestSide = 'right';
      }
    } else if (pageContent.rightStream) {
      hostStream = pageContent.rightStream;
      hostSide = 'right';
    } else if (pageContent.leftStream) {
      hostStream = pageContent.leftStream;
      hostSide = 'left';
    }

    // ===== שלב 2: יצירת הראשי =====
    let mainEl = null;
    let mainBox = null;

    if (pageContent.mainText) {
      const mainLeft = (cfg.pageWidth - mainWidth) / 2;
      mainEl = createMainElement(
        pageContent.mainText, mainLeft, cfg.padding, mainWidth,
        cfg.mainFontSize, cfg.lineHeightRatio
      );
      pageEl.appendChild(mainEl);

      await new Promise(r => requestAnimationFrame(r));
      const pageRect = pageEl.getBoundingClientRect();
      const mainRect = mainEl.getBoundingClientRect();
      mainBox = {
        top:    mainRect.top    - pageRect.top,
        left:   mainRect.left   - pageRect.left,
        right:  mainRect.right  - pageRect.left,
        bottom: mainRect.bottom - pageRect.top,
        height: mainRect.height,
      };
    }

    // ===== שלב 3: יצירת ה-guest float (אם יש) =====
    let guestEl = null;
    let guestSpacer = null;
    if (guestStream && mainBox) {
      guestEl = createGuestElement(
        guestStream, guestSide, halfWidth,
        mainHalfWidth, mainBox.height,
        titles, cfg.sideFontSize, cfg.lineHeightRatio
      );
      pageEl.appendChild(guestEl);
      guestSpacer = guestEl.querySelector('.vilna-v8-guest-main-spacer');
    }

    // ===== שלב 4: יצירת ה-host container =====
    let hostContainer = null;
    let hostSpacer = null;
    if (hostStream) {
      const mainHeight = mainBox ? mainBox.height : 0;
      const result = createHostElement(
        hostStream, hostSide, halfWidth,
        mainHalfWidth, mainHeight,
        titles, cfg.sideFontSize, cfg.lineHeightRatio
      );
      hostContainer = result.container;
      hostSpacer = result.hostMainSpacer;
      pageEl.appendChild(hostContainer);
    }

    // ===== שלב 5: התאמת מיקום הראשי וגובה ה-spacers =====
    if (mainEl && (guestSpacer || hostSpacer)) {
      await new Promise(r => requestAnimationFrame(r));

      const pageRect = pageEl.getBoundingClientRect();
      const tops = [];
      if (guestSpacer) {
        const r = guestSpacer.getBoundingClientRect();
        tops.push(r.top - pageRect.top);
      }
      if (hostSpacer) {
        const r = hostSpacer.getBoundingClientRect();
        tops.push(r.top - pageRect.top);
      }
      const targetTop = Math.max(...tops);

      // עדכון top של הראשי
      mainEl.style.top = targetTop + 'px';

      // עדכון margin-top של ה-spacers להיות זהים
      if (guestSpacer) {
        const r = guestSpacer.getBoundingClientRect();
        const currentTop = r.top - pageRect.top;
        if (currentTop < targetTop) {
          guestSpacer.style.marginTop = (targetTop - currentTop) + 'px';
        }
      }
      if (hostSpacer) {
        const r = hostSpacer.getBoundingClientRect();
        const currentTop = r.top - pageRect.top;
        if (currentTop < targetTop) {
          hostSpacer.style.marginTop = (targetTop - currentTop) + 'px';
        }
      }

      // עדכון מדידת הראשי
      await new Promise(r => requestAnimationFrame(r));
      const newMainRect = mainEl.getBoundingClientRect();
      mainBox = {
        top:    newMainRect.top    - pageRect.top,
        left:   newMainRect.left   - pageRect.left,
        right:  newMainRect.right  - pageRect.left,
        bottom: newMainRect.bottom - pageRect.top,
        height: newMainRect.height,
      };
    }

    // ===== שלב 6: footers =====
    if (pageContent.footerStreams && pageContent.footerStreams.length) {
      for (const fs of pageContent.footerStreams) {
        pageEl.appendChild(createFooterElement(
          fs, titles, cfg.sideFontSize, cfg.lineHeightRatio
        ));
      }
    }

    return { pageEl, mainBox, hostId: hostStream ? hostStream.id : null,
             guestId: guestStream ? guestStream.id : null };
  }

  // =====================================================================
  // ייצוא
  // =====================================================================
  root.VilnaV8 = {
    parseRawText: parseRawText,
    buildPage: buildPage,
    measureHeight: measureHeight,
  };

})(typeof window !== 'undefined' ? window : globalThis);
