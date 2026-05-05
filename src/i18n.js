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
    renderPages: "רנדר עמודים",
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
  },
  en: {
    appTitle: "Integrated Editor - TipTap + Engine",
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
    renderPages: "Render pages",
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
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || "he";
if (!tr[currentLang]) currentLang = "he";

export function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = "rtl";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (tr[currentLang][key]) {
      el.textContent = tr[currentLang][key];
    }
  });

  const btn = document.getElementById("langBtn");
  if (btn) btn.textContent = currentLang === "he" ? "EN" : "HE";
}

export function toggleLanguage() {
  currentLang = currentLang === "he" ? "en" : "he";
  localStorage.setItem(STORAGE_KEY, currentLang);
  applyLanguage();
}
