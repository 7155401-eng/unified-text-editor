// split_marker.js
//
// משה 2026-05-14: סימן חיתוך נסתר (U+2060 Word-Joiner) שמוטבע בכל קצה של
// טקסט שפוצל בידי dom_packer (splitNote / preSplitLongNote / split בתוך
// distributeNotesAcrossPages). הסימן לא נראה למשתמש אבל עובר דרך הצנרת,
// וכשהפריסה נשענת מחדש אפשר לזהות את שני החצאים ולשקול לאחד אותם.
//
// הקובץ הזה הוא ה"מקור" של הסימן וכל פעולה עליו. dom_packer ו-revaluator
// מייבאים מכאן את הקבוע כדי שלא יהיו מחרוזות פזורות בקוד.

export const SPLIT_MARK = "⁠"; // WORD JOINER (invisible, zero-width)

export function hasSplitMark(text) {
  if (typeof text !== "string" || !text) return false;
  return text.indexOf(SPLIT_MARK) !== -1;
}

export function endsWithSplitMark(text) {
  if (typeof text !== "string" || !text) return false;
  // הסימן עשוי להופיע ממש בקצה, או לפני רווח/סימן פיסוק שנוסף בעיבוד הרינדור.
  // נבדוק רק את התו האחרון כי dom_packer מצרף אותו ישירות אחרי trimEnd().
  const last = text.charCodeAt(text.length - 1);
  return last === 0x2060;
}

export function startsWithSplitMark(text) {
  if (typeof text !== "string" || !text) return false;
  return text.charCodeAt(0) === 0x2060;
}

export function stripSplitMarks(text) {
  if (typeof text !== "string" || !text) return text || "";
  if (text.indexOf(SPLIT_MARK) === -1) return text;
  // הסרה גלובלית — לפעמים יש שני סימנים (סוף חלק א' + תחילת חלק ב' מחוברים).
  return text.split(SPLIT_MARK).join("");
}

// מאחד שני חצאים של פיצול לאובייקט אחד. שומר על stream / anchor / num
// של החלק הראשון (הוא ה"מקור"), ועל ה-children שלו (החלק השני תמיד
// isContinuation=true עם children ריקים, אז אין מה לאבד שם).
export function mergeSplitHalves(part1, part2) {
  if (!part1 && !part2) return null;
  if (!part2) return { ...part1, text: stripSplitMarks(part1.text || "") };
  if (!part1) return { ...part2, text: stripSplitMarks(part2.text || "") };
  const text1 = stripSplitMarks(part1.text || "");
  const text2 = stripSplitMarks(part2.text || "");
  // אם החלק הראשון לא נגמר ברווח והחלק השני לא מתחיל ברווח/פיסוק,
  // נצרף רווח אחד כדי שלא נדבק מילים. dom_packer חותך על גבול מילה
  // אז זה המקרה הצפוי.
  let glue = "";
  if (text1 && text2) {
    const last = text1.slice(-1);
    const first = text2.slice(0, 1);
    const isWordEdge1 = /\S/.test(last);
    const isWordEdge2 = /\S/.test(first);
    if (isWordEdge1 && isWordEdge2) glue = " ";
  }
  const merged = {
    ...part1,
    text: text1 + glue + text2,
  };
  // אם החלק הראשון הוא בכלל isContinuation (כלומר זה כבר חלק 2 של פיצול
  // קודם), שומרים את הדגל כדי לא לאבד הקשר.
  if (part1.isContinuation || part2.isContinuation === false) {
    merged.isContinuation = !!part1.isContinuation;
  }
  // children — לוקחים מהראשון, ומחזירים את של השני רק אם זה לא היה
  // מקרה רגיל של continuation עם children ריקים.
  const c1 = Array.isArray(part1.children) ? part1.children : [];
  const c2 = Array.isArray(part2.children) ? part2.children : [];
  if (c2.length > 0) {
    merged.children = c1.concat(c2);
  } else {
    merged.children = c1;
  }
  // לאחר איחוד — אין יותר פיצול.
  delete merged.wasSplit;
  return merged;
}

// משה 2026-05-14: סורק את ה-DOM ומחזיר זוגות של אלמנטים שמכילים את סימן
// הפיצול בקצה. כולל הערות, שורות זרמים, טורי זרמים, V9, וטקסט ראשי.
// תוצאה: [{ first, second }] — שני אלמנטים סמוכים בסדר מסמך שעוברים לסירוגין:
// הראשון מסתיים ב-U+2060 והשני מתחיל ב-U+2060.
const SCAN_SELECTOR = [
  ".note",
  ".note-inline",
  ".note-part",
  ".note-child",
  ".v9-line",
  ".page-main p",
  ".page-main h1",
  ".page-main h2",
  ".page-main h3",
  ".page-main h4",
  ".page-main h5",
  ".page-main h6",
].join(",");

export function findSplitPairs(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) return [];
  const nodes = Array.from(rootEl.querySelectorAll(SCAN_SELECTOR));
  if (nodes.length < 2) return [];
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!endsWithSplitMark(a.textContent || "")) continue;
    // החיפוש לשני: ילך לפנים בסדר המסמך עד שמוצא אלמנט עם תוכן.
    // אם הוא מתחיל ב-U+2060 — זוג. אחרת — לא, ולא ממשיכים יותר.
    for (let j = i + 1; j < nodes.length; j++) {
      const t = nodes[j].textContent || "";
      if (!t.trim()) continue;
      if (startsWithSplitMark(t)) {
        pairs.push({ first: a, second: nodes[j] });
      }
      break;
    }
  }
  return pairs;
}

// מסיר את כל סימני הפיצול מ-text-nodes בעץ ה-DOM. שימושי לפני copy/export
// PDF, ש-byte-by-byte נקיים. החזרה: כמה text-nodes טופלו.
export function stripSplitMarksFromDom(rootEl) {
  if (!rootEl || typeof document === "undefined") return 0;
  let count = 0;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.indexOf(SPLIT_MARK) !== -1) {
      node.nodeValue = node.nodeValue.split(SPLIT_MARK).join("");
      count++;
    }
  }
  return count;
}
