// Settings + history persistence — localStorage port of work-files/text_compare_pro/engine/storage.py
// Schema and defaults verbatim from storage.py.

const SETTINGS_KEY = "ravtext.text_compare_pro.settings";
const HISTORY_KEY = "ravtext.text_compare_pro.history";
const MAX_HISTORY = 50;

const DEFAULTS = {
  sim_threshold: 60,
  consec_limit: 0,
  ignore_items: [],
  active_tab: "smart_compare",
  auto_load_last: true,
  last_doc1: "",
  last_doc2: "",
  last_base: "",
  last_insert: "",
  last_merged: "",
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return Object.assign({}, DEFAULTS);
    const data = JSON.parse(raw) || {};
    return Object.assign({}, DEFAULTS, data);
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

export function saveSettings(data) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    return false;
  }
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

export function addHistory(entry) {
  const items = loadHistory();
  entry.ts = Math.floor(Date.now() / 1000);
  items.unshift(entry);
  const trimmed = items.slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([]));
    return true;
  } catch (_) {
    return false;
  }
}
