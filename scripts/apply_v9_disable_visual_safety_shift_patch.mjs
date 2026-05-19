import fs from "node:fs";

const TARGET = "src/engine/v9_main_bottom_gap.js";
const MARKER = "v9-disable-visual-safety-dom-shift";

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

function patchVisualSafetyShift(source) {
  source = source.replace(/\r\n/g, "\n");

  if (!source.includes("function applyV9VisualSafetyGapToPage(")) {
    console.warn(`[${MARKER}] applyV9VisualSafetyGapToPage anchor not found; skipped`);
    return source;
  }

  if (source.includes(MARKER)) return source;

  const shiftPattern =
/if \(appliedShift > EPS\) \{\s*for \(const el of movable\) setTop\(el, topOf\(el\) \+ appliedShift\);\s*\}/;

  const replacement = `if (appliedShift > EPS) {
      // ${MARKER}: the visual-safety pass may still diagnose unsafe overlap and
      // may still use the transparent-background fallback, but it must not move
      // already-rendered side/footer lines. Moving those DOM nodes creates real
      // gaps inside side columns near the end of rendering.
      const suppressedShift = appliedShift;
      appliedShift = 0;
      pageEl.dataset.v9VisualSafetyShiftSuppressed = JSON.stringify({
        marker: "${MARKER}",
        requested: Math.round(requestedShift * 100) / 100,
        available: Math.round(availableShift * 100) / 100,
        suppressed: Math.round(suppressedShift * 100) / 100
      });
    }`;

  const after = source.replace(shiftPattern, replacement);
  if (after === source) {
    console.warn(`[${MARKER}] shift block not found; skipped`);
  }
  return after;
}

const before = readFile(TARGET);
const after = patchVisualSafetyShift(before);
writeIfChanged(TARGET, before, after);
