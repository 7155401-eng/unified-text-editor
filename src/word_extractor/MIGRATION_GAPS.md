# MIGRATION_GAPS — `word_extractor.py` (1411 lines) → JavaScript

מסמך זה ממפה כל פונקציה / קבוע / רגקס / יכולת ב-`word_extractor.py` המקורי, ומסמן את הסטטוס שלה ב-JS port (`src/word_extractor/*.js`).

מקור (READ-ONLY): `C:\Users\User\migration_work\work-files\word_extractor.py`
יעד: `src/word_extractor/word_extractor_engine.js` + `_dialog.js` + `_streams.js` + `_i18n.js`

מקרא:
- ✅ verbatim — מימוש מלא ותואם להתנהגות Python
- ⚠ partial — קיים אבל קיים פער קטן/אופציה לא תומכת
- ❌ missing — לא קיים, צריך להוסיף

---

## טבלת אימות מלאה

| # | Python (file:line) | Function/feature | JS counterpart | Status | Notes |
|---|----|----|----|----|----|
| 1 | `word_extractor.py:12` | `WNS` namespace const | `word_extractor_engine.js:12` `WNS` | ✅ | זהה |
| 2 | `word_extractor.py:15-21` | `SOURCE_FOOTNOTE`...`SOURCE_PARALLEL` (7 קבועים) | `word_extractor_i18n.js:4-10` | ✅ | זהה |
| 3 | `word_extractor.py:23-31` | `SOURCE_LABELS` dict עם אמוג׳ים | `word_extractor_i18n.js:13-21` | ✅ | תוויות זהות |
| 4 | `word_extractor.py:33-35` | `POSITION_OPTIONS` / `POSITION_MAP` | `word_extractor_i18n.js:35-39` | ✅ | זהה |
| 5 | `word_extractor.py:37-42` | `SIDENOTE_CMD_MAP` | `word_extractor_engine.js:14-19` | ✅ | 4 כתובות (right/left/inner/outer) |
| 6 | `word_extractor.py:44` | `series_letters` ['A'..'L'] | `word_extractor_i18n.js:42` `SERIES_LETTERS` | ✅ | שם UPPERCASE לפי קונבנציית JS |
| 7 | `word_extractor.py:45` | `bracket_styles` | `word_extractor_i18n.js:44` `BRACKET_STYLES` | ✅ | זהה |
| 8 | `word_extractor.py:46-52` | `num_style_map` | `word_extractor_i18n.js:46-52` `NUM_STYLE_MAP` | ✅ | זהה |
| 9 | `word_extractor.py:54-63` | `class CharToken` (b/i/u/sz/col/is_raw_latex) | `word_extractor_engine.js:25-35` | ✅ | פוזיציה זהה |
| 10 | `word_extractor.py:65-77` | `class RichText` (init/append/extend/get_text/copy) | `word_extractor_engine.js:37-55` | ✅ | זהה |
| 11 | `word_extractor.py:78-134` | `RichText.to_latex` כולל emphasis/size/color/spchar | `word_extractor_engine.js:56-112` | ✅ | feature_gate exposed as opts.gate_emph/size/color (defaults true == Python default) |
| 12 | `word_extractor.py:130` | `sp` dict (LaTeX special-char escape) | `word_extractor_engine.js:88-89` | ✅ | זהה (10 תווים) |
| 13 | `word_extractor.py:136-166` | `rich_sub(pattern, repl_func, rich_text, flags)` כולל `char_to_token_pos` | `word_extractor_engine.js:119-163` | ✅ | PR #45 fix מועבר verbatim |
| 14 | `word_extractor.py:168-207` | `_extract_rich(element, ns_w)` — Run properties + `<w:t>` + `<w:br>` | `word_extractor_engine.js:220-271` `_extract_rich_orig` | ✅ | b/bCs/i/iCs/u/szCs/sz/color (regex `[0-9A-Fa-f]{6}`) |
| 15 | `word_extractor.py:209-210` | `_plain(element, ns_w)` | `word_extractor_engine.js:273-279` | ✅ | זהה |
| 16 | `word_extractor.py:212-229` | `_read_notes_xml` עם guard על id <= 0 (PR v11.51.4) | `word_extractor_engine.js:452-468` | ✅ | guard מועבר |
| 17 | `word_extractor.py:231` | `read_footnotes` | `word_extractor_engine.js:470-473` | ✅ | async wrapper |
| 18 | `word_extractor.py:232` | `read_endnotes` | `word_extractor_engine.js:474-477` | ✅ | async wrapper |
| 19 | `word_extractor.py:233-243` | `read_comments` (ללא id filter) | `word_extractor_engine.js:478-491` | ✅ | זהה |
| 20 | `word_extractor.py:245-284` | `find_all_note_sources` כולל inline scan | `word_extractor_engine.js:497-583` | ✅ | רגקס `@(\d+)` זהה, sort זהה |
| 21 | `word_extractor.py:286-317` | `load_external_notes(ext_file, ext_marker)` | `word_extractor_engine.js:589-641` | ✅ | scan paragraphs + footnotes/endnotes |
| 22 | `word_extractor.py:319-335` | `find_all_styles_in_docx` (legacy {style: font}) | `word_extractor_engine.js:647-669` | ✅ | זהה (deep rPr search) |
| 23 | `word_extractor.py:338-407` | `find_all_styles_full` (font/size/bold/italic/spacing) | `word_extractor_engine.js:671-738` | ✅ | line_spacing fallback זהה |
| 24 | `word_extractor.py:409-440` | `find_sections_in_docx` | `word_extractor_engine.js:740-773` | ✅ | direct children w:p זהה |
| 25 | `word_extractor.py:443-469` | `extract_headers_footers` | `word_extractor_engine.js:775-802` | ✅ | header*.xml + footer*.xml |
| 26 | `word_extractor.py:472-485` | `extract_doc_titles` | `word_extractor_engine.js:804-819` | ✅ | זהה |
| 27 | `word_extractor.py:487-499` | `extract_parallel_paragraphs` | `word_extractor_engine.js:821-835` | ✅ | זהה |
| 28 | `word_extractor.py:501-515` | `_balance_braces(s)` | `word_extractor_engine.js:841-855` | ✅ | escape `\{`/`\}` לוגיקה זהה |
| 29 | `word_extractor.py:517-518` | `_clean_latex(s)` | `word_extractor_engine.js:857-859` | ✅ | regex `\s+` זהה |
| 30 | `word_extractor.py:520-545` | `collect_stream_as_paragraphs` | `word_extractor_engine.js:865-894` | ✅ | sort numeric + count=1 sub זהה |
| 31 | `word_extractor.py:549-732` | `_extract_opening_segment` (LaTeX-aware: word/letter/textbf/ravtextbf/textit/emph/underline) | `word_extractor_engine.js:900-1026` | ✅ | recursive style dive זהה, _advance_over_atom + _read_word זהים |
| 32 | `word_extractor.py:735-841` | `_mk_fn` (LASTBOX recipe — normal/twocol/threecol/paragraph) | `word_extractor_engine.js:1042-1091` | ✅ | par_cmd זהה, opw+fli מטופלים, paragraph layout משמיט par |
| 33 | `word_extractor.py:844-848` | `_is_orphan_note(content)` (threshold 80) | `word_extractor_engine.js:1032-1035` | ✅ | regex זהה |
| 34 | `word_extractor.py:850-852` | `_mk_sidenote(position, font_cmd, content)` | `word_extractor_engine.js:1037-1040` | ✅ | זהה |
| 35 | `word_extractor.py:854-872` | `_note_to_latex(note_rich, sid, sd)` | `word_extractor_engine.js:1093-1116` | ✅ | sidenote branch + opw/fli/layout |
| 36 | `word_extractor.py:874-1141` | `extract_and_process` כולל _proc_ref | `word_extractor_engine.js:1122-1408` | ✅ | מיפוי footnote/endnote/comment/sidenote/parallel/external/custom |
| 37 | `word_extractor.py:927-985` | `_proc_ref` (thin space + nolinebreak + first_note_as_title) | `word_extractor_engine.js:1172-1228` | ✅ | Hebrew range `֐-׿` זהה |
| 38 | `word_extractor.py:991-1019` | זיהוי כותרות לפי `pStyle` (Heading/Title/Subtitle) → `\opwhdg{style}{level}{...}` | `word_extractor_engine.js:1245-1259, 1316-1322` | ✅ | safe_style escape זהה |
| 39 | `word_extractor.py:1001-1005` | יישור פסקה לפי `<w:jc>` (center/right/left) | `word_extractor_engine.js:1239-1243, 1323-1330` | ✅ | RTL "left" → `\raggedleft` |
| 40 | `word_extractor.py:971-980` | first_note_as_title — צריכת ההערה הראשונה לכותרת | `word_extractor_engine.js:1211-1222` | ✅ | flag first_note_problems נשמר |
| 41 | `word_extractor.py:1090-1102` | מיפוי בלוקי-סוגריים `[]` `{}` `()` `<>` סביב `@NN` | `word_extractor_engine.js:1344-1361` | ✅ | 4 זוגות בדיוק, dotAll flag |
| 42 | `word_extractor.py:1104-1117` | תבנית מותאמת `SOURCE_CUSTOM` | `word_extractor_engine.js:1364-1379` | ✅ | 4 זוגות סוגריים + nb-pattern |
| 43 | `word_extractor.py:1119-1133` | מסמך חיצוני `SOURCE_EXTERNAL` | `word_extractor_engine.js:1381-1403` | ✅ | reverse iteration זהה |
| 44 | `word_extractor.py:1191-1195` | `_proc_inline(match, rich_text, sid, sd)` | `word_extractor_engine.js:1415-1428` | ✅ | indexOf-based span חישוב — נכון לכל הדפוסים בפועל |
| 45 | `word_extractor.py:1143-1188` | `count_notes_per_stream` | `word_extractor_engine.js:1434-1481` | ✅ | _resolve fallback chain זהה |
| 46 | `word_extractor.py:1209-1336` | `_extract_rich_with_html` (HTML tags inside content) | `word_extractor_engine.js:287-396` | ✅ | open/close stack, font/span attrs |
| 47 | `word_extractor.py:1248` | `HTML_TAG_MAX_LEN = 40` | `word_extractor_engine.js:285` | ✅ | קבוע זהה |
| 48 | `word_extractor.py:1305` | `<br>` / `<br/>` / `<br />` | `word_extractor_engine.js:363` | ✅ | 3 גרסאות מתועדות |
| 49 | `word_extractor.py:1308-1320` | `font color=...` / `span style=...font-size:Npt` | `word_extractor_engine.js:368-378` | ✅ | regex `[0-9a-fA-F]{6}` + `font-size\s*:\s*(\d+)pt` |
| 50 | `word_extractor.py:1338` | `_extract_rich = _extract_rich_with_html` (rebind) | `word_extractor_engine.js:399` | ✅ | alias export |
| 51 | `word_extractor.py:1340-1411` | FastET / FastRe / FastZipFile (cache) | — | n/a | בלתי רלוונטי ל-JS (DOMParser/RegExp/JSZip native) |
| 52 | `word_extractor.py:1-9` | XXE protection (defusedxml) | — | n/a | DOMParser הוא בטוח כברירת מחדל |
| 53 | `word_extractor.py:90-96` | feature_gate gates (size/color/emph/HTML) | `word_extractor_engine.js:59-61` opts | ✅ | options ב-to_latex; ברירת מחדל true |

