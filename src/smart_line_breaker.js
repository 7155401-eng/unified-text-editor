// smart_line_breaker.js — מחלק שורות חכם למניעת מתיחה קיצונית וחפיפה.
//
// משה 2026-05-15: text-align: justify של הדפדפן מותח את הרווחים שווה־בשווה
// בלי שיקול. כשהעמודה צרה ויש מילה אחת ארוכה — הרווחים האחרים נמתחים
// יתר על המידה, ובמקרים מסוימים מילה ארוכה גולשת מחוץ לעמודה.
//
// המודול הזה רץ אחרי הרינדור על כל פסקת טקסט מיושר:
//   1. עוטף כל מילה ב-<span class="ln-word"> כדי שנוכל למדוד.
//   2. מזהה איפה הדפדפן שבר את השורות בפועל.
//   3. לכל שורה — מחשב יחס מתיחה אמיתי (רווח ממוצע / רווח טבעי).
//   4. אם היחס חורג מסף — בונה את השורה מחדש כתיבת flex עם בקרה מדויקת.
//   5. מילה יתומה שרחבה יותר מהעמודה — מקבלת overflow-wrap לפיצול בטוח.
//
// שלא כמו opening_word_stretch.js — שמותח גליפים של מילת פתיח — כאן
// אנחנו לא משנים את הגליפים, רק בוחרים נקודות חיתוך טובות יותר ומבטלים
// מתיחה רק בשורות שבהן היא הופכת קיצונית.

const STRETCH_RATIO_LIMIT = 3.0;          // מעל זה — לבטל מתיחה על השורה
const STRETCH_RATIO_REBALANCE = 2.0;      // מעל זה — לנסות לשבור מחדש
const REBALANCE_MAX_ITERATIONS = 3;
const ORPHAN_OVERFLOW_TOLERANCE = 1.005;

function isHebrewParagraphCandidate(el) {
  if (!el || el.dataset.lnSkip === "1") return false;
  if (el.tagName === "P" || el.tagName === "DIV") {
    const align = getComputedStyle(el).textAlign;
    if (align === "justify" || el.style.textAlign === "justify") return true;
  }
  return false;
}

function measureNaturalSpaceWidth(refEl) {
  // מודדים רוחב רווח אמיתי בפונט של המיכל באמצעות שני בדיקות:
  //   רוחב "x x" פחות רוחב "xx" = רוחב הרווח.
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;pointer-events:none;top:0;inset-inline-start:-9999px;";
  refEl.appendChild(probe);
  probe.textContent = "x x";
  const w1 = probe.getBoundingClientRect().width;
  probe.textContent = "xx";
  const w2 = probe.getBoundingClientRect().width;
  probe.remove();
  return Math.max(1, w1 - w2);
}

function wrapWordsInSpans(root) {
  if (root.dataset.lnWrapped === "1") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      let p = node.parentNode;
      while (p && p !== root) {
        if (!p.classList) { p = p.parentNode; continue; }
        if (p.classList.contains("ln-word")) return NodeFilter.FILTER_REJECT;
        if (p.classList.contains("opening-word-svg")) return NodeFilter.FILTER_REJECT;
        if (p.tagName === "SVG") return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  for (let n; (n = walker.nextNode()); ) textNodes.push(n);

  for (const tn of textNodes) {
    const text = tn.nodeValue;
    const parts = text.split(/(\s+)/);
    if (parts.length <= 1 && !parts[0].trim()) continue;
    const frag = document.createDocumentFragment();
    for (const piece of parts) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        frag.appendChild(document.createTextNode(piece));
      } else {
        const span = document.createElement("span");
        span.className = "ln-word";
        span.textContent = piece;
        frag.appendChild(span);
      }
    }
    tn.parentNode.replaceChild(frag, tn);
  }
  root.dataset.lnWrapped = "1";
}

function detectLines(root) {
  const words = Array.from(root.querySelectorAll(".ln-word"));
  if (!words.length) return [];
  const lines = [];
  let current = null;
  for (const w of words) {
    const r = w.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (!current || Math.abs(r.top - current.top) > 1.5) {
      current = {
        top: r.top,
        bottom: r.bottom,
        leftMost: r.left,
        rightMost: r.right,
        words: [w],
        widths: [r.width],
      };
      lines.push(current);
    } else {
      current.words.push(w);
      current.widths.push(r.width);
      current.leftMost = Math.min(current.leftMost, r.left);
      current.rightMost = Math.max(current.rightMost, r.right);
      current.bottom = Math.max(current.bottom, r.bottom);
    }
  }
  return lines;
}

function lineStretchRatio(line, naturalSpace) {
  const numSpaces = line.words.length - 1;
  if (numSpaces <= 0) return 0;
  const totalWordW = line.widths.reduce((s, w) => s + w, 0);
  const lineW = line.rightMost - line.leftMost;
  const avgSpace = (lineW - totalWordW) / numSpaces;
  return naturalSpace > 0 ? avgSpace / naturalSpace : 0;
}

