import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-limit-full-strip3-one-line";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] patched ${path}: y_end + lockYStart, with one-line cap only for same-stream split`);
  } else {
    console.log(`[${MARKER}] patch noop for ${path}`);
  }
}

function fail(label) {
  throw new Error(`[${MARKER}] required V9 invariant was not applied: ${label}`);
}

function replaceOrKeep(source, before, after) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) return source;
  return source.replace(before, after);
}

function patchExplicitStripEnd(source) {
  if (source.includes("const explicitStripEndY = Number.isFinite(Number(strip.y_end))")) return source;

  const before = `    const nextStripY = (stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY;`;
  const after = `    // v9-strip-y-end-guard: respect explicit strip bottoms. Without this,
    // a capped bridge strip can consume lines down to the next strip/pageBottom.
    const explicitStripEndY = Number.isFinite(Number(strip.y_end)) ? Number(strip.y_end) : null;
    const nextStripY = explicitStripEndY !== null
      ? Math.min(explicitStripEndY, maxY)
      : ((stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY);`;

  if (!source.includes(before)) fail("flow explicit y_end anchor");
  return source.replace(before, after);
}

function patchLockedWideStripStart(source) {
  const pullBefore = `stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].width > strip.width`;
  const pullAfter = `stripIdx + 1 < strips.length &&
      tokenIdx < tokens.length &&
      curY < strips[stripIdx + 1].y_start &&
      strips[stripIdx + 1].lockYStart !== true &&
      strips[stripIdx + 1].width > strip.width`;
  source = replaceOrKeep(source, pullBefore, pullAfter);

  const bridgeBefore = `availableHeight > 0 &&
        stripIdx + 1 < strips.length &&
        strips[stripIdx + 1].width > strip.width`;
  const bridgeAfter = `availableHeight > 0 &&
        stripIdx + 1 < strips.length &&
        strips[stripIdx + 1].lockYStart !== true &&
        strips[stripIdx + 1].width > strip.width`;
  source = replaceOrKeep(source, bridgeBefore, bridgeAfter);

  return source;
}

function patchSideStreamFlowMetadata(source) {
  const unified = `strips.map(s => ({
        y_start: s.y_start,
        y_end: s.y_end,
        width: s.width,
        lockYStart: s.lockYStart === true,
      })),`;

  if (source.includes(unified)) return source;

  const variants = [
    `strips.map(s => ({ y_start: s.y_start, width: s.width })),`,
    `// v9-strip-y-end-guard: flow must receive y_end, otherwise it may
      // consume invisible lines below a capped/suppressed strip.
      strips.map(s => ({ y_start: s.y_start, y_end: s.y_end, width: s.width })),`,
    `strips.map(s => ({
        y_start: s.y_start,
        width: s.width,
        lockYStart: s.lockYStart === true,
      })),`,
  ];

  for (const before of variants) {
    if (source.includes(before)) return source.replace(before, unified);
  }

  fail("side stream flow metadata y_end + lockYStart anchor");
}

function patchSideStreamFullStrip(source) {
  const replacement = `const maxFullStrip3Lines = Number(o.maxFullStrip3Lines) > 0
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
    // ${MARKER}: full-width continuation is still legal after the other side
    // really ends. The one-line cap is reserved only for same-stream split
    // bridge/orphan cases; distinct streams keep the full lower area.
    const suppressFullStrip3 = o.suppressFullStrip3 === true;
    const lockFullStrip3Start = maxFullStrip3Lines > 0 || o.lockFullStrip3Start === true;
    if (fullStrip3StartY < pageBottomY && !suppressFullStrip3) {
      strips.push({
        y_start: fullStrip3StartY,
        y_end: pageBottomY,
        width: innerWidth,
        x: 0,
        lockYStart: lockFullStrip3Start,
      });
    }`;

  if (source.includes(replacement)) return source;

  const original = `if (effectiveMainBottomY < otherEndY) {
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

  if (source.includes(original)) return source.replace(original, replacement);

  const existingPatched = /const maxFullStrip3Lines = Number\(o\.maxFullStrip3Lines\) > 0[\s\S]*?lockYStart: (?:maxFullStrip3Lines > 0|lockFullStrip3Start),\s*\}\);\s*\}/;
  if (existingPatched.test(source)) return source.replace(existingPatched, replacement);

  fail("strip3 full-width continuation replacement");
}

function patchSameStreamSplitFlag(source) {
  const after = `const isScenario1 = (scenario.name === 'one_long_split');
  const isSameStreamSideSplit = isScenario1 || (
    !!pageContent.rightStream &&
    !!pageContent.leftStream &&
    pageContent.rightStream.id === pageContent.leftStream.id
  );`;
  if (source.includes(after)) return source;

  const before = `const isScenario1 = (scenario.name === 'one_long_split');`;
  if (!source.includes(before)) fail("same-stream split flag anchor");
  return source.replace(before, after);
}

function patchTwoColumnLimits(source) {
  const replacements = [
    [
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
    });`,
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: isSameStreamSideSplit && pass1Left ? 1 : 0,
      lockFullStrip3Start: !!pass1Left,
    });`,
    ],
    [
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: pass1Left ? 1 : 0,
    });`,
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: pass1Left ? cap(pass1Left.endY) : mainTopY,
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: isSameStreamSideSplit && pass1Left ? 1 : 0,
      lockFullStrip3Start: !!pass1Left,
    });`,
    ],
    [
      `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
    });`,
      `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isSameStreamSideSplit && (pass2Right || pass1Right) ? 1 : 0,
      lockFullStrip3Start: !!(pass2Right || pass1Right),
    });`,
    ],
    [
      `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isScenario1 ? 1 : 0,
    });`,
      `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isSameStreamSideSplit && (pass2Right || pass1Right) ? 1 : 0,
      lockFullStrip3Start: !!(pass2Right || pass1Right),
    });`,
    ],
    [
      `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: (pass2Right || pass1Right || isScenario1) ? 1 : 0,
    });`,
      `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isSameStreamSideSplit && (pass2Right || pass1Right) ? 1 : 0,
      lockFullStrip3Start: !!(pass2Right || pass1Right),
    });`,
    ],
    [
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
    });`,
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: isSameStreamSideSplit && pass2Left ? 1 : 0,
      lockFullStrip3Start: !!pass2Left,
    });`,
    ],
    [
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: pass2Left ? 1 : 0,
    });`,
      `pass2Right = buildSideStream(pageContent.rightStream, 'right', {
      mainBottomY,
      otherSideEndY: cap(pass2Left.endY),
      suppressFullStrip3: isScenario1,
      maxFullStrip3Lines: isSameStreamSideSplit && pass2Left ? 1 : 0,
      lockFullStrip3Start: !!pass2Left,
    });`,
    ],
  ];

  for (const [before, after] of replacements) source = replaceOrKeep(source, before, after);
  return source;
}

