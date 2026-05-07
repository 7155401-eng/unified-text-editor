// smart_packer.js — TeX-inspired adaptive pagination orchestrator.
//
// משה 2026-05-07: המשתמש ביקש "מנוע שמתאים את כל העמוד לפי התוצאה הסופית
// שלו" — בהשראת Google Docs / Word / TeX (Knuth's insertions model).
//
// במקום לקבוע ערך כרית-בטחון קבוע מראש (160) שיתנקם בנו במסמכים אחרים,
// המנוע מודד את העמודים אחרי הרינדור ומכוון בעצמו לערך המינימלי שעדיין
// לא יוצר חריגה — ספציפי לכל מסמך.
//
// אלגוריתם:
// 1. רינדור ראשון = משתמש בערך הכרית הנוכחי (או 160 ברירת מחדל).
// 2. אחרי כל רינדור: מדידה של max-overflow ו-avg-gap על הדפים האמיתיים.
// 3. אם יש חריגה גלויה > 5px → הכרית נמוכה מדי, מעלים ב-20 ומסמנים rerender.
// 4. אם 0 חריגות וממוצע רווחים > 60px → הכרית גבוהה מדי, מורידים ב-20 ומסמנים rerender.
// 5. אם 0 חריגות וממוצע רווחים סביר → המצב יציב, שומרים את הערך לקאש.
// 6. עוצרים אחרי 6 איטרציות (ביטחון).
//
// הקאש (per-content-hash) נשמר ב-localStorage כדי שלא נצטרך ללמוד מחדש
// בכל פתיחת מסמך זהה.

const SMART_KEY = "ravtext.talmudLayout.smartEngine";
const SAFETY_KEY = "ravtext.talmudLayout.heightSafety";
const CACHE_PREFIX = "ravtext.talmudLayout.smartCache.";
const MAX_ITERATIONS = 6;
const ANTI_OSCILLATION_STEP = 20;
const SAFETY_MIN = 0;
const SAFETY_MAX = 400;

export function isSmartEngineEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SMART_KEY) === "1";
}

export function setSmartEngineEnabled(enabled) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SMART_KEY, enabled ? "1" : "0");
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function readSafety() {
  if (typeof localStorage === "undefined") return 160;
  const raw = localStorage.getItem(SAFETY_KEY);
  if (raw === null) return 160;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clamp(n, SAFETY_MIN, SAFETY_MAX) : 160;
}

function writeSafety(value) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SAFETY_KEY, String(clamp(value, SAFETY_MIN, SAFETY_MAX)));
}

// Hash content (paragraphs + notes) to identify identical documents.
// Using FNV-1a 32-bit; collision risk acceptable for this use case.
export function hashContent(content) {
  let h = 0x811c9dc5;
  if (!Array.isArray(content)) return String(h >>> 0);
  for (const para of content) {
    const text = (para?.mainText || "") + "";
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    if (Array.isArray(para?.notes)) {
      for (const n of para.notes) {
        const t = (n?.stream || "") + ":" + (n?.text || "") + "";
        for (let i = 0; i < t.length; i++) {
          h ^= t.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
      }
    }
  }
  return String(h >>> 0);
}

function readCachedSafety(contentHash) {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CACHE_PREFIX + contentHash);
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clamp(n, SAFETY_MIN, SAFETY_MAX) : null;
}

function writeCachedSafety(contentHash, value) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CACHE_PREFIX + contentHash, String(value));
}

