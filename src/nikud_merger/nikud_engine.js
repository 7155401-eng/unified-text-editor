// nikud_engine.js
// ===============
// תרגום מלא (verbatim) של כל המנוע מ-Python ל-JS:
//   engine/text_utils.py  + engine/filters.py + engine/nikud_quality.py
// + engine/merger.py      + engine/multi_source.py + engine/project.py
//
// הלוגיקה זהה למקור: התאמה ישירה, השוואת שלד, חיפוש קדימה חכם, ניקוי לפי scope.

// ═══════════════════════════════════════════════════════════════════════════
// text_utils.py
// ═══════════════════════════════════════════════════════════════════════════

// טווחי יוניקוד עבריים
export const HEBREW_BLOCK       = "\\u0590-\\u05FF";   // כל הבלוק העברי
export const HEBREW_NIKUD_TAAM  = "\\u0591-\\u05C7";   // ניקוד + טעמים יחד
export const HEBREW_NIKUD_ONLY  =
  "\\u05B0-\\u05BC" +   // שווא, חטפים, פתח, קמץ, צירה, סגול, חיריק, חולם, קובוץ, דגש
  "\\u05BF" +           // רפה
  "\\u05C1-\\u05C2" +   // שין/שין נקודה
  "\\u05C4-\\u05C5" +   // נקודת-הא, תחתון
  "\\u05C7";            // קמץ קטן
export const HEBREW_TAAM_ONLY   =
  "\\u0591-\\u05AF" +   // טעמי המקרא (אתנחתא, סילוק, זקף וכו')
  "\\u05BD" +           // מתג
  "\\u05BE" +           // מקף עברי
  "\\u05C0" +           // פסק
  "\\u05C3" +           // סוף פסוק
  "\\u05C6";            // נון הפוכה
export const HEBREW_LETTERS     = "\\u05D0-\\u05EA";   // 22 האותיות
export const LATIN_LETTERS      = "A-Za-z";
export const DIGITS             = "0-9\\u0660-\\u0669"; // ספרות ערביות + הודיות

const _RE_NIKUD_TAAM = new RegExp(`[${HEBREW_NIKUD_TAAM}]`, "g");
const _RE_NIKUD_ONLY = new RegExp(`[${HEBREW_NIKUD_ONLY}]`, "g");
const _RE_TAAM_ONLY  = new RegExp(`[${HEBREW_TAAM_ONLY}]`, "g");
const _RE_NOT_HEBREW = new RegExp(`[^${HEBREW_BLOCK}]`, "g");

export function stripNikudAndTaam(text) {
  return String(text).replace(_RE_NIKUD_TAAM, "");
}

export function stripNikudOnly(text) {
  return String(text).replace(_RE_NIKUD_ONLY, "");
}

export function stripTaamOnly(text) {
  return String(text).replace(_RE_TAAM_ONLY, "");
}

export function getPureHebrew(text) {
  return String(text).replace(_RE_NOT_HEBREW, "");
}

export function getHebrewLettersOnly(text) {
  const cleaned = stripNikudAndTaam(text);
  return cleaned.replace(new RegExp(`[^${HEBREW_LETTERS}]`, "g"), "");
}

// שלד — מסיר את התו הראשון של רצף ו'/י' אמצעי
const _RE_INTERNAL_VAV_YUD = new RegExp(
  `(?<=[${HEBREW_LETTERS}])(?<![וי])[וי](?=[${HEBREW_LETTERS}])`, "g"
);

export function getSkeleton(text) {
  const stripped = stripNikudAndTaam(text);
  return stripped.replace(_RE_INTERNAL_VAV_YUD, "");
}

// נירמול — NFC
export function normalize(text) {
  try { return String(text).normalize("NFC"); }
  catch (_) { return String(text); }
}


// ═══════════════════════════════════════════════════════════════════════════
// filters.py
// ═══════════════════════════════════════════════════════════════════════════

export const SCOPE_OFF   = "off";
export const SCOPE_VOC   = "voc";
export const SCOPE_CLEAN = "clean";
export const SCOPE_BOTH  = "both";

export const SCOPE_LABELS = {
  [SCOPE_OFF]:   "כבוי",
  [SCOPE_VOC]:   "מנוקד",
  [SCOPE_CLEAN]: "מוגה",
  [SCOPE_BOTH]:  "שניהם",
};

export const SCOPE_LABELS_EN = {
  [SCOPE_OFF]:   "Off",
  [SCOPE_VOC]:   "Vocalized",
  [SCOPE_CLEAN]: "Clean",
  [SCOPE_BOTH]:  "Both",
};

const FILTER_FIELD_KEYS = [
  // --- ניקוד וטעמים ---
  "nikud", "taamim",
  // --- פיסוק ---
  "periods", "commas", "colons", "semicolons", "dashes", "question_exclaim",
  // --- גרשיים ---
  "quotes", "hebrew_geresh", "maqaf",
  // --- סוגריים ---
  "round_brackets", "square_brackets", "curly_brackets", "angle_brackets",
  // --- תווים מיוחדים ---
  "digits", "latin_letters", "at_markers", "asterisks", "hashes",
  // --- רווחים ---
  "extra_spaces", "line_breaks",
];

