// sefaria_api_client.js — verbatim port of sefaria_api_client.py.
// fetch + retry exponential 1→2→4 sec + rate-limit 5/sec.
// No persistent cache (per Moshe's decision — original sqlite cache dropped
// for browser context). Hebrew error log kept in localStorage.
//
// Public API (matches Python module):
//   getIndex, getShape(book), getText(ref, opts),
//   getLinks(ref, withText), getCalendars, getVersions(book),
//   listCommentariesForRef(ref), fetchCommentaryTextForRef(ref, title),
//   extractCommentaryText(linksData, title),
//   extractCommentaryLinks(linksData, title),
//   getDailyDafRef(), getWeeklyParshaRef(),
//   cacheInvalidate(prefix), readErrorLog(), clearErrorLog().

import { errorsLogPath } from "./sefaria_book_metadata.js";

export const BASE_URL = "https://www.sefaria.org";
export const DEFAULT_TIMEOUT_MS = 15000;
const RATE_INTERVAL_MS = 1000.0 / 5.0;  // 5 req/sec
let lastRequestTime = 0;

// ──────────────────────────────────────────────────────────────────────
// Hebrew log (in localStorage; Python writes to file)
// ──────────────────────────────────────────────────────────────────────
function _ts() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function _logAppend(line) {
  try {
    const key = errorsLogPath();
    const cur = localStorage.getItem(key) || "";
    let next = cur + line + "\n";
    // Cap log to 256 KB.
    if (next.length > 262144) {
      next = next.slice(next.length - 200000);
    }
    localStorage.setItem(key, next);
  } catch (_) { /* quota exceeded — drop silently */ }
}

export function _logError(msg) { _logAppend("[" + _ts() + "] " + msg); }
export function _logInfo(msg) { _logAppend("[" + _ts() + "] ℹ " + msg); }

export function readErrorLog(maxLines = 200) {
  try {
    const all = localStorage.getItem(errorsLogPath()) || "";
    const lines = all.split("\n");
    return lines.slice(-maxLines).join("\n");
  } catch (_) { return ""; }
}

export function clearErrorLog() {
  try { localStorage.removeItem(errorsLogPath()); } catch (_) {}
}

// ──────────────────────────────────────────────────────────────────────
// Rate limiter (5 req / sec)
// ──────────────────────────────────────────────────────────────────────
async function _rateWait() {
  const now = performance.now();
  const delta = now - lastRequestTime;
  if (delta < RATE_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, RATE_INTERVAL_MS - delta));
  }
  lastRequestTime = performance.now();
}

// ──────────────────────────────────────────────────────────────────────
// Core fetch with retry 1→2→4
// ──────────────────────────────────────────────────────────────────────
function _fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      "Accept": "application/json",
      "User-Agent": "TorahTypesetter/11.50",
    },
  }).finally(() => clearTimeout(tid));
}

