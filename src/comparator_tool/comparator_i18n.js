// Comparator tool — מילון תרגומים מלא (ported verbatim from comparator_tool.py)
// כולל את כל מחרוזות העברית/אנגלית של שתי הגרסאות (גרסה מלאה + גרסה משתלבת).

export const COMPARATOR_TR = {
  'he': {
    addPane: '📄 חלונית חדשה', split: '✂ הפרד הערות', merge: '🔗 מזג / פרק',
    unmerge: '🔗 פרק חזרה לחלוניות', export: '💾 שמור ל-Word', import: '📂 טען מ-Word',
    preview: '👁 עורך ויזואלי', edit: '👁 חזור לעריכה', sync: '🔗 גלילה', lines: '☷ שורות',
    prev: '▲ הקודם', next: '▼ הבא',
    t_actions: 'פעולות', t_files: 'קבצים', t_view: 'תצוגה', t_width: 'רוחב כללי',
    t_theme: 'גודל וערכת נושא', t_nav: 'ניווט סימנים',
    mainText: 'טקסט ראשי', notesStream: 'הערות — זרם', linkMarker: ':סימן קישור',
    importTitle: 'טעינה מקובץ Word', importDesc: 'סמנו זרמים והגדירו סימן קישור:',
    btnLoad: 'טען', btnCancel: 'ביטול',
    mainPh: 'הדבק טקסט ראשי...', notePh: 'הדבק הערות...',
    alertSplit: 'נדרשת חלונית טקסט ראשי וחלונית הערות אחת לפחות כדי לבצע פיצול.',
    promptFilter: 'הזן סימן לסינון (הערות המכילות סימן זה יעברו לחלון חדש):',
    promptNewSym: 'הזן סימן קישור חדש (יופיע במקור במקום ההערה שהועברה):',
    alertNoSym: 'חסר סימן קישור בחלונית ההערות (זרם 1).',
    alertNoMatch: 'לא נמצאו הערות המכילות את הסימן: ',
    alertSaved: 'הקובץ נשמר בהצלחה:\n',
    // v11.40 — כותרות לחלונות ה-wow
    btnOk: 'אישור',
    wowT_saved: 'נשמר בהצלחה',
    wowT_noSplit: 'לא ניתן לפצל',
    wowT_noSym: 'חסר סימן קישור',
    wowT_noMatch: 'לא נמצאה התאמה',
    wowT_noNotes: 'לא נמצאו הערות שוליים',
    wowM_noNotes: 'הקובץ נטען, אבל אין בו הערות שוליים. נטען רק הטקסט הראשי לעריכה.',
    wowT_noSelection: 'בחירה חסרה',
    wowM_noSelection: 'יש לסמן לפחות זרם אחד לפני הטעינה.',
    transferTitle: 'הגדרות העתקת טקסט',
    transferDesc: 'הגדר את יעד ההעתקה מהטקסט הראשי:',
    btnSave: 'שמור',
    windowTitle: 'כלי עריכת הערות שוליים - גרסה מלאה ודו-לשונית'
  },
  'en': {
    addPane: '📄 New Pane', split: '✂ Split Notes', merge: '🔗 Merge / Split',
    unmerge: '🔗 Split Back', export: '💾 Save to Word', import: '📂 Load Word',
    preview: '👁 Visual Editor', edit: '👁 Edit', sync: '🔗 Sync', lines: '☷ Lines',
    prev: '▲ Prev', next: '▼ Next',
    t_actions: 'Actions', t_files: 'Files', t_view: 'View', t_width: 'Global Width',
    t_theme: 'Size & Theme', t_nav: 'Jump Marker',
    mainText: 'Main Text', notesStream: 'Notes — Stream', linkMarker: 'Marker:',
    importTitle: 'Load from Word', importDesc: 'Select streams and set a marker:',
    btnLoad: 'Load', btnCancel: 'Cancel',
    mainPh: 'Paste main text here...', notePh: 'Paste notes here...',
    alertSplit: 'Main text and at least one notes pane are required to split.',
    promptFilter: 'Enter filter symbol (notes containing this will move to a new pane):',
    promptNewSym: 'Enter new link symbol (will appear in main text):',
    alertNoSym: 'Missing link symbol in notes pane (stream 1).',
    alertNoMatch: 'No notes found containing the symbol: ',
    alertSaved: 'File saved successfully:\n',
    // v11.40 — wow modal titles
    btnOk: 'OK',
    wowT_saved: 'Saved',
    wowT_noSplit: 'Cannot Split',
    wowT_noSym: 'Missing Link Symbol',
    wowT_noMatch: 'No Match Found',
    wowT_noNotes: 'No Footnotes Found',
    wowM_noNotes: 'The file was loaded, but contains no footnote streams. Only the main text was loaded for editing.',
    wowT_noSelection: 'Selection Missing',
    wowM_noSelection: 'You must select at least one stream before loading.',
    transferTitle: 'Text Transfer Settings',
    transferDesc: 'Configure the destination for transfer from the main text:',
    btnSave: 'Save',
    windowTitle: 'Footnote Editor — Full Bilingual Version'
  }
};

