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

// משה 2026-05-15: שורת V9 = יחידה אבסולוטית אחת. כשמופעלת text-align: justify
// + text-align-last: justify, ושורה צרה עם מעט מילים — הרווחים מתפוצצים
// והמילים נראות מרוסקות אחת על השנייה.
//
// משה 2026-05-15 (עדכון אחרי בדיקה בייצור): ה-flex wrap שניסיתי קודם עבד
// לא נכון ב-RTL — flex-direction: row-reverse על dir=rtl כפול הופך כיוון,
// וגם marginInlineStart: auto הציב את התוכן בצד הלא נכון. תוצאה: 523 שורות
// עם חפיפת מילים. עכשיו: גישה פשוטה יותר.
//
// הגישה החדשה:
//   - כשהיחס סביר (<= STRETCH_RATIO_HARD_LIMIT), משאירים את class "justify"
//     ומאפשרים לדפדפן ליישר משני הצדדים באופן רגיל. גם אם הרווחים גדולים,
//     הם מתפלגים שווה ב-RTL ולא יוצרים חפיפות.
//   - רק כשהיחס קיצוני (> STRETCH_RATIO_HARD_LIMIT) — מסירים justify,
//     מיישרים ימינה. בקיצוניות כזאת המראה ממילא נשבר ולא ניתן להציל יישור.
//
// המפתח לעבודה תקינה: V9 חייב למדוד מילים נכון (עם שולי בטיחות נגד runs
// מעוצבים) כדי ש-justify של הדפדפן לא יקבל קלט מוטעה.

const STRETCH_RATIO_HARD_LIMIT_DEFAULT = 10.0; // ברירת מחדל; משתמש יכול להגדיר אחר

// משה 2026-05-15: סף "ויתור על מתיחה" קונפיגורבילי. שורות עם יחס מתיחה מעל הסף
// מאבדות יישור משני הצדדים ועוברות ליישור ימינה. ערך נמוך = יותר מחמיר (יותר
// שורות יוותרו על יישור); ערך גבוה = יותר סובלני (יישור גם בקצוניות).
//   localStorage.setItem("ravtext.v9.stretchGiveUp", "8") — דוגמה לסף 8x
function getStretchGiveUpRatio() {
  if (typeof window === "undefined" || !window.localStorage) return STRETCH_RATIO_HARD_LIMIT_DEFAULT;
  try {
    const raw = window.localStorage.getItem("ravtext.v9.stretchGiveUp");
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 1.5 && n <= 50) return n;
  } catch (_) {
    /* keep default */
  }
  return STRETCH_RATIO_HARD_LIMIT_DEFAULT;
}

// משה 2026-05-15: משיכת מילים אחורה (ALWAYS, לא תלוי משתמש).
// V9 שובר שורות בגישת first-fit עם שולי בטיחות 7% — תוצאה: לעיתים נשאר מקום
// פנוי בסוף שורה למילה מהשורה הבאה, אבל V9 לא ניצל אותו (שמרני). פה אנחנו
// מודדים DOM בפועל (בלי שולי הבטיחות), ואם מילת הפתיח של השורה הבאה
// נכנסת בסוף השורה הנוכחית — מעבירים אותה לכאן. ממשיכים עד שאין יותר מקום.
function probeLineNaturalWidth(refLine, text) {
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:nowrap;top:0;inset-inline-start:-10000px;pointer-events:none;";
  const cs = getComputedStyle(refLine);
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.fontStyle = cs.fontStyle;
  probe.style.letterSpacing = cs.letterSpacing;
  probe.textContent = text;
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

// משה 2026-05-15: extractFirstWordWithFormat — מחלץ את המילה הראשונה משורת B
// כיחידת DOM שלמה, כולל מעטפת `<span>` עם עיצוב (bold/italic/צבע) אם קיים.
// מחזיר { fragment, word } או null. מסיר את המילה מ-B (כולל הרווח שאחריה).
//
// מקרים מטופלים:
//   1) המילה הראשונה ב-textNode ישיר של B: חותכים מ-textNode, מחזירים textNode חדש
//   2) המילה הראשונה בתוך <span> שמכיל רק את המילה הזאת: מעבירים את כל ה-span
//   3) המילה הראשונה היא חלק מ-<span> שמכיל יותר מילים: יוצרים <span> חדש
//      עם אותם class/style למילה החדשה, ומשאירים את שאר התוכן ב-span המקורי
function extractFirstWordWithFormat(lineB) {
  let node = lineB.firstChild;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || "";
      const m = text.match(/^(\s*)(\S+)(\s*)/);
      if (!m) {
        node = node.nextSibling;
        continue;
      }
      const word = m[2];
      const after = text.slice(m[0].length);
      // השאר את מה שאחרי המילה (כולל רווח אחרון אם נשאר); אם ריק - הסר.
      if (after) {
        node.nodeValue = after;
      } else {
        const toRemove = node;
        node = node.nextSibling;
        toRemove.parentNode.removeChild(toRemove);
      }
      return { word, node: document.createTextNode(word) };
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const elText = node.textContent || "";
      const trimmed = elText.replace(/^\s+/, "");
      if (!trimmed) {
        // span ריק / רק רווחים — דלג, אבל הסר את ה-span הריק כדי לא להישאר
        const skip = node;
        node = node.nextSibling;
        skip.parentNode.removeChild(skip);
        continue;
      }
      // האם זה span/element עם רק תווי טקסט פנימי (לא ילדים מורכבים)?
      // אם יש ילדים מסוגים שונים (טקסט + ילדים) — נטפל ברקורסיה.
      const hasComplexChildren = Array.from(node.childNodes).some(c =>
        c.nodeType === Node.ELEMENT_NODE
      );
      if (hasComplexChildren) {
        // לרדת לעומק
        const inner = extractFirstWordWithFormat(node);
        if (!inner) {
          node = node.nextSibling;
          continue;
        }
        // אם ה-span הפנימי התרוקן אחרי החילוץ, להסיר אותו
        if (!(node.textContent || "").trim()) {
          node.parentNode.removeChild(node);
        }
        // עוטפים את ה-inner בעותק של ה-span החיצוני (משמרים עיצוב חיצוני)
        const wrap = node.cloneNode(false);
        wrap.appendChild(inner.node);
        return { word: inner.word, node: wrap };
      }
      // ילדים פשוטים — טקסט בלבד.
      const wordEnd = trimmed.search(/\s/);
      if (wordEnd === -1) {
        // כל ה-span הוא מילה אחת — מעבירים את כולו
        const moved = node;
        node = node.nextSibling;
        moved.parentNode.removeChild(moved);
        return { word: trimmed, node: moved };
      }
      // span עם מספר מילים — מפצלים: יוצרים span חדש עם אותו עיצוב למילה אחת
      const firstWord = trimmed.slice(0, wordEnd);
      const remainder = trimmed.slice(wordEnd);
      const leadingSpace = elText.slice(0, elText.length - trimmed.length);
      node.textContent = leadingSpace + remainder;
      const newEl = node.cloneNode(false); // אותו tag + attributes, ללא ילדים
      newEl.textContent = firstWord;
      return { word: firstWord, node: newEl };
    }
    node = node.nextSibling;
  }
  return null;
}

