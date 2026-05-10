// Locate where a Sefaria verse sits inside a user's text selection.
//
// Used by the "צמוד לציטוט" position modes: the action must operate on the
// portion of the selection that corresponds to the verse, not the whole
// selection. Returns char offsets relative to the selection text — the caller
// adds them to `sel.from` to get ProseMirror positions.
//
// Normalization MUST match sefaria_search.normalizeForSearch (same characters
// stripped, maqaf treated as a separator) so that what auto-detect found in
// the corpus is also locatable inside the user's selection.
//
// Sacred-name canonicalization: the user may write "ה'" / "ה׳" / "ה״" / "השם"
// for the Tetragrammaton; Sefaria stores it as "יהוה". We expand the user's
// short form to "יהוה" in the normalized stream and map all 4 expanded chars
// back to the orig-position of the leading "ה" — so when the matched window
// gets sliced out of the selection, the slice starts at "ה" and ends after
// the apostrophe / "השם" tail. Same expansion is NOT applied to verseText
// (Sefaria's text is already "יהוה"), so indexOf alignment is symmetric.

const STRIP_RE = /[֑-ֽֿ-ׇ]/;       // cantillation + niqqud
const PUNCT_RE = /[׃׀,.;:!?()[\]{}״׳"'׳״]/;
const SEPARATOR_RE = /[\s־]/;
const APOSTROPHE_RE = /['׳״]/;

function isWordBoundary(text, i) {
  if (i < 0 || i >= text.length) return true;
  const ch = text[i];
  return SEPARATOR_RE.test(ch) || PUNCT_RE.test(ch);
}

function normalizeWithMap(text) {
  let norm = "";
  const normToOrig = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // Standalone "ה'" / "ה׳" / "ה״" → "יהוה".
    if (ch === "ה" && i + 1 < text.length && APOSTROPHE_RE.test(text[i + 1])) {
      const beforeOk = isWordBoundary(text, i - 1);
      const afterOk = isWordBoundary(text, i + 2);
      if (beforeOk && afterOk) {
        for (let k = 0; k < 4; k++) {
          norm += "יהוה"[k];
          normToOrig.push(i);
        }
        i += 2;
        continue;
      }
    }

    // Standalone "השם" → "יהוה".
    if (ch === "ה" && text[i + 1] === "ש" && text[i + 2] === "ם") {
      const beforeOk = isWordBoundary(text, i - 1);
      const afterOk = isWordBoundary(text, i + 3);
      if (beforeOk && afterOk) {
        for (let k = 0; k < 4; k++) {
          norm += "יהוה"[k];
          normToOrig.push(i);
        }
        i += 3;
        continue;
      }
    }

    if (STRIP_RE.test(ch)) { i++; continue; }
    if (ch === "־" || PUNCT_RE.test(ch) || /\s/.test(ch)) {
      // Collapse all separators (maqaf, punctuation, whitespace) into a single
      // space — preserves word boundaries without producing runs of spaces.
      if (norm.length === 0 || norm[norm.length - 1] !== " ") {
        norm += " ";
        normToOrig.push(i);
      }
      i++;
      continue;
    }
    norm += ch;
    normToOrig.push(i);
    i++;
  }
  while (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    normToOrig.pop();
  }
  normToOrig.push(text.length);
  return { norm, normToOrig };
}

function normalize(text) {
  return normalizeWithMap(text).norm;
}

/**
 * Find where verseText sits inside selectionText. Tries the full verse first,
 * then progressively shorter contiguous word-windows (≥3 words) to handle the
 * common case of a partial verse inside a longer selection.
 *
 * Caveat: assumes the selection is contained within a single block. Multi-block
 * selections may misalign because ProseMirror positions don't equal character
 * offsets across block boundaries (the doc.textBetween adds a separator).
 *
 * @returns {{ origStart: number, origEnd: number } | null}
 */
export function findVerseInSelection(verseText, selectionText) {
  const { norm: normSel, normToOrig } = normalizeWithMap(selectionText);
  const normVerse = normalize(verseText);
  if (!normSel || !normVerse) return null;

  const idx = normSel.indexOf(normVerse);
  if (idx >= 0) {
    return { origStart: normToOrig[idx], origEnd: normToOrig[idx + normVerse.length] };
  }

  const words = normVerse.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 3; n--) {
    for (let start = 0; start + n <= words.length; start++) {
      const sub = words.slice(start, start + n).join(" ");
      const j = normSel.indexOf(sub);
      if (j >= 0) {
        return { origStart: normToOrig[j], origEnd: normToOrig[j + sub.length] };
      }
    }
  }
  return null;
}