async function _request(url, params) {
  // Build full URL with query string
  let full = url;
  if (params && typeof params === "object") {
    const usp = new URLSearchParams();
    for (const k of Object.keys(params)) {
      if (params[k] === undefined || params[k] === null) continue;
      usp.append(k, String(params[k]));
    }
    const qs = usp.toString();
    if (qs) full += (url.indexOf("?") === -1 ? "?" : "&") + qs;
  }

  let delayMs = 1000;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await _rateWait();
    const t0 = performance.now();
    try {
      const r = await _fetchWithTimeout(full, DEFAULT_TIMEOUT_MS);
      const elapsed = (performance.now() - t0) / 1000.0;
      if (r.status === 200) {
        const data = await r.json();
        const path = full.indexOf(BASE_URL) === 0 ? full.slice(BASE_URL.length) : full;
        let sizeKb = 0;
        try {
          // crude estimate: re-stringify
          sizeKb = JSON.stringify(data).length / 1024.0;
        } catch (_) {}
        _logInfo(`✅ ${path} — ${elapsed.toFixed(2)}s, ${sizeKb.toFixed(1)}KB`);
        return data;
      }
      lastErr = `HTTP ${r.status} (after ${elapsed.toFixed(2)}s)`;
      if (r.status === 404 || r.status === 400) {
        const path = full.indexOf(BASE_URL) === 0 ? full.slice(BASE_URL.length) : full;
        _logError(`❌ ${path}: ${lastErr} (לא קיים — לא מנסה שוב)`);
        return null;
      }
    } catch (e) {
      const elapsed = (performance.now() - t0) / 1000.0;
      lastErr = `${e && e.name ? e.name : "Error"} (after ${elapsed.toFixed(2)}s)`;
    }
    if (attempt < 2) {
      const path = full.indexOf(BASE_URL) === 0 ? full.slice(BASE_URL.length) : full;
      _logError(`⚠ ${path}: ${lastErr} — ניסיון ${attempt + 1}/3 בעוד ${(delayMs / 1000).toFixed(0)} שניות`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
  const path = full.indexOf(BASE_URL) === 0 ? full.slice(BASE_URL.length) : full;
  _logError(`❌ ${path}: ${lastErr} — נכשל אחרי 3 ניסיונות`);
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────
export function getIndex() {
  return _request(`${BASE_URL}/api/index`);
}

export function getShape(bookName) {
  return _request(`${BASE_URL}/api/shape/${encodeURIComponent(bookName)}`);
}

export async function getText(ref, opts) {
  opts = opts || {};
  const params = { return_format: "default" };
  if (opts.version) params.versions = opts.version;
  const data = await _request(`${BASE_URL}/api/v3/texts/${encodeURIComponent(ref)}`, params);
  if (data === null) return null;
  if (data && typeof data === "object") {
    const versions = data.versions || [];
    const keepVowels = opts.with_vowels !== false;
    const keepCant = opts.with_cantillation !== false;
    for (const v of versions) {
      if (Array.isArray(v.text)) {
        v.text = v.text.map(s => stripMarks(s, keepVowels, keepCant));
      } else if (typeof v.text === "string") {
        v.text = stripMarks(v.text, keepVowels, keepCant);
      }
    }
  }
  return data;
}

export function stripMarks(s, keepVowels, keepCantillation) {
  if (typeof s !== "string") return s;
  if (keepVowels && keepCantillation) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i);
    const isVowel = (cp >= 0x05B0 && cp <= 0x05BC) || cp === 0x05C1 || cp === 0x05C2 || cp === 0x05C7;
    const isCant =
      (cp >= 0x0591 && cp <= 0x05AF) ||
      (cp >= 0x05BD && cp <= 0x05C0) ||
      (cp >= 0x05C3 && cp <= 0x05C6);
    if (isVowel && !keepVowels) continue;
    if (isCant && !keepCantillation) continue;
    out += s[i];
  }
  return out;
}

export function getLinks(ref, withText) {
  const wt = (withText === undefined || withText === true) ? 1 : 0;
  return _request(`${BASE_URL}/api/links/${encodeURIComponent(ref)}`, { with_text: wt });
}

export function getCalendars() {
  return _request(`${BASE_URL}/api/calendars`);
}

export function getVersions(bookName) {
  return _request(`${BASE_URL}/api/texts/versions/${encodeURIComponent(bookName)}`);
}

// High-level helpers
export async function listCommentariesForRef(ref) {
  const data = await getLinks(ref, false);
  if (!data) return [];
  const counts = {};
  const hebFor = {};
  for (const link of data) {
    if (!link || link.type !== "commentary") continue;
    const ct = link.collectiveTitle || {};
    const titleEn = ct.en || link.index_title || link.commentator;
    const titleHe = ct.he || link.heCollectiveTitle || link.heCommentator || link.heTitle;
    if (!titleEn) continue;
    counts[titleEn] = (counts[titleEn] || 0) + 1;
    if (titleHe && !hebFor[titleEn]) hebFor[titleEn] = titleHe;
  }
  const out = [];
  for (const t of Object.keys(counts)) {
    out.push({ title: t, heb: hebFor[t] || t, count: counts[t] });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export async function fetchCommentaryTextForRef(ref, commentatorTitle) {
  const data = await getLinks(ref, true);
  return extractCommentaryText(data, commentatorTitle);
}

export function extractCommentaryText(linksData, commentatorTitle) {
  if (!linksData) return "";
  const parts = [];
  for (const link of linksData) {
    if (!link || link.type !== "commentary") continue;
    const ct = link.collectiveTitle || {};
    const title = ct.en || link.index_title;
    if (title !== commentatorTitle) continue;
    let he = link.he || "";
    if (Array.isArray(he)) he = he.filter(x => x).map(x => String(x)).join(" ");
    if (he && String(he).trim()) parts.push(String(he).trim());
  }
  return parts.join(" ");
}

export function extractCommentaryLinks(linksData, commentatorTitle) {
  if (!linksData) return [];
  const out = [];
  for (const link of linksData) {
    if (!link || link.type !== "commentary") continue;
    const ct = link.collectiveTitle || {};
    const title = ct.en || link.index_title;
    if (title !== commentatorTitle) continue;
    let he = link.he || "";
    if (Array.isArray(he)) he = he.filter(x => x).map(x => String(x)).join(" ");
    let text = link.text || "";
    if (Array.isArray(text)) text = text.filter(x => x).map(x => String(x)).join(" ");
    const anchorRef = link.anchorRef || "";
    const commentaryRef = link.ref || "";
    if (he && String(he).trim()) {
      out.push({
        anchor_ref: anchorRef,
        commentary_ref: commentaryRef,
        he: String(he).trim(),
        text: text ? String(text).trim() : "",
        collective_title: link.collectiveTitle || {},
      });
    }
  }
  return out;
}

export async function getDailyDafRef() {
  const data = await getCalendars();
  if (!data) return null;
  const items = data.calendar_items || [];
  for (const item of items) {
    const titleEn = (item && item.title && item.title.en) || "";
    if (titleEn.indexOf("Daf Yomi") !== -1) return item.ref;
  }
  return null;
}

export async function getWeeklyParshaRef() {
  const data = await getCalendars();
  if (!data) return null;
  const items = data.calendar_items || [];
  for (const item of items) {
    const titleEn = (item && item.title && item.title.en) || "";
    if (titleEn.indexOf("Parashat") !== -1 || titleEn.indexOf("Parshat") !== -1) {
      return item.ref;
    }
  }
  return null;
}

// Cache invalidate is a no-op in the browser port (we never cache).
// Kept so the UI's "🔄 רענן API" button can call it without changes.
export function cacheInvalidate(_prefix) { return 0; }
