// Conservative V9 post-layout stretch policy.
// Runs after opening-word window repair.

const EPS = 0.75;
const MIN_FILL = 0.82;
const MAX_WORD = 3.6;
const MAX_LETTER = 0.42;

const px = (v, fb = 0) => {
  const n = Number.parseFloat(String(v || ""));
  return Number.isFinite(n) ? n : fb;
};

function isMainLine(el) {
  const role = String(el?.dataset?.v9Role || "").toLowerCase();
  const box = String(el?.dataset?.v9BoxId || "").toLowerCase();
  return role.includes("main") || box === "main" || el?.classList?.contains("v9-role-main");
}

function pageIndex(el) {
  const page = el?.closest?.(".v9-page, .page");
  return px(page?.dataset?.pageIndex || page?.dataset?.page || 0);
}

function topOf(el) {
  return px(el?.style?.top, el?.offsetTop || 0);
}

function leftOf(el) {
  return px(el?.style?.left, el?.offsetLeft || 0);
}

function widthOf(el) {
  return px(el?.style?.width, el?.getBoundingClientRect?.().width || 0);
}

function textOf(el) {
  return String(el?.textContent || "").replace(/\s+/g, " ").trim();
}

function hasWindow(el) {
  const ds = el?.dataset || {};
  return ds.v9OpeningWindowFollow === "1" || ds.v9OpeningWindowStretchCleared === "1" || ds.v9OpeningWindowReservePx != null;
}

function isContinuation(el) {
  const ds = el?.dataset || {};
  return ds.v9ParagraphStart === "0" || ds.v9Continuation === "1" || ds.v9ContinuedFromPrev === "1" || ds.continuedFromPrev === "1";
}

function clearStretch(el, reason) {
  if (!el?.style) return false;
  const had = el.classList?.contains("v9-continuation-manual-stretch") || el.style.wordSpacing || el.style.letterSpacing || el.style.transform;
  el.classList?.remove("v9-continuation-manual-stretch");
  el.style.wordSpacing = "";
  el.style.letterSpacing = "";
  el.style.transform = "";
  el.style.transformOrigin = "";
  if (reason) el.dataset.v9StretchPolicy = reason;
  return !!had;
}

function measureText(el) {
  if (!el || typeof document === "undefined" || typeof document.createRange !== "function") return 0;
  const old = [el.style.wordSpacing, el.style.letterSpacing, el.style.transform];
  el.style.wordSpacing = "";
  el.style.letterSpacing = "";
  el.style.transform = "";
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const w = r.getBoundingClientRect?.().width || 0;
    r.detach?.();
    return Math.max(0, w);
  } catch {
    return 0;
  } finally {
    el.style.wordSpacing = old[0];
    el.style.letterSpacing = old[1];
    el.style.transform = old[2];
  }
}

function slots(text) {
  const words = (text.match(/\s+/g) || []).length;
  const letters = Math.max(0, Array.from(text.replace(/\s+/g, "")).filter(ch => /[\p{L}\p{N}]/u.test(ch)).length - 1);
  return { words, letters };
}

function paragraphGroups(container) {
  const lines = Array.from(container.querySelectorAll(".v9-line"))
    .filter(isMainLine)
    .sort((a, b) => pageIndex(a) - pageIndex(b) || topOf(a) - topOf(b) || leftOf(a) - leftOf(b));

  const groups = [];
  const byKey = new Map();

  for (const line of lines) {
    const ds = line.dataset || {};
    let key = ds.v9ParagraphId || ds.paragraphId || ds.paraId || "";
    if (!key) key = groups.length && isContinuation(line) ? groups[groups.length - 1].key : `p${pageIndex(line)}-${groups.length}`;

    if (!byKey.has(key)) {
      const group = { key, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).lines.push(line);
  }
  return groups;
}

function planStretch(line, isLast) {
  if (hasWindow(line)) return { ok: false, reason: "opening-window" };
  if (isLast) return { ok: false, reason: "paragraph-end" };

  const text = textOf(line);
  if (text.length < 18) return { ok: false, reason: "too-short" };

  const target = widthOf(line);
  const actual = measureText(line);
  if (target <= 0 || actual <= 0) return { ok: false, reason: "unmeasured" };

  const deficit = target - actual;
  if (deficit <= EPS) return { ok: false, reason: "already-full" };
  if (actual / target < MIN_FILL) return { ok: false, reason: "too-far-from-edge" };

  const s = slots(text);
  if (s.words >= 2) {
    const amount = deficit / s.words;
    if (amount > 0 && amount <= MAX_WORD) return { ok: true, mode: "word", amount, deficit, slots: s.words };
  }
  if (s.letters >= 18) {
    const amount = deficit / s.letters;
    if (amount > 0 && amount <= MAX_LETTER) return { ok: true, mode: "letter", amount, deficit, slots: s.letters };
  }
  return { ok: false, reason: "cannot-fill-cleanly" };
}

function applyPlan(line, plan) {
  clearStretch(line, "");
  const amount = Math.round(plan.amount * 1000) / 1000;
  if (plan.mode === "word") line.style.wordSpacing = `${amount}px`;
  else line.style.letterSpacing = `${amount}px`;

  line.dataset.v9StretchPolicy = "applied-dynamic";
  line.dataset.v9StretchMode = plan.mode;
  line.dataset.v9StretchAmountPx = String(amount);
  line.dataset.v9StretchDeficitPx = String(Math.round(plan.deficit * 100) / 100);
  line.dataset.v9StretchSlots = String(plan.slots || 0);
}

export function normalizeV9StretchPolicy(container) {
  if (!container?.querySelectorAll) return { applied: 0, cleared: 0, skipped: 0, paragraphs: 0 };

  let applied = 0, cleared = 0, skipped = 0, paragraphs = 0;
  for (const group of paragraphGroups(container)) {
    const lines = group.lines || [];
    if (!lines.length) continue;
    paragraphs++;

    for (let i = 0; i < lines.length; i++) {
      const plan = planStretch(lines[i], i === lines.length - 1);
      if (plan.ok) {
        applyPlan(lines[i], plan);
        applied++;
      } else if (clearStretch(lines[i], plan.reason)) {
        cleared++;
      } else {
        skipped++;
      }
    }
  }

  const result = { applied, cleared, skipped, paragraphs };
  container.dataset.v9StretchPolicy = JSON.stringify(result);
  if (typeof window !== "undefined") window.__ravtextLastV9StretchPolicy = result;
  return result;
}
