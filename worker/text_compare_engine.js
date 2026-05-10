// Text Compare Pro — engine.
import { diffChars } from './text_compare_diff.js';

const window = { Diff: { diffChars } };

// Verbatim port of computeSmartCompare, renderSmartReport, computeIntegrity,
// renderIntegrityReport, generateDiffHTML, normalizeForMatch, hasConsecChars,
// getBlocks, escapeHtml, escapeRegex, NIKUD_RE from work-files/text_compare_pro/web/app.js.
// Behaviour preserved 1:1.

/* === Helpers === */
export function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getBlocks(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length);
}

/* Hebrew nikud + taamim + cantillation: U+0591-05C7 + U+200E/F */
export const NIKUD_RE = /[֑-ׇ‎‏]/g;

export function normalizeForMatch(str, opts, ignoreItems) {
  opts = opts || {};
  if (!str) return "";
  if (opts.useIgnoreList && ignoreItems && ignoreItems.length) {
    ignoreItems.forEach((item) => {
      str = str.replace(new RegExp(escapeRegex(item), "g"), "");
    });
  }
  if (opts.ignoreNikud) str = str.replace(NIKUD_RE, "");
  return str.replace(/\s+/g, "");
}

export function hasConsecChars(s1, s2, limit) {
  if (!limit || limit <= 0) return false;
  if (s1.length < limit || s2.length < limit) return false;
  for (let i = 0; i <= s1.length - limit; i++) {
    if (s2.indexOf(s1.substring(i, i + limit)) !== -1) return true;
  }
  return false;
}

export function generateDiffHTML(a, b) {
  if (typeof window.Diff === "undefined") return escapeHtml(a) + " / " + escapeHtml(b);
  const parts = window.Diff.diffChars(a, b);
  return parts
    .map((p) => {
      const t = escapeHtml(p.value);
      if (p.added) return `<ins class="tcp-diff-added">${t}</ins>`;
      if (p.removed) return `<del class="tcp-diff-removed">${t}</del>`;
      return `<span class="tcp-diff-unchanged">${t}</span>`;
    })
    .join("");
}

/* === Smart Compare ===
 * Verbatim port of app.js:computeSmartCompare. The original read DOM inputs;
 * here we accept explicit args so the engine is independent of the modal
 * structure.
 */
