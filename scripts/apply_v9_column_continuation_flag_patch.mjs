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
  if (source.includes("const isColumnAContinuation = !!box.isColumnAContinuation")) return source;

  const before = `      // v9-column-continuation-cut: a synthetic column/page cut is not a paragraph end.
      // Even a one-word final line in column A must not be centered as a real last line.
      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`;
  const after = `      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isColumnAContinuation || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`;
  if (!source.includes(before)) fail("missing continuation predicate anchor");
  return source.replace(before, after);
}

// ★ נמצא 24/09/2026: כאן ישב באג שהתפיח את הקובץ בכל הפעלה של שרת הפיתוח.
// בדיקת "כבר הוחל" חיפשה את **שתי השורות צמודות** — העוגן והשורה שמוזרקת
// אחריו. אבל סקריפט אחר (apply_v9_stream_line_stretch_guard_patch) מזריק
// את השורה שלו אחרי אותו עוגן בדיוק, ולכן דחף את עצמו בין השתיים ושבר את
// הזיווג. בהרצה הבאה הבדיקה לא זיהתה את ההזרקה הקודמת והזריקה שוב —
// ושני הסקריפטים עשו זאת זה לזה לסירוגין.
// נמדד: 53 עותקים של כל שורה, 104 שורות מתות שרצו על כל שורה מצוירת.
// התיקון: בודקים את השורה המוזרקת **לבדה**, ולא את הזיווג.
function patchDebugDataset(source) {
  const injected = `      if (isColumnAContinuation) lineEl.dataset.v9ColumnAContinuation = "1";`;
  if (source.includes(injected)) return source;
  const anchor = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);`;
  if (!source.includes(anchor)) fail("missing dataset anchor");
  return source.replace(anchor, `${anchor}\n${injected}`);
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

  const predicates = [
    "const isContinuationCut = (isColumnAContinuation || !!box.continues)",
    "const isContinuationCut = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues)",
    "const isContinuationCandidate = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues)",
  ];
  if (!predicates.some(p => source.includes(p))) {
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
