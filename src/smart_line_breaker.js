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
//
// TODO (משה ביקש 2026-05-15): שילוב לוגיקת ה-cap בתוך layoutLines() של
// vilna_v9.js. כיום V9 שובר שורות בגישת first-fit פשטנית בלי שיקול stretch ratio,
// ואז smart_line_breaker מתקן בדיעבד. כשהשבירה הראשונית טובה — שורות לא יוצאות
// קצרות מדי, ופחות צריך לקצץ אחר כך. רפקטור עמוק יותר ל-vilna_v9.js נדרש.

// משה 2026-05-15: ערכי הסף הוקלפו אחרי בדיקה בייצור — 220 שורות עם יחס 2.0–2.5
// היו נכנסות ל-soft mode בלי צורך; משה ביקש "למתן ולמתוח עד אחוזים גבוהים יותר".
// REBALANCE 2.0 → 3.5: לא נוגעים בשורות עם מתיחה רגילה.
// LIMIT 3.0 → 5.0: בתוך soft mode, מאפשרים רווח עד פי 5 מטבעי לפני שמתחילים לקצץ.
// HARD_LIMIT 6.0 → 10.0: רק קיצוניות אמיתית מאבדת מראה מיושר.
const STRETCH_RATIO_LIMIT = 5.0;          // תקרת רווח ב-soft mode (פי X רווח טבעי)
const STRETCH_RATIO_REBALANCE = 3.5;      // מתחת לזה — לא מטפלים כלל
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

function balanceContainer(root) {
  if (!root) return;
  // משה 2026-05-15: smart_line_breaker מטפל רק במנוע הקלאסי. ב-V9, K-P עם
  // מדידה דינמית של פער Canvas/DOM (b-VilnaMetrics) עושה את העבודה בעצמו —
  // אין צורך ב-post-process כאן.
  const paragraphs = root.querySelectorAll(".page-main p, .page-main h1, .page-main h2, .page-main h3, .page-main h4, .page-main h5, .page-main h6");
  for (const p of paragraphs) balanceParagraph(p);
  const noteEls = root.querySelectorAll(".stream .note, .stream .note-inline, .stream .note-part");
  for (const note of noteEls) balanceParagraph(note);
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

// בדיקות ידניות מ-DevTools
if (typeof window !== "undefined") {
  window.__lnBalance = applyLineBalanceToPages;
  window.__lnBalancePage = applyLineBalanceToPage;
}
