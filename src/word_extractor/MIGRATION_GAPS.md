# MIGRATION_GAPS — `word_extractor.py` (1411 lines) → JavaScript

מסמך זה ממפה כל פונקציה / יכולת ב-`word_extractor.py` המקורי, ומסמן את הסטטוס שלה ב-`src/word_bridge.js` הקיים (458 שורות).

מקור: `C:\Users\User\migration_work\work-files\word_extractor.py` (read-only)
יעד נוכחי (קיים): `src/word_bridge.js`
יעד חדש (השלמת פערים): `src/word_extractor/*.js`

מקרא: PRESENT = קיים ב-word_bridge.js · MISSING = לא קיים ויש להוסיף · BRIDGE-ONLY = ה-word_bridge.js רק קורא ל-Python דרך pywebview (לא מבצע את הלוגיקה ב-JS).

## הערה כללית

`word_bridge.js` הוא **לקוח דק** שמייבא/מייצא דרך `window.pywebview.api` — כלומר כל הלוגיקה של `word_extractor.py` רצה בצד ה-Python, ו-JS רק מציג Modal לבחירת זרמים ושולח את הבחירה ל-API. לכן כמעט **כל היכולות** של `word_extractor.py` הן MISSING ב-JS — ה-JS רק קורא להן.

המטרה של ה-port הזה: לקבל יכולת עבודה ב-**דפדפן בלבד** (ללא pywebview / Python), עם מימוש מלא של חילוץ ה-DOCX ב-JavaScript.

---

## טבלה מלאה: כל פונקציה ב-word_extractor.py

