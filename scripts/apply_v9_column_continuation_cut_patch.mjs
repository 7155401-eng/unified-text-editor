import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-column-continuation-cut";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function fail(label) {
  throw new Error(`[${MARKER}] ${label}`);
}

function patchColumnABoxFlag(source) {
  const injected = `  if (pass2Right && pass2Left && pass2Right.id === pass2Left.id) {
    pass2Right.isColumnAContinuationCut = true;
    pass2Right.continues = true;
  }

  if (pass2Right) {`;
  if (source.includes(injected)) return source;
  const anchor = `  if (pass2Right) {`;
  if (!source.includes(anchor)) fail("missing pass2Right anchor");
  return source.replace(anchor, injected);
}

function patchContinuationCutPredicate(source) {
  if (source.includes("const isColumnAContinuationCut = !!box.isColumnAContinuationCut")) return source;
  const replacement = `      const isColumnAContinuationCut = !!box.isColumnAContinuationCut && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isColumnAContinuationCut || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`;
  const variants = [
    `      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`,
    `      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1
        && line.naturalWidth < line.width - 2;`,
  ];
  for (const before of variants) {
    if (source.includes(before)) return source.replace(before, replacement);
  }
  fail("missing isContinuationCut anchor");
}

function patchDebugDataset(source) {
  const after = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (isColumnAContinuationCut) lineEl.dataset.v9ColumnContinuationCut = "1";`;
  if (source.includes(after)) return source;
  const before = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);`;
  if (!source.includes(before)) fail("missing dataset anchor");
  return source.replace(before, after);
}

function verify(source) {
  for (const needle of [
    "pass2Right.isColumnAContinuationCut = true",
    "pass2Right.continues = true",
    "const isColumnAContinuationCut = !!box.isColumnAContinuationCut",
    "const isContinuationCut = (isColumnAContinuationCut || !!box.continues)",
    "lineEl.dataset.v9ColumnContinuationCut = \"1\"",
  ]) {
    if (!source.includes(needle)) fail(`missing ${needle}`);
  }
}

const before = readFile(TARGET);
let after = before;
after = patchColumnABoxFlag(after);
after = patchContinuationCutPredicate(after);
after = patchDebugDataset(after);
verify(after);
if (after !== before) {
  fs.writeFileSync(TARGET, after);
  console.log(`[${MARKER}] patched ${TARGET}`);
} else {
  console.log(`[${MARKER}] patch noop for ${TARGET}`);
}
