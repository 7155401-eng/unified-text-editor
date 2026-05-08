// i18n.py port — every key, he+en. Verbatim from i18n.py.
// In the Python file, several keys appear twice in the "he" block (e.g.
// multi_copies_note, multi_engine_card, engine_*, judge_*, multi_mix_*,
// ext_*, tab_*, save_*, output_help, multi_*). Python preserves the LAST
// definition (dict literal). JS object literals behave identically — the
// later key wins — so this is byte-equivalent.

export const STRINGS = {
  he: {
    app_title: "ניקוד מדוייק (AI) — RavText",
    marketing: "תוכנת הניקוד מהמדויקות בעולם — בערך 100% דיוק.",
    warn_title: "⚠ חשוב מאוד",
    warn_body: (
      "חובה לאחר הניקוד להשוות את הטקסט המקורי לטקסט המנוקד. " +
      "אפשר להיעזר בכלי שנבנה בדיוק לזה — מיזוג ניקוד בתוך כלי השוואות " +
      "טקסטים. על כל פנים בניקוד עם Gemini."
    ),
    open_compare_btn: "🔀 פתח מיזוג ניקוד / השוואת טקסטים",
    input_section: "מקור הטקסט",
    tab_paste: "✏ הדבקת טקסט",
    tab_file: "📁 קובץ",
    choose_file: "בחר קובץ…",
    no_file: "(לא נבחר קובץ)",
    supported_files: "txt / docx / rtf / md",
    paste_placeholder: "הדבק כאן את הטקסט לניקוד…",
    options_section: "אפשרויות ניקוד",
    torah_mode: "ניקוד תורני מדוייק (לפי הקשר תורני, ציטוטי תנ\"ך, מינוח קדום)",
    regular_mode_note: "(כשלא מסומן — ניקוד עברית עכשווית, דקדוק עכשווי)",
    preserve_spelling: "לא לשנות כתיב מלא/חסר (נסיוני)",
    provider_section: "ספק הבינה",
    provider_gemini: "Gemini 3.1 Pro Preview  ·  זול יותר",
    provider_claude: "Claude Opus 4.7  ·  לשימוש עסקי",
    provider_dicta: "דיקטה  ·  חינם, מהיר, ללא LLM",
    quota_free: "מכסה חינם: {used} / {limit} תווים נוקדו היום.",
    quota_paid: "רישיון בתשלום פעיל — ניקוד ללא הגבלה.",
    quota_short_free: "חינם: עד {limit} תווים ליום. בתשלום: ללא הגבלה.",
    run_btn: "▶ נקד עכשיו",
    cancel_btn: "✕ בטל",
    status_ready: "מוכן",
    status_extracting: "קורא קובץ…",
    status_sending: "שולח לבינה…",
    status_waiting: "ממתין לתשובה…",
    status_done: "הניקוד הסתיים.",
    status_cancelled: "בוטל.",
    output_section: "תוצאה",
    copy_btn: "📋 העתק",
    save_btn: "💾 שמור כקובץ",
    clear_btn: "🗑 נקה",
    no_text_to_send: "אין טקסט לשליחה. הדבק טקסט או בחר קובץ.",
    quota_block_title: "חרגת מהמכסה היומית",
    save_dialog_title: "שמור טקסט מנוקד",
    save_done: "נשמר בהצלחה ב:\n{path}",
    copy_done: "הועתק ללוח.",
    send_again_short: "▶ נקד עכשיו",
    extension_warning: "הכלי בשלב נסיוני — מומלץ תמיד לבדוק את הפלט מול המקור.",
    btn_lang: "EN",
    btn_theme_dark: "☾",
    btn_theme_light: "☀",
    err_title: "שגיאה",
    warn_no_text: "ריק",
    step_load: "1. טעינת החומר",
    step_warn: "2. אזהרות לפני שליחה",
    step_send: "3. שליחה ותוצאה",
    next_to_warn: "המשך לאזהרות ←",
    back_to_load: "→ חזרה לטעינה",
    back_to_warn: "→ חזרה לאזהרות",
    approve_and_send: "אישרתי — שלח לבינה ▶",
    step_warn_title: "אזהרה לפני שליחה",
    step_warn_subtitle: "קרא בעיון לפני שאתה לוחץ אישור",
    load_summary_title: "מה ייכנס לבינה:",
    load_chars_count: "אורך: {n} תווים",
    load_torah: "מצב ניקוד: תורני (מדוייק לפי הקשר תורני)",
    load_regular: "מצב ניקוד: רגיל (דקדוק עכשווי)",
    load_provider: "ספק: {p}",
    load_preserve_on: "שמירת כתיב מלא/חסר: כן (אזהרה אגרסיבית למנוע)",
    load_preserve_off: "שמירת כתיב מלא/חסר: לא",
    save_dir_label: "תיקיית שמירה:",
    change_dir_btn: "📂 שנה תיקייה",
    auto_saved: "נשמר אוטומטית: {path}",
    default_basename: "ניקוד רב טקסט לוורד",
    api_section: "חשבון ומפתחות בינה",
    api_premium_radio: "⭐  פרמיום (תשלום לפי שימוש דרך השרת שלנו)",
    api_premium_note: "אין צורך במפתחות API. תשלום לפי נקודות שנרכשו אצלנו.",
    api_access_label: "קוד גישה:",
    api_access_ph: "הדבק כאן את קוד הגישה שקיבלת",
    api_personal_radio: "🔐  מפתחות אישיים (תשלום ישיר לספקי הבינה)",
    api_gemini_label: "מפתח Gemini (לבחירת ספק Gemini):",
    api_claude_label: "מפתח Claude (לבחירת ספק Claude):",
    api_inherit_note: "המפתחות מסונכרנים אוטומטית עם כלי התמלול של רב טקסט.",
    api_create_gemini: "🔗 קבל מפתח Gemini בחינם (Google AI Studio)",
    api_create_claude: "🔗 קבל מפתח Claude (Anthropic Console)",
    warn_general_title: "מה כדאי לדעת לפני השליחה",
    warn_short_test: "מומלץ להתחיל עם טקסט קצר כדי לראות את איכות הניקוד לפני שליחת מסמך ארוך.",
    warn_internet: "צריך חיבור פעיל לאינטרנט. אם הקריאה נופלת — בדוק את החיבור.",
    warn_quota_paid: "השימוש נספר רק אחרי תשובה מוצלחת. שליחה שנכשלה לא נספרת.",
    warn_provider_note: "Gemini זול יותר; Claude איכותי יותר ומיועד לעבודות עסקיות.",
    warn_no_long_text: "מומלץ להתחיל עם טקסט קצר כדי לראות את איכות הניקוד לפני שליחת מסמך ארוך. לטקסטים ארוכים מאוד מומלץ לפצל לקטעים.",
    warn_text_chars_high: "⚠ הטקסט במשקל {n} תווים. טקסטים ארוכים מאוד נוטים לקבל תשובה חלקית או לקחת זמן רב; אם המנקד עוצר באמצע — פצל את הקובץ.",
    warn_pricing: "השימוש מחושב לפי תווי קלט+פלט. עם רוב מסמכי המקור הסטנדרטיים — עלות זניחה.",
    warn_no_email_send: "התוצאה לא נשלחת לאף אחד אחר; היא יורדת רק אליך, לתיקייה שבחרת.",
    warn_first_run_slow: "הריצה הראשונה לפעמים איטית יותר (שרת מתחמם). אם נופל פעם אחת — נסה שוב.",
    char_count_live: "Length: {n} characters",
    restart_btn: "↻ New nikud",
    recent_label: "Recent:",
    recent_clear: "Clear list",
    recent_empty: "(no recent files)",
    // First definition (overridden below)
    // multi_copies_note: "3 = basic accuracy. 10 = high accuracy for business work. Ties decided by majority.",
    // multi_engine_card: "✏  Choose vocalizer",
    multi_engine_top: "The vocalizer is what produces the witnesses — each run is an independent vocalization with the same letters.",
    // engine_gemini_label: "⚡  Gemini vocalizes  ·  cheaper",
    // engine_gemini_desc: "Gemini is fast and accurate. Default vocalizer because it's good enough and significantly cheaper at scale.",
    // engine_claude_label: "🤖  Claude vocalizes  ·  higher quality",
    // engine_claude_desc: "Claude produces especially high-quality nikud. Use when you want maximum quality at the witness stage. More expensive.",
    // engine_dicta_label: "📚  Dicta vocalizes  ·  free",
    // engine_dicta_desc: ...
    // multi_mix_enable: "Mixed mode — witnesses from multiple providers",
    // multi_mix_top: ...
    // multi_mix_gemini: "Gemini:",
    // multi_mix_claude: "Claude:",
    // multi_mix_dicta: "Dicta:",
    multi_mix_total: "Total witnesses: {n}",
    // multi_judge_card: "🎯  Choose judge",
    // multi_judge_top: ...
    // judge_claude_label: "🤖  Claude judges  ·  high quality",
    // judge_claude_desc: ...
    // judge_gemini_label: "⚡  Gemini-only judge  ·  cheaper, slightly lower quality",
    // judge_gemini_desc: ...
    // multi_gas_note: "ℹ  The instructions live on a remote server (Google Apps Script) and update for everyone simultaneously.",
    ext_card_title: "📥  External vocalized editions (optional)",
    ext_card_desc: "Attach already-vocalized text files produced by other tools — they will be added to the vocalizer's witnesses and sent to the judge together with them. Supports TXT, DOCX.",
    ext_add_btn: "➕ Add external edition",
    ext_remove_btn: "✕",
    tab_edition: "Edition (judge result)",
    tab_witness: "Witness {i}",
    tab_external: "External: {name}",
    save_edition_btn: "💾 Save edition",
    save_witnesses_btn: "💾 Save witnesses",
    output_help: "The edition is the final nikud after the judge's ruling. Witnesses are the raw vocalized copies the vocalizer produced. Each witness has its own tab.",
    ext_load_failed_title: "Some files failed",
    ext_load_failed_msg: "Added: {added}\nFailed:\n{failed}",
    multi_enable: "ניקוד עם ריבוי העתקים ודיין מכריע (איכות גבוהה יותר)",
    multi_explain: (
      "המנקד יריץ את הטקסט כמה פעמים, וכל ריצה תפיק העתק עצמאי " +
      "באותן אותיות עם ניקוד שלה. הדיין יבחר עבור כל אות את הניקוד " +
      "לפי רוב מבין ההעתקים — ובתיקו לפי הקשר ודקדוק."
    ),
    multi_copies_label: "מספר העתקים (3 – 10):",
    // === Below: Hebrew "second definitions" — these win over the English-flavoured first ones ===
    multi_copies_note: "3 = דיוק בסיסי. 10 = דיוק גבוה לעבודות עסקיות. במקרה של סתירה — הרוב קובע.",
    multi_engine_card: "✏  בחירת המנקד",
    multi_engine_top: (
      "המנקד הוא מי שמייצר את ההעתקים — כל ריצה היא ניקוד עצמאי " +
      "של אותו טקסט, באותן אותיות בדיוק."
    ),
    engine_gemini_label: "⚡  Gemini מנקד  ·  זול יותר",
    engine_gemini_desc: (
      "Gemini מבצע ניקוד מהיר ומדוייק. ברירת המחדל למנקד כי הוא " +
      "מספיק טוב, ועלות ההפעלה זולה משמעותית גם בריבוי העתקים."
    ),
    engine_claude_label: "🤖  Claude מנקד  ·  איכות גבוהה יותר",
    engine_claude_desc: (
      "Claude מבצע ניקוד איכותי במיוחד. מתאים כשרוצים איכות מירבית " +
      "כבר בשלב הייצור של ההעתקים. עולה יותר."
    ),
    engine_dicta_label: "📚  דיקטה מנקדת  ·  חינם",
    engine_dicta_desc: (
      "ניקוד אלגוריתמי מבוסס מודל מאומן. " +
      "מהיר ועקבי. אין מפתח, אין עלות. " +
      "טוב במיוחד לטקסטים עכשוויים. " +
      "עובד גם על לשון חז\"ל וראשונים, אך פחות מדויק מ-LLM בטקסטים מורכבים."
    ),
    multi_mix_enable: "מצב מעורב — לקבל עדים מספקים שונים",
    multi_mix_top: (
      "במצב מעורב הדיין יקבל עדים מכמה ספקים יחד. " +
      "אפשר 0 עד 5 עדים מכל ספק. דיקטה דטרמיניסטית, " +
      "אז יותר מ-1 עד שלה לא יוסיף דיוק."
    ),
    multi_mix_gemini: "Gemini:",
    multi_mix_claude: "Claude:",
    multi_mix_dicta: "דיקטה:",
    multi_mix_total: "סך עדים: {n}",
    multi_judge_card: "🎯  בחירת הדיין המכריע",
    multi_judge_top: (
      "הדיין הוא מי שבוחר את הניקוד הסופי מתוך ההעתקים. אות-מול-אות, " +
      "לפי רוב; ובתיקו לפי דקדוק וההקשר התורני/העכשווי."
    ),
    judge_claude_label: "🤖  Claude מכריע  ·  איכות גבוהה",
    judge_claude_desc: (
      "מודל Claude נפרד משווה את ההעתקים ובוחר את הקריאה הטובה " +
      "ביותר. הזיות מודלים נוטות להיות יחידאיות, ולכן דיין נפרד " +
      "מסנן אותן יעיל."
    ),
    judge_gemini_label: "⚡  רק Gemini מכריע  ·  זול יותר, איכות מעט נמוכה",
    judge_gemini_desc: (
      "Gemini עצמו עושה גם את הניקוד וגם את ההכרעה. בלי מפתח " +
      "Claude. מתאים לבדיקות מהירות וכשאין יתרת קרדיט אצל Anthropic."
    ),
    multi_gas_note: (
      "ℹ  ההנחיות עצמן נשמרות בשרת מרוחק (Google Apps Script) " +
      "ומתעדכנות אצל כולם בו-זמנית."
    ),
    ext_card_title: "📥  מהדורות ניקוד חיצוניות (אופציונלי)",
    ext_card_desc: (
      "אפשר לצרף קבצי טקסט מנוקדים שכבר הופקו בכלים אחרים — הם " +
      "יצורפו לעדי-הנוסח של המנקד וישלחו לדיין יחד איתם. תומך " +
      "בקבצי TXT, DOCX."
    ),
    ext_add_btn: "➕ הוסף מהדורה חיצונית",
    ext_remove_btn: "✕",
    tab_edition: "מהדורה (הכרעת הדיין)",
    tab_witness: "עד {i}",
    tab_external: "חיצוני: {name}",
    save_edition_btn: "💾 שמור מהדורה",
    save_witnesses_btn: "💾 שמור עדים",
    output_help: (
      "המהדורה היא הניקוד הסופי לאחר הכרעת הדיין. עדי-הנוסח הם " +
      "ההעתקים הגולמיים שהמנקד הפיק. כל עד-נוסח בלשונית נפרדת."
    ),
    ext_load_failed_title: "חלק מהקבצים לא נטענו",
    ext_load_failed_msg: "נוספו: {added}\nנכשלו:\n{failed}",
    load_multi_on: "ריבוי העתקים: {n} העתקים, מנקד {e}, דיין {j}",
    load_multi_off: "ריבוי העתקים: כבוי (העתק יחיד)",
    status_multi_run: "מנקד העתק {i} מתוך {n}…",
    status_judge: "הדיין מכריע בין ההעתקים…",
  },
  en: {
    app_title: "Precise Nikud (AI) — RavText",
    marketing: "One of the most accurate Hebrew vocalization tools in the world — about 100% accuracy.",
    warn_title: "⚠ Very important",
    warn_body: (
      "After vocalizing, you MUST compare the result to the original text. " +
      "Use the dedicated tool — Nikud-Merge inside the Text Comparator. " +
      "Especially when vocalizing with Gemini."
    ),
    open_compare_btn: "🔀 Open Nikud-Merge / Text Comparator",
    input_section: "Text source",
    tab_paste: "✏ Paste text",
    tab_file: "📁 File",
    choose_file: "Choose file…",
    no_file: "(no file selected)",
    supported_files: "txt / docx / rtf / md",
    paste_placeholder: "Paste the Hebrew text to vocalize here…",
    options_section: "Vocalization options",
    torah_mode: "Torah-precise nikud (Torah context, biblical citations, archaic vocabulary)",
    regular_mode_note: "(when unchecked — modern-Hebrew nikud, contemporary grammar)",
    preserve_spelling: "Do not change plene/defective spelling (experimental)",
    provider_section: "AI provider",
    provider_gemini: "Gemini 3.1 Pro Preview  ·  cheaper",
    provider_claude: "Claude Opus 4.7  ·  for business use",
    provider_dicta: "Dicta  ·  free, fast, non-LLM",
    quota_free: "Free quota: {used} / {limit} characters used today.",
    quota_paid: "Paid license active — unlimited vocalization.",
    quota_short_free: "Free: up to {limit} chars/day. Paid: unlimited.",
    run_btn: "▶ Vocalize now",
    cancel_btn: "✕ Cancel",
    status_ready: "Ready",
    status_extracting: "Reading file…",
    status_sending: "Sending to AI…",
    status_waiting: "Waiting for reply…",
    status_done: "Done.",
    status_cancelled: "Cancelled.",
    output_section: "Result",
    copy_btn: "📋 Copy",
    save_btn: "💾 Save to file",
    clear_btn: "🗑 Clear",
    no_text_to_send: "No text to send. Paste text or choose a file.",
    quota_block_title: "Daily free quota exceeded",
    save_dialog_title: "Save vocalized text",
    save_done: "Saved to:\n{path}",
    copy_done: "Copied to clipboard.",
    send_again_short: "▶ Vocalize",
    extension_warning: "Experimental tool — always verify the output against the original.",
    btn_lang: "עב",
    btn_theme_dark: "☾",
    btn_theme_light: "☀",
    err_title: "Error",
    warn_no_text: "Empty",
    step_load: "1. Load material",
    step_warn: "2. Warnings before sending",
    step_send: "3. Send & result",
    next_to_warn: "→ Continue to warnings",
    back_to_load: "← Back to loading",
    back_to_warn: "← Back to warnings",
    approve_and_send: "▶ Confirmed — send to AI",
    step_warn_title: "Warning before sending",
    step_warn_subtitle: "Read carefully before you click confirm",
    load_summary_title: "What will be sent:",
    load_chars_count: "Length: {n} characters",
    load_torah: "Mode: Torah-precise (Torah context)",
    load_regular: "Mode: Modern Hebrew (contemporary grammar)",
    load_provider: "Provider: {p}",
    load_preserve_on: "Preserve plene/defective spelling: ON (aggressive engine warning)",
    load_preserve_off: "Preserve plene/defective spelling: OFF",
    save_dir_label: "Save folder:",
    change_dir_btn: "📂 Change folder",
    auto_saved: "Auto-saved: {path}",
    default_basename: "RavText nikud",
    api_section: "Account & AI keys",
    api_premium_radio: "⭐  Premium (pay-per-use through our server)",
    api_premium_note: "No API keys needed. Pay with points purchased from us.",
    api_access_label: "Access code:",
    api_access_ph: "Paste your access code here",
    api_personal_radio: "🔐  Personal API keys (direct billing from AI providers)",
    api_gemini_label: "Gemini API key (when Gemini is selected):",
    api_claude_label: "Claude API key (when Claude is selected):",
    api_inherit_note: "Keys auto-sync with the RavText transcription tool.",
    api_create_gemini: "🔗 Get a free Gemini key (Google AI Studio)",
    api_create_claude: "🔗 Get a Claude key (Anthropic Console)",
    warn_general_title: "What to know before sending",
    warn_short_test: "Start with a short text to evaluate quality before sending a long document.",
    warn_internet: "An active internet connection is required. If the call drops, check your connection.",
    warn_quota_paid: "Usage is counted only after a successful reply. Failed calls are not counted.",
    warn_provider_note: "Gemini is cheaper; Claude is higher-quality and suited for business work.",
    warn_no_long_text: "Start with a short text to evaluate quality before sending a long document. For very long texts, split into chunks.",
    warn_text_chars_high: "⚠ Text is {n} characters long. Very long texts may return partial output or take a long time; split if it stalls.",
    warn_pricing: "Pricing is by input+output characters. Negligible for typical source documents.",
    warn_no_email_send: "The result is not sent to anyone else; it is downloaded only to you, to the folder you picked.",
    warn_first_run_slow: "First run can be slower (server warm-up). If it fails once, retry.",
    char_count_live: "אורך הטקסט: {n} תווים",
    restart_btn: "↻ ניקוד חדש",
    recent_label: "אחרונים:",
    recent_clear: "נקה רשימה",
    recent_empty: "(אין קבצים אחרונים)",
    multi_enable: "Vocalize multiple times and merge with a judge (higher quality)",
    multi_explain: (
      "The vocalizer runs the text several times; each run produces a " +
      "witness with the same letters but its own nikud. A judge picks " +
      "the nikud per letter by majority across witnesses — ties broken " +
      "by context and grammar."
    ),
    multi_copies_label: "Number of witnesses (3-10):",
    multi_engine_label: "Vocalizer (who produces the witnesses):",
    multi_judge_label: "Judge (who decides):",
    engine_gemini: "Gemini  ·  cheaper",
    engine_claude: "Claude  ·  higher quality",
    judge_gemini: "Gemini  ·  cheaper",
    judge_claude: "Claude  ·  high quality (recommended for judge)",
    load_multi_on: "Multi-witness: {n} witnesses, vocalizer {e}, judge {j}",
    load_multi_off: "Multi-witness: off (single witness)",
    status_multi_run: "Vocalizing witness {i} of {n}…",
    status_judge: "Judge merging witnesses…",
    engine_dicta_label: "📚  Dicta vocalizes  ·  free",
    engine_dicta_desc: (
      "Algorithmic vocalization based on a trained model. " +
      "Fast and consistent. No API key, no cost. " +
      "Best for modern Hebrew. " +
      "Also handles rabbinic texts, but less accurate than LLMs on complex passages."
    ),
    multi_mix_enable: "Mixed mode — witnesses from multiple providers",
    multi_mix_top: (
      "In mixed mode the judge gets witnesses from several providers together. " +
      "Pick 0–5 witnesses per provider. Dicta is deterministic, " +
      "so more than 1 of it adds no accuracy."
    ),
    multi_mix_gemini: "Gemini:",
    multi_mix_claude: "Claude:",
    multi_mix_dicta: "Dicta:",
    multi_mix_total: "Total witnesses: {n}",
  },
};

export function t(lang, key, fmt) {
  const tableForLang = STRINGS[lang] || STRINGS.he;
  let s = (key in tableForLang) ? tableForLang[key] : key;
  if (fmt) {
    try {
      for (const [k, v] of Object.entries(fmt)) {
        s = s.split("{" + k + "}").join(String(v));
      }
      return s;
    } catch (e) {
      return s;
    }
  }
  return s;
}

// Direction marks (RLE/PDF) for Hebrew labels with embedded English.
export const RLE = "‫";
export const PDF = "‬";

export function rtl(s, lang = "he") {
  if (lang !== "he" || !s) return s;
  return RLE + s + PDF;
}
