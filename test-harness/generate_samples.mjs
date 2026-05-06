// generate_samples.mjs — programmatic creation of edge-case sample documents.
// Each sample exercises a specific scenario:
//   tiny       — 1 page, 2 streams, short notes
//   many-short — many small inline notes scattered through
//   few-long   — few but very long notes (asymmetric stress)
//   single-1   — 1 stream + main only
//   triple     — 3+ streams + main
//   asymmetric — stream A huge, stream B tiny (causes catastrophic overflow)
//   no-main    — only commentary streams, no main text
//   only-main  — main text with NO commentary streams
//   wide-balanced — many medium streams, balanced
//   long-paragraph — single paragraph that exceeds page height (split test)
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "samples/auto";
fs.mkdirSync(OUT_DIR, { recursive: true });

const HEB_BLOCK = "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר ";
const NOTE_SHORT = "הערה קצרה לפסקה זו ";
const NOTE_LONG  = "הערה ארוכה הכוללת ביאור מרחיב המביא דעות שונות מן הפוסקים והוסיף עליה הסבר מפורט המבסס את הטיעון בראיות מן הגמרא ומן הראשונים. ";

function notes(code, text) { return `{@${code} ${text}}`; }
function paraMain(n) { return Array(n).fill(HEB_BLOCK).join(""); }
function paraNote(code, text, repeats) { return notes(code, Array(repeats).fill(text).join("")); }

// 1. tiny — 1 page, basic structure
fs.writeFileSync(path.join(OUT_DIR, "tiny.txt"),
  paraMain(2) + paraNote("01", NOTE_SHORT, 2) + paraNote("02", NOTE_SHORT, 2)
);

// 2. many-short — many small notes scattered
{
  let out = "";
  for (let i = 0; i < 30; i++) {
    out += paraMain(1) + paraNote("01", NOTE_SHORT, 1) + paraNote("02", NOTE_SHORT, 1) + " ";
  }
  fs.writeFileSync(path.join(OUT_DIR, "many-short.txt"), out);
}

// 3. few-long — small main, huge notes (causes asymmetric expanded)
{
  let out = paraMain(1);
  out += paraNote("01", NOTE_LONG, 30); // ~7500 chars
  out += paraNote("02", NOTE_SHORT, 1); // tiny - asymmetric
  fs.writeFileSync(path.join(OUT_DIR, "few-long.txt"), out);
}

// 4. single-1 — 1 stream + main
fs.writeFileSync(path.join(OUT_DIR, "single-1.txt"),
  paraMain(5) + paraNote("01", NOTE_LONG, 4)
);

// 5. triple — 3 streams + main
fs.writeFileSync(path.join(OUT_DIR, "triple.txt"),
  paraMain(3) +
  paraNote("01", NOTE_SHORT, 3) +
  paraNote("02", NOTE_SHORT, 3) +
  paraNote("03", NOTE_SHORT, 3)
);

// 6. asymmetric — extreme: 01 huge, 02 tiny
{
  let out = paraMain(2);
  out += paraNote("01", NOTE_LONG, 60); // very large
  out += paraNote("02", NOTE_SHORT, 1);
  fs.writeFileSync(path.join(OUT_DIR, "asymmetric.txt"), out);
}

// 7. no-main — only commentary blocks (no main text)
{
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += paraNote("01", NOTE_LONG, 2) + paraNote("02", NOTE_LONG, 2);
  }
  fs.writeFileSync(path.join(OUT_DIR, "no-main.txt"), out);
}

// 8. only-main — pure main text, no streams
fs.writeFileSync(path.join(OUT_DIR, "only-main.txt"), paraMain(15));

// 9. wide-balanced — 4 medium streams, well-balanced
{
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += paraMain(1);
    out += paraNote("01", NOTE_SHORT, 2);
    out += paraNote("02", NOTE_SHORT, 2);
    out += paraNote("03", NOTE_SHORT, 2);
    out += paraNote("04", NOTE_SHORT, 2);
  }
  fs.writeFileSync(path.join(OUT_DIR, "wide-balanced.txt"), out);
}

// 10. long-paragraph — one extremely long note that itself exceeds page height
{
  let out = paraMain(1);
  out += paraNote("01", NOTE_LONG.repeat(100), 1); // single huge paragraph
  out += paraNote("02", NOTE_SHORT, 1);
  fs.writeFileSync(path.join(OUT_DIR, "long-paragraph.txt"), out);
}

// 11. crown-edge — notes exactly at crown threshold
{
  let out = paraMain(2);
  out += paraNote("01", NOTE_SHORT, 4); // ~120 chars — borderline
  out += paraNote("02", NOTE_SHORT, 4);
  fs.writeFileSync(path.join(OUT_DIR, "crown-edge.txt"), out);
}

// 12. mid-length — moderate everything
fs.writeFileSync(path.join(OUT_DIR, "mid-length.txt"),
  paraMain(8) + paraNote("01", NOTE_LONG, 8) + paraNote("02", NOTE_LONG, 6)
);

const summary = fs.readdirSync(OUT_DIR).map(f => ({
  name: f,
  size: fs.statSync(path.join(OUT_DIR, f)).size,
}));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nGenerated ${summary.length} samples in ${OUT_DIR}/`);