function removeDefaultMaxPagesCap(source) {
  const after = source.replace(/maxPages:\s*100,/, "maxPages: Number.MAX_SAFE_INTEGER,");
  if (after === source && !source.includes("maxPages: Number.MAX_SAFE_INTEGER,")) {
    fail("maxPages cap removal");
  }
  return after;
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) fail(label);
}

function assertMissing(source, needle, label) {
  if (source.includes(needle)) fail(label);
}

function verifyInvariant(source) {
  assertIncludes(source, "const explicitStripEndY = Number.isFinite(Number(strip.y_end))", "flow respects strip.y_end");
  assertIncludes(source, "strips[stripIdx + 1].lockYStart !== true", "flow respects lockYStart");
  assertIncludes(source, "y_end: s.y_end", "side strips pass y_end to flow");
  assertIncludes(source, "lockYStart: s.lockYStart === true", "side strips pass lockYStart to flow");
  assertIncludes(source, "const maxFullStrip3Lines = Number(o.maxFullStrip3Lines) > 0", "strip3 line cap exists");
  assertIncludes(source, "const lockFullStrip3Start = maxFullStrip3Lines > 0 || o.lockFullStrip3Start === true", "full-width start lock is decoupled from one-line cap");
  assertIncludes(source, "const isSameStreamSideSplit = isScenario1 ||", "same-stream split flag exists");
  assertIncludes(source, "maxFullStrip3Lines: isSameStreamSideSplit && pass1Left ? 1 : 0", "right pass2 cap is same-stream only");
  assertIncludes(source, "lockFullStrip3Start: !!pass1Left", "right pass2 still locks full-width start when left exists");
  assertIncludes(source, "maxFullStrip3Lines: isSameStreamSideSplit && (pass2Right || pass1Right) ? 1 : 0", "left pass2 cap is same-stream only");
  assertIncludes(source, "lockFullStrip3Start: !!(pass2Right || pass1Right)", "left pass2 still locks full-width start when right exists");
  assertIncludes(source, "maxFullStrip3Lines: isSameStreamSideSplit && pass2Left ? 1 : 0", "final right pass2 cap is same-stream only");
  assertIncludes(source, "lockFullStrip3Start: !!pass2Left", "final right pass2 still locks full-width start when left exists");
  assertIncludes(source, "maxPages: Number.MAX_SAFE_INTEGER,", "default page cap removed");
  assertMissing(source, "strips.map(s => ({ y_start: s.y_start, width: s.width })),", "old side strip metadata without y_end/lock");
  assertMissing(source, "strips.map(s => ({ y_start: s.y_start, y_end: s.y_end, width: s.width })),", "side strip metadata with y_end but without lock");
  assertMissing(source, "maxFullStrip3Lines: pass1Left ? 1 : 0", "distinct-stream right pass2 must not be capped");
  assertMissing(source, "maxFullStrip3Lines: (pass2Right || pass1Right || isScenario1) ? 1 : 0", "distinct-stream left pass2 must not be capped");
  assertMissing(source, "maxFullStrip3Lines: pass2Left ? 1 : 0", "distinct-stream final right pass2 must not be capped");
}

const before = readFile(TARGET);
let after = before;
after = patchExplicitStripEnd(after);
after = patchLockedWideStripStart(after);
after = patchSideStreamFlowMetadata(after);
after = patchSideStreamFullStrip(after);
after = patchSameStreamSplitFlag(after);
after = patchTwoColumnLimits(after);
after = removeDefaultMaxPagesCap(after);
verifyInvariant(after);
writeIfChanged(TARGET, before, after);
