import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-limit-full-strip3-one-line";
const STABILIZE_MARKER = "v9-stabilize-side-stream-passes";

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

function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }

    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
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

function patchStabilizeSideStreamPasses(source) {
  source = source.replace(/\r\n/g, "\n");
  if (source.includes(STABILIZE_MARKER)) return source;

  const rightPassPattern = /if\s*\(\s*pageContent\.rightStream\s*\)\s*\{/g;
  const matches = Array.from(source.matchAll(rightPassPattern));
  const candidates = matches
    .map((match) => {
      const blockStart = source.indexOf("{", match.index);
      const blockEnd = findMatchingBrace(source, blockStart);
      if (blockStart < 0 || blockEnd < 0) return null;
      const block = source.slice(match.index, blockEnd + 1);
      return { start: match.index, end: blockEnd + 1, block };
    })
    .filter(Boolean)
    .filter(({ block }) =>
      block.includes("pass2Right") &&
      block.includes("buildSideStream") &&
      block.includes("pageContent.rightStream") &&
      block.includes("'right'") &&
      block.includes("pass2Left")
    );

  if (!candidates.length) {
    console.warn(`[${STABILIZE_MARKER}] final right-pass anchor not found; skipped`);
    return source;
  }

  const target = candidates[candidates.length - 1];
  const insertion = `

  // ${STABILIZE_MARKER}: the final right rebuild can change right.endY; rebuild left once
  // from that final value so full-width strip 3 cannot open while the opposite column still has a line.
  if (pageContent.leftStream && pass2Right) {
    pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: cap(pass2Right.endY),
    });
  }`;

  return source.slice(0, target.end) + insertion + source.slice(target.end);
}

const before = readFile(TARGET);
let after = patchLimitFullStrip3ToOneLine(before);
after = patchStabilizeSideStreamPasses(after);
writeIfChanged(TARGET, before, after);