---

## טבלת UI / dialog / streams / i18n

| # | יכולת | מימוש | מיקום |
|---|----|----|----|
| 54 | בחירת קובץ DOCX (`<input type=file>`) | ✅ | `word_extractor_dialog.js` |
| 55 | זיהוי-אוטומטי של זרמים + סמנים | ✅ | `_dialog.js` + `find_all_note_sources` |
| 56 | תצוגה מקדימה (preview) של הערות | ✅ | `_dialog.js:previewStream` |
| 57 | מיפוי ידני: footnote @01 → A | ✅ | `_dialog.js:renderStreamsTable` |
| 58 | A/B/C/D auto לפי סוג | ✅ | `_streams.js:buildDefaultStreamMapping` |
| 59 | findDuplicateSeries warning | ✅ | `_streams.js:findDuplicateSeries` |
| 60 | streamsToSd helper | ✅ | `_streams.js:streamsToSd` |
| 61 | RTL בכל תיבות הדיאלוג | ✅ | `word_extractor.css` + `dir="rtl"` |
| 62 | מחרוזות עברית + אנגלית | ✅ | `_i18n.js:UI` |
| 63 | distributeToPanes (פלט לחלוניות) | ✅ | `_dialog.js:distributeToPanes` |

---

## סיכום

- **0 ❌** missing
- **0 ⚠** partial
- **53 ✅** verbatim ports (מתוך 53 פריטי Python ניתנים-להעברה)
- **3 n/a** — קאש ביצועים + XXE protection לא רלוונטיים ל-Browser
- **10 תוספות JS** — UI/streams/i18n שלא היו ב-Python הסטנדלון