export class FilterConfig {
  constructor(init = {}) {
    // --- ניקוד וטעמים ---
    this.nikud       = SCOPE_CLEAN;
    this.taamim      = SCOPE_BOTH;

    // --- פיסוק — הכל ברירת מחדל "מנוקד" ---
    this.periods         = SCOPE_VOC;
    this.commas          = SCOPE_VOC;
    this.colons          = SCOPE_VOC;
    this.semicolons      = SCOPE_VOC;
    this.dashes          = SCOPE_VOC;
    this.question_exclaim = SCOPE_VOC;

    // --- גרשיים ---
    this.quotes        = SCOPE_OFF;
    this.hebrew_geresh = SCOPE_OFF;
    this.maqaf         = SCOPE_VOC;

    // --- סוגריים ---
    this.round_brackets  = SCOPE_VOC;
    this.square_brackets = SCOPE_VOC;
    this.curly_brackets  = SCOPE_VOC;
    this.angle_brackets  = SCOPE_VOC;

    // --- תווים מיוחדים ---
    this.digits         = SCOPE_VOC;
    this.latin_letters  = SCOPE_VOC;
    this.at_markers     = SCOPE_VOC;
    this.asterisks      = SCOPE_VOC;
    this.hashes         = SCOPE_VOC;

    // --- רווחים ---
    this.extra_spaces = SCOPE_BOTH;
    this.line_breaks  = SCOPE_BOTH;

    // --- טווחי-התעלמות ---
    this.ignore_ranges = [
      ["{", "}", SCOPE_VOC],
      ["<<", ">>", SCOPE_VOC],
    ];

    // --- גמישות מתקדמת ---
    this.flexible_ktiv          = true;
    this.case_insensitive_latin = true;

    // ערכים שהועברו ב-init דורסים
    Object.assign(this, init);
  }

  toDict() {
    return {
      nikud: this.nikud, taamim: this.taamim,
      periods: this.periods, commas: this.commas, colons: this.colons,
      semicolons: this.semicolons, dashes: this.dashes,
      question_exclaim: this.question_exclaim,
      quotes: this.quotes, hebrew_geresh: this.hebrew_geresh, maqaf: this.maqaf,
      round_brackets: this.round_brackets, square_brackets: this.square_brackets,
      curly_brackets: this.curly_brackets, angle_brackets: this.angle_brackets,
      digits: this.digits, latin_letters: this.latin_letters,
      at_markers: this.at_markers, asterisks: this.asterisks, hashes: this.hashes,
      extra_spaces: this.extra_spaces, line_breaks: this.line_breaks,
      ignore_ranges: this.ignore_ranges.map(r => r.slice()),
      flexible_ktiv: this.flexible_ktiv,
      case_insensitive_latin: this.case_insensitive_latin,
    };
  }

  static fromDict(data) {
    return new FilterConfig(data || {});
  }

  static presetLoose() {
    return new FilterConfig();
  }

  static presetStrict() {
    const c = new FilterConfig();
    const fields = [
      "periods","commas","colons","semicolons","dashes","question_exclaim",
      "quotes","hebrew_geresh","maqaf",
      "round_brackets","square_brackets","curly_brackets","angle_brackets",
      "digits","latin_letters","at_markers","asterisks","hashes",
    ];
    for (const f of fields) c[f] = SCOPE_OFF;
    c.ignore_ranges = [];
    c.flexible_ktiv = false;
    return c;
  }

  static presetMidrash() {
    const c = new FilterConfig();
    c.at_markers    = SCOPE_BOTH;
    c.hebrew_geresh = SCOPE_VOC;
    return c;
  }
}

const _NIKUD_RANGE   = "\\u05B0-\\u05BC\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7";
const _TAAMIM_RANGE  = "\\u0591-\\u05AF\\u05BD\\u05C0\\u05C3\\u05C6";
const _HEBREW_MAQAF  = "\\u05BE";
const _HEBREW_GERESH = "\\u05F3\\u05F4";

const _CHAR_RULES = [
  ["nikud",            _NIKUD_RANGE],
  ["taamim",           _TAAMIM_RANGE],
  ["periods",          "\\."],
  ["commas",           ","],
  ["colons",           ":"],
  ["semicolons",       ";"],
  ["dashes",           "\\-\\u2013\\u2014"],
  ["question_exclaim", "\\?!"],
  ["quotes",           "\"'`"],
  ["hebrew_geresh",    _HEBREW_GERESH],
  ["maqaf",            _HEBREW_MAQAF],
  ["round_brackets",   "\\(\\)"],
  ["square_brackets",  "\\[\\]"],
  ["curly_brackets",   "\\{\\}"],
  ["angle_brackets",   "<>"],
  ["digits",           "0-9"],
  ["latin_letters",    "A-Za-z"],
  ["asterisks",        "\\*"],
  ["hashes",           "#"],
  ["line_breaks",      "\\n\\r"],
];