| # | מזהה ב-Python | תיאור | סטטוס ב-word_bridge.js | יעד חדש |
|---|----|----|----|----|
| 1 | `WNS` const | namespace WordprocessingML | MISSING | engine.js |
| 2 | `SOURCE_FOOTNOTE` … `SOURCE_PARALLEL` consts | 7 קבועי סוגי מקור | חלקי (רק names למיפוי תצוגה ב-`sourceDisplayName`) | engine.js |
| 3 | `SOURCE_LABELS` dict | תוויות עם אמוג׳ים | MISSING | i18n.js |
| 4 | `POSITION_OPTIONS` / `POSITION_MAP` | מיפויי מיקום הערת-צד | MISSING | engine.js |
| 5 | `SIDENOTE_CMD_MAP` | פקודות LaTeX להערות צד | MISSING | engine.js |
| 6 | `series_letters` / `bracket_styles` / `num_style_map` | רשימות קונפיגורציה | MISSING | engine.js |
| 7 | `class CharToken` | טוקן עם b/i/u/sz/col/is_raw_latex | MISSING | engine.js |
| 8 | `class RichText` (init/append/extend/get_text/copy/to_latex) | מבנה טקסט עשיר עם המרה ל-LaTeX | MISSING | engine.js |
| 9 | `RichText.to_latex` כולל feature_gate ו-spchar | MISSING | engine.js |
| 10 | `rich_sub(pattern, repl_func, rich_text, flags)` כולל char_to_token_pos | MISSING | engine.js |
| 11 | `_extract_rich(element, ns_w)` — חילוץ Run-properties (b/bCs/i/iCs/u/szCs/sz/color), `<w:t>`, `<w:br>` | MISSING | engine.js |
| 12 | `_plain(element, ns_w)` | MISSING | engine.js |
| 13 | `_read_notes_xml(file_path, xml_file, note_tag)` | MISSING | engine.js |
| 14 | `read_footnotes` | BRIDGE-ONLY (רץ ב-Python) | engine.js |
| 15 | `read_endnotes` | BRIDGE-ONLY | engine.js |
| 16 | `read_comments` | BRIDGE-ONLY | engine.js |
| 17 | `find_all_note_sources(file_path)` — סריקת מסמך, זיהוי `@\d+`, מיפוי inline | BRIDGE-ONLY | engine.js |
| 18 | `load_external_notes(ext_file, ext_marker)` | MISSING | engine.js |
| 19 | `find_all_styles_in_docx(file_path)` | MISSING | engine.js |
| 20 | `find_all_styles_full(file_path)` | MISSING | engine.js |
| 21 | `find_sections_in_docx(file_path)` | MISSING | engine.js |
| 22 | `extract_headers_footers(file_path)` | MISSING | engine.js |
| 23 | `extract_doc_titles(file_path)` | MISSING | engine.js |
| 24 | `extract_parallel_paragraphs(file_path)` | MISSING | engine.js |
| 25 | `_balance_braces(s)` | MISSING | engine.js |
| 26 | `_clean_latex(s)` | MISSING | engine.js |
| 27 | `collect_stream_as_paragraphs(source_file, source_type, marker)` | MISSING | engine.js |
| 28 | `_extract_opening_segment(content, target, count)` — מילה-פותחת LaTeX-aware | MISSING | engine.js |
| 29 | `_mk_fn(series, content, opw, fli, layout)` | MISSING | engine.js |
| 30 | `_is_orphan_note(content)` | MISSING | engine.js |
| 31 | `_mk_sidenote(position, font_cmd, content)` | MISSING | engine.js |
| 32 | `_note_to_latex(note_rich, sid, sd)` | MISSING | engine.js |
| 33 | `extract_and_process(source_file, sd, ext_map=None)` — ליבת התרגום | BRIDGE-ONLY | engine.js |
| 34 | `_proc_ref` (פנימי) — thin space + nolinebreak לפני סמן הערה | MISSING | engine.js |
| 35 | `_proc_inline(match, rich_text, sid, sd)` | MISSING | engine.js |
| 36 | זיהוי כותרות לפי `pStyle` (Heading1.../Title/Subtitle) → `\opwhdg{style}{level}{...}` | MISSING | engine.js |
| 37 | יישור פסקה לפי `<w:jc>` (center/right/left) | MISSING | engine.js |
| 38 | first_note_as_title — צריכת ההערה הראשונה לכותרת זרם | MISSING | engine.js |
| 39 | מיפוי בלוקי-סוגריים `[ ]` `{ }` `( )` `< >` סביב `@NN` | MISSING | engine.js |
| 40 | תבנית מותאמת (`SOURCE_CUSTOM`) — חיפוש `cp` בטקסט | MISSING | engine.js |
| 41 | מסמך חיצוני (`SOURCE_EXTERNAL`) — מיפוי `@tm` → ext_notes | MISSING | engine.js |
| 42 | `count_notes_per_stream(source_file, sd)` | MISSING | engine.js |
| 43 | `_extract_rich_with_html` — תמיכה בתגי HTML (b/strong/i/em/u/font/span/br) בתוך תוכן | MISSING | engine.js |
| 44 | תקרת אורך תג HTML (`HTML_TAG_MAX_LEN = 40`) | MISSING | engine.js |
| 45 | סוג סינון `font color=...` / `span style=...font-size:Npt` | MISSING | engine.js |
| 46 | קאש ביצועים `FastET.fromstring` | לא רלוונטי ל-JS (DOMParser) | — |
| 47 | קאש ביצועים `FastRe.findall` | לא רלוונטי ל-JS | — |
| 48 | קאש ביצועים `FastZipFile` | לא רלוונטי ל-JS | — |
| 49 | feature_gate (העתקת גדלי פונט / צבעי טקסט / סגנון נפרד / תמיכה בתגי HTML) | MISSING | engine.js (כברירת מחדל-On, חשוף כ-options) |
| 50 | XXE protection (defusedxml) | DOMParser בדפדפן בטוח כברירת מחדל | — |

### יכולות UI שצריכות להופיע מחדש ב-word_extractor.js