// Quill toolbar tooltips (Hebrew strings preserved verbatim from comparator_tool.py)
export const COMPARATOR_TOOLTIPS = {
  '.ql-bold': 'מודגש (Ctrl+B)',
  '.ql-italic': 'נטוי (Ctrl+I)',
  '.ql-underline': 'קו תחתון (Ctrl+U)',
  '.ql-strike': 'קו חוצה',
  '.ql-size': 'גודל גופן',
  '.ql-header': 'כותרות',
  '.ql-list[value="ordered"]': 'רשימה ממוספרת',
  '.ql-list[value="bullet"]': 'רשימת תבליטים',
  '.ql-script[value="sub"]': 'כתב תחתון',
  '.ql-script[value="super"]': 'כתב עילי',
  '.ql-indent[value="-1"]': 'הקטן הזחה',
  '.ql-indent[value="+1"]': 'הגדל הזחה',
  '.ql-direction[value="rtl"]': 'כיוון ימין לשמאל',
  '.ql-align': 'יישור טקסט',
  '.ql-color': 'צבע טקסט',
  '.ql-background': 'צבע רקע',
  '.ql-link': 'קישור',
  '.ql-image': 'תמונה',
  '.ql-video': 'וידאו',
  '.ql-clean': 'נקה עיצוב'
};

// Tools menu (from showExpandedTools in comparator_tool.py)
export const COMPARATOR_EXPANDED_TOOLS = [
  { text: '📊 סטטיסטיקות', action: 'showStats' },
  { text: '🔍 חיפוש מתקדם', action: 'advancedSearch' },
  { text: '📝 מעצב טקסט', action: 'textFormatter' },
  { text: '🎨 ערכות נושא', action: 'themeSelector' },
  { text: '⚡ פעולות מהירות', action: 'quickActions' },
  { text: '🔗 ניהול קישורים', action: 'linkManager' },
  { text: '📋 היסטוריית עריכה', action: 'editHistory' },
  { text: '🛠️ הגדרות מתקדמות', action: 'advancedSettings' }
];

// Quick-tag menu items (from showQuickTagMenu in comparator_tool.py)
export const COMPARATOR_QUICK_TAGS = [
  { label: 'B', tag: 'b', title: 'מודגש' },
  { label: 'I', tag: 'i', title: 'נטוי' },
  { label: 'U', tag: 'u', title: 'קו תחתון' },
  { label: 'BR', tag: 'br', title: 'שבירת שורה' }
];

// Default markers (from `dm` in both Python files)
export const COMPARATOR_DEFAULT_MARKERS = ['@01','@02','@03','@04','@05','@06','@07','@08'];

// Marker color cycle (from `MC` in both Python files)
export const COMPARATOR_MARKER_COLORS = [
  {bg:'#0984e3',fg:'#fff'},
  {bg:'#00b894',fg:'#fff'},
  {bg:'#e17055',fg:'#fff'},
  {bg:'#6c5ce7',fg:'#fff'},
  {bg:'#fdcb6e',fg:'#000'},
  {bg:'#636e72',fg:'#fff'}
];
