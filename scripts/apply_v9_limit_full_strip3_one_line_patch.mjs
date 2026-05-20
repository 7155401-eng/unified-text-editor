import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-limit-full-strip3-one-line";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] patched ${path}: limited split-stream full-width bridge to one line`);
  } else {
    console.log(`[${MARKER}] patch noop for ${path}`);
  }
}

function patchLockedWideStripStart(source) {
  const already = `stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].lockYStart !== true &&
      strips[stripIdx + 1].width > strip.width`;

  const before = `stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].width > strip.width`;

  if (source.includes(already)) return source;
  if (!source.includes(before)) {
    console.warn(`[${MARKER}] flow lock anchor did not match; skipped`);
    return source;
  }
  return source.replace(before, already);
}

function patchSideStreamFlowMetadata(source) {
  const before = `strips.map(s => ({ y_start: s.y_start, width: s.width })),`;
  const after = `strips.map(s => ({
        y_start: s.y_start,
        width: s.width,
        lockYStart: s.lockYStart === true,
      })),`;

  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    console.warn(`[${MARKER}] flow metadata anchor did not match; skipped`);
    return source;
  }
  return source.replace(before, after);
}

function patchSideStreamFullStrip(source) {
  const before = `if (effectiveMainBottomY < otherEndY) {
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
    }`;

  const after = `// ${MARKER}: בתרחיש שזרם אחד מפוצל לשני טורים, שורת הגשר
    // הממורכזת מתחת לטורים מותרת רק כשורת שארית אחת. אם יש מקום ליותר
    // משורה אחת, משאירים את השורות העודפות בתוך הטור הצידי, ורק השורה
    // האחרונה מקבלת את כל הרוחב.
    const maxFullStrip3Lines = Number(o.maxFullStrip3Lines) > 0
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
    // משה 2026-05-10: בתרחיש 1, רק לצד אחד (השמאלי = החצי השני בסדר הקריאה)
    // יש strip 3 ברוחב מלא. אחרת שני הצדדים יציירו על אותו אזור (חפיפה).
    // הימני (החצי הראשון) — אם יש לו עודף, הוא ייכנס ל-carry-over.
    const suppressFullStrip3 = o.suppressFullStrip3 === true;
    if (fullStrip3StartY < pageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: fullStrip3StartY,
        y_end: pageBottomY,
        width: innerWidth,
        x: 0,
        lockYStart: maxFullStrip3Lines > 0,
      });
    }`;

  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    console.warn(`[${MARKER}] strip3 anchor did not match; skipped`);
    return source;
  }
  return source.replace(before, after);
}

function patchScenario1LeftLimit(source) {
  const before = `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
    });`;
  const after = `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isScenario1 ? 1 : 0,
    });`;

  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    console.warn(`[${MARKER}] scenario1 left limit anchor did not match; skipped`);
    return source;
  }
  return source.replace(before, after);
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
let after = before;
after = patchLockedWideStripStart(after);
after = patchSideStreamFlowMetadata(after);
after = patchSideStreamFullStrip(after);
after = patchScenario1LeftLimit(after);
after = removeDefaultMaxPagesCap(after);
writeIfChanged(TARGET, before, after);
