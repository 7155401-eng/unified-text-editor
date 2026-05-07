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
const SAFETY_KEY_TALMUD = "ravtext.talmudLayout.heightSafety";
const SAFETY_KEY_REGULAR = "ravtext.layout.heightSafetyRegular";
const TALMUD_TOGGLE_KEY = "ravtext.talmudLayout";
const CACHE_PREFIX = "ravtext.talmudLayout.smartCache.";

// משה 2026-05-07: המנוע החכם פעיל גם במצב רגיל (לא רק תלמודי). מזהה את המצב
// ומכוון את המפתח המתאים: heightSafety לתלמוד (ברירת מחדל 160) או
// heightSafetyRegular לרגיל (ברירת מחדל 6).
function isTalmudActive() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(TALMUD_TOGGLE_KEY) === "1";
}
function activeSafetyKey() {
  return isTalmudActive() ? SAFETY_KEY_TALMUD : SAFETY_KEY_REGULAR;
}
function defaultSafetyForMode() {
  return isTalmudActive() ? 160 : 6;
}
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
  const def = defaultSafetyForMode();
  if (typeof localStorage === "undefined") return def;
  const raw = localStorage.getItem(activeSafetyKey());
  if (raw === null) return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clamp(n, SAFETY_MIN, SAFETY_MAX) : def;
}

function writeSafety(value) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(activeSafetyKey(), String(clamp(value, SAFETY_MIN, SAFETY_MAX)));
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

// משה 2026-05-07: בדיקת איכות פיצולי שורה. ל-paragraph שמתפצל בין עמוד N
// ל-N+1, השורה האחרונה בעמוד N צריכה להיות מלאה (~72%+ מרוחב הטקסט) ולא
// להיגמר באמצע מילה. אם המנוע פיצל פסקה כך שהשורה האחרונה כמעט ריקה או
// נחתכה באמצע מילה — זה "פיצול אמצע שורה" ויש להעלות את הכרית כדי לדחוף
// יותר טקסט לעמוד הבא ולקבל סיום שורה נכון.
const AWKWARD_LAST_LINE_FILL = 0.55;

function lastTextLineInfo(pageMain) {
  if (!pageMain) return null;
  const ps = pageMain.querySelectorAll(":scope p, :scope > p");
  if (!ps.length) return null;
  const lastP = ps[ps.length - 1];
  const rects = lastP.getClientRects();
  if (rects.length === 0) return null;
  let maxWidth = 0;
  for (const r of rects) if (r.width > maxWidth) maxWidth = r.width;
  if (maxWidth <= 0) return null;
  const last = rects[rects.length - 1];
  const fill = last.width / maxWidth;
  const text = (lastP.textContent || "").trimEnd();
  const lastChar = text.charAt(text.length - 1);
  // אות עברית/לטינית בסוף = יכול להיות אמצע מילה. סימני פיסוק = סוף נורמלי.
  const endsAtPunctuation = /[.,;:!?״"׳'\)\]}־׃׳״]\s*$/.test(text);
  const endsAtLetter = /[֐-׿A-Za-z]$/.test(text);
  return { fill, lastChar, endsAtPunctuation, endsAtLetter, hasMultipleLines: rects.length > 1 };
}

// Measure all rendered pages: per-page overflow + bottom-gap + line-quality.
// Skips pages marked hidden or placeholder.
export function measurePagesState(container) {
  if (!container) return { pages: [], maxOverflow: 0, avgGap: 0, totalGap: 0, awkwardSplits: 0 };
  const pages = Array.from(
    container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)")
  ).filter(p => p.style.display !== "none");
  if (pages.length === 0) return { pages: [], maxOverflow: 0, avgGap: 0, totalGap: 0, awkwardSplits: 0 };
  let maxOverflow = 0;
  let totalGap = 0;
  let countableGaps = 0;
  let awkwardSplits = 0;
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

    let awkward = false;
    if (i < pages.length - 1) {
      const info = lastTextLineInfo(main);
      if (info && info.hasMultipleLines && info.fill < AWKWARD_LAST_LINE_FILL && info.endsAtLetter && !info.endsAtPunctuation) {
        awkward = true;
        awkwardSplits++;
      }
    }
    perPage.push({ idx: i + 1, gap: Math.round(gap), overflow: Math.round(overflow), awkward });
    if (overflow > maxOverflow) maxOverflow = overflow;
    if (i < pages.length - 1) {
      totalGap += gap;
      countableGaps++;
    }
  }
  const avgGap = countableGaps > 0 ? totalGap / countableGaps : 0;
  return { pages: perPage, maxOverflow: Math.round(maxOverflow), avgGap: Math.round(avgGap), totalGap: Math.round(totalGap), awkwardSplits };
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
  // משה 2026-05-07: ההחלטה היא בשרת (worker/render_planner.js). state כולל
  // עכשיו גם awkwardSplits — השרת יוכל להוסיף לוגיקה שעולה את הכרית
  // כשמזוהה פיצול אמצע-שורה. עד אז: קבל את ההחלטה מהשרת כפי שהיא.
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

