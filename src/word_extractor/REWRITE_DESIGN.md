# עיצוב המנוע מחדש — Word Extractor v3

מבוסס על המחקר ב-`RESEARCH_NOTES.md`. מטרת ה-rewrite היא להחליף את
המנוע שמייצר LaTeX ולנסות להמיר אותו אחר-כך, במנוע שמייצר HTML
ישירות מ-DOCX, בדיוק כמו `comparator_tool.py:docx_extract` — אבל עם
שכבת עיצוב (run formatting → HTML inline tags).

---

## 1. ממשק מודולים (boundaries)

```
src/word_extractor/
├─ word_extractor.js               (entry — נשאר)
├─ word_extractor_dialog.js        (UI דיאלוג — distributeToPanes נכתב מחדש)
├─ word_extractor_engine.js        (מנוע ה-DOCX→HTML — כתיבה מחדש)
├─ word_extractor_streams.js       (לוגיקת מיפוי A/B/C לזרמים — נשאר)
├─ word_extractor_i18n.js          (מחרוזות — נשאר)
└─ word_extractor.css              (CSS — נשאר)
```

### word_extractor_engine.js — ה-API החדש

```javascript
/**
 * הוצאת מקור-הערות מ-DOCX (לזיהוי לפני הדיאלוג).
 * @param {ArrayBuffer} buf
 * @returns {Promise<Array<{
 *   id: string,                       // 'footnote_@01' / 'endnote_none' וכו'
 *   source_type: 'footnote'|'endnote'|'comment',
 *   marker: string|null,              // '01', '02', null
 *   count: number,                    // כמה הערות מסוג זה
 *   icon: string,                     // אמוג'י
 *   label: string,                    // 'שוליים @01 (12)'
 * }>>}
 */
export async function find_all_note_sources(buf);

/**
 * עיבוד מלא של DOCX לזרמים נפרדים.
 * @param {ArrayBuffer} buf
 * @param {Array<{stream, symbol}>} selected — רשימת נבחרים
 * @returns {Promise<{
 *   mainHtml: string,                 // HTML של הגוף הראשי
 *   streamsByCode: {[code:string]: string},   // code='01' → HTML של הערות הזרם
 *   streamLabels: {[code:string]: string},    // code → תווית מקור (למשל 'שוליים @01')
 *   streamSymbols: {[code:string]: string},   // code → הסמל שהמשתמש בחר
 * }>}
 */
export async function extract_word_html(buf, selected);

// תאימות: הפונקציות הישנות נשארות זמינות אבל מחזירות 'no-op' או
// מצביעות אל החלקים החדשים — כך ש-dialog ושאר ה-pipeline ימשיכו לעבוד.
export async function read_footnotes(buf);
export async function read_endnotes(buf);
export async function read_comments(buf);
```

### word_extractor_dialog.js — שינוי קריטי ב-distributeToPanes

הפונקציה הקיימת לוקחת `RichText` שעוטפים LaTeX. הפונקציה החדשה תקרא
ישירות ל-`extract_word_html` ותחלק את ה-HTML לחלוניות:

```javascript
async function onConfirm() {
  const selected = _state.streams.filter(s => s.included);
  const result = await extract_word_html(_state.zipBuf.slice(0), selected);
  // result.mainHtml -> main pane
  // result.streamsByCode['01'] -> stream pane '01'
  loadIntoMainPane(result.mainHtml);
  for (const code of Object.keys(result.streamsByCode)) {
    loadIntoStreamPane(code, result.streamsByCode[code], result.streamLabels[code]);
  }
}
```

---

## 2. אלגוריתם המנוע (extract_word_html)

זוהי הפנים של המנוע. תרגום צמוד ל-`comparator_tool.py:docx_extract`,
עם תוספת של שכבת עיצוב.

