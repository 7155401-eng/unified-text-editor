# הוראות תיקון — כל הבאגים הפתוחים שנותרו במנוע התלמוד

מסמך זה מרכז 9 באגים שעדיין לא טופלו ב-engine, אחרי 3 התיקונים של Cloud Claude (Bug 1, 2, 3 מהמסמך הקודם).

---

## באג רביעי — פערים של 17-29px באמצע עמודים 1-5 (כלל 2)

### הבעיה
Codex round 9 דיווח: בעמודים 1-5 יש פער של 17-29px בין הזרם הראשי לזרמים התחתונים. סותר את כלל 2 ("אסור רווח לבן באמצע — פגישה באמצע").

### מקור
`pullBackwardAcrossAllPages` ב-`src/talmud_pull_backward.js` קיים אבל לא תופס את כל המקרים. אסטרטגיה 3 מנוטרלת בעקבות חשד לבאג של מילים נמחקות.

### הפתרון המוצע
לכתוב `pullForwardWhenGap`:

```javascript
function pullForwardWhenGap(container) {
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"));
  for (let i = 0; i < pages.length - 1; i++) {
    const cur = pages[i];
    const next = pages[i + 1];
    let safety = 100;
    while (safety-- > 0) {
      const gap = computeMiddleGap(cur);
      if (gap < 5) break;
      const moved = moveOneStreamItemBackward(cur, next);
      if (!moved) break;
    }
  }
}
```

נדרש להוסיף את `computeMiddleGap` ו-`moveOneStreamItemBackward` (האחרונה חייבת להיות בטוחה — לא למחוק תוכן, לא לשבור מילים).

---

## באג חמישי — אין התרחבות דינמית לפי Y-segments (כלל 3)

### הבעיה
Streams בעלי רוחב קבוע full-width לכל הדף — אין חישוב מחדש כשזרם נגמר באמצע.

### הפתרון המוצע (מורכב)
מימוש layout שעובד לפי Y-segments:
1. אחרי build, סורקים מלמעלה למטה.
2. בכל גובה Y עם שינוי, חותכים זרמים שעוברים שם.
3. כל מקטע אנכי מקבל רוחב לפי כמות הזרמים הפעילים בו.

Refactor משמעותי. אלטרנטיבה: לסמוך על float טבעי (כפי שכעת) — לא מספיק לכל המקרים.

---

## באג שישי — תרחיש 2 (זרם 1 קצר) לא מיושם (כלל 6)

### הבעיה
כשיש זרם 1 קצר (פחות מ-4 שורות ברוחב מלא) — אין כתר. הזרם והראשי מתחילים יחד.
V1 תמיד מנסה ליצור כתר.

### הפתרון
ב-`splitSingleCommentaryIntoHalves` (`talmud_layout.js` ~שורה 785), לפני פיצול:

```javascript
const linesAtFull = measureLinesAtFullWidth(commentary, block);
if (linesAtFull < crownLines) {
  commentary.classList.add("talmud-body-portion", "talmud-right");
  commentary.style.float = "right";
  commentary.style.width = "29%";
  commentary.style.clear = "none";
  commentary.style.marginLeft = `${getTalmudSideGap()}px`;
  if (mainEl) mainEl.insertBefore(commentary, mainEl.firstChild);
  return null;
}
```

נדרש להוסיף `measureLinesAtFullWidth` (דומה ל-`commentaryFillsCrownAtFullWidth` של Cloud Bug 1).

---

## באג שביעי — תרחיש 5 (2 זרמים קצרים) (כלל 6)

### הבעיה
כשיש 2 זרמים נפרדים שניהם קצרים — צריך אין כתר.

### הפתרון
**מטופל אוטומטית ע"י Cloud Bug 1** — אם הארוך לא מספיק לרוחב מלא, oneLongOneShort=false, הקוד נופל לענף `talmud-no-crown` הקיים. רק לאמת אחרי יישום Bug 1.

---

## באג שמיני — זרם 1 מפוצל אינו רציף ימין→שמאל (כלל 7)

### הבעיה
ב-`talmud-one-commentary` mode, הקוד מחלק לפי שורות אבל לא מבטיח רציפות הקריאה.

### הפתרון — בדיקה ראשית
```javascript
const reconstructed = rightCrown.textContent + leftCrown.textContent
                    + rightBody.textContent + leftBody.textContent;
// reconstructed should equal originalStreamText (after whitespace normalization)
```

