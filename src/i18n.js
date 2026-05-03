const STORAGE_KEY = "ravtext.lang";

export const tr = {
  he: {
    appTitle: "עורך משולב - TipTap + Engine",
    addPane: "+ חלונית",
    import: "טען Word",
    export: "שמור Word",
    merge: "מזג / פרק",
    split: "הפרד הערות",
    sync: "גלילה",
    lines: "שורות",
    preview: "תצוגה",
    prev: "הקודם",
    next: "הבא",
    mainPh: "הדבק או הקלד את הטקסט הראשי כאן",
    notePh: "הדבק או הקלד את הערות הזרם כאן",
    notesStream: "זרם",
    linkMarker: "סימן",
  },
  en: {
    appTitle: "Integrated Editor - TipTap + Engine",
    addPane: "+ Pane",
    import: "Load Word",
    export: "Save Word",
    merge: "Merge / Split",
    split: "Split Notes",
    sync: "Scroll",
    lines: "Lines",
    preview: "Preview",
    prev: "Previous",
    next: "Next",
    mainPh: "Paste or type the main text here",
    notePh: "Paste or type this stream notes here",
    notesStream: "Stream",
    linkMarker: "Marker",
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || "he";

export function getCurrentLang() {
  return currentLang;
}

export function t(key) {
  return (tr[currentLang] && tr[currentLang][key]) || tr.he[key] || key;
}

export function setLang(lang) {
  currentLang = lang === "en" ? "en" : "he";
  localStorage.setItem(STORAGE_KEY, currentLang);
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === "he" ? "rtl" : "ltr";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && t(key)) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key && t(key)) el.title = t(key);
  });

  const btn = document.getElementById("lang-btn");
  if (btn) btn.textContent = currentLang === "he" ? "EN" : "HE";
}

export function toggleLang() {
  setLang(currentLang === "he" ? "en" : "he");
  return currentLang;
}

export function applyLangToPanes(paneManager) {
  const dir = currentLang === "he" ? "rtl" : "ltr";
  for (const pane of paneManager.panes || []) {
    if (typeof pane.setDir === "function") pane.setDir(dir);
    if (!pane.streamCode) continue;
    const label = pane.element && pane.element.querySelector(".pane-label");
    if (label) label.textContent = `${t("notesStream")} ${pane.streamCode}`;
  }
}
