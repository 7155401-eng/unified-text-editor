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

const STRIP_RE = /[֑-ֽֿ-ׇ]/;       // cantillation + niqqud
const PUNCT_RE = /[׃׀,.;:!?()[\]{}״׳"'׳״]/;

function normalizeWithMap(text) {
  let norm = "";
  const normToOrig = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (STRIP_RE.test(ch)) continue;
    if (ch === "־" || PUNCT_RE.test(ch) || /\s/.test(ch)) {
      // Collapse all separators (maqaf, punctuation, whitespace) into a single
      // space — preserves word boundaries without producing runs of spaces.
      if (norm.length === 0 || norm[norm.length - 1] !== " ") {
        norm += " ";
        normToOrig.push(i);
      }
      continue;
    }
    norm += ch;
    normToOrig.push(i);
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
