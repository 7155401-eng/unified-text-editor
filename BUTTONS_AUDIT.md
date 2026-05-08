# סקירה: כפתורי עורך רב טקסט — פייתון מקורי מול וב

תאריך: 2026-05-08
ענף: `claude-fix-editor-buttons-audit`
קובץ פייתון מקור: `work-files/comparator_tool.py` (העורך עצמו, לא `app_ui.py`)
`app_ui.py` הוא חלון ההפקה הראשי שמפעיל את `comparator_tool.py` בתת-תהליך נפרד דרך `open_comparator_tool` (שורות 4875-4901).

תיאור המקרא:
- ✅ יש בעורך החדש, התנהגות תואמת
- ⚠️ קיים אבל עם הבדל התנהגות
- ❌ חסר לחלוטין
- 🔧 קיים אבל קרוב/שבור

---

## 1. סרגל ראשי — קבוצת "פעולות" (`tb-group t_actions`)

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| 📄 חלונית חדשה | `addPane()` | ✅ | `index.html:272` `data-cmd="pane-add"` → `main.js:1652` |
| ✂ הפרד הערות | `splitNotes()` | ⚠️ | `index.html:276` `data-cmd="split-special-notes"` → `main.js:1727` (logic בקובץ אחר) |
| 🔗 מזג / פרק | `toggleMerge()` | ✅ | `index.html:277` `data-cmd="merge-toggle"` → `main.js:1732` |

## 2. קבוצת "קבצים" (`tb-group t_files`)

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| 💾 שמור ל-Word | `doExport()` | ✅ | `index.html:262` `data-cmd="word-export"` → `main.js:1494` → `word_bridge.js` |
| 📂 טען מ-Word | `doImport()` | ✅ | `index.html:261` `data-cmd="word-import"` → `main.js:1490` → `word_bridge.js` |

## 3. קבוצת "תצוגה" (`tb-group t_view`)

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| 👁 עורך ויזואלי | `togglePreview()` | ✅ | `index.html:279` `data-cmd="preview-toggle"` → `main.js:1743` |
| ⚙️ כלים | `toggleExpandTools()` | ✅ | `index.html:280` `data-cmd="tools-toggle"` → `main.js:1453` |
| ⚙️ העתקה | `showTransferSettings()` | ❌ | חסר. אין דיאלוג `transferModal`, אין קונספט "העתק לזרם". |
| 🔗 גלילה | `toggleSync()` | ✅ | `index.html:281` `data-cmd="sync-toggle"` → `main.js:1756` |
| ☷ שורות | `toggleLines()` | ⚠️ | `index.html:283` `data-cmd="lines-toggle"` → `main.js:1737`. הלוגיקה הישנה הזריקה `\n` לפני כל סימן זרם בכל החלוניות; החדש רק מפעיל class `lineMode` ב-`pane_manager`. |

## 4. קבוצת "רוחב כללי" (`tb-group t_width`)

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| `<input type="range" id="widthSlider">` (10..100) | `changeWidth(this.value)` | ✅ | קיים כסליידר דינמי `#width-slider` (min=18 max=100) שנוצר ב-`main.js:504-558` עם applyWidth מתוחכם יותר (תומך גם ב-stacked layout). |

## 5. קבוצת "גודל וערכת נושא" (`tb-group t_theme`)

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| ☀️/🌙 | `toggleTheme()` | ✅ | `index.html:225` `data-cmd="theme-toggle"` → `main.js:1437` |
| −− | `changeFontSize(-2)` | ✅ | `index.html:189` `data-cmd="size-down-double"` |
| − | `changeFontSize(-1)` | ✅ | `index.html:190` `data-cmd="size-down"` |
| `fsLabel` 15 | (תצוגה בלבד) | ✅ | `index.html:191` `id="fs-label"` |
| + | `changeFontSize(1)` | ✅ | `index.html:192` `data-cmd="size-up"` |
| ++ | `changeFontSize(2)` | ✅ | `index.html:193` `data-cmd="size-up-double"` |

## 6. קבוצת "ניווט סימנים" (`tb-group t_nav`)

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| ▲ הקודם | `jumpMarker(-1)` | ✅ | `index.html:250` `data-cmd="stream-prev"` → `main.js:1602` |
| ▼ הבא | `jumpMarker(1)` | ✅ | `index.html:251` `data-cmd="stream-next"` → `main.js:1596` |

## 7. כפתור שפה

| כפתור פייתון | onclick | סטטוס | היכן בעורך החדש |
|---|---|---|---|
| EN | `toggleLang()` | ✅ | `index.html:226` `data-cmd="lang-toggle"` → `main.js:1443` |

## 8. סרגל Quill Global (`#global-toolbar`)

