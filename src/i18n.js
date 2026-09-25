const STORAGE_KEY = "ravtext.lang";

const tr = {
  he: {
    profileBtn: "מנוי",
    renderStop: "■ עצור רינדור",
    devUpdates: "📰 עדכוני פיתוח",
    troubleshoot: "🛠️ פתרון בעיות",
    reportBug: "🐞 דיווח באג",
    contactUs: "✉️ צור קשר",
    navVideos: "סרטונים",
    navFaq: "שאלות",
    navSettings: "הגדרות",
    navDownloads: "הורדות",
    navGift: "מתנה",
    navPremium: "פרמיום",
    renderTab: "רינדור",
    renderNow: "⟳ רנדר",
    highlightBtn: "🖍 הדגש",
    formatPainter: "🎨 מברשת",
    streamRules: "כללי סגנון לכל זרם",
    loadFont: "📁 טען",
    openStreamMenu: "פתח תפריט זרמים",
    shortHelp: "הסבר קצר",
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
    demoTitle: "מצב דמו,",
    demoBody: "השינויים אינם נשמרים והתוכנה מתאפסת במצב זה מידי דקה.<p>כדי למנוע איפוס הירשם או התחבר. בחשבון חינמי כל יצוא או הדפסה מסומן.</p>",
    // font names (display only — internal font identifiers stay in data-cmd)
    "font-david": "דוד",
    "font-frank": "פרנק",
    "font-segoe": "סגו",
  },
  en: {
    profileBtn: "Account",
    renderStop: "■ Stop render",
    devUpdates: "📰 Updates",
    troubleshoot: "🛠️ Troubleshoot",
    reportBug: "🐞 Report a bug",
    contactUs: "✉️ Contact",
    navVideos: "Videos",
    navFaq: "FAQ",
    navSettings: "Settings",
    navDownloads: "Downloads",
    navGift: "Gift",
    navPremium: "Premium",
    renderTab: "Render",
    renderNow: "⟳ Render",
    highlightBtn: "🖍 Highlight",
    formatPainter: "🎨 Format painter",
    streamRules: "Per-stream style rules",
    loadFont: "📁 Load",
    openStreamMenu: "Open streams menu",
    shortHelp: "Quick help",
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
    demoTitle: "Demo Mode,",
    demoBody: "Changes are not saved and the app resets every minute in this mode.<p>To prevent reset, register or sign in. In a free account, every export or print is watermarked.</p>",
    // font names (display only — internal font identifiers stay in data-cmd)
    "font-david": "David",
    "font-frank": "Frank",
    "font-segoe": "Segoe",
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || "he";
if (!tr[currentLang]) currentLang = "he";

const LANG_ICON='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>';
function syncLanguageSwitcher(){const btn=document.getElementById("langBtn");if(!btn)return;const nextLang=currentLang==="he"?"en":"he",label=nextLang==="en"?"EN":"HE";btn.classList.add("language-switcher");btn.dataset.currentLang=currentLang;btn.dataset.nextLang=nextLang;btn.title=nextLang==="en"?"English":"עברית";btn.setAttribute("aria-label",nextLang==="en"?"Switch language to English":"החלף שפה לעברית");btn.innerHTML=`<span aria-hidden="true" style="display:inline-flex;vertical-align:middle;margin-inline-end:4px">${LANG_ICON}</span><b style="font-size:11px;letter-spacing:.04em">${label}</b>`;const select=document.getElementById("settings-language");if(select)select.value=currentLang;}

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

  // משה, מטלה 20: כפתורים שנוצרים בקוד ואין להם data-i18n ב-HTML.
  // במקום לגעת ב-HTML של כל אחד — ממפים כאן מזהה למפתח תרגום.
  // ⛔ לא מוחק ולא משנה שום כפתור; רק מחליף את הכיתוב שלו לפי השפה.
  const BY_ID = {
    "profile-avatar-btn": "profileBtn",
    "btn-dev-updates": "devUpdates",
    "btn-troubleshooting": "troubleshoot",
    "btn-report-bug": "reportBug",
    "btn-contact": "contactUs",
    "rt-prem-icon-videos": "navVideos",
    "rt-prem-icon-faq": "navFaq",
    "rt-prem-icon-settings": "navSettings",
    "rt-prem-icon-downloads": "navDownloads",
    "rt-prem-icon-gift": "navGift",
    "rt-prem-icon-diamond": "navPremium",
    "btn-render-tab": "renderTab",
    "btn-highlight": "highlightBtn",
    "btn-format-painter": "formatPainter",
    "btn-stream-auto-rules": "streamRules",
    "local-font-upload-btn": "loadFont",
    "nested-notes-open-stream-menu-btn": "openStreamMenu",
    "nested-notes-short-help-btn": "shortHelp",
  };
  const applyById = () => {
    for (const id in BY_ID) {
      const el = document.getElementById(id);
      const val = tr[currentLang] && tr[currentLang][BY_ID[id]];
      if (el && val && el.textContent !== val) el.textContent = val;
    }
    // כפתור הרינדור מיוחד: הכיתוב שלו מתחלף בזמן עבודה בין "רנדר"
    // ל"עצור רינדור", ולכן אסור לקבע לו טקסט אחד. מזהים באיזה מצב
    // הוא נמצא לפי הכיתוב הנוכחי, ומתרגמים את אותו מצב בלבד.
    const rb = document.getElementById("btn-render");
    if (rb) {
      const t = (rb.textContent || "");
      const stopping = /עצור|Stop/.test(t);
      const key = stopping ? "renderStop" : "renderNow";
      const val = tr[currentLang] && tr[currentLang][key];
      if (val && rb.textContent !== val) rb.textContent = val;
    }
  };
  applyById();
  // ⭐ חלק מהכפתורים נבנים אחרי שהשפה כבר הוחלה, וחלקם נכתבים מחדש
  // בזמן עבודה. לכן מחילים שוב: מעט אחרי, ובכל פעם שהרינדור מסתיים.
  setTimeout(applyById, 1200);
  if (!window.__i18nRerunBound) {
    window.__i18nRerunBound = true;
    window.addEventListener("ravtext:engine-rendered", () => setTimeout(applyById, 60));
  }

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

  syncLanguageSwitcher();
  // v33: persist language across reloads.
  localStorage.setItem(STORAGE_KEY, currentLang);
}

export function getLanguage() { return currentLang; }

export function toggleLanguage() {
  currentLang = currentLang === "he" ? "en" : "he";
  localStorage.setItem(STORAGE_KEY, currentLang);
  applyLanguage();
}