| # | יכולת | קיים ב-word_bridge.js | יעד |
|---|----|----|----|
| 51 | בחירת קובץ DOCX (`<input type=file>`) | חלקי — דרך bridge בלבד | dialog.js (web FileReader) |
| 52 | זיהוי-אוטומטי של כל הזרמים והסמנים | רק תצוגה של תוצאה מ-Python | dialog.js |
| 53 | תצוגה מקדימה (preview) של ההערות לפני אישור המיפוי | MISSING | dialog.js |
| 54 | מיפוי ידני: למשל "footnote @01 → זרם A" | MISSING | dialog.js + streams.js |
| 55 | מיפוי A/B/C/D עבור footnotes/endnotes/comments/sidenotes | MISSING (משתמש מקבל סדר אוטומטי) | streams.js |
| 56 | סימוני-ברירת-מחדל `@01..@99` | PRESENT (`DEFAULT_MARKERS`) | dialog.js |
| 57 | RTL בכל תיבות הדיאלוג | PRESENT | dialog.js |
| 58 | כל המחרוזות בעברית ובאנגלית | חלקי | i18n.js |

### יכולות `word_bridge.js` שמושמרות ולא נוגעים בהן

- `setupWordBridge` / `setupWordSyncHub` / `pollSyncHub` — תקשורת עם pywebview (Win-app)
- `loadWordContent` / `inlineNodeHtml` / `getRichHtml` / `mainWordHtml`
- `notePartsFromPane` / `exportWord` / `confirmWordImport`
- `closeWordImportModal` / `openImportModal` / `renderImportStreams`

הם נשארים פעילים — כשמערכת רצה תחת PyWebView, ה-bridge הקיים פועל. הכלי החדש (`word_extractor.js`) מתווסף **לצד** ה-bridge וניתן להריצו בדפדפן בלבד.

---

## מיפוי זרמים — A/B/C/D לפי סוג הערה

לפי כלל הזיכרון: **"Each note type is its own stream"** — כל סוג הערה הוא זרם נפרד.

מהקוד של Python (`extract_and_process`, שורות 886-922):

| sd[sid].source_type | מטופל ב | mapping dict |
|----|----|----|
| `SOURCE_FOOTNOTE` | footnotes.xml | `fn_m2s` (marker→sid) + `fn_none` (חסר סמן) |
| `SOURCE_ENDNOTE` | endnotes.xml | `en_m2s` + `en_none` |
| `SOURCE_COMMENT` | comments.xml | `cm_m2s` + `cm_none` |
| `SOURCE_SIDENOTE` (base=footnote/endnote/comment) | base XML, פלט `\ledrightnote` | מתמזג ל-fn_m2s/en_m2s/cm_m2s לאחר מילוי הראשונים |
| `SOURCE_PARALLEL` (base=…) | זהה ל-SIDENOTE | זהה |
| `SOURCE_EXTERNAL` | מסמך נפרד | `ext_t2s` (target_marker→sid) |
| `SOURCE_CUSTOM` | חיפוש cp בגוף | `cust_m2s` (pattern→sid) |

ב-`series_letters = ['A','B','C','D','E','F','G','H','I','J','K','L']` — התווית של כל זרם תלויה ב-`sd[sid]['series']` שהמשתמש קובע.

ב-port החדש: ברירת-מחדל אוטומטית — footnote → A, endnote → B, comment → C, sidenote → D, ושאר זרמים מקבלים אותיות בסדר.

---

## checklist השלמה

- [x] קריאה מלאה של `word_extractor.py` (1411 שורות)
- [x] קריאה מלאה של `word_bridge.js` (458 שורות)
- [x] רשימת gap מלאה (50+ פריטים)
- [x] מימוש כל הפונקציות ב-engine.js
- [x] CharToken/RichText/rich_sub
- [x] _extract_rich + _extract_rich_with_html
- [x] read_footnotes / read_endnotes / read_comments
- [x] find_all_note_sources
- [x] extract_and_process כולל _proc_ref + _proc_inline
- [x] count_notes_per_stream
- [x] _extract_opening_segment + _mk_fn + _mk_sidenote
- [x] HTML run translation
- [x] dialog.js (preview + mapping confirmation)
- [x] streams.js (A/B/C/D mapping)
- [x] i18n.js (כל המחרוזות)
- [x] CSS (RTL)
- [x] חיווט ב-main.js כפעולה נוספת
- [x] smoke_test.mjs — 44 בדיקות יחידה (כולן עברו)
- [x] vite build עובר ללא שגיאות
- [x] JSZip dependency הוסף ל-package.json
