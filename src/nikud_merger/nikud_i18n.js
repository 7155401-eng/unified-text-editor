// nikud_i18n.js
// =============
// תרגום מלא של ui/i18n.py — מערכת תרגומים לממשק (עברית/אנגלית).
// כל מחרוזת verbatim, כפי שמופיעה בקוד ה-Python המקורי.

export const TRANSLATIONS = {
  // ---------- כותרות ----------
  app_title:           { he: "מיזוג ניקוד",                         en: "Nikud Merger" },
  app_subtitle:        { he: "Nikud Merger Pro  •  Torah Typesetter Pro",
                         en: "Nikud Merger Pro  •  Torah Typesetter Pro" },

  // ---------- סרגל כלים ראשי ----------
  new_project:         { he: "📁  פרויקט חדש",                       en: "📁  New" },
  open_project:        { he: "📂  פתח...",                            en: "📂  Open..." },
  save_project:        { he: "💾  שמור",                              en: "💾  Save" },
  save_as:             { he: "💾  שמור בשם...",                       en: "💾  Save As..." },
  untitled_project:    { he: "◆  פרויקט ללא שם",                       en: "◆  Untitled" },
  lang_toggle:         { he: "🌐  English",                            en: "🌐  עברית" },

  // ---------- ניהול חלונות ----------
  add_window:          { he: "➕  הוסף חלון חדש",                       en: "➕  Add Window" },
  remove_window:       { he: "✕  מחק חלון נוכחי",                      en: "✕  Remove Current" },
  window_count_one:    { he: "◆  חלון אחד פתוח",                       en: "◆  1 window" },
  window_count_many:   { he: "◆  {n} חלונות פתוחים",                    en: "◆  {n} windows" },

  // ---------- כפתורי מצבים בטאב ----------
  filter_settings:     { he: "⚙  הגדרות סינון",                        en: "⚙  Filter Settings" },
  close_filters:       { he: "✕  סגור סינון",                          en: "✕  Close Filters" },
  multi_sources:       { he: "☰  מקורות מרובים",                       en: "☰  Multi Sources" },
  single_source:       { he: "◎  מקור יחיד",                            en: "◎  Single Source" },
  check_quality:       { he: "✓  בדוק איכות ניקוד",                     en: "✓  Check Nikud Quality" },

  // ---------- תוויות תיבות ----------
  clean_label:         { he: "  ✎  טקסט מוגה (הקובע)",                  en: "  ✎  Clean Text (master)" },
  voc_label:           { he: "  ☆  מקור מנוקד",                        en: "  ☆  Vocalized Source" },
  result_label:        { he: "  ⚘  תוצאת המיזוג",                       en: "  ⚘  Merge Result" },
  master_label:        { he: "  📜  טקסט מוכן (איסוף מכל החלונות)",
                         en: "  📜  Master Text (collected from all windows)" },

  // ---------- כפתורי פעולה ----------
  merge:               { he: "⚙  בצע מיזוג",                            en: "⚙  Merge" },
  merge_from_cursor:   { he: "▶  מיזוג מהסמן",                          en: "▶  Merge from Cursor" },
  stop:                { he: "⏹  עצור",                                 en: "⏹  Stop" },

  accept_all:          { he: "✓  קבל הכל",                              en: "✓  Accept All" },
  reject_all:          { he: "✗  דחה הכל",                              en: "✗  Reject All" },
  accept_spelling:     { he: "✎  רק שינויי כתיב",                       en: "✎  Spelling Only" },
  toggle_hide:         { he: "👁  הסתר/הצג כתיב",                       en: "👁  Hide/Show Spelling" },
  accept_selected:     { he: "✓  קבל מסומן",                            en: "✓  Accept Selected" },
  reject_selected:     { he: "✗  דחה מסומן",                            en: "✗  Reject Selected" },
  copy_all:            { he: "⎘  העתק הכל",                             en: "⎘  Copy All" },
  to_master:           { he: "⬆  לטקסט מוכן",                           en: "⬆  To Master" },

  // ---------- ייצוא ----------
  export_word:         { he: "📄  Word",                                 en: "📄  Word" },
  export_html:         { he: "🌐  HTML",                                 en: "🌐  HTML" },
  export_txt:          { he: "📝  טקסט",                                 en: "📝  Text" },
  export_label:        { he: "ייצוא:",                                   en: "Export:" },

  // ---------- טקסט מוכן ----------
  master_copy:         { he: "📋  העתק הכל",                             en: "📋  Copy All" },
  master_save:         { he: "💾  שמור",                                 en: "💾  Save" },
  master_clear:        { he: "✕  נקה",                                   en: "✕  Clear" },

  // ---------- ניווט ----------
  nav_first:           { he: "לשינוי הראשון",                            en: "First change" },
  nav_prev:            { he: "שינוי קודם (Shift+F3)",                    en: "Prev change (Shift+F3)" },
  nav_next:            { he: "שינוי הבא (F3)",                           en: "Next change (F3)" },
  nav_last:            { he: "לשינוי האחרון",                            en: "Last change" },
  nav_search:          { he: "חיפוש (Ctrl+F)",                           en: "Search (Ctrl+F)" },

  // ---------- סטטוס וההודעות ----------
  waiting:             { he: "◆  ממתין להפעלה",                          en: "◆  Waiting" },
  processing:          { he: "◆  מעבד...",                               en: "◆  Processing..." },
  stopping:            { he: "◆  עוצר...",                               en: "◆  Stopping..." },
  stopped_partial:     { he: "◆  נעצר — הותאמו {n} מילים",
                         en: "◆  Stopped — {n} words matched" },
  done:                { he: "◆  הותאמו {m}/{t} ({p}%)  |  במנוקד: {v}",
                         en: "◆  Matched {m}/{t} ({p}%)  |  vocalized: {v}" },
  filter_summary:      { he: "◆  מתעלם מ-{n} סוגי תווים",                en: "◆  Ignoring {n} char types" },
  sources_count_one:   { he: "◆  מקור אחד",                              en: "◆  1 source" },
  sources_count_many:  { he: "◆  {n} מקורות",                            en: "◆  {n} sources" },

  // ---------- הודעות ----------
  empty_field_title:   { he: "שדה ריק",                                  en: "Empty field" },
  empty_clean:         { he: "טקסט המוגה חסר.",                          en: "Clean text is missing." },
  empty_voc:           { he: "המקור המנוקד חסר.",                        en: "Vocalized source is missing." },
  cursor_at_end:       { he: "סמן בסוף",                                 en: "Cursor at end" },
  cursor_msg:          { he: "הסמן בסוף הטקסט — אין מה למזג.",
                         en: "Cursor is at end — nothing to merge." },
  error:               { he: "שגיאה",                                    en: "Error" },
  saved:               { he: "נשמר",                                     en: "Saved" },
  loaded:              { he: "נטען",                                     en: "Loaded" },
  copied:              { he: "הועתק",                                    en: "Copied" },
  copied_msg:          { he: "הטקסט הועתק ללוח.",                        en: "Text copied to clipboard." },

  // ---------- פאנל סינון ----------
  filter_title:        { he: "⚙  הגדרות סינון — אילו תווים להתעלם בהשוואה",
                         en: "⚙  Filter Settings — which characters to ignore" },
  preset_loose:        { he: "📖 גמיש (ברירת מחדל)",                     en: "📖 Loose (default)" },
  preset_midrash:      { he: "📚 מדרש",                                  en: "📚 Midrash" },
  preset_strict:       { he: "🎯 קפדני",                                 en: "🎯 Strict" },

  section_nikud:       { he: "✎  ניקוד וטעמים",                          en: "✎  Nikud & Taamim" },
  section_punct:       { he: "⊙  פיסוק",                                 en: "⊙  Punctuation" },
  section_quotes:      { he: "❞  גרשיים וגרש",                           en: "❞  Quotes & Geresh" },
  section_brackets:    { he: "◐  סוגריים",                               en: "◐  Brackets" },
  section_special:     { he: "※  תווים מיוחדים",                         en: "※  Special chars" },
  section_spaces:      { he: "↔  רווחים ושורות",                         en: "↔  Spaces & lines" },
  section_advanced:    { he: "✦  גמישות מתקדמת",                         en: "✦  Advanced" },

  f_ignore_nikud:      { he: "התעלם מניקוד",                              en: "Ignore nikud" },
  f_ignore_taamim:     { he: "התעלם מטעמי מקרא",                          en: "Ignore taamim" },
  f_periods:           { he: "נקודה  .  ",                                 en: "Period  .  " },
  f_commas:            { he: "פסיק  ,  ",                                  en: "Comma  ,  " },
  f_colons:            { he: "נקודתיים  :  ",                              en: "Colons  :  " },
  f_semicolons:        { he: "נקודה-פסיק  ;  ",                            en: "Semicolon  ;  " },
  f_dashes:            { he: "מקפים  –  —  -  ",                           en: "Dashes  –  —  -  " },
  f_qmarks:            { he: "סימני שאלה/קריאה  ?  !  ",                    en: "? ! " },
  f_quotes:            { he: 'גרשיים לועזיים  "  \'  ',                    en: 'Quotes  "  \'  ' },
  f_heb_quotes:        { he: "גרשיים עבריים  ׳  ״  ",                      en: "Heb. quotes  ׳  ״  " },
  f_maqaf:             { he: "מקף עברי  ־  ",                              en: "Heb. maqaf  ־  " },
  f_round:             { he: "עגולים  (  )  ",                             en: "Round  (  )  " },
  f_square:            { he: "מרובעים  [  ]  ",                            en: "Square  [  ]  " },
  f_curly:             { he: "מסולסלים  {  }  ",                           en: "Curly  {  }  " },
  f_angle:             { he: "זוויתיים  <  >  ",                           en: "Angle  <  >  " },
  f_digits:            { he: "ספרות  0-9  ",                               en: "Digits  0-9  " },
  f_latin:             { he: "אותיות לועזיות  A-Z  ",                      en: "Latin letters  A-Z  " },
  f_at_markers:        { he: "סימני @  (@06, @16...)",                     en: "@ markers  (@06...)" },
  f_asterisks:         { he: "כוכביות  *  ",                               en: "Asterisks  *  " },
  f_hashes:            { he: "סולמית  #  ",                                en: "Hashes  #  " },
  f_extra_spaces:      { he: "רווחים כפולים/משולשים",                       en: "Multiple spaces" },
  f_line_breaks:       { he: "ירידות שורה",                                en: "Line breaks" },
  f_flex_ktiv:         { he: "גמישות כתיב חסר/מלא",                         en: "Flexible spelling (ו/י)" },
  f_case:              { he: "A=a  (אותיות לועזיות)",                      en: "A=a (case-insensitive)" },

  // ---------- מקורות ----------
  add_source:          { he: "➕  הוסף מקור",                              en: "➕  Add Source" },
  remove_source:       { he: "✕  הסר אחרון",                               en: "✕  Remove Last" },
  source_label:        { he: "  ☆  מקור מנוקד - {name}",                   en: "  ☆  Source - {name}" },
  source_name:         { he: "מקור {n}",                                   en: "Source {n}" },

  // ---------- כלי תיבה ----------
  tb_load_file:        { he: "טען קובץ טקסט",                              en: "Load file" },
  tb_undo:             { he: "בטל (Ctrl+Z)",                               en: "Undo (Ctrl+Z)" },
  tb_redo:             { he: "חזור (Ctrl+Y)",                              en: "Redo (Ctrl+Y)" },
  tb_copy:             { he: "העתק הכל",                                   en: "Copy all" },
  tb_clear:            { he: "נקה תיבה",                                   en: "Clear" },
  tb_rtl:              { he: "עב | RTL",                                    en: "עב | RTL" },
  tb_ltr:              { he: "En | LTR",                                    en: "En | LTR" },

  // ---------- תפריט קליק-ימני ----------
  menu_cut:            { he: "גזור",                                       en: "Cut" },
  menu_copy:           { he: "העתק",                                       en: "Copy" },
  menu_paste:          { he: "הדבק",                                       en: "Paste" },
  menu_select_all:     { he: "סמן הכל",                                    en: "Select All" },
  menu_undo:           { he: "בטל פעולה (Ctrl+Z)",                        en: "Undo (Ctrl+Z)" },
  menu_redo:           { he: "חזור על פעולה (Ctrl+Y)",                    en: "Redo (Ctrl+Y)" },

  // ---------- חיפוש ----------
  search_title:        { he: "🔍  חיפוש והחלפה",                           en: "🔍  Find & Replace" },
  search_placeholder:  { he: "מה לחפש...",                                 en: "Find what..." },
  replace_placeholder: { he: "החלף ב-...",                                 en: "Replace with..." },
  find_next:           { he: "חפש הבא",                                    en: "Find next" },
  replace_one:         { he: "החלף",                                       en: "Replace" },
  replace_all:         { he: "🔄  החלף הכל",                               en: "🔄  Replace all" },
  highlight_all:       { he: "💡  סמן הכל",                                en: "💡  Highlight all" },
  clear_highlights:    { he: "נקה הדגשות",                                 en: "Clear highlights" },
  case_sensitive:      { he: "רגיש לרישיות",                              en: "Case sensitive" },
  whole_word:          { he: "מילה שלמה בלבד",                             en: "Whole word only" },
  search_not_found:    { he: "◆  לא נמצא",                                 en: "◆  Not found" },
  search_found_at:     { he: "◆  נמצא ב-{pos}",                            en: "◆  Found at {pos}" },
  search_wrapped:      { he: "◆  נמשך מהתחלה",                             en: "◆  Wrapped from start" },
  search_replaced_n:   { he: "◆  הוחלפו {n}",                              en: "◆  Replaced {n}" },
  search_highlighted_n:{ he: "◆  סומנו {n} מופעים",                        en: "◆  Highlighted {n}" },
};


