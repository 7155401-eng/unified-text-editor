// word_extractor_i18n.js — כל המחרוזות (עברית + אנגלית) למודול ה-Word Extractor.
// ברירת המחדל: עברית (תואם word_extractor.py).

export const SOURCE_FOOTNOTE = 'footnote';
export const SOURCE_ENDNOTE = 'endnote';
export const SOURCE_COMMENT = 'comment';
export const SOURCE_CUSTOM = 'custom';
export const SOURCE_EXTERNAL = 'external';
export const SOURCE_SIDENOTE = 'sidenote';
export const SOURCE_PARALLEL = 'parallel';
// משה 2026-05-08: זרם מסוג "סוגריים" — כל מה שבין opener ל-closer (בלי custom_pattern).
export const SOURCE_BRACKETED = 'bracketed';

// תוויות עברית עם אמוג׳ים — verbatim מ-word_extractor.py SOURCE_LABELS
export const SOURCE_LABELS = {
  [SOURCE_FOOTNOTE]: '\u{1F4DD} שוליים',
  [SOURCE_ENDNOTE]:  '\u{1F4CB} סיום',
  [SOURCE_COMMENT]:  '\u{1F4AC} בלון',
  [SOURCE_CUSTOM]:   '\u{1F527} מותאם',
  [SOURCE_EXTERNAL]: '\u{1F4CE} מקושר',
  [SOURCE_SIDENOTE]: '\u{1F4CC} הערת צד',
  [SOURCE_PARALLEL]: '\u{1F4D6} טקסט מקביל',
};

// שמות סוגים בעברית להצגה (ללא אמוג׳י)
export const SOURCE_HEB_NAMES = {
  [SOURCE_FOOTNOTE]: 'שוליים',
  [SOURCE_ENDNOTE]:  'סיום',
  [SOURCE_COMMENT]:  'בלון',
  [SOURCE_CUSTOM]:   'מותאם',
  [SOURCE_EXTERNAL]: 'מקושר',
  [SOURCE_SIDENOTE]: 'הערת צד',
  [SOURCE_PARALLEL]: 'טקסט מקביל',
};

// אופציות מיקום הערות-צד
export const POSITION_OPTIONS = ['ימין', 'שמאל', 'פנימי', 'חיצוני'];
export const POSITION_MAP = {
  'ימין': 'right', 'שמאל': 'left', 'פנימי': 'inner', 'חיצוני': 'outer',
  'Right': 'right', 'Left': 'left', 'Inner': 'inner', 'Outer': 'outer'
};

// אותיות הסדרה (A..L) — verbatim מ-word_extractor.py
export const SERIES_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export const BRACKET_STYLES = [['(', ')'], ['[', ']'], ['<', '>']];

export const NUM_STYLE_MAP = {
  'אותיות עבריות':         '\\alph',
  'מספרים (1,2,3)':         '\\arabic',
  'אותיות אנגלית קטנות':    '\\alph',
  'אותיות רומיות':          '\\roman',
  'ללא סימן היכר':          'none',
};