| Quill control | סטטוס | מקבילה בחדש |
|---|---|---|
| `ql-size` (small/normal/large/huge) | ⚠️ | החדש משתמש ב-`size-selected-select` עם ערכי px ספציפיים — מקובל פונקציונלית |
| `ql-bold` | ✅ | `data-cmd="bold"` |
| `ql-italic` | ✅ | `data-cmd="italic"` |
| `ql-underline` | ✅ | `data-cmd="underline"` |
| `ql-strike` | ✅ | `data-cmd="strike"` |
| `ql-color` (selector) | ⚠️ | החדש = 4 כפתורי צבע קבועים (אדום/כחול/ירוק/זהב) במקום בורר צבעים מלא |
| `ql-background` (selector) | ⚠️ | החדש = 3 כפתורים קבועים (צהוב/ציאן/ורוד) במקום בורר צבעי רקע מלא |
| `ql-script sub` | ✅ | `data-cmd="sub"` |
| `ql-script super` | ✅ | `data-cmd="super"` |
| `ql-header 1` | ✅ | `data-cmd="h1"` |
| `ql-header 2` | ✅ | `data-cmd="h2"` |
| `ql-list ordered` | ✅ | `data-cmd="ordered"` |
| `ql-list bullet` | ✅ | `data-cmd="bullet"` |
| `ql-indent -1` | ✅ | `data-cmd="indent-out"` |
| `ql-indent +1` | ✅ | `data-cmd="indent-in"` |
| `ql-direction rtl` | ✅ | `data-cmd="rtl"` |
| `ql-align` (selector) | ✅ | `align-right/center/left/justify` |
| `ql-clean` | ✅ | `data-cmd="clear"` |

## 9. דיאלוגים / Modals

| דיאלוג בפייתון | סטטוס | מקבילה בחדש |
|---|---|---|
| `transferModal` (זרם יעד + prefix/suffix להעתקה) | ❌ | חסר לחלוטין |
| `importModal` (בחירת זרמים מקובץ Word) | ⚠️ | קיים בתוך `word_bridge.js` אבל הצגה שונה |
| `wowAlert` (info/warn/err/ok) | ⚠️ | החדש משתמש ב-`alert()` רגיל ברוב המקומות, ראה `main.js:1782` |

## 10. תכונה: כפתור צף "העתק לזרם N" (PR #105)

| תכונה בפייתון | סטטוס |
|---|---|
| `handleMainSelection()` — מציג כפתור "העתק לזרם" כל פעם שהמשתמש מסמן טקסט בעורך הראשי | ❌ חסר |
| `copySelectedText()` — מעתיק טקסט נבחר עם prefix/suffix לזרם היעד | ❌ חסר |
| `transferTargetStream`, `transferPrefix`, `transferSuffix` (משתני state) | ❌ חסר |
| `showTransferSettings()` / `closeTransferModal()` / `saveTransferSettings()` | ❌ חסר |
| `updateTransferButtonText()` | ❌ חסר |

זוהי תכונה משמעותית מ-PR #105 שלא הועברה לעורך החדש.

## 11. תכונת מצב שורות (Line Mode) — לוגיקת `\n` הזרקה

| תכונה בפייתון | סטטוס |
|---|---|
| בהפעלת lineMode: סורק את כל הסימנים, מצמיד `\n` לפני כל סימן (אם אין כבר), מסיר רווח אם הוא לפני הסימן | ✅ |
| בכיבוי lineMode: מסיר את ה-`\n` שלפני כל סימן ומחזיר רווח | ✅ |
| מוסיף class `no-wrap` לכל `.ql-editor` (גלישת שורה כבויה) | ✅ |

החדש (`line_mode.js`) מבצע בדיוק את אותה לוגיקה דרך ProseMirror transactions:
`_enableLineMode` שובר פסקאות לפני כל סימן (`tr.split` עם הסרת רווח קודם),
`_disableLineMode` מצרף פסקאות (`tr.join`) ומחזיר רווח. תואם פונקציונלית.

## 12. סקירה תמציתית של פערים

### גדול — פעולות חסרות לחלוטין

1. **❌ הגדרות העתקה (Transfer Settings)** — modal `transferModal`, כפתור `⚙️ העתקה` בסרגל הראשי, וכפתור צף "העתק לזרם N" שקופץ בכל בחירה בעורך הראשי. כל הזרם מ-PR #105.
2. **❌ סליידר רוחב כללי** — `<input type="range" id="widthSlider">` עם `oninput="changeWidth(this.value)"`.

### בינוני — קיים אבל לא תואם

3. **🔧 מצב שורות** — בעורך החדש לא מבצע מניפולציית `\n` כפי שעשה הישן. אין הזרקת/הסרת newlines לפני כל סימן.

### קטן

4. **⚠️ wowAlert** — alert מעוצב עם 4 סוגים (info/warn/err/ok). החדש משתמש ב-`alert()` סטנדרטי.
5. **⚠️ ql-color/ql-background** — הישן השתמש ב-Quill native color pickers; החדש בחר 4-3 צבעים קבועים.

---

## תיקונים שבוצעו בענף הזה

ראה commits במשימה זו.

