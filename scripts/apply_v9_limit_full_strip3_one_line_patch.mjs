import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-limit-full-strip3-one-line";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] patched ${path}: one full-width bridge line under active two-column streams`);
  } else {
    console.log(`[${MARKER}] patch noop for ${path}`);
  }
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    console.warn(`[${MARKER}] ${label} anchor did not match; skipped`);
    return source;
  }
  return source.replace(before, after);
}

function patchLockedWideStripStart(source) {
  return replaceOnce(
    source,
    `stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].width > strip.width`,
    `stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].lockYStart !== true &&
      strips[stripIdx + 1].width > strip.width`,
    "flow lock"
  );
}

function patchSideStreamFlowMetadata(source) {
  return replaceOnce(
    source,
    `strips.map(s => ({ y_start: s.y_start, width: s.width })),`,
    `strips.map(s => ({
        y_start: s.y_start,
        width: s.width,
        lockYStart: s.lockYStart === true,
      })),`,
    "flow metadata"
  );
}

function patchSideStreamFullStrip(source) {
  return replaceOnce(
    source,
    `if (effectiveMainBottomY < otherEndY) {
      strips.push({
        y_start: effectiveMainBottomY,
        y_end: otherEndY,
        width: sideHalfWidth,
        x: side === 'right' ? sideRightX : 0,
      });
    }
    // משה 2026-05-10: בתרחיש 1, רק לצד אחד (השמאלי = החצי השני בסדר הקריאה)
    // יש strip 3 ברוחב מלא. אחרת שני הצדדים יציירו על אותו אזור (חפיפה).
    // הימני (החצי הראשון) — אם יש לו עודף, הוא ייכנס ל-carry-over.
    const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (otherEndY < pageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: otherEndY,
        y_end: pageBottomY,
        width: innerWidth,
        x: 0,
      });
    }`,
    `const maxFullStrip3Lines = Number(o.maxFullStrip3Lines) > 0
      ? Math.max(1, Math.floor(Number(o.maxFullStrip3Lines)))
      : 0;
    const fullStrip3LineHeight = Math.max(0, getSideMetricsForStream(streamData.id)?.lineHeight || sideLineH);
    const fullStrip3StartY = (maxFullStrip3Lines > 0 && fullStrip3LineHeight > 0)
      ? Math.max(otherEndY, pageBottomY - fullStrip3LineHeight * maxFullStrip3Lines)
      : otherEndY;

    if (effectiveMainBottomY < fullStrip3StartY) {
      strips.push({
        y_start: effectiveMainBottomY,
        y_end: fullStrip3StartY,
        width: sideHalfWidth,
        x: side === 'right' ? sideRightX : 0,
      });
    }
    // ${MARKER}: full-width bridge under two side columns is capped at one line.
    const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (fullStrip3StartY < pageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: fullStrip3StartY,
        y_end: pageBottomY,
        width: innerWidth,
        x: 0,
        lockYStart: maxFullStrip3Lines > 0,
      });
    }`,
    "strip3"
  );
}

function patchTwoColumnLimits(source) {
  source = replaceOnce(
    source,
    `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
    });`,
    `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: pass1Left ? 1 : 0,
    });`,
    "initial right pass2"
  );

  source = replaceOnce(
    source,
    `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isScenario1 ? 1 : 0,
    });`,
    `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: (pass2Right || pass1Right || isScenario1) ? 1 : 0,
    });`,
    "left pass2 upgrade"
  );

  source = replaceOnce(
    source,
    `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
    });`,
    `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: (pass2Right || pass1Right || isScenario1) ? 1 : 0,
    });`,
    "left pass2"
  );

  source = replaceOnce(
    source,
    `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
    });`,
    `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: pass2Left ? 1 : 0,
    });`,
    "final right pass2"
  );

  return source;
}

function removeDefaultMaxPagesCap(source) {
  const after = source.replace(/maxPages:\s*100,/, "maxPages: Number.MAX_SAFE_INTEGER,");
  if (after === source && !source.includes("maxPages: Number.MAX_SAFE_INTEGER,")) {
    console.warn(`[${MARKER}] maxPages cap anchor did not match; skipped`);
  }
  return after;
}

const before = readFile(TARGET);
let after = before;
after = patchLockedWideStripStart(after);
after = patchSideStreamFlowMetadata(after);
after = patchSideStreamFullStrip(after);
after = patchTwoColumnLimits(after);
after = removeDefaultMaxPagesCap(after);
writeIfChanged(TARGET, before, after);