function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _buildCharPattern(config, scope) {
  const parts = [];
  for (const [fieldName, charRegex] of _CHAR_RULES) {
    const fieldScope = config[fieldName] !== undefined ? config[fieldName] : SCOPE_OFF;
    if (fieldScope === SCOPE_BOTH || fieldScope === scope) {
      parts.push(charRegex);
    }
  }
  if (parts.length === 0) return /(?!)/g;
  return new RegExp("[" + parts.join("") + "]", "g");
}

function _buildAtPattern(config, scope) {
  const fieldScope = config.at_markers !== undefined ? config.at_markers : SCOPE_OFF;
  if (fieldScope === SCOPE_BOTH || fieldScope === scope) {
    return /@\d+/g;
  }
  return null;
}

function _buildRangeRemovers(config, scope) {
  const patterns = [];
  for (const item of (config.ignore_ranges || [])) {
    if (!item || item.length < 3) continue;
    const opener = item[0], closer = item[1], itemScope = item[2];
    if (!opener || !closer) continue;
    if (itemScope === SCOPE_OFF) continue;
    if (itemScope !== SCOPE_BOTH && itemScope !== scope) continue;
    const pat = new RegExp(`${_escapeRegex(opener)}[\\s\\S]*?${_escapeRegex(closer)}`, "g");
    patterns.push(pat);
  }
  return patterns;
}

export function stripIgnoredRanges(text, config, scope) {
  let t = String(text);
  for (const pat of _buildRangeRemovers(config, scope)) {
    t = t.replace(pat, "");
  }
  return t;
}

export function cleanTextFull(text, config, scope) {
  let t = stripIgnoredRanges(text, config, scope);
  const atPat = _buildAtPattern(config, scope);
  if (atPat) t = t.replace(atPat, "");
  return t;
}

export function cleanForCompare(text, config, scope = SCOPE_BOTH) {
  // הסרת טווחים
  let t = stripIgnoredRanges(text, config, scope);

  // הסרת @-סימנים
  const atPat = _buildAtPattern(config, scope);
  if (atPat) t = t.replace(atPat, "");

  // הסרת תווים
  const pat = _buildCharPattern(config, scope);
  t = t.replace(pat, "");

  // רווחים
  const spacesScope = config.extra_spaces !== undefined ? config.extra_spaces : SCOPE_OFF;
  if (spacesScope === SCOPE_BOTH || spacesScope === scope) {
    t = t.replace(/\s+/g, " ");
  }

  // lowercase
  const latinScope = config.latin_letters !== undefined ? config.latin_letters : SCOPE_OFF;
  if (config.case_insensitive_latin && latinScope !== SCOPE_BOTH) {
    t = t.toLowerCase();
  }

  return t.trim();
}


// ═══════════════════════════════════════════════════════════════════════════
// nikud_quality.py
// ═══════════════════════════════════════════════════════════════════════════

export const IssueKind = Object.freeze({
  NO_NIKUD:         "no_nikud",
  PARTIAL_NIKUD:    "partial_nikud",
  MISSING_SHIN_DOT: "missing_shin_dot",
  DOUBLE_NIKUD:     "double_nikud",
});

const HEBREW_LETTER_RE = /[א-ת]/;
const NIKUD_RANGE_RE   = /[ְ-ּֿׁ-ׂׄ-ׇׅ]/;
const SHIN             = "ש";
const SHIN_DOT_RIGHT   = "ׁ";
const SHIN_DOT_LEFT    = "ׂ";
const WORD_PATTERN     = /[א-ת֑-ׇ]+/g;

const FINAL_LETTERS = new Set(["ך","ם","ן","ף","ץ"]);

export function hasAnyNikud(word) {
  return new RegExp(`[\\u05B0-\\u05BC\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7]`).test(word);
}

export function countLettersWithoutNikud(word) {
  let lettersTotal = 0;
  let lettersWithout = 0;
  let i = 0;
  while (i < word.length) {
    const ch = word[i];
    if (HEBREW_LETTER_RE.test(ch)) {
      lettersTotal += 1;
      let hasNikudAfter = false;
      let j = i + 1;
      while (j < word.length && NIKUD_RANGE_RE.test(word[j])) {
        hasNikudAfter = true;
        j += 1;
      }
      if (!hasNikudAfter) lettersWithout += 1;
      i = j;
    } else {
      i += 1;
    }
  }
  return [lettersWithout, lettersTotal];
}

export function checkText(text, ignoreShort = true) {
  const issues = [];
  const words = String(text).match(WORD_PATTERN) || [];

  for (let pos = 0; pos < words.length; pos++) {
    const word = words[pos];
    const lettersCount = (word.match(/[א-ת]/g) || []).length;
    if (lettersCount === 0) continue;
    if (ignoreShort && lettersCount === 1) continue;

    if (!hasAnyNikud(word)) {
      issues.push({
        kind: IssueKind.NO_NIKUD,
        word, position: pos,
        description: "מילה ללא ניקוד כלל",
      });
      continue;
    }

    const [without, total] = countLettersWithoutNikud(word);
    if (without > 1 && total > 1) {
      issues.push({
        kind: IssueKind.PARTIAL_NIKUD,
        word, position: pos,
        description: `${without} אותיות מתוך ${total} ללא ניקוד`,
      });
    }

    if (word.includes(SHIN)) {
      let idx = word.indexOf(SHIN);
      while (idx !== -1) {
        const nextChars = word.slice(idx + 1, idx + 4);
        if (!nextChars.includes(SHIN_DOT_RIGHT) && !nextChars.includes(SHIN_DOT_LEFT)) {
          issues.push({
            kind: IssueKind.MISSING_SHIN_DOT,
            word, position: pos,
            description: "ש' ללא ניקוד ימני/שמאלי",
          });
          break;
        }
        idx = word.indexOf(SHIN, idx + 1);
      }
    }
  }
  return issues;
}

