// sefaria_dh.js — verbatim port of `_extract_dh` and `_find_dh_position`
// from sefaria_downloader_ui.py (PR #102 — boundary search).
//
// extractDh(heText)         — return the dibur-hamatchil (3 detection
//                              forms) or null.
// findDhPosition(mainText, dh)
//                            — locate dh inside main_text after stripping
//                              vowels/cantillation/punctuation/HTML, with
//                              4 fallback levels. Returns char index in
//                              ORIGINAL main_text where the marker should
//                              be inserted, or null.

// 3 detection forms:
//   1. <b>…</b> at the start (Steinsaltz)
//   2. "… - …"   first chunk before " - " (Rashi)
//   3. "…. …"    first sentence (Tosafot / R. Gershom)
export function extractDh(heText) {
  if (!heText) return null;
  const s = String(heText).trim();
  // 1. <b>…</b>
  const m1 = s.match(/<b[^>]*>([^<]{2,80}?)<\/b>/);
  if (m1 && m1.index < 80) return m1[1].trim();

  const sClean = s.replace(/<[^>]+>/g, "").trim();
  // 2. "… - explanation"
  const m2 = sClean.match(/^(.{3,80}?)\s+-\s+/);
  if (m2) return m2[1].trim();
  // 3. first sentence
  const m3 = sClean.match(/^([^.\n]{3,80}?)\.\s/);
  if (m3) return m3[1].trim();
  // 4. first 6 words fallback
  const words = sClean.split(/\s+/).slice(0, 6);
  if (words.length >= 2) return words.join(" ");
  return null;
}

// Helpers ────────────────────────────────────────────────────────────
function _keep(ch) {
  const cp = ch.charCodeAt(0);
  if (cp >= 0x0591 && cp <= 0x05C7) return false;
  // strip standard punctuation
  if (".,:;!?\"'`()[]{}״׳—–-()".indexOf(ch) !== -1) return false;
  return true;
}

function _isSpace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === " ";
}

const _BOUNDARY_BEFORE = "(?:^|[\\s־\\.,;:\\(\\[]|[\"׳״])";
const _BOUNDARY_AFTER  = "(?=[\\s־\\.,;:\\)\\]!?]|[\"׳״]|$)";

function _escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _findWholeWord(text, pattern) {
  const re = new RegExp(_BOUNDARY_BEFORE + "(" + _escRe(pattern) + ")" + _BOUNDARY_AFTER);
  const m = text.match(re);
  if (!m) return -1;
  // m.index is the boundary char start; we want the captured group start.
  return m.index + (m[0].length - m[1].length);
}

function _countWholeWord(text, pattern) {
  const re = new RegExp(_BOUNDARY_BEFORE + "(" + _escRe(pattern) + ")" + _BOUNDARY_AFTER, "g");
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

export function findDhPosition(mainText, dh) {
  if (!mainText || !dh) return null;

  // Build normalized text + reverse-map (orig_end_for_norm in Python)
  const normChars = [];
  const origEndForNorm = [];
  for (let i = 0; i < mainText.length; ) {
    const ch = mainText[i];
    if (!_keep(ch)) { i++; continue; }
    if (_isSpace(ch)) {
      if (normChars.length > 0 && normChars[normChars.length - 1] !== " ") {
        normChars.push(" ");
        origEndForNorm.push(i + 1);
      }
      i++;
      continue;
    }
    normChars.push(ch);
    origEndForNorm.push(i + 1);
    i++;
  }
  const normText = normChars.join("").trim();

  // Normalize dh
  const dhClean = String(dh).replace(/<[^>]+>/g, " ");
  const dhNormList = [];
  for (let i = 0; i < dhClean.length; i++) {
    const ch = dhClean[i];
    if (!_keep(ch)) continue;
    if (_isSpace(ch)) {
      if (dhNormList.length > 0 && dhNormList[dhNormList.length - 1] !== " ") {
        dhNormList.push(" ");
      }
      continue;
    }
    dhNormList.push(ch);
  }
  let dhNorm = dhNormList.join("").trim();
  if (dhNorm.length < 3) return null;

  let pos = _findWholeWord(normText, dhNorm);
  if (pos < 0) {
    const words = dhNorm.split(/\s+/);
    // Fallback level 2: progressively shorter prefixes
    for (let n = Math.min(words.length, 5); n > 1 && pos < 0; n--) {
      const sub = words.slice(0, n).join(" ");
      const p2 = _findWholeWord(normText, sub);
      if (p2 >= 0) {
        pos = p2;
        dhNorm = sub;
        break;
      }
    }
    if (pos < 0) {
      // Fallback level 3: any 3- or 2-word window
      outer:
      for (const win of [3, 2]) {
        for (let i2 = 0; i2 <= words.length - win; i2++) {
          const sub = words.slice(i2, i2 + win).join(" ");
          if (sub.length < 4) continue;
          const p2 = _findWholeWord(normText, sub);
          if (p2 >= 0) {
            pos = p2;
            dhNorm = sub;
            break outer;
          }
        }
      }
    }
    if (pos < 0) {
      // Fallback level 4: distinctive long word that appears exactly once
      const sortedByLen = words.slice().sort((a, b) => b.length - a.length);
      for (const w of sortedByLen) {
        if (w.length < 5) break;
        if (_countWholeWord(normText, w) === 1) {
          pos = _findWholeWord(normText, w);
          dhNorm = w;
          break;
        }
      }
    }
    if (pos < 0) return null;
  }

  const endNorm = pos + dhNorm.length;
  // start_norm_chars = len(normText[:pos].replace(' ', ''))
  // end_norm_chars   = len(normText[:endNorm].replace(' ', ''))
  let endNormChars = 0;
  for (let i = 0; i < endNorm; i++) {
    if (normText[i] !== " ") endNormChars++;
  }
  // Map end back: nth non-space norm char → original end index
  let count = 0;
  for (let idx = 0; idx < normChars.length; idx++) {
    const ch = normChars[idx];
    if (ch !== " ") {
      count++;
      if (count === endNormChars) return origEndForNorm[idx];
    }
  }
  return null;
}
