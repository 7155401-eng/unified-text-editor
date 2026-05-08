// sefaria_preset_manager.js — verbatim port of sefaria_preset_manager.py.
// 7 built-in Hebrew presets + user CRUD + favorites toggle + recent dedup
// cap 10. Storage: localStorage (Python used JSON files in %APPDATA%).

import {
  BOOK_TYPE_TANAKH, BOOK_TYPE_BAVLI, BOOK_TYPE_SHULCHAN_ARUKH,
  STORAGE_KEYS,
} from "./sefaria_book_metadata.js";

export const BUILTIN_PRESETS = {
  "מקרא מפורש": {
    book_type: BOOK_TYPE_TANAKH,
    commentators: ["Rashi", "Ibn Ezra", "Ramban", "Onkelos", "Sforno"],
    vowels: true,
    cantillation: true,
    description: "תנ\"ך עם רש\"י, אבן עזרא, רמב\"ן, אונקלוס וספורנו",
  },
  "תנ\"ך פשוט": {
    book_type: BOOK_TYPE_TANAKH,
    commentators: ["Rashi"],
    vowels: true,
    cantillation: true,
    description: "תנ\"ך עם רש\"י בלבד",
  },
  "מקראות גדולות": {
    book_type: BOOK_TYPE_TANAKH,
    commentators: ["Rashi", "Ibn Ezra", "Ramban", "Sforno", "Or HaChaim",
                   "Kli Yakar", "Rashbam", "Radak"],
    vowels: true,
    cantillation: true,
    description: "תנ\"ך עם 8 מפרשים קלאסיים",
  },
  "דף יומי": {
    book_type: BOOK_TYPE_BAVLI,
    commentators: ["Rashi", "Tosafot"],
    vowels: false,
    cantillation: false,
    description: "בבלי עם רש\"י ותוספות (פורמט וילנא)",
  },
  "ש\"ס מפורש": {
    book_type: BOOK_TYPE_BAVLI,
    commentators: ["Rashi", "Tosafot", "Maharsha", "Rashba"],
    vowels: false,
    cantillation: false,
    description: "בבלי עם רש\"י, תוס', מהרש\"א ורשב\"א",
  },
  "שולחן ערוך לבעלי בתים": {
    book_type: BOOK_TYPE_SHULCHAN_ARUKH,
    commentators: ["Mishnah Berurah", "Be'er Heitev", "Beur Halacha"],
    vowels: false,
    cantillation: false,
    description: "שו\"ע אורח חיים עם משנ\"ב, באר היטב וביאור הלכה",
  },
  "שולחן ערוך עיוני": {
    book_type: BOOK_TYPE_SHULCHAN_ARUKH,
    commentators: ["Mishnah Berurah", "Magen Avraham", "Taz", "Shach",
                   "Aruch HaShulchan"],
    vowels: false,
    cantillation: false,
    description: "שו\"ע עם 5 מפרשים עיקריים",
  },
};

function _loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function _saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function _loadUserPresets() { return _loadJson(STORAGE_KEYS.user_presets, {}); }
function _saveUserPresets(p) { return _saveJson(STORAGE_KEYS.user_presets, p); }

export function listAllPresets() {
  const out = Object.assign({}, BUILTIN_PRESETS);
  const u = _loadUserPresets();
  for (const k of Object.keys(u)) out[k] = u[k];
  return out;
}

export function getPreset(name) {
  return listAllPresets()[name];
}

export function savePreset(name, presetDict) {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, name)) {
    return [false, "preset_overwrite_builtin"];
  }
  const u = _loadUserPresets();
  const p = Object.assign({}, presetDict);
  if (!p.created) {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    p.created = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  u[name] = p;
  if (_saveUserPresets(u)) return [true, "preset_saved_short"];
  return [false, "preset_write_failed"];
}

export function deletePreset(name) {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, name)) {
    return [false, "preset_delete_builtin"];
  }
  const u = _loadUserPresets();
  if (!Object.prototype.hasOwnProperty.call(u, name)) {
    return [false, "preset_not_exists"];
  }
  delete u[name];
  _saveUserPresets(u);
  return [true, "preset_deleted"];
}

export function isBuiltin(name) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, name);
}

// Export to a JSON Blob (no path concept in browser)
export function exportPresetsBlob(names) {
  let u = _loadUserPresets();
  if (names && names.length) {
    const filtered = {};
    for (const n of names) if (Object.prototype.hasOwnProperty.call(u, n)) filtered[n] = u[n];
    u = filtered;
  }
  const text = JSON.stringify(u, null, 2);
  return {
    blob: new Blob([text], { type: "application/json" }),
    count: Object.keys(u).length,
  };
}

// Import from a parsed object (caller reads File via FileReader)
export function importPresetsFromObject(incoming, overwrite) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { added: 0, skipped: ["presets_format_invalid"] };
  }
  const u = _loadUserPresets();
  let added = 0;
  const skipped = [];
  for (const name of Object.keys(incoming)) {
    const p = incoming[name];
    if (Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, name)) {
      skipped.push({ key: "presets_skip_builtin", name });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(u, name) && !overwrite) {
      skipped.push({ key: "presets_skip_exists", name });
      continue;
    }
    u[name] = p;
    added++;
  }
  _saveUserPresets(u);
  return { added, skipped };
}

// Favorites & recent ──────────────────────────────────────────────────
function _loadList(key) { return _loadJson(key, []); }
function _saveList(key, arr) { return _saveJson(key, arr); }

export function getFavorites() {
  const v = _loadList(STORAGE_KEYS.favorites);
  return Array.isArray(v) ? v : [];
}

export function toggleFavorite(bookName) {
  const favs = getFavorites();
  const idx = favs.indexOf(bookName);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(bookName);
  _saveList(STORAGE_KEYS.favorites, favs);
  return favs;
}

export function getRecent(limit) {
  const lim = limit || 10;
  const v = _loadList(STORAGE_KEYS.recent);
  return Array.isArray(v) ? v.slice(0, lim) : [];
}

export function pushRecent(bookName, ref) {
  let items = _loadList(STORAGE_KEYS.recent);
  if (!Array.isArray(items)) items = [];
  // dedup by ref
  items = items.filter(e => e && e.ref !== ref);
  items.unshift({ book: bookName, ref, ts: Date.now() / 1000 });
  if (items.length > 10) items = items.slice(0, 10);
  _saveList(STORAGE_KEYS.recent, items);
  return items;
}
