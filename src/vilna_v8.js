// vilna_v8.js — מנוע פריסת דף וילנא, V8 (ES module)
//
// ארכיטקטורה: זרם ארוך הוא host, זרם קצר הוא guest float, ראשי absolute במרכז.
// גלישה אמיתית של ה-host סביב ה-guest והראשי, בלי חיתוך ידני.
//
// הפונקציה הראשית היא buildPage(container, content, cfg). הקובץ הזה מיועד גם
// לשימוש עצמאי וגם לקריאה מ-vilna_v8_apply.js שמיישם את ה-CSS על עמודים שכבר
// פוצלו ע"י domPack.

export function parseRawText(text) {
  const lines = text.split("\n");
  const main = [];
  const streams = {};
  let buf = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buf.length) { main.push(buf.join(" ")); buf = []; }
      continue;
    }
    let mainLine = "";
    let i = 0;
    while (i < trimmed.length) {
      const m = trimmed.substring(i).match(/^\{@(\d+)\s+/);
      if (m) {
        const sid = m[1];
        let depth = 1, j = i + m[0].length;
        while (j < trimmed.length && depth > 0) {
          if (trimmed[j] === "{") depth++;
          else if (trimmed[j] === "}") depth--;
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
  if (buf.length) main.push(buf.join(" "));
  return { main, streams };
}

export function measureHeight(text, widthPx, fontSizePx, lineHeightRatio) {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;" +
    "direction:rtl;text-align:justify;word-wrap:break-word;";
  probe.style.fontSize = fontSizePx + "px";
  probe.style.lineHeight = lineHeightRatio;
  probe.style.width = widthPx + "px";
  probe.textContent = text;
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return h;
}

function ensureGlobalStyles() {
  if (document.getElementById("vilna-v8-styles")) return;
  const style = document.createElement("style");
  style.id = "vilna-v8-styles";
  style.textContent = `
    .vilna-v8-page * { box-sizing: border-box; margin: 0; padding: 0; }
    .vilna-v8-page {
      background: #faf6e8;
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

function createMainElement(text, leftPx, topPx, widthPx, fontSizePx, lineHeightRatio) {
  const el = document.createElement("div");
  el.className = "vilna-v8-main";
  el.style.left = leftPx + "px";
  el.style.top = topPx + "px";
  el.style.width = widthPx + "px";
  el.style.fontSize = fontSizePx + "px";
  el.style.lineHeight = lineHeightRatio;
  el.textContent = text;
  return el;
}

function createGuestElement(stream, side, halfWidth, mainHalfWidth, mainHeight,
                              titles, fontSizePx, lineHeightRatio) {
  const el = document.createElement("div");
  el.className = "vilna-v8-guest vilna-v8-guest-" + side;
  el.style.cssText =
    "float:" + side + ";" +
    "width:" + halfWidth + "px;" +
    "padding-" + (side === "right" ? "left" : "right") + ":6px;" +
    "font-size:" + fontSizePx + "px;" +
    "line-height:" + lineHeightRatio + ";";

  if (titles[stream.id]) {
    const t = document.createElement("div");
    t.className = "vilna-v8-stream-title";
    t.style.fontSize = fontSizePx + "px";
    t.textContent = titles[stream.id];
    el.appendChild(t);
  }

  const sp = document.createElement("div");
  sp.className = "vilna-v8-guest-main-spacer";
  sp.style.cssText =
    "float:" + (side === "right" ? "left" : "right") + ";" +
    "width:" + mainHalfWidth + "px;" +
    "height:" + mainHeight + "px;";
  el.appendChild(sp);

  const txt = document.createElement("div");
  txt.textContent = stream.items.join(" ");
  el.appendChild(txt);

  return el;
}

function createHostElement(stream, hostSide, halfWidth, mainHalfWidth, mainHeight,
                            titles, fontSizePx, lineHeightRatio) {
  const container = document.createElement("div");
  container.className = "vilna-v8-host-container";
  container.style.cssText =
    "font-size:" + fontSizePx + "px;" +
    "line-height:" + lineHeightRatio + ";";

  const guestSide = hostSide === "right" ? "left" : "right";
  // ה-spacer של ה-host חייב להיות בצד הפנימי של ה-host (= לכיוון המרכז שבו הראשי).
  // אם guest בצד right, host בצד left — ה-spacer צריך לצוף ימינה (לכיוון המרכז).
  // אם guest בצד left, host בצד right — ה-spacer צריך לצוף שמאלה.
  // לכן הכיוון = guestSide בדיוק.
  const hostMainSpacer = document.createElement("div");
  hostMainSpacer.className = "vilna-v8-host-main-spacer";
  hostMainSpacer.style.cssText =
    "float:" + guestSide + ";" +
    "width:" + mainHalfWidth + "px;" +
    "height:" + mainHeight + "px;";
  container.appendChild(hostMainSpacer);

  if (titles[stream.id]) {
    const t = document.createElement("div");
    t.className = "vilna-v8-stream-title";
    t.style.cssText =
      "font-size:" + fontSizePx + "px;" +
      "width:" + halfWidth + "px;" +
      "float:" + hostSide + ";";
    t.textContent = titles[stream.id];
    container.appendChild(t);
  }

  const txt = document.createElement("div");
  txt.textContent = stream.items.join(" ");
  container.appendChild(txt);

  return { container, hostMainSpacer };
}

function createFooterElement(stream, titles, fontSizePx, lineHeightRatio) {
  const el = document.createElement("div");
  el.className = "vilna-v8-footer";
  el.style.cssText =
    "font-size:" + fontSizePx + "px;" +
    "line-height:" + lineHeightRatio + ";";
  if (titles[stream.id]) {
    const t = document.createElement("div");
    t.className = "vilna-v8-stream-title";
    t.style.fontSize = fontSizePx + "px";
    t.textContent = titles[stream.id];
    el.appendChild(t);
  }
  const txt = document.createElement("div");
  txt.textContent = stream.items.join(" ");
  el.appendChild(txt);
  return el;
}

// container — האלמנט להזריק לתוכו את הדף.
// אם cfg.useExisting=true — לא יוצר .vilna-v8-page חדש; משתמש ב-container עצמו.
export async function buildPage(container, pageContent, userCfg) {
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
    useExisting: false,
  }, userCfg || {});

  const titles = pageContent.titles || {};
  const pageInnerWidth = cfg.pageWidth - 2 * cfg.padding;
  const halfWidth = pageInnerWidth / 2;
  const mainWidth = Math.floor(pageInnerWidth * cfg.mainWidthRatio);
  const mainHalfWidth = Math.ceil(mainWidth / 2);

  let pageEl;
  if (cfg.useExisting) {
    pageEl = container;
    pageEl.classList.add("vilna-v8-page");
    pageEl.style.padding = cfg.padding + "px";
    pageEl.style.position = "relative";
  } else {
    pageEl = document.createElement("div");
    pageEl.className = "vilna-v8-page";
    pageEl.style.cssText =
      "width:" + cfg.pageWidth + "px;" +
      "min-height:" + cfg.pageHeight + "px;" +
      "padding:" + cfg.padding + "px;" +
      "margin:12px auto;" +
      "border:2px solid #333;";
    container.appendChild(pageEl);
  }

  let hostStream = null;
  let guestStream = null;
  let hostSide = null;
  let guestSide = null;

  if (pageContent.rightStream && pageContent.leftStream) {
    const rText = pageContent.rightStream.items.join(" ");
    const lText = pageContent.leftStream.items.join(" ");
    const rH = measureHeight(rText, halfWidth, cfg.sideFontSize, cfg.lineHeightRatio);
    const lH = measureHeight(lText, halfWidth, cfg.sideFontSize, cfg.lineHeightRatio);

    if (rH >= lH) {
      hostStream = pageContent.rightStream;
      hostSide = "right";
      guestStream = pageContent.leftStream;
      guestSide = "left";
    } else {
      hostStream = pageContent.leftStream;
      hostSide = "left";
      guestStream = pageContent.rightStream;
      guestSide = "right";
    }
  } else if (pageContent.rightStream) {
    hostStream = pageContent.rightStream;
    hostSide = "right";
  } else if (pageContent.leftStream) {
    hostStream = pageContent.leftStream;
    hostSide = "left";
  }

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

  let guestEl = null;
  let guestSpacer = null;
  if (guestStream && mainBox) {
    guestEl = createGuestElement(
      guestStream, guestSide, halfWidth,
      mainHalfWidth, mainBox.height,
      titles, cfg.sideFontSize, cfg.lineHeightRatio
    );
    pageEl.appendChild(guestEl);
    guestSpacer = guestEl.querySelector(".vilna-v8-guest-main-spacer");
  }

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

    mainEl.style.top = targetTop + "px";

    if (guestSpacer) {
      const r = guestSpacer.getBoundingClientRect();
      const currentTop = r.top - pageRect.top;
      if (currentTop < targetTop) {
        guestSpacer.style.marginTop = (targetTop - currentTop) + "px";
      }
    }
    if (hostSpacer) {
      const r = hostSpacer.getBoundingClientRect();
      const currentTop = r.top - pageRect.top;
      if (currentTop < targetTop) {
        hostSpacer.style.marginTop = (targetTop - currentTop) + "px";
      }
    }

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

  if (pageContent.footerStreams && pageContent.footerStreams.length) {
    for (const fs of pageContent.footerStreams) {
      pageEl.appendChild(createFooterElement(
        fs, titles, cfg.sideFontSize, cfg.lineHeightRatio
      ));
    }
  }

  return { pageEl, mainBox,
           hostId: hostStream ? hostStream.id : null,
           guestId: guestStream ? guestStream.id : null };
}

// =====================================================================
// buildPages — מקבל מערך פסקאות מובנות (mainText + notes) ו-מפגן לבד
// לעמודי V8. כל עמוד מקבל כמה פסקאות שנכנסות בלי לחרוג מ-pageHeight.
// =====================================================================
//
// paragraphs: [{ mainText: string, notes: [{stream, text}] }, ...]
// titles: { '02': 'משנה ברורה', ... }
// streamSettings: { '02': { mishnaSide: 'right'|'left' }, ... }
//
// קונפיגורציה דומה ל-buildPage. תוספות:
//   maxPages: 100 (ביטחון נגד לולאות)
//   maxParasPerPage: ניסיון מקסימום פסקאות בעמוד אחד (לפני שמוותרים)
//
// אסטרטגיה: לכל עמוד מנסים לסיפח פסקה־אחר־פסקה. אחרי כל הוספה מודדים
// אם scrollHeight > pageHeight. אם כן — חוזרים אחורה לפסקה האחרונה
// שנכנסה ומסיימים את העמוד. אם אפילו פסקה אחת לא נכנסת, מקבלים אותה
// בכל זאת ועוברים לעמוד הבא (overflow visual שהמשתמש יראה).

export async function buildPages(container, paragraphs, userCfg) {
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
    titles: {},
    streamSettings: {},
    maxPages: 100,
    maxParasPerPage: 50,
  }, userCfg || {});

  if (!container || !Array.isArray(paragraphs) || paragraphs.length === 0) {
    return [];
  }

  const created = [];
  let cursor = 0;
  let pageIdx = 0;

  while (cursor < paragraphs.length && pageIdx < cfg.maxPages) {
    // קודם מוצאים את N — כמה פסקאות יכולות להיכנס לעמוד הנוכחי
    let bestN = 1;
    let n = 1;
    while (n <= cfg.maxParasPerPage && cursor + n <= paragraphs.length) {
      const slice = paragraphs.slice(cursor, cursor + n);
      const aggContent = aggregateParagraphsForV8(slice, cfg.titles, cfg.streamSettings);

      const trial = makePageElement(cfg, true);
      container.appendChild(trial);
      await buildPage(trial, aggContent, { ...cfg, useExisting: true });

      const overflows = trial.scrollHeight > cfg.pageHeight + 1;
      trial.remove();

      if (overflows) {
        if (n === 1) bestN = 1; // אפילו פסקה אחת חורגת — נקבל אותה בכל זאת
        break;
      }
      bestN = n;
      n++;
    }

    // עכשיו רינדור סופי לעמוד הנוכחי
    const finalSlice = paragraphs.slice(cursor, cursor + bestN);
    const finalContent = aggregateParagraphsForV8(finalSlice, cfg.titles, cfg.streamSettings);
    const pageEl = makePageElement(cfg, false);
    pageEl.dataset.pageIndex = String(pageIdx);
    pageEl.dataset.realized = "1";
    container.appendChild(pageEl);
    await buildPage(pageEl, finalContent, { ...cfg, useExisting: true });

    created.push(pageEl);
    cursor += bestN;
    pageIdx++;
  }

  return created;
}

function makePageElement(cfg, hidden) {
  const el = document.createElement("div");
  el.className = "page vilna-v8-page";
  el.setAttribute("dir", "rtl");
  el.style.cssText =
    "width:" + cfg.pageWidth + "px;" +
    "height:" + cfg.pageHeight + "px;" +
    "overflow:hidden;" +
    "margin:12px auto;" +
    "border:2px solid #333;" +
    "padding:" + cfg.padding + "px;" +
    "background:#faf6e8;" +
    "position:relative;" +
    "box-sizing:border-box;" +
    (hidden ? "visibility:hidden;position:absolute;left:-9999px;top:0;" : "");
  return el;
}

function aggregateParagraphsForV8(paragraphs, titles, streamSettings) {
  // מאחד את הראשי בפסקאות עם רווח כפול בין פסקאות
  const mainText = paragraphs.map(p => (p.mainText || "").trim()).filter(Boolean).join("  ");

  // אגרגציה של הערות לפי zerm
  const streamMap = new Map();
  for (const para of paragraphs) {
    for (const note of (para.notes || [])) {
      const sid = note.stream || note.streamId || note.streamCode;
      if (!sid) continue;
      if (!streamMap.has(sid)) streamMap.set(sid, []);
      streamMap.get(sid).push(note.text || "");
    }
  }

  const allStreams = Array.from(streamMap.entries()).map(([id, items]) => ({ id, items }));

  // החלטת host/guest/footer לפי mishnaSide
  let rightStream = null;
  let leftStream = null;
  const footerStreams = [];

  for (const s of allStreams) {
    const side = (streamSettings[s.id] || {}).mishnaSide;
    if (side === "right" && !rightStream) rightStream = s;
    else if (side === "left" && !leftStream) leftStream = s;
    else footerStreams.push(s);
  }

  // Fallback: אם אף זרם לא הוגדר עם side, ניקח את 2 הראשונים
  if (!rightStream && !leftStream && allStreams.length >= 1) {
    rightStream = allStreams[0];
    if (allStreams.length >= 2) leftStream = allStreams[1];
    footerStreams.length = 0;
    for (let i = 2; i < allStreams.length; i++) footerStreams.push(allStreams[i]);
  } else if (!rightStream && footerStreams.length > 0) {
    rightStream = footerStreams.shift();
  } else if (!leftStream && footerStreams.length > 0) {
    leftStream = footerStreams.shift();
  }

  return { mainText, rightStream, leftStream, footerStreams, titles };
}