export function summarizeIssues(issues) {
  const summary = {
    [IssueKind.NO_NIKUD]: 0,
    [IssueKind.PARTIAL_NIKUD]: 0,
    [IssueKind.MISSING_SHIN_DOT]: 0,
    [IssueKind.DOUBLE_NIKUD]: 0,
  };
  for (const issue of issues) {
    summary[issue.kind] = (summary[issue.kind] || 0) + 1;
  }
  summary.total = issues.length;
  return summary;
}


// ═══════════════════════════════════════════════════════════════════════════
// merger.py
// ═══════════════════════════════════════════════════════════════════════════

export const HEBREW_WORD_RE_SOURCE = "([\\(\\[\\]]*[\\u0590-\\u05FF'\\n\\r]+[\\)\\]]*)";
const HEBREW_WORD_RE_GLOBAL = new RegExp(HEBREW_WORD_RE_SOURCE, "g");
const HEBREW_WORD_RE_FULL   = new RegExp("^" + HEBREW_WORD_RE_SOURCE + "$");

export const SegmentKind = Object.freeze({
  PASSTHROUGH:   "passthrough",
  UNCHANGED:     "unchanged",
  INSERTED:      "inserted",
  DELETED:       "deleted",
  SPELLING_DIFF: "spelling_diff",
});

export function makeSegment(kind, text, original = "") {
  return { kind, text, original };
}

function _isMatch(a, b, config) {
  // רמה 1: השוואה מלאה לפי scope
  const aClean = cleanForCompare(a, config, SCOPE_CLEAN);
  const bClean = cleanForCompare(b, config, SCOPE_VOC);
  if (aClean === bClean) return true;

  // רמה 2: עברית טהורה
  const p1 = getPureHebrew(a);
  const p2 = getPureHebrew(b);
  if (p1 && p1 === p2) return true;

  // רמה 3: שלד
  if (config.flexible_ktiv) {
    const s1 = getSkeleton(a);
    const s2 = getSkeleton(b);
    if (s1 && s1 === s2) return true;
  }

  return false;
}

function _isHebrewToken(token) {
  return HEBREW_WORD_RE_FULL.test(token);
}

const LOOKAHEAD_LIMIT = 5;
const SEQUENCE_CHECK  = 3;

function _findBestMatchAhead(cleanToken, cleanTokens, cIndex, vocWords, vIndex, config) {
  let bestIdx = -1;
  let bestScore = -1;
  let checkedValid = 0;
  let searchOffset = 1;

  while (checkedValid < LOOKAHEAD_LIMIT && (vIndex + searchOffset) < vocWords.length) {
    const idx = vIndex + searchOffset;
    const candidate = vocWords[idx];

    if (getPureHebrew(candidate).length === 0) {
      searchOffset += 1;
      continue;
    }

    checkedValid += 1;

    if (!_isMatch(cleanToken, candidate, config)) {
      searchOffset += 1;
      continue;
    }

    let sequenceMatches = 0;
    let lookaheadValid = 0;
    let cOff = 1, vOff = 1;

    while (
      lookaheadValid < SEQUENCE_CHECK
      && (cIndex + cOff) < cleanTokens.length
      && (idx + vOff) < vocWords.length
    ) {
      const nextC = cleanTokens[cIndex + cOff];
      if (getPureHebrew(nextC).length === 0) { cOff += 1; continue; }
      const nextV = vocWords[idx + vOff];
      if (getPureHebrew(nextV).length === 0) { vOff += 1; continue; }

      if (_isMatch(nextC, nextV, config)) sequenceMatches += 1;
      lookaheadValid += 1;
      cOff += 1;
      vOff += 1;
    }

    const score = 1 + sequenceMatches;
    if (score > bestScore) {
      bestScore = score;
      bestIdx   = idx;
    }
    searchOffset += 1;
  }

  return [bestIdx, bestScore];
}

// JS port של re.split על pattern קבוצתי בפייתון: השארת המפרידים בתוצאה.
// HEBREW_WORD_RE_SOURCE היא קבוצה אחת, כך ש-re.split מחזיר נון-מטץ' ומטץ' לסירוגין.
function _hebrewSplit(text) {
  const tokens = [];
  const re = new RegExp(HEBREW_WORD_RE_SOURCE, "g");
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push(text.slice(last, m.index));   // לפני המטץ' (פאסת'רו)
    tokens.push(m[0]);                        // המטץ' עצמו (מילה)
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  tokens.push(text.slice(last));
  return tokens;
}

