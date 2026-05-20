import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-limit-full-strip3-one-line";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] patched ${path}: restored full-strip behavior and removed V9 maxPages cap`);
  } else {
    console.log(`[${MARKER}] patch noop for ${path}`);
  }
}

function restoreFullStrip3OriginalBehavior(source) {
  source = source.replace(/\r\n/g, "\n");

  const original = `const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (otherEndY < pageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: otherEndY,
        y_end: pageBottomY,
        width: innerWidth,
        x: 0,
      });
    }`;

  const patchedPattern =
/const suppressFullStrip3 = o\.suppressFullStrip3 === true;\s*if \(otherEndY < pageBottomY && !suppressFullStrip3\) \{\s*\/\/ v9-limit-full-strip3-one-line:[\s\S]*?const fullStrip3LineHeight = Math\.max\(0, getSideMetricsForStream\(streamData\.id\)\?\.lineHeight \|\| sideLineH\);\s*const fullStrip3EndY = Math\.min\(pageBottomY, otherEndY \+ fullStrip3LineHeight\);\s*if \(fullStrip3EndY > otherEndY\) \{\s*strips\.push\(\{\s*y_start: otherEndY,\s*y_end: fullStrip3EndY,\s*width: innerWidth,\s*x: 0,\s*\}\);\s*\}\s*\}/;

  const after = source.replace(patchedPattern, original);
  if (after === source && source.includes(MARKER)) {
    console.warn(`[${MARKER}] marker found but restore anchor did not match; skipped`);
  }
  return after;
}

function removeDefaultMaxPagesCap(source) {
  source = source.replace(/\r\n/g, "\n");

  const after = source.replace(/maxPages:\s*100,/, "maxPages: Number.MAX_SAFE_INTEGER,");
  if (after === source && !source.includes("maxPages: Number.MAX_SAFE_INTEGER,")) {
    console.warn(`[${MARKER}] maxPages cap anchor did not match; skipped`);
  }
  return after;
}

const before = readFile(TARGET);
let after = restoreFullStrip3OriginalBehavior(before);
after = removeDefaultMaxPagesCap(after);
writeIfChanged(TARGET, before, after);