// מחרוזות UI
export const UI = {
  he: {
    title: 'ייבוא Word עם זרמים מלאים',
    desc: 'בחר קובץ DOCX, סקור את הזרמים שזוהו אוטומטית ואשר את המיפוי לפני הייבוא.',
    chooseFile: 'בחר קובץ DOCX…',
    noFile: 'לא נבחר קובץ.',
    scanning: 'סורק את המסמך…',
    scanFailed: 'שגיאה בקריאת הקובץ:',
    detectedSources: 'מקורות שזוהו:',
    docTitle: 'כותרת מסמך:',
    docSubtitle: 'כותרת משנה:',
    headerLabel: 'כותרת עליונה:',
    footerLabel: 'כותרת תחתונה:',
    sectionsLabel: 'מקטעים:',
    stylesLabel: 'סגנונות:',
    streamsTable: 'מיפוי זרמים',
    colInclude: 'לכלול',
    colSourceType: 'סוג מקור',
    colMarker: 'סמן',
    colCount: 'הערות',
    colSeries: 'אות זרם',
    colPosition: 'מיקום',
    colPreview: 'תצוגה מקדימה',
    previewBtn: 'הצג',
    previewClose: 'סגור',
    confirm: 'ייבא',
    cancel: 'ביטול',
    chooseSeries: 'בחר אות',
    autoMapDefault: 'ברירת-מחדל אוטומטית',
    autoMapInfo: 'A=שוליים · B=סיום · C=בלון · D=הערת צד · E…=נוספים',
    none: 'ללא סימון',
    inlineLabel: 'inline',
    note: 'הערה',
    notes: 'הערות',
    noFootnotes: 'לא נמצאו הערות שוליים.',
    noEndnotes: 'לא נמצאו הערות סיום.',
    noComments: 'לא נמצאו הערות בלון.',
    noSidenotes: 'לא נמצאו הערות צד.',
    selectAtLeastOne: 'יש לבחור לפחות זרם אחד לייבוא.',
    importDone: 'ייבוא הושלם:',
    streamsCreated: 'נוצרו חלוניות זרם:',
    seriesAlreadyUsed: 'אות זרם בשימוש — בחר אחרת.',
    importFailed: 'ייבוא נכשל:',
    paragraph: 'פסקה',
    paragraphs: 'פסקאות',
    btnLabel: '\u{1F4D8} ייבא Word עם זרמים מלאים',
    btnTitle: 'ייבוא DOCX מתקדם — שוליים, סיום, בלונים והערות צד כזרמים נפרדים',
  },
  en: {
    title: 'Import Word with full streams',
    desc: 'Pick a DOCX file, review the auto-detected streams and confirm the mapping before import.',
    chooseFile: 'Choose DOCX…',
    noFile: 'No file selected.',
    scanning: 'Scanning document…',
    scanFailed: 'Failed to read file:',
    detectedSources: 'Detected sources:',
    docTitle: 'Document title:',
    docSubtitle: 'Subtitle:',
    headerLabel: 'Header:',
    footerLabel: 'Footer:',
    sectionsLabel: 'Sections:',
    stylesLabel: 'Styles:',
    streamsTable: 'Stream mapping',
    colInclude: 'Include',
    colSourceType: 'Source type',
    colMarker: 'Marker',
    colCount: 'Notes',
    colSeries: 'Series',
    colPosition: 'Position',
    colPreview: 'Preview',
    previewBtn: 'Show',
    previewClose: 'Close',
    confirm: 'Import',
    cancel: 'Cancel',
    chooseSeries: 'Pick letter',
    autoMapDefault: 'Default mapping',
    autoMapInfo: 'A=footnotes · B=endnotes · C=comments · D=sidenotes · E…=others',
    none: 'unmarked',
    inlineLabel: 'inline',
    note: 'note',
    notes: 'notes',
    noFootnotes: 'No footnotes found.',
    noEndnotes: 'No endnotes found.',
    noComments: 'No comments found.',
    noSidenotes: 'No sidenotes found.',
    selectAtLeastOne: 'Pick at least one stream to import.',
    importDone: 'Import complete:',
    streamsCreated: 'Stream panes created:',
    seriesAlreadyUsed: 'Series letter is already used — pick another.',
    importFailed: 'Import failed:',
    paragraph: 'paragraph',
    paragraphs: 'paragraphs',
    btnLabel: '\u{1F4D8} Import Word with full streams',
    btnTitle: 'Advanced DOCX import — footnotes, endnotes, comments and sidenotes as separate streams',
  },
};

export function getLang() {
  try {
    const v = localStorage.getItem('ravtext.lang');
    if (v === 'en' || v === 'he') return v;
  } catch (e) { /* ignore */ }
  return 'he';
}

export function t(key) {
  const lang = getLang();
  return (UI[lang] && UI[lang][key]) || (UI.he[key]) || key;
}
