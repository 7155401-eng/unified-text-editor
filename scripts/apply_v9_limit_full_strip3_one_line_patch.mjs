import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-limit-full-strip3-one-line";

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

function patchLimitFullStrip3ToOneLine(source) {
  source = source.replace(/\r\n/g, "\n");
  if (source.includes(MARKER)) return source;

  const pattern =
/const suppressFullStrip3 = o\.suppressFullStrip3 === true;\s*if \(otherEndY < pageBottomY && !suppressFullStrip3\) \{\s*strips\.push\(\{\s*y_start: otherEndY,\s*y_end: pageBottomY,\s*width: innerWidth,\s*x: 0,\s*\}\);\s*\}/;

  const replacement = `const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (otherEndY < pageBottomY && !suppressFullStrip3) {
      // ${MARKER}: תנאי 3 — רק שורה אחת יכולה להיפרס ברוחב מלא מתחת לשני הטורים.
      const fullStrip3LineHeight = Math.max(0, getSideMetricsForStream(streamData.id)?.lineHeight || sideLineH);
      const fullStrip3EndY = Math.min(pageBottomY, otherEndY + fullStrip3LineHeight);
      if (fullStrip3EndY > otherEndY) {
        strips.push({
          y_start: otherEndY,
          y_end: fullStrip3EndY,
          width: innerWidth,
          x: 0,
        });
      }
    }`;

  const after = source.replace(pattern, replacement);
  if (after === source) {
    console.warn(`[${MARKER}] anchor not found; skipped`);
  }
  return after;
}

const before = readFile(TARGET);
const after = patchLimitFullStrip3ToOneLine(before);
writeIfChanged(TARGET, before, after);
