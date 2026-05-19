// Conservative V9 post-layout stretch policy.
// Runs after opening-word window repair.
//
// Purpose:
//   The V9 renderer already decides which lines are paragraph ends and which
//   lines should be justified.  This module must not invent new pagination or
//   re-split text.  It only replaces fragile browser justify stretching with a
//   measured, bounded word/letter spacing policy.
//
// Surgical note, 2026-05-19:
//   The original policy only scanned main lines.  That left stream/commentary
//   lines with class "justify" outside the controlled stretch path.  We now
//   include non-main V9 lines only when V9 has already marked them "justify".
//   We do not touch centered stream lines, because those are treated as real
//   paragraph endings or intentional full-width bridge rows by v9_main_bottom_gap.

const EPS = 0.75;
const MIN_FILL = 0.82;
const MAX_WORD = 3.6;
const MAX_LETTER = 0.42;

const px = (v, fb = 0) => {
  const n = Number.parseFloat(String(v || ""));
  return Number.isFinite(n) ? n : fb;
};

function roleOf(el) {
  return String(el?.dataset?.v9Role || "").toLowerCase();
}

function boxIdOf(el) {
  return String(el?.dataset?.v9BoxId || "").toLowerCase();
}

function isMainLine(el) {
  const role = roleOf(el);
  const box = boxIdOf(el);
  return role.includes("main") || box === "main" || el?.classList?.contains("v9-role-main");
}

function isControlledStreamJustifyLine(el) {
  if (!el || isMainLine(el)) return false;
  if (!el.classList?.contains("justify")) return false;

  const role = roleOf(el);
  const box = boxIdOf(el);
  const looksLikeStream =
    !!role ||
    (!!box && box !== "main") ||
    String(el.className || "").includes("stream-color-");

  return looksLikeStream && textOf(el).length >= 18;
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
  return ds.v9OpeningWindowFollow === "1" ||
    ds.v9OpeningWindowStretchCleared === "1" ||
    ds.v9OpeningWindowReservePx != null;
}

function isContinuation(el) {
  const ds = el?.dataset || {};
  return ds.v9ParagraphStart === "0" ||
    ds.v9Continuation === "1" ||
    ds.v9ContinuedFromPrev === "1" ||
    ds.continuedFromPrev === "1";
}

function clearStretch(el, reason) {
  if (!el?.style) return false;

  const had = el.classList?.contains("v9-continuation-manual-stretch") ||
    el.style.wordSpacing ||
    el.style.letterSpacing ||
    el.style.transform;

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
  const letters = Math.max(
    0,
    Array.from(text.replace(/\s+/g, "")).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length - 1
  );
  return { words, letters };
}

function sortedV9Lines(container) {
  return Array.from(container.querySelectorAll(".v9-line"))
    .sort((a, b) => pageIndex(a) - pageIndex(b) || topOf(a) - topOf(b) || leftOf(a) - leftOf(b));
}

function appendMainParagraphGroups(groups, lines) {
  const byKey = new Map();

  for (const line of lines.filter(isMainLine)) {
    const ds = line.dataset || {};
    let key = ds.v9ParagraphId || ds.paragraphId || ds.paraId || "";

    if (!key) {
      key = groups.length && isContinuation(line)
        ? groups[groups.length - 1].key
        : `p${pageIndex(line)}-${groups.length}`;
    }

    if (!byKey.has(key)) {
      const group = { key, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }

    byKey.get(key).lines.push(line);
  }
}

function appendStreamJustifyGroups(groups, lines) {
  let idx = 0;

  for (const line of lines) {
    if (!isControlledStreamJustifyLine(line)) continue;

    const ds = line.dataset || {};
    const key = [
      "stream-justify",
      pageIndex(line),
      ds.v9BoxId || "",
      ds.v9Role || "",
      idx++,
    ].join(":");

    // Force non-last: V9 already marked this stream line as justify.
    // Treating this singleton as "last" would disable the policy again.
    groups.push({ key, lines: [line], forceNonLast: true });
  }
}

function paragraphGroups(container) {
  const lines = sortedV9Lines(container);
  const groups = [];

  appendMainParagraphGroups(groups, lines);
  appendStreamJustifyGroups(groups, lines);

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
    if (amount > 0 && amount <= MAX_WORD) {
      return { ok: true, mode: "word", amount, deficit, slots: s.words };
    }
  }

  if (s.letters >= 18) {
    const amount = deficit / s.letters;
    if (amount > 0 && amount <= MAX_LETTER) {
      return { ok: true, mode: "letter", amount, deficit, slots: s.letters };
    }
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
  if (!container?.querySelectorAll) {
    return { applied: 0, cleared: 0, skipped: 0, paragraphs: 0 };
  }

  let applied = 0;
  let cleared = 0;
  let skipped = 0;
  let paragraphs = 0;
  let streamJustifyLines = 0;

  for (const group of paragraphGroups(container)) {
    const lines = group.lines || [];
    if (!lines.length) continue;

    paragraphs++;
    if (group.forceNonLast) streamJustifyLines += lines.length;

    for (let i = 0; i < lines.length; i++) {
      const isLast = group.forceNonLast ? false : i === lines.length - 1;
      const plan = planStretch(lines[i], isLast);

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

  const result = { applied, cleared, skipped, paragraphs, streamJustifyLines };
  container.dataset.v9StretchPolicy = JSON.stringify(result);

  if (typeof window !== "undefined") {
    window.__ravtextLastV9StretchPolicy = result;
  }

  return result;
}
