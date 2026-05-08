# Word Extractor v3 — מחקר מקור

מחקר זה הוא תנאי מוקדם לכתיבת המנוע מחדש. הוא קורא את הייבואן הנכון מתוך
`comparator_tool.py` (לא את `word_extractor.py` שייצר LaTeX).

---

## 1. ה-API של `docx_extract` ב-`comparator_tool.py`

חתימה: `docx_extract(fp, selected) -> (main_text, [(symbol, joined_notes_text)])`

* `fp` — נתיב מלא ל-DOCX.
* `selected` — רשימת tuples `(stream, symbol)` כאשר:
  * `stream` הוא dict שהוחזר מ-`docx_find_streams` (יש בו `source`,
    `marker`, `label`, `count`).
  * `symbol` הוא הסמל שהמשתמש בחר עבור הזרם הזה (למשל `@01`, `@02`).

הפונקציה מחזירה **טקסט פשוט** (לא HTML, לא LaTeX). השדה הראשון הוא טקסט
הגוף הראשי, השדה השני הוא רשימה של `(symbol, joined_notes)` — לכל
זרם, כל ההערות מאוחות לטקסט אחד עם `\n` ביניהן, וכל הערה מוצמדת בתחילתה
לסמל הזרם (למשל `@01<תוכן ההערה>`).

### האלגוריתם הליבה — `docx_extract` (לפי שורות 200-251):

```
1. טען footnotes.xml/endnotes.xml/comments.xml אל מילון נפרד לפי id, כל
   ערך = הטקסט הפשוט של ההערה (concat של כל ה-w:t).
2. בנה ארבעה מילונים:
     fn_m, en_m, cm_m  — marker → symbol  (לזרמים עם marker)
     fn_n, en_n, cm_n  — symbol יחיד או None (לזרם "ללא סימון")
   עפ"י המבנה בו המשתמש עבר על selected.
3. עבור על כל w:p ב-document.xml:
   - cumulate w:t ל-pt
   - בכל פעם שנתקלים ב-w:footnoteReference / endnoteReference / commentReference:
       * ענה את id של ההערה
       * שלוף את הטקסט שלה מהמילון המתאים
       * הרץ _res(...) שמחזיר (stream_symbol, content_without_prefix)
       * שרשר את stream_symbol לתוך pt (זה ה"placeholder" בגוף הראשי)
       * הוסף `f'{symbol}{content}'` לרשימת ההערות של הזרם
   - אסוף את כל ה-pt כשורה אחת ב-parts (אם לא ריקה אחרי strip).
4. main = '\n'.join(parts).
5. מחזיר (main, [(s, '\n'.join(notes_for_s)) for s,notes_for_s in sn.items() if notes_for_s])
```

### `_res(txt, m2s, nsym)` — הרזולוציה הקריטית (שורות 216-221):

```python
def _res(txt, m2s, nsym):
    m = re.search(r'@(\d+)', txt)
    if m and m.group(1) in m2s:
        return m2s[m.group(1)], re.sub(r'^.*?@'+re.escape(m.group(1))+r'\s*:?\s*','',txt).strip()
    elif nsym and not m:
        return nsym, txt.strip()
    return None, txt.strip()
```

**תרגום פשוט:**
1. אם בתוכן ההערה יש `@<digits>`, וה-digits הזה נמצא במילון
   marker→symbol — הזרם הוא `m2s[digits]`, וה-content הוא הטקסט
   ללא הקידומת `^.*?@<digits>\s*:?\s*` (מסיר רווחים מובילים, התווית
   `@NN`, ואופציונלית `:`+רווחים).
2. אחרת, אם אין `@<digits>` בכלל **וגם** קיים זרם "ללא סימון"
   נבחר → הזרם הוא הזרם-ללא-סימון, ה-content הוא הטקסט המלא (אחרי strip).
3. אחרת — הזרם הוא None וההערה אינה משובצת באף זרם (אבל הקוד עדיין
   מחזיר את הטקסט; קוד הקריאה בודק `if s:` לפני שהוא משתמש בו).

---

## 2. מה זה `@<digits>:` בתוך הערות?

**זוהי תחביר עריכתי של משה.** המחבר כתב כל הערה בתוך הוורד עם תחילית
שמסמנת לאיזה "זרם" (apparatus) ההערה שייכת. דוגמה מהמסמך לדוגמה:

```
" @01:(מ"א) קודם השכמת הבוקר. הג"ה כשם שצריך הצנע..."
" @02:הקדמה אורחות - אם אדם הולך באורח חיים אזי הולך לפי משפט..."
" @03:אורח חיים הלכות אדם - אורח חיים הלכות חייבים על פי הכתב..."
```

37 ההערות בקובץ הזה מתחלקות:
* `@01` — 12 הערות (זרם A במונחי app_ui)
* `@02` — 20 הערות
* `@03` — 4 הערות
* ללא תווית — 1 הערה (תהיה בזרם "ללא סימון")