// ═══════════════════════════════════════════════════════════════════════════
//  מצב הגלובלי
// ═══════════════════════════════════════════════════════════════════════════

function readGlobalLangPref() {
  // v11.63 — initial language follows the shared RavText preference.
  // ב-JS (Web): עוקבים אחרי localStorage מקביל ל-RavText/lang.txt
  try {
    const v = (localStorage.getItem("ravtext.lang") || "").trim().toLowerCase();
    return v === "en" ? "en" : "he";
  } catch (_) {
    return "he";
  }
}

let _currentLang = readGlobalLangPref();
const _listeners = [];

export function t(key, kwargs) {
  const entry = TRANSLATIONS[key] || {};
  let text = entry[_currentLang] || entry.he || key;
  if (kwargs) {
    try {
      text = text.replace(/\{(\w+)\}/g, (m, k) => (kwargs[k] !== undefined ? String(kwargs[k]) : m));
    } catch (_) { /* keep */ }
  }
  return text;
}

export function setLanguage(lang) {
  if (lang !== "he" && lang !== "en") return;
  if (lang === _currentLang) return;
  _currentLang = lang;
  try { localStorage.setItem("ravtext.lang", lang); } catch (_) {}
  for (const cb of _listeners.slice()) {
    try { cb(); } catch (_) { /* ignore */ }
  }
}

export function currentLanguage() { return _currentLang; }

export function isRtl() { return _currentLang === "he"; }

export function registerListener(callback) {
  if (!_listeners.includes(callback)) _listeners.push(callback);
}

export function unregisterListener(callback) {
  const i = _listeners.indexOf(callback);
  if (i >= 0) _listeners.splice(i, 1);
}