function _hebrewFindAll(text) {
  const result = [];
  const re = new RegExp(HEBREW_WORD_RE_SOURCE, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    result.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return result;
}

export function merge(cleanText, vocalizedText, opts = {}) {
  let { config = null, progressCallback = null, stopFlag = null, mode = "word" } = opts;
  if (config === null) config = new FilterConfig();

  cleanText = normalize(cleanText);
  vocalizedText = normalize(vocalizedText);

  cleanText = cleanTextFull(cleanText, config, SCOPE_CLEAN);
  vocalizedText = cleanTextFull(vocalizedText, config, SCOPE_VOC);

  if (mode === "char") {
    return _mergeCharLevel(cleanText, vocalizedText, config, progressCallback);
  }

  const cleanTokens = _hebrewSplit(cleanText);
  const vocWords = _hebrewFindAll(vocalizedText);

  const segments = [];
  let vIdx = 0;
  let matchCount = 0;
  let stopped = false;

  const total = cleanTokens.length;
  let lastPct = -1;

  for (let cIdx = 0; cIdx < cleanTokens.length; cIdx++) {
    const token = cleanTokens[cIdx];

    if (stopFlag && stopFlag.stop) { stopped = true; break; }

    if (progressCallback && total > 0) {
      const pct = Math.floor((cIdx / total) * 100);
      if (pct !== lastPct) {
        progressCallback(pct);
        lastPct = pct;
      }
    }

    if (!_isHebrewToken(token)) {
      if (token) segments.push(makeSegment(SegmentKind.PASSTHROUGH, token));
      continue;
    }

    const pureToken = getPureHebrew(token);
    if (!pureToken) {
      segments.push(makeSegment(SegmentKind.PASSTHROUGH, token));
      continue;
    }

    while (vIdx < vocWords.length && !getPureHebrew(vocWords[vIdx])) vIdx += 1;

    if (vIdx >= vocWords.length) {
      segments.push(makeSegment(SegmentKind.INSERTED, token));
      continue;
    }

    const currentVoc = vocWords[vIdx];

    if (_isMatch(token, currentVoc, config)) {
      const aClean = cleanForCompare(token, config, SCOPE_CLEAN);
      const bClean = cleanForCompare(currentVoc, config, SCOPE_VOC);
      if (aClean !== bClean) {
        segments.push(makeSegment(SegmentKind.SPELLING_DIFF, currentVoc, token));
      } else {
        segments.push(makeSegment(SegmentKind.UNCHANGED, currentVoc));
      }
      vIdx += 1;
      matchCount += 1;
      continue;
    }

    const [bestIdx /* , _score */] = _findBestMatchAhead(
      token, cleanTokens, cIdx, vocWords, vIdx, config,
    );

    if (bestIdx !== -1) {
      for (let i = vIdx; i < bestIdx; i++) {
        segments.push(makeSegment(SegmentKind.DELETED, vocWords[i] + " "));
      }
      const found = vocWords[bestIdx];
      const aClean = cleanForCompare(token, config, SCOPE_CLEAN);
      const bClean = cleanForCompare(found, config, SCOPE_VOC);
      if (aClean !== bClean) {
        segments.push(makeSegment(SegmentKind.SPELLING_DIFF, found, token));
      } else {
        segments.push(makeSegment(SegmentKind.UNCHANGED, found));
      }
      vIdx = bestIdx + 1;
      matchCount += 1;
    } else {
      segments.push(makeSegment(SegmentKind.INSERTED, token));
    }
  }

  if (!stopped) {
    for (let i = vIdx; i < vocWords.length; i++) {
      segments.push(makeSegment(SegmentKind.DELETED, vocWords[i] + " "));
    }
  }

  let cleanWordCount = 0;
  for (const t of cleanTokens) {
    if (_isHebrewToken(t) && getPureHebrew(t)) cleanWordCount += 1;
  }
  let vocWordCount = 0;
  for (const w of vocWords) {
    if (getPureHebrew(w)) vocWordCount += 1;
  }

  return {
    segments,
    matchCount,
    cleanWordCount,
    vocWordCount,
    stopped,
    get matchRatio() { return this.matchCount / Math.max(1, this.cleanWordCount); },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// difflib SequenceMatcher (port מינימלי של autojunk=False)
// משמש ב-_mergeCharLevel; מחזיר opcodes בפורמט [op, i1, i2, j1, j2].
// ═══════════════════════════════════════════════════════════════════════════

function _seqMatcher(a, b) {
  // בנה b2j: char → רשימת אינדקסים ב-b
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(j);
  }

  function findLongestMatch(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newJ2len = new Map();
      const indices = b2j.get(a[i]) || [];
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newJ2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newJ2len;
    }
    return [besti, bestj, bestsize];
  }

  function getMatchingBlocks() {
    const queue = [[0, a.length, 0, b.length]];
    const matchingBlocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
      if (k > 0) {
        matchingBlocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    matchingBlocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    // מיזוג בלוקים שכנים
    const merged = [];
    let i1 = 0, j1 = 0, k1 = 0;
    for (const [i2, j2, k2] of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) merged.push([i1, j1, k1]);
        i1 = i2; j1 = j2; k1 = k2;
      }
    }
    if (k1) merged.push([i1, j1, k1]);
    merged.push([a.length, b.length, 0]);
    return merged;
  }

  function getOpcodes() {
    const opcodes = [];
    let i = 0, j = 0;
    for (const [ai, bj, size] of getMatchingBlocks()) {
      let tag = "";
      if (i < ai && j < bj) tag = "replace";
      else if (i < ai) tag = "delete";
      else if (j < bj) tag = "insert";
      if (tag) opcodes.push([tag, i, ai, j, bj]);
      i = ai + size; j = bj + size;
      if (size) opcodes.push(["equal", ai, i, bj, j]);
    }
    return opcodes;
  }

  return { getOpcodes };
}

