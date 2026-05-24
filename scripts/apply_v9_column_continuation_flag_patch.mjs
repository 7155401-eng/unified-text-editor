import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-column-a-continuation";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function fail(label) {
  throw new Error(`[${MARKER}] ${label}`);
}

function patchColumnAFlag(source) {
  const injected = `  if (pass2Right && pass2Left && pass2Right.id === pass2Left.id) {
    pass2Right.isColumnAContinuation = true;
    pass2Right.continues = true;
  }

  if (pass2Right) {`;
  if (source.includes(injected)) return source;
  const anchor = `  if (pass2Right) {`;
  if (!source.includes(anchor)) fail("missing pass2Right block anchor");
  return source.replace(anchor, injected);
}

function patchContinuationPredicate(source) {
  // This script may run before or after the line-edge guard patch. If the
  // richer predicate is already present, it already includes column A as one
  // of the accepted synthetic continuation cases.
  if (source.includes("const isColumnAContinuation = !!box.isColumnAContinuation")) return source;

  const before = `      // v9-column-continuation-cut: a synthetic column/page cut is not a paragraph end.
      // Even a one-word final line in column A must not be centered as a real last line.
      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`;
  const after = `      // v9-column-a-continuation: the first column of a same-stream split
      // is a synthetic transition into column B. Its last line is never a real
      // paragraph/page ending, even if the generic box.continues flag is lost.
      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isColumnAContinuation || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`;
  if (!source.includes(before)) fail("missing continuation predicate anchor");
  return source.replace(before, after);
}

function patchDebugDataset(source) {
  const after = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (isColumnAContinuation) lineEl.dataset.v9ColumnAContinuation = "1";`;
  if (source.includes(after)) return source;
  const before = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);`;
  if (!source.includes(before)) fail("missing dataset anchor");
  return source.replace(before, after);
}

function verify(source) {
  const required = [
    "pass2Right.isColumnAContinuation = true",
    "pass2Right.continues = true",
    "const isColumnAContinuation = !!box.isColumnAContinuation",
    "lineEl.dataset.v9ColumnAContinuation = \"1\"",
  ];
  for (const needle of required) {
    if (!source.includes(needle)) fail(`missing ${needle}`);
  }

  const hasSimpleColumnPredicate = source.includes(
    "const isContinuationCut = (isColumnAContinuation || !!box.continues)"
  );
  const hasComposedColumnPredicate = source.includes(
    "const isContinuationCut = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues)"
  );
  if (!hasSimpleColumnPredicate && !hasComposedColumnPredicate) {
    fail("missing column-aware continuation predicate");
  }
}

const before = readFile(TARGET);
let after = before;
after = patchColumnAFlag(after);
after = patchContinuationPredicate(after);
after = patchDebugDataset(after);
verify(after);
if (after !== before) {
  fs.writeFileSync(TARGET, after);
  console.log(`[${MARKER}] patched ${TARGET}`);
} else {
  console.log(`[${MARKER}] patch noop for ${TARGET}`);
}
