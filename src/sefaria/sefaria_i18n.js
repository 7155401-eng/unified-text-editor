// sefaria_i18n.js — every Sefaria string in he+en (verbatim port from
// sefaria_downloader_ui.py + sefaria_live_tool.py).
// Reads %APPDATA%/RavText/lang.txt analog from localStorage("ravtext.lang").

const STRINGS = {
  he: {
    // Downloader window chrome
    downloader_title: "📖 טעינת ספר מספריא — רב טקסט לוורד AI",
    btn_close: "✕",
    btn_lang_to_en: "🌐 English",
    btn_lang_to_he: "🌐 עברית",
    title_main: "📖 טעינת ספר מספריא",
    placeholder_search_book: "חיפוש ספר…",
    btn_today: "🗓 היום",
    btn_presets: "📋 תבניות",
    btn_refresh_api: "🔄 רענן API",
    btn_log: "📜 לוג",
    netfree_warn_downloader:
      "⚠ שים לב: טעינת ספר מספריא לא עובדת ב-Netfree (ספריא חסומה שם). " +
      "אם אתה גולש ב-Netfree — הטעינה תיכשל.",
    hint_action_row:
      "◀ פעולה ראשית — טען את הספר ישירות לרב טקסט   |   או שמור Word בלבד לעריכה ידנית ▶",
    btn_export_load: "📚 הוסף לרב טקסט (ייצא וטען)",
    btn_export_only: "💾 ייצא Word בלבד",
    btn_cancel: "⏹ עצור",
    status_ready: "מוכן",
    status_loading_index: "טוען אינדקס מספריא…",
    status_index_failed: "❌ נכשלה טעינת אינדקס — בדוק חיבור אינטרנט",

    // Tree pane
    tree_title: "📚 בחירת ספר",
    tree_fav_title: "⭐ מועדפים (קליק ימני להוספה)",
    tree_fav_empty: "(ריק — קליק ימני בעץ)",
    tree_recent_title: "🕒 נטענו לאחרונה",
    tree_recent_empty: "(ריק)",
    cat_tanakh: "📁 תנ\"ך",
    cat_bavli: "📁 תלמוד בבלי",
    cat_yerushalmi: "📁 תלמוד ירושלמי",
    cat_shulchan: "📁 שולחן ערוך",

    // Range/preview pane
    range_title: "📍 טווח טקסט",
    range_pick_book: "בחר ספר מהעץ",
    range_manual_label: "או הזן ידנית (ביטול בחירות לעיל):",
    range_manual_placeholder: "למשל: 1 או 1:1-23 או 2a או 5:3",
    btn_refresh_commentators: "🔍 רענן רשימת מפרשים",
    preview_title: "👁 תצוגה מקדימה",
    preview_loading: "טוען תצוגה מקדימה…",
    preview_invalid: "(לא ניתן לטעון תצוגה מקדימה — האם הטווח תקין?)",
    preview_empty: "(אין טקסט)",
    commentators_title: "📜 פרשנים (סדר הופעה)",
    btn_select_all: "✓ סמן הכל",
    btn_clear_all: "✕ הסר הכל",
    commentators_empty: "בחר ספר וטווח כדי לראות מפרשים",
    commentators_loading: "טוען רשימת פרשנים…",
    commentators_none: "לא נמצאו פרשנים לטווח הנוכחי",

    // Settings pane
    settings_title: "⚙ הגדרות יצוא",
    settings_vowels: "כולל ניקוד",
    settings_cantillation: "כולל טעמים",
    settings_version: "גרסה:",
    btn_save_preset: "💾 שמור כתבנית",
    summary_title: "📊 סיכום",
    summary_book_none: "לא נבחר",
    summary_template: "ספר: {book}\nטווח: {rng}\nמפרשים נבחרים: {sel} / {total}",
    summary_simple: "ספר: {book}\nטווח: {rng}\nמפרשים: {n}",
    settings_imports_dir_label: "📁 קבצים נשמרים אל:",
    btn_open_imports: "📂 פתח תיקייה",

    // Struct selectors
    struct_chapter: "פרק:",
    struct_verse: "פסוק:",
    struct_verse_ph: "(ריק=כל הפרק)",
    struct_daf: "דף:",
    struct_amud: "עמוד:",
    struct_amud_hint: "(a=א, b=ב)",
    struct_siman: "סימן:",
    struct_seif: "סעיף:",
    struct_seif_ph: "(ריק=כל הסימן)",

    // Today modal
    today_title: "📅 לימוד היום",
    today_pick: "📅 בחר מה לטעון:",
    btn_today_daf: "📜 דף היומי בבבלי",
    btn_today_parsha: "📖 פרשת השבוע",
    btn_cancel_short: "ביטול",
    today_no_daf: "לא ניתן לאתר את דף היום מספריא",
    today_no_parsha: "לא ניתן לאתר פרשת שבוע מספריא",
    today_loaded_daf: "📜 הוטען דף היומי: {ref}",
    today_loaded_parsha: "📖 הוטענה פרשת השבוע: {ref}",
    status_seek_daf: "מאתר דף יומי…",
    status_seek_parsha: "מאתר פרשת השבוע…",

    // Presets dialog
    presets_title: "📋 תבניות שמורות",
    presets_header: "📋 תבניות מובנות + שלי",
    btn_load_preset: "טען",
    btn_delete_preset: "🗑 מחק",
    btn_import_json: "📥 ייבא JSON",
    btn_export_json: "📤 ייצא JSON",
    btn_close_word: "סגור",
    preset_applied: "📋 תבנית '{name}' הוחלה",
    preset_delete_confirm: "למחוק את התבנית '{name}'?",
    preset_save_title: "💾 שמירת תבנית",
    preset_name_label: "שם התבנית:",
    preset_desc_label: "תיאור (אופציונלי):",
    preset_save_no_name: "הזן שם",
    preset_saved: "💾 תבנית '{name}' נשמרה",
    preset_save_failed: "שמירה נכשלה",
    preset_save_no_data: "אין מפרשים לשמור — בחר ספר וטווח קודם",
    preset_overwrite_builtin: "לא ניתן לדרוס תבנית מובנית — בחר שם אחר",
    preset_delete_builtin: "לא ניתן למחוק תבנית מובנית",
    preset_not_exists: "התבנית לא קיימת",
    preset_saved_short: "נשמר",
    preset_deleted: "נמחק",
    preset_write_failed: "כתיבה לקובץ נכשלה",

    // Import/export presets
    presets_imported: "יובאו {n} תבניות",
    presets_exported: "יוצאו {n} תבניות",
    presets_skipped: "דילוגים:",
    presets_format_invalid: "פורמט לא תקין — ציפינו ל-dict",
    presets_skip_builtin: "{name} (שם של תבנית מובנית)",
    presets_skip_exists: "{name} (כבר קיים)",
    presets_skip_read_err: "שגיאת קריאה: {err}",
    presets_import_done: "ייבוא הושלם",
    presets_export_done: "ייצוא",

    // Cache refresh
    cache_select_book: "בחר ספר תחילה",
    cache_refresh_msg: "נמחקו {n} קבצי cache. הורדה הבאה תהיה טרייה.",
    cache_refresh_title: "רענון cache",

    // Log viewer
    log_title: "📜 לוג ספריא",
    log_empty: "(הלוג ריק)",
    log_not_yet: "(הלוג עוד לא נוצר)",
    log_read_err: "שגיאה בקריאת לוג: {err}",
    btn_log_refresh: "רענן",
    btn_log_clear: "נקה לוג",

    // Confirm export modal
    confirm_title: "אישור ייצוא",
    confirm_template:
      "📖 ספר: {book}\n" +
      "📍 טווח: {rng}\n" +
      "📜 מפרשים: {n}\n" +
      "   {names}{more}\n\n" +
      "⏱ זמן משוער: {tmin}–{tmax} שניות\n\n" +
      "להמשיך?",
    confirm_btn_continue: "✓ המשך",
    confirm_btn_cancel: "✕ ביטול",
    confirm_more_template: " ועוד {n}",
    confirm_range_all: "(הכל)",

    // Errors
    err_no_book: "בחר ספר תחילה",
    err_no_range: "הזן טווח (פרק/דף/סימן)",
    err_export_in_progress: "תהליך ייצוא כבר פועל — סיים או בטל קודם",
    err_export_in_progress_title: "ייצוא בעיצומו",
    err_required_title: "חסר",
    err_text_load_fail: "טעינת הטקסט נכשלה",
    err_empty_text: "הטקסט ריק או בפורמט לא צפוי",
    err_export: "שגיאת ייצוא",
    err_export_done_template: "{err}\n\nהלוג נשמר ב-{path}",
    err_close_running: "ייצוא בעיצומו — לעצור ולסגור?",
    err_close_title: "סגירה",

    // Status messages
    status_loading_book_text: "מוריד טקסט: {ref}",
    status_collecting_segs: "אוסף פרשנים לכל segment...",
    status_loading_seg_links: "מוריד הערות ל-segment {i}/{n}...",
    status_building_docx: "בונה קובץ Word…",
    status_saved: "✅ נשמר: {path}",
    status_loaded_to_app: "✅ נטען בתוכנה הראשית — מוכן לקימפול",
    status_cancelled: "⏹ בוטל על ידי המשתמש",
    status_cancelling: "⏹ ביטול…",
    status_loading_commentators: "טוען מפרשים ל-{ref}…",
    status_loading_commentators_err: "❌ שגיאה בטעינת פרשנים: {err}",
    status_found_commentators: "נמצאו {n} פרשנים זמינים",
    status_fav_added: "⭐ נוסף למועדפים: {name}",
    status_fav_removed: "הוסר ממועדפים: {name}",

    // Export done dialog (no auto-load)
    export_done_title: "ייצוא הושלם",
    export_done_msg:
      "הקובץ נשמר ב:\n{path}\n\n" +
      "פתח אותו בוורד לעריכה, או בחר 'ייצא וטען' לטעינה ישירה לתוכנה.",

    // Hints for invalid refs
    hint_talmud: "לתלמוד צריך לציין דף+עמוד, למשל: {heb} 2a (דף ב' עמוד א')",
    hint_tanakh:
      "לתנ\"ך צריך מספר פרק (למשל 1) או פרק:פסוק (למשל 1:5)",
    invalid_template:
      "(לא ניתן לטעון תצוגה מקדימה — האם הטווח תקין?)\n\n💡 {hint}",

    // Live tool window
    live_title: "כלי משיכת פסוקים",
    netfree_warn_live:
      "⚠ שים לב: כלי משיכת פסוקים לא עובד ב-Netfree (ספריא חסומה שם). " +
      "אם אתה גולש ב-Netfree, המשיכה תיכשל.",
    t_actions: "פעולות",
    btn_start: "▶ התחל עיבוד",
    t_settings: "הגדרות עיבוד",
    l_dup: "כפילויות:",
    l_chap: "פרק שלם:",
    opt_first: "פסוק ראשון",
    opt_skip: "דלג",
    opt_all: "הכל",
    l_speed: "מהירות:",
    l_err: "הצג שגיאות",
    t_export: "ייצוא תוצאה",
    btn_word: "📥 Word",
    btn_txt: "📄 טקסט",
    btn_copy: "📋 העתק",
    t_theme: "עיצוב",
    t_input: "טקסט קלט",
    btn_books: "➕ הגדרות ספרים",
    t_res: "תוצאות העיבוד",
    stat_found: "📥 אותרו",
    stat_skip: "⛔ דולגו",
    stat_succ: "✅ הצלחה",
    stat_err: "❌ שגיאות",
    l_reasons: "סיבות סינון:",
    l_format: "פורמט:",
    l_book: "ספר:",
    l_context: "הקשר (שם):",
    l_dupes: "כפילויות:",
    l_tech: "שגיאות טכניות:",
    l_net: "רשת:",
    l_api: "API:",
    l_notfound: "לא נמצא:",
    t_processing: "מעבד:",
    vip_title: "גרסת פרימיום מלאה",
    vip_desc: "✨ גישה ללא הגבלה",
    ph_vip: "הדבק כאן את הטקסט המלא (ללא הגבלה)...",
    lock_title: "אזור מוגן: גישה מוגבלת",
    lock_desc: "הנך מוגבל ל-500 תווים",
    ph_lock: "הדבק כאן את הטקסט...",
    inst_title: "הוראות לפורמט כתיבה תקין (לחץ לפתיחה)",
    inst_1_s: "ציטוט מלא:",
    inst_1: " (בראשית א, א) או (בראשית א:א)",
    inst_2_s: "פרק ופסוק על בסיס קודם (\"שם\"):",
    inst_2: " (שם, יב) - יביא את פסוק י\"ב מאותו ספר ופרק קודם.",
    inst_3_s: "פסוק בלבד על בסיס קודם:",
    inst_3:
      " (שם יב) או (שם, יב) - אם הוזכר קודם פרק, יביא פסוק י\"ב מאותו פרק.",
    inst_4_s: "שינוי פרק באותו ספר:",
    inst_4: " (שם פרק יב פסוק א) או פשוט (שם, יב, א).",
    inst_5_s: "ספרים נתמכים:",
    inst_5:
      " תנ\"ך מלא (שמות תקניים ומקובלים). המערכת תומכת גם בקיצורים כמו דהי\"א, מ\"א וכו'.",
    speed_title: "ℹ️ הסבר על מהירות ויציבות:",
    speed_1:
      "מספר גבוה (למשל 20+) יביא לתוצאות מהירות יותר, אך עלול לגרום לקריסה או שגיאות בשרתים חלשים.",
    speed_2: "מספר נמוך (למשל 5) הוא איטי יותר אך יציב ובטוח בהרבה.",
    speed_3: "מומלץ: 6 עד 10 לרוב המשתמשים.",
    live_quota_msg:
      "⛔ הגעת למכסת השימוש לשבוע. הפעל רישיון או תוסף בחנות התוספים.",
    live_locked_msg:
      "⛔ שלחת יותר מידי בקשות. הנך נעול לשעה או רכוש גישה.",
    live_err_unknown_book: "(ספר לא זוהה)",
    live_err_dup: "(פסוק כפול - הוגדר במערכת)",
    live_err_format: "(פורמט לא תקין)",
    live_err_missing: "(שגיאה: {err} - {ref})",
    live_err_chap_end: "{book} מסתיים בפרק {chap}",
    live_err_chap_missing: "פרק {chap} אינו קיים",
    live_err_verse_not_found: "(פסוק לא נמצא - {ref})",
    live_err_network: "(שגיאת חיבור לשרת)",
    live_err_unknown: "(שגיאה לא ידועה)",
    live_err_input_required: "נא להזין טקסט",
    live_progress_template: "הושלמו {done} מתוך {total} בקשות.",
    live_progress_done: "הושלם בהצלחה!",
    live_progress_waiting: "ממתין לשליחה: {n}",
    live_save_word_ok: "הקובץ נשמר בהצלחה:\n{path}",
    live_clipboard_ok: "הטקסט הועתק ללוח בהצלחה!",
    live_clipboard_err: "שגיאה בהעתקה: {err}",

    // Sefaria-tool entry buttons (in editor toolbar)
    tool_download_book: "📖 הורד ספר",
    tool_complete_verses: "🔍 השלם פסוקים בטקסט",
  },

  en: {
    downloader_title: "📖 Sefaria Book Loader — Rav Text",
    btn_close: "✕",
    btn_lang_to_en: "🌐 English",
    btn_lang_to_he: "🌐 Hebrew",
    title_main: "📖 Sefaria Book Loader",
    placeholder_search_book: "Search book…",
    btn_today: "🗓 Today",
    btn_presets: "📋 Presets",
    btn_refresh_api: "🔄 Refresh API",
    btn_log: "📜 Log",
    netfree_warn_downloader:
      "⚠ Note: Sefaria book loading does not work on Netfree (Sefaria is blocked). " +
      "If you browse Netfree — the load will fail.",
    hint_action_row:
      "◀ Primary action — load the book directly into Rav Text   |   Or save Word only for manual editing ▶",
    btn_export_load: "📚 Add to Rav Text (export & load)",
    btn_export_only: "💾 Export Word only",
    btn_cancel: "⏹ Stop",
    status_ready: "Ready",
    status_loading_index: "Loading Sefaria index…",
    status_index_failed: "❌ Index load failed — check connection",

    tree_title: "📚 Pick a book",
    tree_fav_title: "⭐ Favorites (right-click to add)",
    tree_fav_empty: "(empty — right-click in tree)",
    tree_recent_title: "🕒 Recently loaded",
    tree_recent_empty: "(empty)",
    cat_tanakh: "📁 Tanakh",
    cat_bavli: "📁 Bavli Talmud",
    cat_yerushalmi: "📁 Jerusalem Talmud",
    cat_shulchan: "📁 Shulchan Arukh",

    range_title: "📍 Text range",
    range_pick_book: "Pick a book from the tree",
    range_manual_label: "Or enter manually (overrides above):",
    range_manual_placeholder: "e.g.: 1 or 1:1-23 or 2a or 5:3",
    btn_refresh_commentators: "🔍 Refresh commentary list",
    preview_title: "👁 Preview",
    preview_loading: "Loading preview…",
    preview_invalid: "(Cannot load preview — is the range valid?)",
    preview_empty: "(no text)",
    commentators_title: "📜 Commentators (display order)",
    btn_select_all: "✓ Select all",
    btn_clear_all: "✕ Clear all",
    commentators_empty: "Pick book + range to see commentators",
    commentators_loading: "Loading commentary list…",
    commentators_none: "No commentators found for this range",

    settings_title: "⚙ Export settings",
    settings_vowels: "Include vowels",
    settings_cantillation: "Include cantillation",
    settings_version: "Version:",
    btn_save_preset: "💾 Save as preset",
    summary_title: "📊 Summary",
    summary_book_none: "(none)",
    summary_template: "Book: {book}\nRange: {rng}\nSelected: {sel} / {total}",
    summary_simple: "Book: {book}\nRange: {rng}\nCommentators: {n}",
    settings_imports_dir_label: "📁 Files saved to:",
    btn_open_imports: "📂 Open folder",

    struct_chapter: "Chapter:",
    struct_verse: "Verse:",
    struct_verse_ph: "(blank=whole chapter)",
    struct_daf: "Daf:",
    struct_amud: "Amud:",
    struct_amud_hint: "(a=א, b=ב)",
    struct_siman: "Siman:",
    struct_seif: "Seif:",
    struct_seif_ph: "(blank=whole siman)",

    today_title: "📅 Today's learning",
    today_pick: "📅 Pick what to load:",
    btn_today_daf: "📜 Daily Daf (Bavli)",
    btn_today_parsha: "📖 Weekly Parsha",
    btn_cancel_short: "Cancel",
    today_no_daf: "Cannot find today's daf in Sefaria",
    today_no_parsha: "Cannot find weekly parsha in Sefaria",
    today_loaded_daf: "📜 Loaded daily daf: {ref}",
    today_loaded_parsha: "📖 Loaded weekly parsha: {ref}",
    status_seek_daf: "Looking up daily daf…",
    status_seek_parsha: "Looking up weekly parsha…",

    presets_title: "📋 Saved presets",
    presets_header: "📋 Built-in + my presets",
    btn_load_preset: "Load",
    btn_delete_preset: "🗑 Delete",
    btn_import_json: "📥 Import JSON",
    btn_export_json: "📤 Export JSON",
    btn_close_word: "Close",
    preset_applied: "📋 Preset '{name}' applied",
    preset_delete_confirm: "Delete preset '{name}'?",
    preset_save_title: "💾 Save preset",
    preset_name_label: "Preset name:",
    preset_desc_label: "Description (optional):",
    preset_save_no_name: "Enter a name",
    preset_saved: "💾 Preset '{name}' saved",
    preset_save_failed: "Save failed",
    preset_save_no_data: "Nothing to save — pick book + range first",
    preset_overwrite_builtin: "Cannot overwrite a built-in preset — pick a different name",
    preset_delete_builtin: "Cannot delete a built-in preset",
    preset_not_exists: "Preset does not exist",
    preset_saved_short: "Saved",
    preset_deleted: "Deleted",
    preset_write_failed: "File write failed",

    presets_imported: "Imported {n} presets",
    presets_exported: "Exported {n} presets",
    presets_skipped: "Skipped:",
    presets_format_invalid: "Invalid format — expected dict",
    presets_skip_builtin: "{name} (built-in name)",
    presets_skip_exists: "{name} (already exists)",
    presets_skip_read_err: "Read error: {err}",
    presets_import_done: "Import complete",
    presets_export_done: "Export",

    cache_select_book: "Pick a book first",
    cache_refresh_msg: "Removed {n} cache files. Next download will be fresh.",
    cache_refresh_title: "Cache refresh",

    log_title: "📜 Sefaria log",
    log_empty: "(log is empty)",
    log_not_yet: "(log not created yet)",
    log_read_err: "Log read error: {err}",
    btn_log_refresh: "Refresh",
    btn_log_clear: "Clear log",

    confirm_title: "Confirm export",
    confirm_template:
      "📖 Book: {book}\n" +
      "📍 Range: {rng}\n" +
      "📜 Commentators: {n}\n" +
      "   {names}{more}\n\n" +
      "⏱ Estimated time: {tmin}–{tmax} seconds\n\n" +
      "Continue?",
    confirm_btn_continue: "✓ Continue",
    confirm_btn_cancel: "✕ Cancel",
    confirm_more_template: " and {n} more",
    confirm_range_all: "(all)",

    err_no_book: "Pick a book first",
    err_no_range: "Enter a range (chapter/daf/siman)",
    err_export_in_progress: "An export is already running — finish or cancel first",
    err_export_in_progress_title: "Export in progress",
    err_required_title: "Missing",
    err_text_load_fail: "Text load failed",
    err_empty_text: "Text is empty or unexpected format",
    err_export: "Export error",
    err_export_done_template: "{err}\n\nLog at {path}",
    err_close_running: "Export running — stop and close?",
    err_close_title: "Close",

    status_loading_book_text: "Downloading text: {ref}",
    status_collecting_segs: "Collecting commentary per segment...",
    status_loading_seg_links: "Loading commentary for segment {i}/{n}...",
    status_building_docx: "Building Word file…",
    status_saved: "✅ Saved: {path}",
    status_loaded_to_app: "✅ Loaded into main app — ready to compile",
    status_cancelled: "⏹ Cancelled by user",
    status_cancelling: "⏹ Cancelling…",
    status_loading_commentators: "Loading commentators for {ref}…",
    status_loading_commentators_err: "❌ Commentators load error: {err}",
    status_found_commentators: "Found {n} commentators",
    status_fav_added: "⭐ Added to favorites: {name}",
    status_fav_removed: "Removed from favorites: {name}",

    export_done_title: "Export done",
    export_done_msg:
      "File saved to:\n{path}\n\n" +
      "Open in Word for editing, or use 'Export & load' for direct loading.",

    hint_talmud: "Talmud needs daf+amud, e.g. {heb} 2a (folio 2 side a)",
    hint_tanakh: "Tanakh needs chapter (e.g. 1) or chapter:verse (e.g. 1:5)",
    invalid_template:
      "(Cannot load preview — is the range valid?)\n\n💡 {hint}",

    live_title: "Sefaria Verse Picker",
    netfree_warn_live:
      "⚠ Note: this tool does not work on Netfree (Sefaria is blocked). " +
      "If you browse Netfree, fetching will fail.",
    t_actions: "Actions",
    btn_start: "▶ Start Processing",
    t_settings: "Process Settings",
    l_dup: "Duplicates:",
    l_chap: "Whole Chapter:",
    opt_first: "First Verse",
    opt_skip: "Skip",
    opt_all: "All",
    l_speed: "Speed:",
    l_err: "Show Errors",
    t_export: "Export Result",
    btn_word: "📥 Word",
    btn_txt: "📄 Text",
    btn_copy: "📋 Copy",
    t_theme: "Theme",
    t_input: "Input Text",
    btn_books: "➕ Book Settings",
    t_res: "Processing Results",
    stat_found: "📥 Found",
    stat_skip: "⛔ Skipped",
    stat_succ: "✅ Success",
    stat_err: "❌ Errors",
    l_reasons: "Filter Reasons:",
    l_format: "Format:",
    l_book: "Book:",
    l_context: "Context (Ibid):",
    l_dupes: "Duplicates:",
    l_tech: "Technical Errors:",
    l_net: "Network:",
    l_api: "API:",
    l_notfound: "Not Found:",
    t_processing: "Processing:",
    vip_title: "Full Premium Version",
    vip_desc: "✨ Unlimited Access",
    ph_vip: "Paste full text here (unlimited)...",
    lock_title: "Protected Area: Limited Access",
    lock_desc: "You are limited to 500 characters",
    ph_lock: "Paste text here...",
    inst_title: "Format Instructions (Click to expand)",
    inst_1_s: "Full citation:",
    inst_1: " (Genesis 1, 1) or (Genesis 1:1)",
    inst_2_s: "Chapter and verse based on previous (\"Ibid\"):",
    inst_2: " (Ibid, 12) - Fetches verse 12 from same book/previous chapter.",
    inst_3_s: "Verse only based on previous:",
    inst_3:
      " (Ibid 12) or (Ibid, 12) - If a chapter was previously mentioned, fetches verse 12 from that chapter.",
    inst_4_s: "Change chapter in same book:",
    inst_4: " (Ibid chapter 12 verse 1) or simply (Ibid, 12, 1).",
    inst_5_s: "Supported books:",
    inst_5:
      " Full Tanakh (standard names). Abbreviations supported.",
    speed_title: "ℹ️ Speed and Stability Info:",
    speed_1:
      "A high number (e.g. 20+) yields faster results but may crash weak servers.",
    speed_2: "A low number (e.g. 5) is slower but stable.",
    speed_3: "Recommended: 6 to 10 for most users.",
    live_quota_msg:
      "⛔ You have reached the weekly quota. Activate a license or addon.",
    live_locked_msg:
      "⛔ Too many requests. You are locked for an hour or buy access.",
    live_err_unknown_book: "(book not recognized)",
    live_err_dup: "(duplicate verse - skipped by limit)",
    live_err_format: "(invalid format)",
    live_err_missing: "(error: {err} - {ref})",
    live_err_chap_end: "{book} ends at chapter {chap}",
    live_err_chap_missing: "Chapter {chap} does not exist",
    live_err_verse_not_found: "(verse not found - {ref})",
    live_err_network: "(network error)",
    live_err_unknown: "(unknown error)",
    live_err_input_required: "Please enter text",
    live_progress_template: "{done} of {total} requests done.",
    live_progress_done: "Done!",
    live_progress_waiting: "Waiting to send: {n}",
    live_save_word_ok: "File saved:\n{path}",
    live_clipboard_ok: "Text copied to clipboard!",
    live_clipboard_err: "Copy error: {err}",

    tool_download_book: "📖 Download book",
    tool_complete_verses: "🔍 Complete verses",
  },
};

export function getLang() {
  try {
    const v = (localStorage.getItem("ravtext.lang") || "").toLowerCase();
    return v === "en" ? "en" : "he";
  } catch (_) {
    return "he";
  }
}

export function setLang(lang) {
  try { localStorage.setItem("ravtext.lang", lang === "en" ? "en" : "he"); }
  catch (_) {}
}

export function toggleLang() {
  const cur = getLang();
  const nxt = cur === "he" ? "en" : "he";
  setLang(nxt);
  return nxt;
}

export function t(key, params) {
  const lang = getLang();
  const dict = STRINGS[lang] || STRINGS.he;
  let s = dict[key];
  if (s === undefined) s = STRINGS.he[key] || key;
  if (params && typeof s === "string") {
    for (const k of Object.keys(params)) {
      s = s.split("{" + k + "}").join(String(params[k]));
    }
  }
  return s;
}

export function isRTL() {
  return getLang() === "he";
}