function _mergeCharLevel(cleanText, vocalizedText, config, progressCallback) {
  const vocPlainChars = [];
  const vocOrigIndices = [];
  for (let idx = 0; idx < vocalizedText.length; idx++) {
    const ch = vocalizedText[idx];
    const stripped = stripNikudAndTaam(ch);
    if (stripped) {
      vocPlainChars.push(stripped);
      vocOrigIndices.push(idx);
    }
  }
  const vocPlain = vocPlainChars.join("");

  const matcher = _seqMatcher(cleanText, vocPlain);
  const segments = [];
  let matchCount = 0;

  function vocSlice(j1, j2) {
    if (j1 >= vocOrigIndices.length) return "";
    const start = vocOrigIndices[j1];
    let end;
    if (j2 >= vocOrigIndices.length) end = vocalizedText.length;
    else end = vocOrigIndices[j2];
    return vocalizedText.slice(start, end);
  }

  for (const [op, i1, i2, j1, j2] of matcher.getOpcodes()) {
    if (op === "equal") {
      const text = vocSlice(j1, j2);
      if (text) {
        segments.push(makeSegment(SegmentKind.UNCHANGED, text));
        matchCount += text.split(/\s+/).filter(Boolean).length;
      }
    } else if (op === "insert") {
      const text = vocSlice(j1, j2);
      if (text) segments.push(makeSegment(SegmentKind.DELETED, text));
    } else if (op === "delete") {
      const text = cleanText.slice(i1, i2);
      if (text) segments.push(makeSegment(SegmentKind.INSERTED, text));
    } else if (op === "replace") {
      const vocText = vocSlice(j1, j2);
      const cleanPart = cleanText.slice(i1, i2);
      if (vocText) segments.push(makeSegment(SegmentKind.DELETED, vocText));
      if (cleanPart) segments.push(makeSegment(SegmentKind.INSERTED, cleanPart));
    }
  }

  if (progressCallback) progressCallback(100);

  const cleanWordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const vocWordCount   = vocalizedText.split(/\s+/).filter(Boolean).length;

  return {
    segments,
    matchCount,
    cleanWordCount,
    vocWordCount,
    stopped: false,
    get matchRatio() { return this.matchCount / Math.max(1, this.cleanWordCount); },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// רנדור — render_as_html / render_as_plain
// ═══════════════════════════════════════════════════════════════════════════

function _escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderAsHtml(result) {
  const parts = [];
  for (const seg of result.segments) {
    const br = (s) => _escapeHtml(s).replace(/\n/g, "<br>").replace(/\r/g, "");
    if (seg.kind === SegmentKind.PASSTHROUGH) parts.push(br(seg.text));
    else if (seg.kind === SegmentKind.UNCHANGED) parts.push(br(seg.text));
    else if (seg.kind === SegmentKind.INSERTED) parts.push(`<ins>${br(seg.text)}</ins>`);
    else if (seg.kind === SegmentKind.DELETED) parts.push(`<del>${br(seg.text)}</del>`);
    else if (seg.kind === SegmentKind.SPELLING_DIFF) {
      parts.push(
        `<span class="spelling-diff">` +
        `<del>${br(seg.original)}</del>` +
        `<ins>${br(seg.text)}</ins>` +
        `</span>`
      );
    }
  }
  return parts.join("");
}

export function renderAsPlain(result, acceptAll = true) {
  const parts = [];
  for (const seg of result.segments) {
    if (seg.kind === SegmentKind.PASSTHROUGH
     || seg.kind === SegmentKind.UNCHANGED
     || seg.kind === SegmentKind.INSERTED) {
      parts.push(seg.text);
    } else if (seg.kind === SegmentKind.DELETED) {
      if (!acceptAll) parts.push(seg.text);
    } else if (seg.kind === SegmentKind.SPELLING_DIFF) {
      parts.push(acceptAll ? seg.text : seg.original);
    }
  }
  return parts.join("");
}


// ═══════════════════════════════════════════════════════════════════════════
// multi_source.py
// ═══════════════════════════════════════════════════════════════════════════

export const MultiMode = Object.freeze({
  CHAIN:         "chain",
  VOTING:        "voting",
  BEST_MATCH:    "best_match",
  MANUAL_REVIEW: "manual_review",
});

export function makeMultiSegment(opts) {
  return {
    kind: opts.kind,
    text: opts.text || "",
    original: opts.original || "",
    options: opts.options || [],
    chosenSource: (opts.chosenSource !== undefined) ? opts.chosenSource : -1,
    get hasOptions() { return (this.options || []).length > 1; },
  };
}

export function mergeAllSources(cleanText, sources, opts = {}) {
  let { config = null, progressCallback = null, stopFlag = null, mode = "word" } = opts;
  if (!sources || sources.length === 0) {
    return { segments: [], sourceNames: [], statsPerSource: [], mode: MultiMode.CHAIN };
  }
  const allSegments = [];
  const stats = [];

  for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
    const [name, text] = sources[srcIdx];
    const srcResult = merge(cleanText, text, {
      config, progressCallback: null, stopFlag, mode,
    });
    let matched = 0;
    for (const seg of srcResult.segments) {
      const ms = makeMultiSegment({
        kind: seg.kind, text: seg.text, original: seg.original,
        options: [],
        chosenSource: (seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF)
          ? srcIdx : -1,
      });
      allSegments.push(ms);
      if (seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF) {
        matched += 1;
      }
    }
    if (srcIdx < sources.length - 1) {
      allSegments.push(makeMultiSegment({
        kind: SegmentKind.PASSTHROUGH,
        text: `\n\n━━━ ${name} ↓ | ${sources[srcIdx+1][0]} ↑ ━━━\n\n`,
        original: "",
        options: [],
        chosenSource: -1,
      }));
    }
    stats.push({ matched, source: name });
  }

  return {
    segments: allSegments,
    sourceNames: sources.map(s => s[0]),
    statsPerSource: stats,
    mode: MultiMode.CHAIN,
  };
}

export function mergeChain(cleanText, sources, opts = {}) {
  let { config = null, progressCallback = null, stopFlag = null } = opts;
  if (!sources || sources.length === 0) {
    return { segments: [], sourceNames: [], statsPerSource: [], mode: MultiMode.CHAIN };
  }
  const [, firstText] = sources[0];
  const currentResult = merge(cleanText, firstText, { config, progressCallback, stopFlag });

  const multiSegments = currentResult.segments.map(seg => makeMultiSegment({
    kind: seg.kind, text: seg.text, original: seg.original,
    options: [],
    chosenSource: (seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF) ? 0 : -1,
  }));

  for (let srcIdx = 1; srcIdx < sources.length; srcIdx++) {
    const [, text] = sources[srcIdx];
    const unmatchedWords = [];
    const unmatchedIndices = [];
    for (let i = 0; i < multiSegments.length; i++) {
      const seg = multiSegments[i];
      if (seg.kind === SegmentKind.INSERTED) {
        unmatchedWords.push(seg.text);
        unmatchedIndices.push(i);
      }
    }
    if (unmatchedWords.length === 0) break;
    const partialClean = unmatchedWords.join(" ");
    const partialResult = merge(partialClean, text, { config });
    let wordIdx = 0;
    for (const seg of partialResult.segments) {
      if (seg.kind === SegmentKind.PASSTHROUGH) continue;
      if (wordIdx >= unmatchedIndices.length) break;
      const multiIdx = unmatchedIndices[wordIdx];
      if (seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF) {
        multiSegments[multiIdx].kind = seg.kind;
        multiSegments[multiIdx].text = seg.text;
        if (seg.kind === SegmentKind.SPELLING_DIFF) multiSegments[multiIdx].original = seg.original;
        multiSegments[multiIdx].chosenSource = srcIdx;
        wordIdx += 1;
      } else if (seg.kind === SegmentKind.INSERTED) {
        wordIdx += 1;
      }
    }
  }

  const statsPerSource = [];
  for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
    let matched = 0;
    for (const s of multiSegments) if (s.chosenSource === srcIdx) matched += 1;
    statsPerSource.push({ matched, source: sources[srcIdx][0] });
  }

  return {
    segments: multiSegments,
    sourceNames: sources.map(s => s[0]),
    statsPerSource,
    mode: MultiMode.CHAIN,
  };
}