// Measure all rendered pages: per-page overflow + bottom-gap.
// Skips pages marked hidden or placeholder.
export function measurePagesState(container) {
  if (!container) return { pages: [], maxOverflow: 0, avgGap: 0, totalGap: 0 };
  const pages = Array.from(
    container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)")
  ).filter(p => p.style.display !== "none");
  if (pages.length === 0) return { pages: [], maxOverflow: 0, avgGap: 0, totalGap: 0 };
  let maxOverflow = 0;
  let totalGap = 0;
  let countableGaps = 0;
  const perPage = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const r = p.getBoundingClientRect();
    const block = p.querySelector(":scope > .talmud-layout");
    const ps = p.querySelector(":scope > .page-streams");
    const main = p.querySelector(":scope > .page-main, :scope .page-main.talmud-main");
    const cands = [
      block?.getBoundingClientRect().bottom,
      ps?.getBoundingClientRect().bottom,
      main?.getBoundingClientRect().bottom,
    ].filter(x => x != null && x > 0);
    const lowest = cands.length ? Math.max(...cands) : r.top;
    const gap = Math.max(0, r.bottom - lowest);
    const overflow = Math.max(0, p.scrollHeight - p.clientHeight);
    perPage.push({ idx: i + 1, gap: Math.round(gap), overflow: Math.round(overflow) });
    if (overflow > maxOverflow) maxOverflow = overflow;
    // Last page is allowed to have gap (no source to pull from). Skip in avg.
    if (i < pages.length - 1) {
      totalGap += gap;
      countableGaps++;
    }
  }
  const avgGap = countableGaps > 0 ? totalGap / countableGaps : 0;
  return { pages: perPage, maxOverflow: Math.round(maxOverflow), avgGap: Math.round(avgGap), totalGap: Math.round(totalGap) };
}

// משה 2026-05-07: ההחלטה הזו עברה לשרת (worker/render_planner.js).
// הדפדפן רק מודד; הנוסחה (ספי overflow/gap, ערכי step) רצה בשרת בלבד.
export async function decideAdjustment(currentSafety, state) {
  const res = await fetch('/api/render/preflight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      layoutType: 'any',
      smart: { currentSafety, state },
    }),
  });
  if (!res.ok) {
    throw new Error(`smart adjustment failed: HTTP ${res.status}`);
  }
  const plan = await res.json();
  return plan.decisions?.safety || { newSafety: currentSafety, action: 'stable', reason: 'no-server-decision' };
}

// Public entry point: orchestrate the smart-tune cycle. Caller provides
// rerender(safetyValue) which packs+renders the document at that safety
// and returns when the DOM is stable. We measure, decide, possibly call
// rerender again, until stable or max iterations.
//
// contentHash: stable identifier of the document content for caching.
// Returns the final safety value used.
export async function runSmartTune(contentHash, container, rerender) {
  if (!isSmartEngineEnabled()) {
    // Not enabled — do nothing, return current safety.
    return readSafety();
  }
  // First, try cached value if we have one for this exact content.
  const cached = readCachedSafety(contentHash);
  if (cached !== null) {
    const currentSafety = readSafety();
    if (cached !== currentSafety) {
      writeSafety(cached);
      await rerender(cached);
    }
    return cached;
  }

  let currentSafety = readSafety();
  let history = new Set([currentSafety]);
  let lastAction = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const state = measurePagesState(container);
    const decision = await decideAdjustment(currentSafety, state);
    console.debug(`[smart-engine] iter ${iter} safety=${currentSafety} → ${decision.action} (${decision.reason})`);
    if (decision.action === "stable") {
      writeCachedSafety(contentHash, currentSafety);
      return currentSafety;
    }
    // Anti-oscillation: if we'd reverse direction immediately, stop.
    if (lastAction && lastAction !== decision.action) {
      // We just bounced — prefer the higher (safer) of the two.
      const safer = lastAction === "down" ? currentSafety + ANTI_OSCILLATION_STEP : decision.newSafety;
      writeCachedSafety(contentHash, safer);
      writeSafety(safer);
      if (safer !== currentSafety) await rerender(safer);
      return safer;
    }
    if (history.has(decision.newSafety)) {
      // Revisited a value — stop to avoid loop.
      writeCachedSafety(contentHash, currentSafety);
      return currentSafety;
    }
    history.add(decision.newSafety);
    lastAction = decision.action;
    currentSafety = decision.newSafety;
    writeSafety(currentSafety);
    await rerender(currentSafety);
  }
  // Hit max iterations — store whatever we have.
  writeCachedSafety(contentHash, currentSafety);
  return currentSafety;
}

// Clear the cache for a specific content hash (used when content edits invalidate it).
export function invalidateSmartCache(contentHash) {
  if (typeof localStorage === "undefined") return;
  if (contentHash) {
    localStorage.removeItem(CACHE_PREFIX + contentHash);
  }
}