function handleOrphanOverflow(root, containerW) {
  const overflowing = [];
  for (const w of root.querySelectorAll(".ln-word")) {
    const wr = w.getBoundingClientRect();
    if (wr.width > containerW * ORPHAN_OVERFLOW_TOLERANCE) {
      w.classList.add("ln-orphan-overflow");
      overflowing.push(w);
    }
  }
  return overflowing;
}

function rebuildLineAsFlex(line, mode, naturalSpace) {
  // מאחדים את המילים של השורה לתוך div flex עם שליטה על המתיחה.
  // mode:
  //   "balanced" — justify-content: space-between (מתיחה רגילה, אבל בלי overflow)
  //   "no-stretch" — flex-end (ימינה, בלי מתיחה)
  const firstWord = line.words[0];
  if (!firstWord || !firstWord.parentNode) return;
  const parent = firstWord.parentNode;
  const block = document.createElement("span");
  block.className = "ln-line ln-line-" + mode;
  block.style.cssText =
    "display:flex;width:100%;flex-direction:row-reverse;align-items:baseline;" +
    (mode === "balanced"
      ? `justify-content:space-between;gap:${Math.max(1, naturalSpace)}px;`
      : `justify-content:flex-end;gap:${Math.max(1, naturalSpace)}px;`);

  // נכניס לפני המילה הראשונה
  parent.insertBefore(block, firstWord);
  for (const w of line.words) {
    // מנקים text nodes רווח שמסביב למילה (לא צריך אותם בתוך flex)
    const prev = w.previousSibling;
    if (prev && prev.nodeType === Node.TEXT_NODE && /^\s+$/.test(prev.nodeValue || "")) {
      prev.remove();
    }
    block.appendChild(w);
  }
  // ננקה רווח טקסט אחרי המילה האחרונה אם נשאר
  const after = block.nextSibling;
  if (after && after.nodeType === Node.TEXT_NODE && /^\s+$/.test(after.nodeValue || "")) {
    after.remove();
  }
}

function balanceParagraph(p) {
  if (!isHebrewParagraphCandidate(p)) return;
  if (p.dataset.lnBalanced === "1") return;
  const containerRect = p.getBoundingClientRect();
  if (containerRect.width < 20) return;
  wrapWordsInSpans(p);
  const naturalSpace = measureNaturalSpaceWidth(p);

  for (let iter = 0; iter < REBALANCE_MAX_ITERATIONS; iter++) {
    const lines = detectLines(p);
    if (lines.length === 0) break;
    handleOrphanOverflow(p, containerRect.width);
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const isLast = i === lines.length - 1;
      const line = lines[i];
      // לא נוגעים בשורה האחרונה — היא מטופלת ע"י text-align-last
      if (isLast) continue;
      // אם השורה כבר עטופה — דלג
      if (line.words[0]?.parentNode?.classList?.contains("ln-line")) continue;
      const ratio = lineStretchRatio(line, naturalSpace);
      if (ratio > STRETCH_RATIO_LIMIT) {
        rebuildLineAsFlex(line, "no-stretch", naturalSpace);
        touched = true;
      } else if (ratio > STRETCH_RATIO_REBALANCE) {
        rebuildLineAsFlex(line, "balanced", naturalSpace);
        touched = true;
      }
    }
    if (!touched) break;
  }
  p.dataset.lnBalanced = "1";
}

// משה 2026-05-15: שורת V9 = יחידה אבסולוטית אחת. כשמופעלת text-align: justify
// + text-align-last: justify, ושורה צרה עם מעט מילים — הרווחים מתפוצצים
// והמילים נראות מרוסקות אחת על השנייה.
//
// גישה דו־שלבית:
//   - יחס מתיחה בינוני (>STRETCH_RATIO_REBALANCE, ברירת מחדל 2.0):
//     עוטפים את תוכן השורה ב-flex עם justify-content: space-between ומגבילים
//     את ה-max-width של ה-flex לרוחב טבעי + מקס' רווח מותר × מספר רווחים.
//     התוצאה: השורה נראית מיושרת משני הצדדים אבל הרווחים לא מתפוצצים.
//   - יחס קיצוני (>STRETCH_RATIO_LIMIT, ברירת מחדל 3.0):
//     אותו טיפול אבל עם מקס' רווח קטן יותר; אם זה עדיין לא מספיק (יחס > LIM_HARD)
//     מסירים את class "justify" לחלוטין ועוברים ליישור ימינה.

const STRETCH_RATIO_HARD_LIMIT = 6.0; // מעל זה — אין דרך לשמור על נראות מיושרת