export function mergeManualReview(cleanText, sources, opts = {}) {
  let { config = null, progressCallback = null, stopFlag = null } = opts;
  if (!sources || sources.length === 0) {
    return { segments: [], sourceNames: [], statsPerSource: [], mode: MultiMode.MANUAL_REVIEW };
  }
  if (config === null) config = new FilterConfig();

  const allResults = [];
  for (const [, text] of sources) {
    if (stopFlag && stopFlag.stop) break;
    allResults.push(merge(cleanText, text, { config, progressCallback, stopFlag }));
  }

  if (allResults.length === 0) {
    return { segments: [], sourceNames: [], statsPerSource: [], mode: MultiMode.MANUAL_REVIEW };
  }

  const lists = allResults.map(r => r.segments);
  const hebrewLists = lists.map(segs => segs.filter(s => s.kind !== SegmentKind.PASSTHROUGH));
  const indices = new Array(lists.length).fill(0);
  const multiSegments = [];

  for (const seg0 of lists[0]) {
    if (seg0.kind === SegmentKind.PASSTHROUGH) {
      multiSegments.push(makeMultiSegment({ kind: SegmentKind.PASSTHROUGH, text: seg0.text }));
      continue;
    }
    const options = [];
    for (let srcIdx = 0; srcIdx < lists.length; srcIdx++) {
      const hl = hebrewLists[srcIdx];
      const idx = indices[srcIdx];
      if (idx < hl.length) {
        const seg = hl[idx];
        const opt = {
          sourceIndex: srcIdx,
          sourceName:  sources[srcIdx][0],
          text: seg.kind !== SegmentKind.INSERTED ? seg.text : "",
          isMatch: seg.kind !== SegmentKind.INSERTED,
          isSpellingDiff: seg.kind === SegmentKind.SPELLING_DIFF,
        };
        if (opt.isMatch) options.push(opt);
        indices[srcIdx] += 1;
      }
    }

    const uniqueTexts = new Set(options.filter(o => o.isMatch).map(o => o.text));

    if (options.length === 0) {
      multiSegments.push(makeMultiSegment({
        kind: SegmentKind.INSERTED, text: seg0.text,
        options: [], chosenSource: -1,
      }));
    } else if (uniqueTexts.size === 1) {
      const chosen = options[0];
      const isSpelling = options.some(o => o.isSpellingDiff);
      multiSegments.push(makeMultiSegment({
        kind: isSpelling ? SegmentKind.SPELLING_DIFF : SegmentKind.UNCHANGED,
        text: chosen.text,
        original: seg0.original || "",
        options,
        chosenSource: chosen.sourceIndex,
      }));
    } else {
      const chosen = options[0];
      const isSpelling = options[0].isSpellingDiff;
      multiSegments.push(makeMultiSegment({
        kind: isSpelling ? SegmentKind.SPELLING_DIFF : SegmentKind.UNCHANGED,
        text: chosen.text,
        original: seg0.original || "",
        options,
        chosenSource: chosen.sourceIndex,
      }));
    }
  }

  const statsPerSource = [];
  for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
    let matched = 0;
    for (const s of multiSegments) if (s.chosenSource === srcIdx) matched += 1;
    statsPerSource.push({ matched, source: sources[srcIdx][0] });
  }

  return {
    segments: multiSegments,
    sourceNames: sources.map(s => s[0]),
    statsPerSource,
    mode: MultiMode.MANUAL_REVIEW,
  };
}