// משה 2026-05-07: post-process לפיצולים מכוערים. שורה אחרונה קצרה באמצע
// פסקה — קודם מנסים לדחוף מילה אחת מהעמוד הבא לאחור (אם נכנסת בלי חריגה),
// ואם לא — מותחים את השורה האחרונה (text-align-last:justify) כדי למלא את
// הרוחב. זה תיקון ברמת השורה — לא ברמת השוליים. הפעולה הזו מקצה את עצמה
// רק כשמנוע חכם דולק ורק בעמודי המשך־פסקה (לא בסוף פסקה אמיתי).
const PUSHBACK_AWKWARD_FILL = 0.55;
// סוף משפט: נקודה, סימן שאלה/קריאה, נקודתיים סופיות, סוגרי מירכאות
const SENTENCE_END = /[.!?:׃״”]\s*$/;

function getMainParagraphs(pageEl) {
  const main = pageEl?.querySelector(":scope > .page-main, :scope .page-main");
  if (!main) return [];
  return Array.from(main.querySelectorAll(":scope > p"));
}

function lastLineFill(p) {
  const rects = p.getClientRects();
  if (rects.length < 2) return { fill: 1, multiline: false };
  let maxWidth = 0;
  for (const r of rects) if (r.width > maxWidth) maxWidth = r.width;
  if (maxWidth <= 0) return { fill: 1, multiline: false };
  return { fill: rects[rects.length - 1].width / maxWidth, multiline: true };
}

function isContinuedParagraph(lastP, firstNextP) {
  // היוריסטיקה: שתי פסקאות = אותו משך אם ה-tag זהה והאות הראשונה של הבאה
  // לא מתחילה משפט חדש (לא מתחילה ב-Capital, ולא קודם נקודתיים בסוף הקודמת).
  // לא מושלם — אבל בטוח: עדיף להחמיץ מאשר לדחוף מילה ממקום אחר בטעות.
  if (!lastP || !firstNextP) return false;
  if (lastP.tagName !== firstNextP.tagName) return false;
  const lastText = (lastP.textContent || "").trimEnd();
  if (SENTENCE_END.test(lastText)) return false;
  return true;
}

export function rebalanceAwkwardSplits(container) {
  if (!container) return { stretched: 0, pushed: 0 };
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"))
    .filter((p) => p.style.display !== "none");
  let stretched = 0;
  let pushed = 0;

  for (let i = 0; i < pages.length - 1; i++) {
    const page = pages[i];
    const nextPage = pages[i + 1];
    const ps = getMainParagraphs(page);
    if (ps.length === 0) continue;
    const lastP = ps[ps.length - 1];
    // ניקוי כל ניסיון קודם
    lastP.classList.remove("awkward-stretch");

    const { fill, multiline } = lastLineFill(lastP);
    if (!multiline || fill >= PUSHBACK_AWKWARD_FILL) continue;

    const nextPs = getMainParagraphs(nextPage);
    const firstNextP = nextPs[0] || null;

    // שלב 1: דחיפה לאחור (רק אם פסקה ממשיכה)
    let didPushBack = false;
    if (firstNextP && isContinuedParagraph(lastP, firstNextP)) {
      const nextText = firstNextP.textContent || "";
      const m = nextText.match(/^\s*(\S+)(\s+|$)/);
      if (m && m[1]) {
        const word = m[1];
        const remaining = nextText.substring(m[0].length);
        const origLast = lastP.textContent || "";
        const origNext = nextText;
        lastP.textContent = origLast.replace(/\s*$/, "") + " " + word;
        firstNextP.textContent = remaining;
        // בודקים שלא יצרנו חריגה בעמוד הנוכחי
        const overflow = page.scrollHeight - page.clientHeight;
        if (overflow > 1) {
          // ביטול
          lastP.textContent = origLast;
          firstNextP.textContent = origNext;
        } else {
          didPushBack = true;
          pushed++;
        }
      }
    }

    // שלב 2: אם לא נדחף — מתיחה (רק אם זו פסקת המשך, לא סוף פסקה אמיתית)
    if (!didPushBack && firstNextP && isContinuedParagraph(lastP, firstNextP)) {
      lastP.classList.add("awkward-stretch");
      stretched++;
    }
  }

  return { stretched, pushed };
}

// Clear the cache for a specific content hash (used when content edits invalidate it).
export function invalidateSmartCache(contentHash) {
  if (typeof localStorage === "undefined") return;
  if (contentHash) {
    localStorage.removeItem(CACHE_PREFIX + contentHash);
  }
}