```
INPUT: buf (ArrayBuffer של DOCX), selected ([{stream, symbol}, ...])

1. פתיחת ZIP (JSZip) וקריאה של:
     word/document.xml
     word/footnotes.xml  (אם קיים)
     word/endnotes.xml   (אם קיים)
     word/comments.xml   (אם קיים)

2. בנה fn_d/en_d/cm_d: מילון id → תוכן ההערה
   - תוכן ההערה הוא רשימה של פסקאות, כל פסקה היא רשימה של "runs"
     עם עיצוב.
   - לטובת זיהוי הזרם נשמור גם plain text (concat של כל ה-w:t).

3. בנה fn_m/en_m/cm_m (marker → symbol) ו-fn_n/en_n/cm_n (זרם
   ללא סימון → symbol או null), לפי selected.

4. בנה seriesAssignment: לכל symbol שנבחר, הצמד code סדרתי 01,02,...
   streamSymbols['01'] = '@01' (או מה שהמשתמש בחר)
   streamLabels['01']  = 'שוליים @01' / 'סיום ללא סימון' וכו'

5. בנה streamBuckets[code] = []  (לכל code, רשימת HTML של הערות)

6. עבור על כל w:p ב-document.xml:
   bodyParaRuns = []     // רצף runs+סמלים של הפסקה הזו
   עבור על כל element בפסקה ברצף DFS:
     - אם w:r:
         שלוף את w:rPr → format
         לכל w:t / w:br בתוך הפסקה אסוף text/br עם אותו format
         דחוף ל-bodyParaRuns
     - אם w:footnoteReference id=N:
         note = fn_d[N]
         (sym, content) = _res(note.text, fn_m, fn_n)
         אם sym:
            דחוף ל-bodyParaRuns מארקר עם ה-symbol של הזרם הנכון
            (כתאם של מארקר עיצובי, לא טקסט גולמי)
            המר את note.runs ל-HTML, ועטוף ב-symbol prefix
            דחוף ל-streamBuckets[code]
     - אם w:endnoteReference / commentReference: כנ"ל

   שמור bodyParaRuns כפסקה אחת ב-bodyParas

7. mainHtml = bodyParas.map(p => `<p>${runsToHtml(p)}</p>`).join('')
   streamsByCode[code] = streamBuckets[code].map(noteHtml => `<p>${noteHtml}</p>`).join('')

8. החזר { mainHtml, streamsByCode, streamLabels, streamSymbols }
```

### _res עברית-JS (זהה לפיתון):

```javascript
function _res(text, m2s, nsym) {
  const m = text.match(/@(\d+)/);
  if (m && m[1] in m2s) {
    const symbol = m2s[m[1]];
    const stripped = text.replace(new RegExp('^.*?@' + m[1] + '\\s*:?\\s*'), '').trim();
    return [symbol, stripped];
  }
  if (nsym && !m) return [nsym, text.trim()];
  return [null, text.trim()];
}
```

חשוב: גם עבור הערה שזוהתה ב-marker, אנחנו עדיין מחזירים את ה-content
ה**מלא** (אחרי הסרת `@<digits>:` וגרירה רלוונטית). כשמייצרים את ה-HTML
של ההערה אנחנו צריכים לחתוך את אותם תווים מהתחילית של ה-RichText —
ראה סעיף 3.

---

## 3. שכבת העיצוב — runs → HTML

### ייצוג פנימי
לכל run בנפרד, אנחנו מחזיקים אובייקט:

```javascript
{
  text: string,           // הטקסט (כל w:t המאוחים, עם \n מ-w:br)
  bold: boolean,
  italic: boolean,
  underline: boolean,
  strike: boolean,
  vertAlign: 'super'|'sub'|null,
  color: string|null,     // 'FF0000' (hex bli #)
  fontSize: number|null,  // half-points (Word הטבעי) - יוצג כ-pt בעת המרה
}
```

### חוקי המרה (runsToHtml):

```
1. עבור על runs ברצף.
2. כל run → escapeHtml(text), עם החלפה של \n ל-<br>.
3. עטיפה (חיצוני אל פנימי, אבל הסדר משנה רק קוסמטית):
   - color/fontSize: <span style="color:#X; font-size:Npt">
   - bold:     <strong>
   - italic:   <em>
   - underline:<u>
   - strike:   <s>
   - vertAlign:<sup>/<sub>
4. אם רצף runs באים עם אותו עיצוב — צירוף לתוך אותה עטיפה (אופטימיזציה
   קלה לפלט נקי).
```

### חיתוך תחילית `@NN:` מ-RichText

ב-`_res` הפיתון פשוט עבד על plain text. לנו יש מבנה עם runs. הגישה:

```
1. שלוף את plain_text של ההערה.
2. מצא בו את האינדקס של תחילית ה-`^.*?@NN\s*:?\s*` (אורך הקידומת).
3. חתוך את ה-runs כך שעד לאינדקס הזה — נסיר; משם והלאה — נשאיר.
   זה נדרש משום שהקידומת יכולה להיות מפוצלת בין מספר runs (למשל
   ` @` ב-run אחד, `01:` ב-run שני, ו"תחילת התוכן" ב-run שלישי).
```

פסאודו-קוד:

```javascript
function trimPrefixFromRuns(runs, prefixLength) {
  let remaining = prefixLength;
  const out = [];
  for (const r of runs) {
    if (remaining >= r.text.length) {
      remaining -= r.text.length;
      continue;
    }
    if (remaining > 0) {
      out.push({ ...r, text: r.text.slice(remaining) });
      remaining = 0;
    } else {
      out.push(r);
    }
  }
  return out;
}
```

---

## 4. עיצוב הסמל שהמשתמש בחר