export function mergeMulti(cleanText, sources, mode = MultiMode.MANUAL_REVIEW, opts = {}) {
  if (mode === MultiMode.CHAIN) return mergeChain(cleanText, sources, opts);
  if (mode === MultiMode.MANUAL_REVIEW) return mergeManualReview(cleanText, sources, opts);
  // VOTING / BEST_MATCH דרך manual_review (זהה במקור)
  return mergeManualReview(cleanText, sources, opts);
}


// ═══════════════════════════════════════════════════════════════════════════
// project.py — שמירה/טעינה (ב-JS: localStorage במקום קובץ JSON על דיסק)
// ═══════════════════════════════════════════════════════════════════════════

export function makeTabData(init = {}) {
  return {
    name: init.name || "",
    clean_text: init.clean_text || "",
    vocalized_sources: Array.isArray(init.vocalized_sources) ? init.vocalized_sources.slice() : [],
    filter_config: init.filter_config && typeof init.filter_config === "object"
      ? Object.assign({}, init.filter_config)
      : new FilterConfig().toDict(),
  };
}

export function makeProjectData(init = {}) {
  return {
    version: init.version || "1.0",
    created: init.created || "",
    modified: init.modified || "",
    tabs: Array.isArray(init.tabs) ? init.tabs.map(t => makeTabData(t)) : [],
    master_text: init.master_text || "",
    saved_filter_profiles: init.saved_filter_profiles && typeof init.saved_filter_profiles === "object"
      ? Object.assign({}, init.saved_filter_profiles)
      : {},
  };
}

const LS_PROJECT_KEY  = "ravtext.nikud_merger.project";
const LS_AUTOSAVE_KEY = "ravtext.nikud_merger.autosave";
const LS_PROFILES_KEY = "ravtext.nikud_merger.filter_profiles";

export function saveProject(project, key = LS_PROJECT_KEY) {
  project.modified = new Date().toISOString();
  if (!project.created) project.created = project.modified;
  try {
    localStorage.setItem(key, JSON.stringify(project));
    return true;
  } catch (_) { return false; }
}

export function loadProject(key = LS_PROJECT_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return makeProjectData(JSON.parse(raw));
  } catch (_) { return null; }
}

export function autosave(project) {
  try { saveProject(project, LS_AUTOSAVE_KEY); } catch (_) { /* ignore */ }
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE_KEY);
    if (!raw) return null;
    return makeProjectData(JSON.parse(raw));
  } catch (_) { return null; }
}

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(LS_PROFILES_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) { return {}; }
}

export function saveProfile(name, config) {
  const profiles = loadProfiles();
  profiles[name] = config.toDict ? config.toDict() : Object.assign({}, config);
  try { localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(profiles)); }
  catch (_) { /* ignore */ }
}

export function deleteProfile(name) {
  const profiles = loadProfiles();
  if (profiles[name] !== undefined) {
    delete profiles[name];
    try { localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(profiles)); }
    catch (_) { /* ignore */ }
    return true;
  }
  return false;
}

export function getProfile(name) {
  const profiles = loadProfiles();
  if (profiles[name]) return FilterConfig.fromDict(profiles[name]);
  return null;
}
