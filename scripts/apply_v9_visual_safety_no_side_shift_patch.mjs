import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-visual-safety-no-side-shift";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] patched ${path}`);
  } else {
    console.log(`[${MARKER}] no changes needed for ${path}`);
  }
}

const HELPER = `
// ${MARKER}: undo only post-render visual-safety shifts that were applied to side columns.
// This does not change V9 layout, expansion, strips, or centering. It only repairs DOM top
// values after a later visual-safety pass inserted a full artificial gap inside a left/right column.
function __ravtextV9NoSideVisualSafetyShift(pageEl) {
  if (!pageEl || !pageEl.dataset || !pageEl.querySelectorAll) return;
  const raw = pageEl.dataset.v9VisualSafetyGap || "";
  if (!raw) return;

  let info = null;
  try { info = JSON.parse(raw); } catch (_) { info = null; }
  const applied = Number(info?.applied);
  if (!Number.isFinite(applied) || applied <= 0.5) return;

  function px(value, fallback = 0) {
    const n = Number.parseFloat(String(value || ""));
    return Number.isFinite(n) ? n : fallback;
  }

  function roleOf(el) {
    return String(el?.dataset?.v9Role || el?.className || "").toLowerCase();
  }

  function isSideLine(el) {
    if (!el || !el.classList || !el.classList.contains("v9-line")) return false;
    const role = roleOf(el);
    if (role.includes("main")) return false;
    return role.includes("left") || role.includes("right") ||
      el.classList.contains("v9-role-left") || el.classList.contains("v9-role-right");
  }

  function groupKey(el) {
    const role = roleOf(el).includes("left") || el.classList.contains("v9-role-left") ? "left" : "right";
    const stream = el.dataset.v9SourceStream || el.dataset.v9BoxId || "";
    const left = Math.round(px(el.style.left, el.offsetLeft || 0) * 2) / 2;
    const width = Math.round(px(el.style.width, el.getBoundingClientRect?.().width || 0) * 2) / 2;
    return [role, stream, left, width].join("|");
  }

  function topOf(el) {
    return px(el.style.top, el.offsetTop || 0);
  }

  function lineStep(a, b) {
    const ah = px(a.style.height, a.getBoundingClientRect?.().height || 0);
    const bh = px(b.style.height, b.getBoundingClientRect?.().height || 0);
    return Math.max(1, ah || 0, bh || 0);
  }

  function setTop(el, top) {
    el.style.top = (Math.round(top * 100) / 100) + "px";
  }

  const lines = Array.from(pageEl.querySelectorAll(".v9-line")).filter(isSideLine);
  if (lines.length < 2) return;

  const groups = new Map();
  for (const line of lines) {
    const key = groupKey(line);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  let restored = 0;
  const tolerance = 1.75;

  for (const groupLines of groups.values()) {
    groupLines.sort((a, b) => topOf(a) - topOf(b));
    for (let i = 1; i < groupLines.length; i++) {
      const prev = groupLines[i - 1];
      const cur = groupLines[i];
      const prevTop = topOf(prev);
      const curTop = topOf(cur);
      const normalStep = lineStep(prev, cur);
      const extraGap = curTop - prevTop - normalStep;
      const bottomGap = curTop - (prevTop + normalStep);

      if (Math.abs(extraGap - applied) > tolerance && Math.abs(bottomGap - applied) > tolerance) {
        continue;
      }

      const startTop = curTop;
      for (let j = i; j < groupLines.length; j++) {
        const el = groupLines[j];
        if (el.dataset.v9VisualSafetySideShiftRestored === "1") continue;
        const currentTop = topOf(el);
        if (currentTop < startTop - 0.5) continue;
        setTop(el, currentTop - applied);
        el.dataset.v9VisualSafetySideShiftRestored = "1";
        restored += 1;
      }
      break;
    }
  }

  if (restored > 0) {
    pageEl.dataset.v9VisualSafetySideShiftGuard = JSON.stringify({
      marker: "${MARKER}",
      restored,
      applied: Math.round(applied * 100) / 100,
      reason: "side-column-shift-restored"
    });
  }
}
`;

function patchVilnaV9(source) {
  source = source.replace(/\r\n/g, "\n");

  if (!source.includes("function __ravtextV9NoSideVisualSafetyShift(")) {
    const anchor = "\nfunction renderPagePlan(plan, pageEl, cfg) {";
    if (!source.includes(anchor)) {
      console.warn(`[${MARKER}] renderPagePlan anchor not found; helper not inserted`);
    } else {
      source = source.replace(anchor, HELPER + anchor);
    }
  }

  if (source.includes("__ravtextRunV9PostRenderGuards")) return source;

  const schedulePattern = /if \(typeof queueMicrotask === "function"\) \{\s*queueMicrotask\(\(\) => autoResolveV9CrownMainOverlap\(pageEl\)\);\s*\} else \{\s*setTimeout\(\(\) => autoResolveV9CrownMainOverlap\(pageEl\), 0\);\s*\}/;

  const replacement = `const __ravtextRunV9PostRenderGuards = () => {
    autoResolveV9CrownMainOverlap(pageEl);
    __ravtextV9NoSideVisualSafetyShift(pageEl);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => __ravtextV9NoSideVisualSafetyShift(pageEl));
    }
    setTimeout(() => __ravtextV9NoSideVisualSafetyShift(pageEl), 0);
    setTimeout(() => __ravtextV9NoSideVisualSafetyShift(pageEl), 80);
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(__ravtextRunV9PostRenderGuards);
  } else {
    setTimeout(__ravtextRunV9PostRenderGuards, 0);
  }`;

  const after = source.replace(schedulePattern, replacement);
  if (after === source) {
    console.warn(`[${MARKER}] post-render guard anchor not found; schedule not changed`);
  }
  return after;
}

const before = readFile(TARGET);
const after = patchVilnaV9(before);
writeIfChanged(TARGET, before, after);