המנוע **מסיר** את התחילית `@NN:` כשהוא מציג את ההערה בחלונית הערות.
בגוף הטקסט הראשי המנוע **שותל** את ה-symbol שהמשתמש בחר (הוא לא
חייב להיות `@NN` המקורי — המשתמש יכול לבחור `*`, `†`, וכו').

המסקנה החשובה: "הזיהוי עצמו" של זרם הוא **תוכן ההערה**, לא סגנון או
rStyle. אם תוכן ההערה מתחיל ב-`@<digits>` שתאם לזרם נבחר — לשם היא
תילך.

---

## 3. צורת התוכן שהעורך מצפה לקבל

ב-`comparator_tool.py` השדות מוזרמים אל Quill דרך `loadWordContent`:

```javascript
function loadWordContent(editor, htmlContent) {
    if (htmlContent.includes('<')) {
        // HTML → Delta → setContents
        const delta = htmlToDelta(htmlContent);
        editor.setContents(delta, 'silent');
    } else {
        // טקסט פשוט
        editor.setText(htmlContent);
    }
}
```

ב-app החדש, הזרימה זהה אבל דרך TipTap:

```javascript
function loadWordContent(editor, htmlContent) {
  if (htmlContent.includes("<")) {
    editor.commands.setContent(htmlContent);
    return;
  }
  // טקסט פשוט עם \n הופך ל-<p>...<br>...</p>
  editor.commands.setContent(`<p>${escaped.replace(/\n/g, "<br>")}</p>`);
}
```

**כלומר:** `setContent` של TipTap מקבל מחרוזת HTML. אם נספק HTML
תקין (`<p>...</p>` עם `<strong>`, `<em>`, `<u>`, `<span style="...">`),
TipTap יציג את התוכן עם העיצוב.

מה שהפנים מקבלים:
* `mainHtml` — מחרוזת HTML עבור הגוף הראשי
* `streamsByCode[code]` — מחרוזת HTML עבור חלונית הזרם code

---

## 4. למה לא לעבור דרך LaTeX?

`word_extractor.py` הוא הייבואן של המסך הראשי בתוכנה הישנה. הוא
מתרגם מ-DOCX ל-LaTeX משום שהמסך הראשי מייצר PDF דרך XeLaTeX.
הפלט שלו מכיל פקודות כמו:

```latex
\textcolor{red}{...}  \fontsize{12}{14}\selectfont ...  \par
\footnoteA{...}  \ledrightnote{...}
```

ב-V2 ניסינו לקחת את ה-RichText של LaTeX ולחלץ ממנו `<strong>` וכו'.
זה הוביל ל-`\fontsize` ו-`\textcolor` שזולגים ל-HTML של העורך,
שמוצג כטקסט מילולי (העורך לא מבין LaTeX).

**הפתרון הנכון:** לקרוא את ה-DOCX **ישירות** ולייצר HTML, בלי שלב
LaTeX באמצע. זה בדיוק מה שהייבואן של עורך-ההשוואה
(`comparator_tool.py:docx_extract`) עושה — אבל פלט שלו טקסט פשוט,
ולכן אנחנו משדרגים את אלגוריתם הזיהוי שלו (פסקה→פסקה,
footnoteReference→symbol, marker resolution) ומוסיפים שכבת עיצוב
ב-run-level.

---

## 5. מבנה DOCX רלוונטי לקריאה

* `word/document.xml` — `<w:body>` → רצף `<w:p>` (פסקאות).
  כל `<w:p>` מכיל `<w:r>` (runs). כל `<w:r>` מכיל `<w:rPr>` (עיצוב)
  ו-`<w:t>` (טקסט). יש גם `<w:br/>` (line break בתוך פסקה),
  ו-`<w:footnoteReference w:id="N"/>` / `<w:endnoteReference w:id="N"/>` /
  `<w:commentReference w:id="N"/>` (מצביעים אל ההערות).
* `word/footnotes.xml` — `<w:footnote w:id="N">` → אותה מבנה (פסקאות
  ועם runs). `id<=0` מסונן (אלה הפרדה/continuation סטנדרטיים של Word).
* `word/endnotes.xml` — אותו דבר עם `<w:endnote>`.
* `word/comments.xml` — `<w:comment w:id="N">` (אבל `id>=0` כאן —
  comment id ראשון יכול להיות 0).

### עיצוב ב-`<w:rPr>`:
* `<w:b/>` — bold
* `<w:i/>` — italic
* `<w:u w:val="single"/>` — underline (כל val שאינה `none` = underline)
* `<w:color w:val="FF0000"/>` — צבע (hex 6-תווי)
* `<w:sz w:val="24"/>` — גודל בחצאי-נקודות (24 = 12pt)
* `<w:strike/>` — strikethrough
* `<w:vertAlign w:val="superscript"/>` או `subscript` — sup/sub

לוגיקת תרגום ל-HTML:
* `<w:b/>` → `<strong>`
* `<w:i/>` → `<em>`
* `<w:u/>` → `<u>`
* `<w:strike/>` → `<s>`
* `<w:vertAlign val="superscript">` → `<sup>`
* `<w:vertAlign val="subscript">` → `<sub>`
* color/size → `<span style="color:#XXXXXX; font-size:Npt">`

---

## 6. סיכום הוראות תכנון

1. הקלט: `ArrayBuffer` של DOCX + רשימת `selected = [{stream, symbol}, ...]`
2. הפלט: `{ mainHtml, streamsByCode: { '01': html, '02': html, ... }, streamLabels: {...} }`
3. הזרם הוא "אוסף הערות". הסמל שהמשתמש בחר (`@01`, וכו') הוא ה-placeholder
   שמופיע בגוף ההערות וגם בגוף הראשי במקום ה-footnoteReference.
4. אין שלב LaTeX. ה-RichText נכתב ישירות ל-HTML.
5. אין regex cleanup. אם משהו מלוכלך בפלט — תקן את המקור, לא את התוצר.