לפי המחקר, הסמל שהמשתמש בחר (`@01`, `@02` וכו') משובץ:
1. **בגוף הראשי** במקום `w:footnoteReference` — להראות "כאן הייתה הערה
   #N של הזרם הזה".
2. **בתחילת ההערה בחלונית הזרם** — בדיוק כמו `f'{symbol}{content}'`
   ב-Python, כדי שהמשתמש יוכל לראות-ולערוך לאיזה זרם זה שייך.

המנוע יוצא **גם** עם `mainHtml` שכולל את הסמלים inline, **וגם** עם
`streamsByCode[code]` שבו כל הערה מתחילה ב-symbol של הזרם.

הסמל מוטמע כטקסט פשוט ב-HTML — לא span, לא marker class. (אם בעתיד
המשתמש ירצה stream-mark מוצג בצבעי-זרם, יש מנגנון
`stream_mark.js` בעורך שיכול לתפוס אותו אחרי הטעינה — אבל זה לא
חלק מהמנוע.)

---

## 5. תאימות אחורה (כדי לא לשבור את ה-dialog)

ה-`word_extractor_dialog.js` הקיים משתמש בפונקציות:
* `find_all_note_sources(buf)` — נשמרת, מחזירה אותו פורמט.
* `read_footnotes(buf)`, `read_endnotes(buf)`, `read_comments(buf)` —
  משמשים ל-preview. נשמרים, מחזירים `{id: RichText}` עם API
  של `RichText.get_text()`.
* `extract_doc_titles`, `extract_headers_footers`, `find_sections_in_docx`,
  `find_all_styles_in_docx` — UI metadata. נשמרים אבל יכולים להיות
  פשוטים (return `['', '']` / `{}` אם לא דחוף).
* `extract_and_process(buf, sd, options)` — היה ה-entry הישן. **מוחלף**
  ב-`extract_word_html(buf, selected)`. ה-dialog יקרא את החדש.

---

## 6. מקרים מיוחדים

1. **אין הערות בקובץ** — `selected` ריק → `extract_word_html` עדיין
   מייצר `mainHtml`, סתם בלי שום symbol שתול. `streamsByCode` ריק.

2. **footnoteReference לא נבחר** — המשתמש בחר רק חלק מהזרמים. הערות
   שלא משובצות לזרם נבחר (כי `_res` החזיר `null`) פשוט נופלות —
   ה-symbol לא משובץ ב-mainHtml, וההערה לא נכנסת לשום bucket.

3. **הערה בתוך הערה** — במידע אם footnote מכיל reference פנימי, נתעלם
   (consistent עם Python).

4. **w:br בתוך פסקה** — אנחנו מתרגמים ל-`<br>` בתוך ה-`<p>`, לא לפסקה
   נפרדת.

5. **פסקה ריקה** — Python דילג עליה. אנחנו נשמור על אותו התנהגות:
   אם אחרי `runsToHtml` הפלט ריק (אחרי trim) — לא נדחף `<p>` ריק.

6. **טבלאות / רשימות** — לפיתון `comparator_tool.py:docx_extract` לא
   טיפל בהם בכלל (עבר רק על `<w:p>` ב-XPath שטוח). נשמור על אותה
   התנהגות. טבלה במסמך תופיע כתאי טקסט פשוטים ברצף.

7. **rPr משונה (theme colors, ...)** — נתעלם. רק `w:val` ישיר על
   `w:color` נתפס. אם אין `w:val` המאפיין מתעלם.

---

## 7. בדיקות

טסט יקרא את הקובץ
`C:\LyxWork\שולחן ערוך אורח חיים הלכות הנהגת אדם בבוקר סימן א - עותק.docx`
(מעותק ב-`samples/sample_shulchan_aruch.docx`) וייצר את ה-HTML.

נדרשים תנאי PASS:
1. `mainHtml` לא מכיל `\` ראש-במשפט (`\fontsize`, `\textcolor`, `\par`,
   `\footnoteA` וכו').
2. `mainHtml` מכיל לפחות פסקה אחת (`<p>`).
3. הזרמים הצפויים: 4 זרמים סה"כ (footnote @01, @02, @03, ועוד 1
   ללא-סימון, וכן endnote+comment בכל אחד מהם 1).
4. `streamsByCode['01']` מכיל ~12 הערות (footnote @01).
5. אין `@02:` או `@03:` בתוך `streamsByCode['01']` (כל הערה הולכת רק
   לזרם שלה).
6. עיצוב bold/italic נשמר (בדיקה על נוכחות `<strong>` או `<em>` אם
   הקובץ כולל אותם — אופציונלי, רק מציגים).

---

## 8. סיכום

המנוע החדש קצר משמעותית מהקיים (~1585 שורות → צפי ~400 שורות),
כי הוא עושה דבר אחד: DOCX → HTML עם מיפוי הערות לזרמים. אין שלב
LaTeX, אין `RichText.to_latex`, אין `_mk_fn`, אין balloon חיבורים.