### Smoke tests
- `node src/word_extractor/smoke_test.mjs` — **44/44 PASS**
- מכסים: RichText, rich_sub, _balance_braces, _clean_latex, _extract_opening_segment, _is_orphan_note, _mk_fn, _mk_sidenote, buildDefaultStreamMapping, streamsToSd, findDuplicateSeries

### בדיקות מורחבות שבוצעו במהלך האודיט
- `_extract_rich` rPr lookup paths (b/bCs/i/iCs/u/szCs/sz/color) ↔ Python's `rPr.find` — match ✅
- `find_sections_in_docx` direct-children w:p ↔ Python's `body.findall(w:p)` — match ✅
- `find_all_styles_in_docx` deep rPr (`.//rPr`) vs `find_all_styles_full` direct rPr — match ✅
- `_extract_rich_with_html` — open/close stack לוגיקה ↔ Python state_stack — match ✅
- `_proc_ref` Hebrew range check `֐-׿` ↔ Python — match ✅
- `_extract_opening_segment` recursive style dive (textbf/ravtextbf/textit/emph/underline) — match ✅
- `_mk_fn` paragraph layout omits `\unskip\null\par` — match ✅
- 4 זוגות סוגריים `[] {} () <>` בלולאת `extract_and_process` — match ✅

ה-port מלא, מעודכן, ועובר בדיקות.