function measureNaturalLineTextWidth(line) {
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:nowrap;top:0;inset-inline-start:-10000px;pointer-events:none;";
  const cs = getComputedStyle(line);
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.fontStyle = cs.fontStyle;
  probe.style.letterSpacing = cs.letterSpacing;
  probe.textContent = (line.textContent || "").replace(/\s+/g, " ").trim();
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

function rebuildV9LineAsFlex(line, words, capWidthPx, naturalSpace) {
  // עוטפים את כל תוכן השורה ב-span flex עם רוחב מקסימלי קצוב.
  // space-between פנימית מחלקת את הרווחים שווה — אבל בתוך width מוגבל,
  // לכן הרווחים לא יכולים להתפוצץ.
  const wrap = document.createElement("span");
  wrap.className = "ln-line-cap";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "row-reverse";
  wrap.style.justifyContent = "space-between";
  wrap.style.alignItems = "baseline";
  wrap.style.maxWidth = "100%";
  wrap.style.width = capWidthPx + "px";
  wrap.style.marginInlineStart = "auto";
  // העברת התוכן הקיים כפי שהוא, ואז פיצול ל-span לכל מילה.
  // (V9 לפעמים מכניס run-spans פנימה — נשמרים).
  // הדרך הפשוטה: לוקחים textContent ומפצלים. זה מוחק עיצוב run-level
  // אבל V9 כרגע לא מתמכלל ב-runs בתוך שורה. אם בעתיד יתחיל — נשנה גישה.
  for (const w of words) {
    const span = document.createElement("span");
    span.textContent = w;
    wrap.appendChild(span);
  }
  line.textContent = "";
  line.appendChild(wrap);
}

function balanceV9Line(line) {
  if (line.dataset.lnV9Fixed === "1") return false;
  if (!line.classList.contains("justify")) return false;
  const rect = line.getBoundingClientRect();
  if (rect.width < 20) return false;
  const text = (line.textContent || "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const natTextW = measureNaturalLineTextWidth(line);
  if (natTextW <= 0) return false;
  const naturalSpace = measureNaturalSpaceWidth(line);
  const numSpaces = words.length - 1;
  const wordsOnlyW = natTextW - naturalSpace * numSpaces;
  const requiredSpace = (rect.width - wordsOnlyW) / numSpaces;
  const ratio = naturalSpace > 0 ? requiredSpace / naturalSpace : 0;

  if (ratio > STRETCH_RATIO_HARD_LIMIT) {
    // קיצוני מאוד — אין דרך להחזיק יישור משני הצדדים, מיישרים ימינה.
    line.classList.remove("justify");
    line.style.textAlign = "right";
    line.style.textAlignLast = "right";
    line.dataset.lnV9Fixed = "1";
    line.dataset.lnV9Ratio = ratio.toFixed(2);
    line.dataset.lnV9Mode = "hard";
    return true;
  }
  if (ratio > STRETCH_RATIO_REBALANCE) {
    // בינוני־חזק — שומרים על מראה מיושר משני הצדדים, מקפיצים את הרווח.
    // מקס' רווח מותר: STRETCH_RATIO_LIMIT × רווח טבעי.
    const maxAllowedSpace = naturalSpace * STRETCH_RATIO_LIMIT;
    const capW = Math.min(rect.width, wordsOnlyW + numSpaces * maxAllowedSpace);
    rebuildV9LineAsFlex(line, words, capW, naturalSpace);
    line.dataset.lnV9Fixed = "1";
    line.dataset.lnV9Ratio = ratio.toFixed(2);
    line.dataset.lnV9Mode = "soft";
    return true;
  }
  return false;
}

function balanceContainer(root) {
  if (!root) return;
  // כל פסקת ראשי (מנוע קלאסי)
  const paragraphs = root.querySelectorAll(".page-main p, .page-main h1, .page-main h2, .page-main h3, .page-main h4, .page-main h5, .page-main h6");
  for (const p of paragraphs) balanceParagraph(p);
  // הערות בזרמים — לפעמים מיושרות
  const noteEls = root.querySelectorAll(".stream .note, .stream .note-inline, .stream .note-part");
  for (const note of noteEls) balanceParagraph(note);
  // שורות V9 — כל יחידה היא שורה אחת, מטפלים בנפרד
  const v9Lines = root.querySelectorAll(".v9-line.justify");
  for (const line of v9Lines) balanceV9Line(line);
}

export function applyLineBalanceToPage(pageEl) {
  if (!pageEl || pageEl.classList?.contains("page-placeholder")) return;
  balanceContainer(pageEl);
}

export function applyLineBalanceToPages(container) {
  if (!container) return;
  container.querySelectorAll(".page:not(.page-placeholder)").forEach((page) => {
    applyLineBalanceToPage(page);
  });
}

// משה: בדיקה ידנית מ-DevTools
if (typeof window !== "undefined") {
  window.__lnBalance = applyLineBalanceToPages;
  window.__lnBalancePage = applyLineBalanceToPage;
}
