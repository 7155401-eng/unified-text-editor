const STORAGE_KEY = "ravtext.lang";

const tr = {
  he: {
    appTitle: "רב טקסט לוורד AI",
    status: 'טען טקסט ולחץ "רנדר עמודים" כדי לראות את התצוגה.',
    markAsStream: "סמן כזרם:",
    mark: "סמן",
    addPane: "+ חלונית",
    removePane: "✕ הסר חלונית",
    split: "✂ פצל לחלוניות",
    splitNotes: "✂ הפרד הערות",
    mergeToggle: "🔗 מזג / פרק",
    merge: "⤺ אחד",
    sync: "🔗 גלילה",
    lines: "☷ שורות",
    reset: "↺ איפוס",
    loadSample: "טען דוגמה",
    loadInline: "טען טקסט inline",
    loadShulchan: 'טען שו"ע',
    loadTalmud: "טען גמרא",
    renderPages: "רנדר",
    mishnaWrap: "משנה ברורה: גלישה",
    levels: "רמות:",
    stress: "בדיקת עומס:",
    preview: "תצוגה",
    diagnostics: "אבחון",
    wordImport: "טען מ-Word",
    wordExport: "שמור ל-Word",
    wordImportTitle: "טעינה מקובץ Word",
    wordImportDesc: "סמן זרמים והגדר סימן קישור:",
    load: "טען",
    cancel: "ביטול",
    json: "JSON",
    roundTrip: "round-trip",
    // v33: settings strings (HE)
    settingsDisplay: "תצוגה",
    settingsDarkMode: "מצב כהה:",
    settingsLanguage: "שפה:",
    settingsLicense: "רישיון משתמש",
    settingsLicenseUnset: "לא הוטמע עדיין",
    settingsDebug: "דיבוג",
    settingsSaveLog: "שמור לוג רינדור מפורט:",
    settingsLogCopy: "העתק לוג",
    settingsLogDownload: "הורד לוג",
    settingsLogClear: "נקה לוג",
    // ribbon tabs (HE)
    file: "קובץ",
    downloads: "הורדות",
    home: "בית",
    streams: "זרמים",
    insert: "הוספה",
    layout: "פריסה",
    talmud: 'גפ"ת',
    mishna: 'משנ"ב',
    torah: "תורני",
    review: "סקירה",
    view: "תצוגה",
    advanced: "מתקדם",
    settings: "הגדרות",
    // demo banner
    demoTitle: "מצב דמו",
    demoBody: "השינויים אינם נשמרים והתוכנה מתאפסת במצב זה מידי דקה.<br>כדי למנוע איפוס הירשם או התחבר. בחשבון חינמי כל יצוא או הדפסה מסומן.",
    // font names (display only — internal font identifiers stay in data-cmd)
    "font-david": "דוד",
    "font-frank": "פרנק",
    "font-segoe": "סגו",
  },
  en: {
    appTitle: "RavText to Word AI",
    status: 'Load text and click "Render pages" to see the preview.',
    markAsStream: "Mark as stream:",
    mark: "Mark",
    addPane: "+ Pane",
    removePane: "✕ Remove pane",
    split: "✂ Split to panes",
    splitNotes: "✂ Split notes",
    mergeToggle: "🔗 Merge / Split",
    merge: "⤺ Merge",
    sync: "🔗 Scroll",
    lines: "☷ Lines",
    reset: "↺ Reset",
    loadSample: "Load sample",
    loadInline: "Load inline text",
    loadShulchan: "Shulchan",
    loadTalmud: "Talmud",
    renderPages: "Render",
    mishnaWrap: "Mishna Berura: wrap",
    levels: "Levels:",
    stress: "Stress test:",
    preview: "Preview",
    diagnostics: "Diagnostics",
    wordImport: "Load Word",
    wordExport: "Save to Word",
    wordImportTitle: "Load from Word",
    wordImportDesc: "Select streams and set a marker:",
    load: "Load",
    cancel: "Cancel",
    json: "JSON",
    roundTrip: "round-trip",
    // v33: settings strings
    settingsDisplay: "Display",
    settingsDarkMode: "Dark mode:",
    settingsLanguage: "Language:",
    settingsLicense: "User License",
    settingsLicenseUnset: "Not yet integrated",
    settingsDebug: "Debug",
    settingsSaveLog: "Save detailed render log:",
    settingsLogCopy: "Copy log",
    settingsLogDownload: "Download log",
    settingsLogClear: "Clear log",
    // ribbon tabs
    file: "File",
    downloads: "Downloads",
    home: "Home",
    streams: "Streams",
    insert: "Insert",
    layout: "Layout",
    talmud: "Talmud",
    mishna: "Mishna B.",
    torah: "Torah",
    review: "Review",
    view: "View",
    advanced: "Advanced",
    settings: "Settings",
    // demo banner
    demoTitle: "Demo Mode",
    demoBody: "Changes are not saved and the app resets every minute in this mode.<br>To prevent reset, register or sign in. In a free account, every export or print is watermarked.",
    // font names (display only — internal font identifiers stay in data-cmd)
    "font-david": "David",
    "font-frank": "Frank",
    "font-segoe": "Segoe",
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || "he";
if (!tr[currentLang]) currentLang = "he";

export function applyLanguage(forceLang) {
  // v33: accept either explicit lang or fall back to localStorage / current.
  if (forceLang && tr[forceLang]) {
    currentLang = forceLang;
    localStorage.setItem(STORAGE_KEY, currentLang);
  } else {
    // Re-read from storage in case it changed externally (e.g. via settings).
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && tr[stored]) currentLang = stored;
  }
  document.documentElement.lang = currentLang;
  // v33: switch direction with language. Hebrew is RTL, English is LTR.
  document.documentElement.dir = currentLang === "he" ? "rtl" : "ltr";
  // Also set body class so CSS can target language-specific tweaks.
  document.body.classList.toggle("lang-he", currentLang === "he");
  document.body.classList.toggle("lang-en", currentLang === "en");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (tr[currentLang][key]) {
      if (key === "demoBody") el.innerHTML = tr[currentLang][key];
      else el.textContent = tr[currentLang][key];
    }
  });

  // v33: also translate ribbon tab labels.
  document.querySelectorAll("[data-ribbon-tab]").forEach(el => {
    const tabId = el.dataset.ribbonTab;
    if (tabId && tr[currentLang][tabId]) {
      // Only update tab buttons (not panels — those have their own content).
      if (el.classList.contains("ribbon-tab")) {
        el.textContent = tr[currentLang][tabId];
      }
    }
  });

  const btn = document.getElementById("langBtn");
  if (btn) btn.textContent = currentLang === "he" ? "EN" : "HE";
  // v33: persist language across reloads.
  localStorage.setItem(STORAGE_KEY, currentLang);
}

export function getLanguage() { return currentLang; }

export function toggleLanguage() {
  currentLang = currentLang === "he" ? "en" : "he";
  localStorage.setItem(STORAGE_KEY, currentLang);
  applyLanguage();
}