אם לא תואם — יש באג ב-extractAfterSplit שמדלג על תוכן.

---

## באג תשיעי — עמוד אחרון: העלאת הערות דינמית (כלל 10)

### הבעיה
ב-pass 156 הוספתי CSS עם `margin-top: -29px !important` קבוע. לא דינמי.

### הפתרון
JS שמודד את הפער האמיתי:

```javascript
function raiseLastPageFootnotes(container) {
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"));
  if (pages.length === 0) return;
  const lastReal = pages[pages.length - 1];
  const ps = lastReal.querySelector(":scope > .page-streams");
  if (!ps) return;
  const block = lastReal.querySelector(":scope > .talmud-layout");
  const main = lastReal.querySelector(":scope > .page-main");
  const above = block || main;
  if (!above) return;
  const aboveBottom = above.getBoundingClientRect().bottom;
  const psTop = ps.getBoundingClientRect().top;
  const gap = psTop - aboveBottom;
  if (gap > 5) {
    ps.style.marginTop = `${-gap}px`;
  }
}
```

קריאה אחרי `loopUntilStable`. הסר את ה-CSS הקבוע מ-`styles.css` (pass 156).

---

## באג עשירי — INV-10 "Expanded Parallel" עדיין n/a

### הפתרון
ב-`src/talmud_invariants.js`:

```javascript
export function invExpandedParallel(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return { invariant: "INV-10", name: "Expanded Parallel", ok: true, detail: "n/a (no block)" };
  const expandeds = Array.from(block.querySelectorAll(".talmud-body-expanded"));
  const main = block.querySelector(":scope > .page-main, :scope > .talmud-main");
  if (expandeds.length === 0 || !main) return { invariant: "INV-10", name: "Expanded Parallel", ok: true, detail: "n/a (no expanded)" };

  const mainTop = Math.round(main.getBoundingClientRect().top);
  const failures = [];
  for (const exp of expandeds) {
    const expTop = Math.round(exp.getBoundingClientRect().top);
    if (Math.abs(expTop - mainTop) > 5) {
      failures.push(`exp top=${expTop}, main top=${mainTop}`);
    }
  }
  return {
    invariant: "INV-10",
    name: "Expanded Parallel",
    ok: failures.length === 0,
    detail: failures.length === 0 ? "all parallel" : failures.join("; "),
  };
}
```

---

## באג אחד-עשרה — body-expanded ב-two-commentaries אסור

### הבעיה
לפי Cloud Chrome: במצב 2 זרמים נפרדים, אסור body-expanded. תוכן עודף → page-streams.

### הפתרון
ב-`layoutTwoCommentariesWithMain` (~שורה 1032), מסיר קריאה ל-`makeExpanded` ב-mode זה. תוכן עודף נדחף ע"י `splitPageStreamsBetweenPages` הקיים.

---

## באג שתים-עשרה — V2 engine לא גמור

### מה חסר
1. **Page split** — `createOverflowPage(sourceIdx, content)` חסר.
2. **Pull-backward** — לא ממלא פערים ע"י משיכה.
3. **Last page raise** — לא מטפל.
4. **Two-commentaries** — לא נבדק על שו"ע.
5. **שילוב עם engine_bridge** — splitters לא קוראים ל-V2.

### הפתרון
1. להעתיק splitPageStreamsBetweenPages ו-splitBodyExpandedBetweenPages לתוך V2.
2. להוסיף raiseLastPageFootnotes (Bug 9).
3. להוסיף pullForwardWhenGap (Bug 4).
4. להריץ `verify-full-rules.mjs` עם `useV2=1`.

---

## סדר עבודה מומלץ

1. **באג 11 (INV-10)** — הכי קל
2. **באג 9 (last-page raise דינמי)** — קל
3. **באג 10 (body-expanded ב-two-commentaries)** — בינוני
4. **באג 6 (תרחיש 2)** — קל-בינוני
5. **באג 4 (פערים 17-29px)** — בינוני
6. **באג 8 (רציפות זרם 1)** — בדיקה
7. **באג 12 (V2)** — גדול
8. **באג 5 (דינמי לפי Y)** — הכי גדול וקשה

לכל באג: להריץ `verify-full-rules.mjs` ו-`test-harness/bug_regression.mjs`.