export function computeSmartCompare(text1, text2, opts) {
  opts = opts || {};
  const simThreshold =
    typeof opts.simThreshold === "number"
      ? opts.simThreshold / 100
      : 0.6;
  const consecLimit = opts.consecLimit | 0;
  const normOpts = {
    ignoreNikud: !!opts.ignoreNikud,
    useIgnoreList: !!opts.useIgnoreList,
  };
  const ignoreItems = opts.ignoreItems || [];

  const map1 = getBlocks(text1).map((b) => ({
    original: b,
    norm: normalizeForMatch(b, normOpts, ignoreItems),
  }));
  const map2 = getBlocks(text2).map((b) => ({
    original: b,
    norm: normalizeForMatch(b, normOpts, ignoreItems),
  }));

  // Stage 1: 100% match
  let u1 = [];
  let u2 = [];
  const used2 = new Set();
  let identicalCount = 0;
  map1.forEach((item1) => {
    const idx = map2.findIndex(
      (it, i) => !used2.has(i) && it.norm === item1.norm
    );
    if (idx !== -1) {
      used2.add(idx);
      identicalCount++;
    } else {
      u1.push(item1);
    }
  });
  map2.forEach((it, i) => {
    if (!used2.has(i)) u2.push(it);
  });

  // Stage 2: consecutive characters
  let consecMatched = 0;
  if (consecLimit > 0) {
    const usedConsec = new Set();
    const remain = [];
    u1.forEach((item1) => {
      const idx = u2.findIndex(
        (it, i) =>
          !usedConsec.has(i) && hasConsecChars(item1.norm, it.norm, consecLimit)
      );
      if (idx !== -1) {
        usedConsec.add(idx);
        consecMatched++;
      } else {
        remain.push(item1);
      }
    });
    u1 = remain;
    u2 = u2.filter((_, i) => !usedConsec.has(i));
  }

  // Stage 3: similarity
  const similarPairs = [];
  const finalU1 = [];
  const usedSim = new Set();
  u1.forEach((item1) => {
    let bestScore = -1;
    let bestIdx = -1;
    const len1 = item1.norm.length;
    u2.forEach((item2, idx) => {
      if (usedSim.has(idx)) return;
      const len2 = item2.norm.length;
      if (len2 < len1 * simThreshold || len2 > len1 / simThreshold) return;
      const diff = window.Diff
        ? window.Diff.diffChars(item1.norm, item2.norm)
        : [];
      let matchLen = 0;
      diff.forEach((p) => {
        if (!p.added && !p.removed) matchLen += p.value.length;
      });
      const maxLen = Math.max(len1, len2);
      const score = maxLen > 0 ? matchLen / maxLen : 1;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestScore >= simThreshold && bestIdx !== -1) {
      usedSim.add(bestIdx);
      similarPairs.push({ item1, item2: u2[bestIdx], score: bestScore });
    } else {
      finalU1.push(item1);
    }
  });
  const finalU2 = u2.filter((_, i) => !usedSim.has(i));

  return {
    identicalCount,
    consecMatched,
    similar: similarPairs,
    onlyIn1: finalU1,
    onlyIn2: finalU2,
    totalIn1: map1.length,
    totalIn2: map2.length,
    simThreshold: Math.round(simThreshold * 100),
    consecLimit,
  };
}

/* Verbatim port of renderSmartReport — outputs HTML string for the results panel. */
export function renderSmartReport(r) {
  let html = "";

  // Summary cards
  html += '<div class="tcp-summary-counts">';
  html += `<div class="tcp-count-card pass"><div class="num">${r.identicalCount}</div><div class="label">קטעים זהים</div></div>`;
  if (r.consecLimit > 0)
    html += `<div class="tcp-count-card pass"><div class="num">${r.consecMatched}</div><div class="label">סוננו ברצף תווים</div></div>`;
  html += `<div class="tcp-count-card warn"><div class="num">${r.similar.length}</div><div class="label">קטעים דומים (≥${r.simThreshold}%)</div></div>`;
  html += `<div class="tcp-count-card fail"><div class="num">${r.onlyIn1.length}</div><div class="label">חסרים במסמך 2</div></div>`;
  html += `<div class="tcp-count-card fail"><div class="num">${r.onlyIn2.length}</div><div class="label">נוספו במסמך 2</div></div>`;
  html += "</div>";

  if (r.similar.length === 0 && r.onlyIn1.length === 0 && r.onlyIn2.length === 0) {
    html += '<div class="tcp-result-box pass"><h3>✅ מעולה — שני המסמכים זהים בכל הקטעים.</h3>';
    html += '<div class="muted">כל הקטעים תואמים או סוננו לפי ההגדרות שלך.</div></div>';
    return html;
  }

  if (r.similar.length) {
    html += '<div class="tcp-result-box warn">';
    html += `<h3>⚠ ${r.similar.length} קטעים דומים</h3>`;
    html += '<div class="muted">אדום עם קו = הוסר ממסמך 1 · ירוק = נוסף במסמך 2</div>';
    r.similar.forEach((p) => {
      html += '<div class="tcp-diff-container">';
      html += `<span class="tcp-score-pill">דמיון ${Math.round(p.score * 100)}%</span>`;
      html += generateDiffHTML(p.item1.original, p.item2.original);
      html += "</div>";
    });
    html += "</div>";
  }

  if (r.onlyIn1.length) {
    html += '<div class="tcp-result-box fail">';
    html += `<h3>❌ ${r.onlyIn1.length} קטעים חסרים במסמך 2</h3>`;
    html += '<div class="muted">קטעים שקיימים במסמך 1 אך לא נמצאו במסמך 2.</div>';
    r.onlyIn1.forEach((it) => {
      html += `<div class="tcp-missing-item">${escapeHtml(it.original)}</div>`;
    });
    html += "</div>";
  }

  if (r.onlyIn2.length) {
    html += '<div class="tcp-result-box fail">';
    html += `<h3>❌ ${r.onlyIn2.length} קטעים נוספו במסמך 2</h3>`;
    html += '<div class="muted">קטעים שקיימים במסמך 2 אך לא היו במסמך 1.</div>';
    r.onlyIn2.forEach((it) => {
      html += `<div class="tcp-added-item">${escapeHtml(it.original)}</div>`;
    });
    html += "</div>";
  }

  return html;
}

/* === Integrity (curly braces merge) — verbatim port === */
export function computeIntegrity(base, insert, merged, opts) {
  opts = opts || {};
  const normOpts = {
    ignoreNikud: !!opts.ignoreNikud,
    useIgnoreList: !!opts.useIgnoreList,
  };
  const ignoreItems = opts.ignoreItems || [];

  const mergedNoBrackets = merged.replace(/\{[\s\S]*?\}/g, "");
  const matches = merged.match(/\{([\s\S]*?)\}/g) || [];
  const extracted = matches.map((s) => s.slice(1, -1)).join("");

  const cleanBase = normalizeForMatch(base, normOpts, ignoreItems);
  const cleanMergedNoBr = normalizeForMatch(mergedNoBrackets, normOpts, ignoreItems);
  const cleanInsert = normalizeForMatch(insert, normOpts, ignoreItems);
  const cleanExtracted = normalizeForMatch(extracted, normOpts, ignoreItems);

  const basePass = cleanBase === cleanMergedNoBr;
  const insertPass = cleanInsert === cleanExtracted;

  return {
    basePass,
    insertPass,
    baseDiff: basePass ? null : generateDiffHTML(cleanBase, cleanMergedNoBr),
    insertDiff: insertPass ? null : generateDiffHTML(cleanInsert, cleanExtracted),
    braceCount: matches.length,
    baseLen: base.length,
    insertLen: insert.length,
    mergedLen: merged.length,
  };
}

export function renderIntegrityReport(r) {
  let html = "";
  html += '<div class="tcp-summary-counts">';
  html += `<div class="tcp-count-card ${r.basePass ? "pass" : "fail"}"><div class="num">${r.basePass ? "✓" : "✗"}</div><div class="label">טקסט ראשי</div></div>`;
  html += `<div class="tcp-count-card ${r.insertPass ? "pass" : "fail"}"><div class="num">${r.insertPass ? "✓" : "✗"}</div><div class="label">טקסט משני</div></div>`;
  html += `<div class="tcp-count-card"><div class="num">${r.braceCount}</div><div class="label">בלוקי {} שזוהו</div></div>`;
  html += "</div>";

  if (r.basePass) {
    html += '<div class="tcp-result-box pass"><h3>✅ בדיקת טקסט ראשי</h3>';
    html += '<div class="muted">הטקסט הראשי נמצא במלואו בטקסט המשולב מחוץ לסוגריים.</div></div>';
  } else {
    html += '<div class="tcp-result-box fail"><h3>❌ שגיאה בטקסט ראשי</h3>';
    html += '<div class="muted">הטקסט הראשי אינו זהה לטקסט המשולב לאחר הסרת הסוגריים.</div>';
    html += `<div class="tcp-diff-container">${r.baseDiff}</div></div>`;
  }

  if (r.insertPass) {
    html += '<div class="tcp-result-box pass"><h3>✅ בדיקת סוגריים {}</h3>';
    html += '<div class="muted">תוכן הסוגריים בטקסט המשולב תואם בדיוק לטקסט המשני.</div></div>';
  } else {
    html += '<div class="tcp-result-box fail"><h3>❌ שגיאה בטקסט משני</h3>';
    html += '<div class="muted">תוכן הסוגריים בטקסט המשולב אינו תואם לטקסט המשני שהוזן.</div>';
    html += `<div class="tcp-diff-container">${r.insertDiff}</div></div>`;
  }

  return html;
}

/* === Vendor lib loader — loads diff.min.js + mammoth.browser.min.js once === */
function vendorBase() {
  // Use Vite's BASE_URL when available (handles GitHub Pages / Vercel both),
  // and strip a trailing slash so the join below produces a single one.
  let b = "/";
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) {
      b = import.meta.env.BASE_URL;
    }
  } catch (_) {}
  if (!b.endsWith("/")) b = b + "/";
  return b + "vendor/text_compare_pro";
}
let _vendorPromise = null;

export function ensureVendorLoaded() {
  if (_vendorPromise) return _vendorPromise;
  const base = vendorBase();
  _vendorPromise = Promise.all([
    loadScript(`${base}/diff.min.js`),
    loadScript(`${base}/mammoth.browser.min.js`),
  ]);
  return _vendorPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-tcp-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.tcpSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}