function tryPullFirstWord(lineA, lineB) {
  // החזרה: true אם הצליח להעביר מילה, false אחרת
  const textA = (lineA.textContent || "").trim();
  const textB = (lineB.textContent || "").trim();
  if (!textA || !textB) return false;
  const m = textB.match(/^(\S+)/);
  if (!m) return false;
  const firstWord = m[1];
  if (!firstWord) return false;

  const lineAW = lineA.getBoundingClientRect().width;
  if (lineAW < 20) return false;

  const newAText = textA + " " + firstWord;
  const newAWidth = probeLineNaturalWidth(lineA, newAText);
  // טולרנס 1px לסאב-פיקסל
  if (newAWidth > lineAW - 1) return false;

  // חילוץ ה-DOM של המילה הראשונה משורת B, עם עיצוב משומר.
  const extracted = extractFirstWordWithFormat(lineB);
  if (!extracted) return false;

  // הוספה לסוף A: רווח (text node) + ה-node המחולץ (כולל מעטפת עיצוב אם יש)
  lineA.appendChild(document.createTextNode(" "));
  lineA.appendChild(extracted.node);

  // סימונים לאינספקציה
  lineA.dataset.lnV9Pulled = String(parseInt(lineA.dataset.lnV9Pulled || "0", 10) + 1);
  lineB.dataset.lnV9LostFirst = String(parseInt(lineB.dataset.lnV9LostFirst || "0", 10) + 1);
  return true;
}

function pullAdjacentV9Words(root) {
  const allLines = Array.from(root.querySelectorAll(".v9-line"));
  // קיבוץ לפי data-v9-box-id (פסקה/זרם), כי משיכה רק בין שורות באותו box
  const byBox = new Map();
  for (const line of allLines) {
    const boxId = line.dataset.v9BoxId || "__default__";
    if (!byBox.has(boxId)) byBox.set(boxId, []);
    byBox.get(boxId).push(line);
  }
  let total = 0;
  for (const group of byBox.values()) {
    if (group.length < 2) continue;
    // מיון לפי top — סדר טבעי בעמוד
    group.sort((a, b) => {
      const ta = parseFloat(a.style.top || "0");
      const tb = parseFloat(b.style.top || "0");
      return ta - tb;
    });
    for (let i = 0; i < group.length - 1; i++) {
      // לא מושכים אל שורה שכבר טופלה כ-hard (אבד יישור) — לא רוצים לדחוס בה
      // אם המשתמש בחר להוותר.
      const a = group[i];
      const b = group[i + 1];
      // מקס' 8 משיכות בין כל זוג שורות, להגנה
      for (let k = 0; k < 8; k++) {
        if (!tryPullFirstWord(a, b)) break;
        total++;
      }
    }
  }
  return total;
}

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

  // רק מקרה קיצוני (ratio > סף משתמש, ברירת מחדל 10) — אין סיכוי להציל מראה
  // מיושר משני הצדדים. כל יחס נמוך יותר נשאר ב-justify של הדפדפן.
  const giveUpRatio = getStretchGiveUpRatio();
  if (ratio > giveUpRatio) {
    line.classList.remove("justify");
    line.style.textAlign = "right";
    line.style.textAlignLast = "right";
    line.dataset.lnV9Fixed = "1";
    line.dataset.lnV9Ratio = ratio.toFixed(2);
    line.dataset.lnV9Mode = "hard";
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
  // משה 2026-05-15: שלב 1 ב-V9 — משיכת מילים אחורה כשיש מקום (תמיד).
  pullAdjacentV9Words(root);
  // שלב 2 ב-V9 — שורות שעדיין מעל סף המשתמש: ויתור על יישור.
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

// משה 2026-05-15: כיוון הסף "ויתור על יישור" עבר ל-UI בלוח גפ"ת
// (input id="v9-stretch-giveup-input"). אין יותר צורך בעוזר window.
if (typeof window !== "undefined") {
  window.__lnBalance = applyLineBalanceToPages;
  window.__lnBalancePage = applyLineBalanceToPage;
}
