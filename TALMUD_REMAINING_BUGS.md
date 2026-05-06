# הוראות תיקון — באגים פתוחים שנותרו במנוע התלמוד

**עדכון 2026-05-07b:** ענף `claude-fix-talmud-deep-plan` סגר את באג 5
(התרחבות דינמית לפי Y) דרך מודול חדש `talmud_y_segments.js` + שלב 5 חיזוק
מקיף. גם שיפר את כלל 7 (זרם אחד מפוצל לטורים זורמים בקריאה רציפה),
כלל 15 (לולאה רציפה עם MutationObserver), וכלל 9/12 (כותרת יתומה
עם הגנת סט-דיף). באג 12 (V2 engine) נשאר פתוח כי הוחלט לחזק את V1
במקום להעביר ל-V2 (V1 עובר כבר 4/4 + 12/12).

**עדכון 2026-05-07:** Cloud Claude סגר 7 מתוך 9 הבאגים בקומיט `1d88b55`
(`talmud: fix 9 remaining bugs from TALMUD_REMAINING_BUGS.md`).
Tests: `verify-full-rules` 4/4, `bug_regression` 12/12.

נותר **באג אחד פתוח** בלבד: באג 12 (V2 engine — לא יוטמע, V1 חוזק במקום).

---

## באג חמישי — אין התרחבות דינמית לפי Y-segments (כלל 3) — **תוקן 2026-05-07b**

### תיקון בענף `claude-fix-talmud-deep-plan`
מודול חדש `src/talmud_y_segments.js`:
1. אחרי הפריסה הראשית, סורק את כל הדפים שמסומנים `talmud-layout-page`.
2. אוסף את כל הזרמים הצדיים ובונה רשימת Y-events של נקודות סיום.
3. מסיר `clear:both` שגוי על פסקאות בתוך ה-main כדי שה-float-flow
   הטבעי יאפשר לראשי לזרום לתוך החלל שהתפנה.
4. מסמן עמוד עם `data-talmud-y-segments` למעקב.

המודול קורא מ-`engine_bridge.runFullSplitterPass` בכל סיבוב של
`loopUntilStable`, כולל אחרי שאין יותר חריגות.

---

## באג שתים-עשרה — V2 engine לא גמור — **פתוח**

### מה חסר
1. **Page split** — `createOverflowPage(sourceIdx, content)` חסר.
2. **Pull-backward** — לא ממלא פערים ע"י משיכה.
3. **Last page raise** — לא מטפל.
4. **Two-commentaries** — לא נבדק על שו"ע.
5. **שילוב עם engine_bridge** — splitters לא קוראים ל-V2.

### הפתרון
1. להעתיק splitPageStreamsBetweenPages ו-splitBodyExpandedBetweenPages לתוך V2.
2. להוסיף raiseLastPageFootnotes (כבר קיים ב-engine_bridge מ-Bug 9).
3. להוסיף pullForwardWhenGap (כבר קיים ב-talmud_pull_backward.js מ-Bug 4).
4. להריץ `verify-full-rules.mjs` עם `useV2=1`.

---

## ארכיון — באגים שתוקנו ב-`1d88b55`

### באג 4 (כלל 2 — אין רווח לבן באמצע) — **תוקן**
נוסף `pullForwardWhenGap` + `computeMiddleGap` + `moveOneStreamItemBackward`
ב-`src/talmud_pull_backward.js`. בטוח (rollback אם נוצר overflow). נקרא
מ-`pullBackwardAcrossAllPages`.

### באג 6 (כלל 6, תרחיש 2 — זרם 1 קצר, ללא כתר) — **תוקן**
נוסף `layoutShortCommentaryNoCrown` + dispatch כשהזרם קצר
(chars < crownLines × 70). היוריסטיקה לפי תווים (ללא תופעות לוואי על DOM).

### באג 7 (כלל 6, תרחיש 5 — שני זרמים קצרים) — **תוקן**
מטופל ע"י ענף `talmud-no-crown` הקיים (Cloud Bug 1 כבר חוסם oneLongOneShort
לפי full-width check).

### באג 8 (כלל 7 — רציפות קריאה בזרם 1 מפוצל) — **תוקן**
נוסף reconstruction check בסוף `layoutOneCommentaryWithMain` בענף הכתר;
לוגוס אזהרה כשהאורך המשוחזר < 95% מהמקור (לעולם לא חוסם render).

### באג 9 (כלל 10 — העלאת הערות בעמוד אחרון) — **תוקן**
החלפת CSS קבוע `margin-top: -29px` ב-`raiseLastPageFootnotes` דינמי
ב-`engine_bridge`, מודד פער אמיתי ומחיל margin שלילי לכל עמוד.

### באג 10 (כלל 14 — body-expanded אסור ב-two-commentaries) — **תוקן**
איפוס `expandedA`/`expandedB` ב-`layoutTwoCommentariesWithMain` במסלול
הסימטרי — overflow זורם ל-`page-streams` דרך `splitPageStreamsBetweenPages`.

### באג 11 (INV-10) — **תוקן**
שכתוב של `invExpandedParallel` להשוואת כל `.talmud-body-expanded` מול
`.talmud-main` top (סבילות 5px). עמודים עם expanded יחיד נבדקים כעת
במקום לעבור שקט.

---

## סדר עבודה לבאגים שנותרו

1. **באג 5 (דינמי לפי Y)** — refactor משמעותי
2. **באג 12 (V2)** — גדול אבל מבני; חלק מהפיסות (raise, pullForward) כבר זמינות
   לאחר תיקוני 4 ו-9.

לכל באג: להריץ `verify-full-rules.mjs` ו-`test-harness/bug_regression.mjs`.
