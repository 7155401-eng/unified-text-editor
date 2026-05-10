// Comparator tool — שמירת העדפות ב-localStorage (תחליף ל-AppData/RavText/lang.txt + theme.txt)
// במקור Python נשמר ב-os.environ.APPDATA/RavText/lang.txt ו-LOCALAPPDATA/RavText/theme.txt.
// בדפדפן אנו משתמשים ב-localStorage עם prefix "ravtext.comparator.*".

const KEY_LANG = 'ravtext.comparator.lang';
const KEY_THEME = 'ravtext.comparator.theme';
const KEY_FONTSIZE = 'ravtext.comparator.fontSize';
const KEY_TRANSFER = 'ravtext.comparator.transferSettings';
const KEY_LAST_FILE = 'ravtext.comparator.lastFileName';

export function getLangPref() {
  try {
    const v = localStorage.getItem(KEY_LANG);
    return v === 'en' ? 'en' : 'he';
  } catch (_) {
    return 'he';
  }
}

export function setLangPref(lang) {
  try {
    localStorage.setItem(KEY_LANG, lang === 'en' ? 'en' : 'he');
  } catch (_) {}
}

export function toggleLangPref() {
  const cur = getLangPref();
  const next = cur === 'he' ? 'en' : 'he';
  setLangPref(next);
  return next;
}

export function getThemePref() {
  try {
    const v = (localStorage.getItem(KEY_THEME) || '').toLowerCase();
    return v === 'light' ? 'light' : 'dark';
  } catch (_) {
    return 'dark';
  }
}

export function setThemePref(theme) {
  try {
    localStorage.setItem(KEY_THEME, theme === 'light' ? 'light' : 'dark');
  } catch (_) {}
}

export function getFontSize() {
  try {
    const v = parseInt(localStorage.getItem(KEY_FONTSIZE) || '15', 10);
    if (Number.isFinite(v) && v >= 10 && v <= 40) return v;
  } catch (_) {}
  return 15;
}

export function setFontSize(size) {
  try {
    const v = Math.max(10, Math.min(40, parseInt(size, 10) || 15));
    localStorage.setItem(KEY_FONTSIZE, String(v));
  } catch (_) {}
}

export function getTransferSettings() {
  try {
    const raw = localStorage.getItem(KEY_TRANSFER);
    if (!raw) return { targetStream: 2, prefix: '', suffix: '' };
    const d = JSON.parse(raw);
    return {
      targetStream: parseInt(d.targetStream, 10) || 2,
      prefix: typeof d.prefix === 'string' ? d.prefix : '',
      suffix: typeof d.suffix === 'string' ? d.suffix : ''
    };
  } catch (_) {
    return { targetStream: 2, prefix: '', suffix: '' };
  }
}

export function setTransferSettings(settings) {
  try {
    localStorage.setItem(KEY_TRANSFER, JSON.stringify({
      targetStream: parseInt(settings.targetStream, 10) || 2,
      prefix: settings.prefix || '',
      suffix: settings.suffix || ''
    }));
  } catch (_) {}
}

export function getLastFileName() {
  try {
    return localStorage.getItem(KEY_LAST_FILE) || '';
  } catch (_) {
    return '';
  }
}

export function setLastFileName(name) {
  try {
    if (name) localStorage.setItem(KEY_LAST_FILE, name);
  } catch (_) {}
}

// Suggest a unique filename based on a base name. In the Python original, this
// scans the user's Documents folder; in the browser we cannot list the FS, so
// we just append "(ערוך)" / a numeric suffix that the save dialog can accept.
export function suggestSaveFilename(originalName) {
  const base = originalName
    ? (originalName.replace(/\.[^.]+$/, '') + ' (ערוך)')
    : 'רב טקסט בוורד';
  return `${base}.doc`;
}
