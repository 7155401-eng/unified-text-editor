// Torah-editor toolbox — Sefaria verse picker, gimatria, Hebrew date,
// Hebrew typographic special characters.
//
// As of Phase 2 (2026-05-08): all Sefaria text reads come from the local mirror
// (src/sefaria_local.js → public/data/sefaria/*.json), never from sefaria.org.
// This eliminates CSP issues, the 500-on-Hebrew-refs bug, and offline failures.

import { getVerseText as _getVerseTextFromMirror, ensureCorpus as _ensureCorpus, listBooks as _listBooks } from "./sefaria_local.js";
import { searchByText as _searchByText } from "./sefaria_search.js";
import { formatCitation as _formatCitation, formatRefLabel as _formatRefLabel } from "./sefaria_ref_format.js";
import { showMatchDialog as _showMatchDialog } from "./sefaria_match_dialog.js";
import { findVerseInSelection as _findVerseInSelection } from "./sefaria_locate.js";
import { parseUserRef as _parseUserRef } from "./sefaria_parse_ref.js";

const GIMATRIA_VALUES = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
  "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
};

const SPECIAL_CHARS = [
  ["גרשיים ״", "״"],
  ["גרש ׳", "׳"],
  ["מקף עברי ־", "־"],
  ["סוף פסוק ׃", "׃"],
  ["פסק ׀", "׀"],
  ["מרכאות פותחות „", "„"],
  ["מרכאות סוגרות “", "“"],
  ["—", "—"],
  ["–", "–"],
  ["…", "…"],
  ["§", "§"],
  ["¶", "¶"],
  ["★", "★"],
  ["✓", "✓"],
  ["✗", "✗"],
];

const TANACH_BOOKS = [
  "בראשית", "שמות", "ויקרא", "במדבר", "דברים",
  "יהושע", "שופטים", "שמואל א", "שמואל ב", "מלכים א", "מלכים ב",
  "ישעיהו", "ירמיהו", "יחזקאל",
  "הושע", "יואל", "עמוס", "עובדיה", "יונה", "מיכה",
  "נחום", "חבקוק", "צפניה", "חגי", "זכריה", "מלאכי",
  "תהילים", "משלי", "איוב",
  "שיר השירים", "רות", "איכה", "קהלת", "אסתר",
  "דניאל", "עזרא", "נחמיה", "דברי הימים א", "דברי הימים ב",
];

// Sefaria's /api/texts/ accepts only English book refs.
// Hebrew refs return 500 or strip the chapter/verse silently.
const SEFARIA_REF = {
  "בראשית": "Genesis", "שמות": "Exodus", "ויקרא": "Leviticus",
  "במדבר": "Numbers", "דברים": "Deuteronomy",
  "יהושע": "Joshua", "שופטים": "Judges",
  "שמואל א": "I Samuel", "שמואל ב": "II Samuel",
  "מלכים א": "I Kings", "מלכים ב": "II Kings",
  "ישעיהו": "Isaiah", "ירמיהו": "Jeremiah", "יחזקאל": "Ezekiel",
  "הושע": "Hosea", "יואל": "Joel", "עמוס": "Amos", "עובדיה": "Obadiah",
  "יונה": "Jonah", "מיכה": "Micah", "נחום": "Nahum", "חבקוק": "Habakkuk",
  "צפניה": "Zephaniah", "חגי": "Haggai", "זכריה": "Zechariah", "מלאכי": "Malachi",
  "תהילים": "Psalms", "משלי": "Proverbs", "איוב": "Job",
  "שיר השירים": "Song of Songs", "רות": "Ruth", "איכה": "Lamentations",
  "קהלת": "Ecclesiastes", "אסתר": "Esther",
  "דניאל": "Daniel", "עזרא": "Ezra", "נחמיה": "Nehemiah",
  "דברי הימים א": "I Chronicles", "דברי הימים ב": "II Chronicles",
};

const HEB_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const HEB_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];

function numberToHebrewLetters(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1) return "";
  let result = "";
  let rest = n;
  while (rest >= 400) { result += "ת"; rest -= 400; }
  if (rest >= 100) {
    const h = Math.floor(rest / 100);
    result += "קרש"[h - 1] || "";
    rest = rest % 100;
  }
  if (rest === 15) return result + "טו";
  if (rest === 16) return result + "טז";
  if (rest >= 10) {
    result += HEB_TENS[Math.floor(rest / 10)];
    rest = rest % 10;
  }
  if (rest > 0) result += HEB_ONES[rest];
  return result;
}

function stripTaamim(text) {
  return String(text || "").replace(/[֑-ֽֿ֯׀׃׆]/g, "");
}
function stripAllNiqqud(text) {
  return String(text || "").replace(/[֑-ׇ]/g, "");
}

function gimatriaValue(text) {
  let sum = 0;
  const stripped = stripAllNiqqud(text);
  for (const ch of stripped) {
    if (GIMATRIA_VALUES[ch]) sum += GIMATRIA_VALUES[ch];
  }
  return sum;
}

function selectedText(editor) {
  if (!editor) return "";
  const { from, to, empty } = editor.state.selection;
  if (empty) return "";
  return editor.state.doc.textBetween(from, to, " ", " ");
}

function insertText(editor, text) {
  if (!editor || !text) return;
  editor.chain().focus().insertContent(text).run();
}

function todayHebrewDate() {
  try {
    return new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
      day: "numeric", month: "long", year: "numeric",
    }).format(new Date());
  } catch {
    return new Date().toLocaleDateString("he-IL");
  }
}

// Fetch a verse by its Hebrew book title. The book lives in one of three
// corpora; bookCorpus tells us which one to pass. For Tanakh we also have
// the English-name map (SEFARIA_REF) for backward compatibility.
async function fetchSefariaVerse(book, chap, verse, corpusName) {
  if (corpusName === "tanakh") {
    const engBook = SEFARIA_REF[book] || book;
    return _getVerseTextFromMirror(engBook, chap, verse, { corpus: "tanakh" });
  }
  // Mishnah + Bavli: pass the Hebrew title directly; sefaria_local resolves it.
  return _getVerseTextFromMirror(book, chap, verse, { corpus: corpusName });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function smallSourceHtml(citationText) {
  return `<span style="font-size:70%">${escapeHtml(citationText)}</span>`;
}

function buildCitation(book, chap, verse, corpus) {
  // Bavli convention: "(שבת ד, ב)" reads weird; common form is "(שבת ד.)" or
  // "(שבת ד:)" but we don't know amud from segment-index. Stick with the
  // generic gematria form for all corpora — caller can edit after.
  return `(${book} ${numberToHebrewLetters(chap)}, ${numberToHebrewLetters(verse)})`;
}

function applyNiqqudPref(text, withNiqqud) {
  return withNiqqud ? stripTaamim(text) : stripAllNiqqud(text);
}

function buildSelect(id, title, items, placeholder) {
  const sel = document.createElement("select");
  sel.id = id;
  sel.title = title;
  sel.className = "torah-tool-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  sel.appendChild(blank);
  for (const item of items) {
    const [label, value] = Array.isArray(item) ? item : [item, item];
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  return sel;
}

export function wireTorahTools(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;
  toolbar.replaceChildren();

  const getEditor = () => paneManager.getActiveEditor?.();

  // === Group: special characters ===
  const charsSelect = buildSelect(
    "torah-chars-select",
    "תווים מיוחדים — גרשיים, מקף עברי, סוף פסוק וכו'",
    SPECIAL_CHARS,
    "תווים מיוחדים…"
  );
  charsSelect.addEventListener("change", () => {
    if (charsSelect.value) insertText(getEditor(), charsSelect.value);
    charsSelect.value = "";
  });
  const groupChars = document.createElement("span");
  groupChars.className = "tb-group";
  groupChars.dataset.title = "תווים מיוחדים";
  groupChars.appendChild(charsSelect);

  // === Group: calculation tools ===
  const groupCalc = document.createElement("span");
  groupCalc.className = "tb-group";
  groupCalc.dataset.title = "כלי חישוב והוספה";
  const gimBtn = document.createElement("button");
  gimBtn.type = "button";
  gimBtn.textContent = "🔢 גימטריה";
  gimBtn.title = "חשב את הגימטריה של הטקסט הנבחר";
  gimBtn.addEventListener("click", () => {
    const ed = getEditor();
    const text = selectedText(ed);
    if (!text.trim()) {
      alert("בחר טקסט עברי כדי לחשב את הגימטריה.");
      return;
    }
    const value = gimatriaValue(text);
    const insert = confirm(`הגימטריה של "${text.trim()}" היא ${value}.\n\nלהוסיף את התוצאה אחרי הטקסט הנבחר?`);
    if (insert && ed) {
      ed.chain().focus().setTextSelection(ed.state.selection.to).insertContent(` (${value})`).run();
    }
  });
  groupCalc.appendChild(gimBtn);

  const dateBtn = document.createElement("button");
  dateBtn.type = "button";
  dateBtn.textContent = "📅 תאריך עברי";
  dateBtn.title = "הוסף את התאריך העברי הנוכחי";
  dateBtn.addEventListener("click", () => insertText(getEditor(), todayHebrewDate()));
  groupCalc.appendChild(dateBtn);

  // === Two Sefaria groups ===
  // Per Moshe (2026-05-09): the action buttons (📜 הכנס פסוק + the four
  // ניקוד / מקור / שניהם / השלמת כל המקור) belong together and apart from
  // the inputs (book picker, chapter, verse, niqqud checkbox, position).
  // So we render two adjacent .tb-group containers with a separator between.
  const groupVerseInputs = document.createElement("span");
  groupVerseInputs.className = "tb-group torah-verse-inputs-group";
  groupVerseInputs.dataset.title = "ספר / פרק / פסוק";

  const groupVerseActions = document.createElement("span");
  groupVerseActions.className = "tb-group torah-verse-actions-group";
  groupVerseActions.dataset.title = "פעולות ספריא";

  const labelBook = document.createElement("span");
  labelBook.style.cssText = "font-size:12px;color:#555;";
  labelBook.textContent = "ספר:";

  // Single grouped <select> with three optgroups: תנ"ך, משנה, בבלי.
  // Each option's value is "<corpus>::<heTitle>" so the click handler knows
  // which corpus to load and which book to ask for. Mishnah + Bavli get
  // populated lazily on first selection (loadCorpus is cached).
  const bookSel = document.createElement("select");
  bookSel.id = "torah-book-select";
  bookSel.title = "בחר ספר — תנ\"ך, משנה, או בבלי";
  bookSel.className = "torah-tool-select";
  bookSel.style.cssText = "max-width:200px;";

  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "— בחר ספר —";
  bookSel.appendChild(blankOpt);

  const tanakhGroup = document.createElement("optgroup");
  tanakhGroup.label = "תנ\"ך";
  for (const heTitle of TANACH_BOOKS) {
    const o = document.createElement("option");
    o.value = `tanakh::${heTitle}`;
    o.textContent = heTitle;
    tanakhGroup.appendChild(o);
  }
  bookSel.appendChild(tanakhGroup);

  const mishnahGroup = document.createElement("optgroup");
  mishnahGroup.label = "משנה";
  bookSel.appendChild(mishnahGroup);

  const bavliGroup = document.createElement("optgroup");
  bavliGroup.label = "בבלי";
  bookSel.appendChild(bavliGroup);

  // Populate Mishnah + Bavli on demand when the user opens the dropdown the
  // first time. Awaiting on focus keeps the initial toolbar render instant.
  let _populatedMishnahBavli = false;
  async function populateMishnahBavli() {
    if (_populatedMishnahBavli) return;
    _populatedMishnahBavli = true;
    try {
      await Promise.all([_ensureCorpus("mishnah"), _ensureCorpus("bavli")]);
      const fillGroup = (group, corpusName) => {
        const books = _listBooks(corpusName);
        for (const { heTitle } of books) {
          if (!heTitle) continue;
          const o = document.createElement("option");
          o.value = `${corpusName}::${heTitle}`;
          o.textContent = heTitle;
          group.appendChild(o);
        }
      };
      fillGroup(mishnahGroup, "mishnah");
      fillGroup(bavliGroup, "bavli");
    } catch (e) {
      console.warn("[torah] could not populate Mishnah/Bavli:", e);
      _populatedMishnahBavli = false;
    }
  }
  bookSel.addEventListener("focus", populateMishnahBavli, { once: false });
  bookSel.addEventListener("mousedown", populateMishnahBavli, { once: false });

  const chapInput = document.createElement("input");
  chapInput.type = "number";
  chapInput.min = "1";
  chapInput.placeholder = "פרק";
  chapInput.title = "מספר פרק (משנה: פרק • בבלי: דף)";
  chapInput.id = "torah-chap-input";
  chapInput.style.cssText = "width:60px;font-size:12px;padding:3px 6px;";

  const verseInput = document.createElement("input");
  verseInput.type = "number";
  verseInput.min = "1";
  verseInput.placeholder = "פסוק";
  verseInput.title = "מספר פסוק (משנה: משנה • בבלי: שורה)";
  verseInput.id = "torah-verse-input";
  verseInput.style.cssText = "width:60px;font-size:12px;padding:3px 6px;";

  // Update placeholders + chap/verse hints when the user picks a book — so
  // they can see at a glance whether to type a chapter or a daf.
  bookSel.addEventListener("change", () => {
    const v = bookSel.value;
    if (v.startsWith("bavli::")) {
      chapInput.placeholder = "דף";
      verseInput.placeholder = "שורה";
    } else if (v.startsWith("mishnah::")) {
      chapInput.placeholder = "פרק";
      verseInput.placeholder = "משנה";
    } else {
      chapInput.placeholder = "פרק";
      verseInput.placeholder = "פסוק";
    }
  });

  const niqqudLabel = document.createElement("label");
  niqqudLabel.className = "toolbar-checkbox";
  niqqudLabel.title = "כשמסומן — הפסוק נכנס מנוקד (ללא טעמי מקרא); אחרת ללא ניקוד כלל";
  const niqqudCb = document.createElement("input");
  niqqudCb.type = "checkbox";
  niqqudCb.id = "torah-niqqud-toggle";
  niqqudCb.checked = localStorage.getItem("ravtext.torah.niqqud") !== "0";
  const niqqudText = document.createElement("span");
  niqqudText.textContent = "נקד את הפסוק";
  niqqudLabel.appendChild(niqqudCb);
  niqqudLabel.appendChild(niqqudText);
  niqqudCb.addEventListener("change", () => {
    localStorage.setItem("ravtext.torah.niqqud", niqqudCb.checked ? "1" : "0");
  });

  const fetchBtn = document.createElement("button");
  fetchBtn.type = "button";
  fetchBtn.id = "torah-fetch-verse";
  fetchBtn.textContent = "📜 הכנס פסוק";
  fetchBtn.title = "מחפש את הפסוק הנבחר בספריא ומכניס אותו עם מקור בסוף";

  const status = document.createElement("span");
  status.id = "torah-verse-status";
  status.style.cssText = "font-size:11px;color:#888;margin-inline-start:6px;";

  // Source-position dropdown (where the citation/replacement targets):
  //   "after"        — right after the entire selection
  //   "before"       — right before the entire selection
  //   "after-quote"  — right after the verse-portion identified within the selection
  //   "before-quote" — right before the verse-portion identified within the selection
  // Persisted in localStorage. The "-quote" modes fetch the verse from Sefaria
  // and substring-match it (after stripping niqqud) inside the selected text;
  // if no match found, falls back to whole-selection behavior.
  const posSel = document.createElement("select");
  posSel.id = "torah-source-position";
  posSel.title = "מיקום המקור — ביחס לכל הסימון או רק לציטוט שבתוכו";
  posSel.className = "torah-tool-select";
  posSel.style.cssText = "font-size:11px;padding:2px 4px;";
  const POS_OPTIONS = [
    ["מקור אחרי הסימון", "after"],
    ["מקור לפני הסימון", "before"],
    ["מקור אחרי הציטוט בתוך הסימון", "after-quote"],
    ["מקור לפני הציטוט בתוך הסימון", "before-quote"],
  ];
  const VALID_POS = new Set(POS_OPTIONS.map(([, v]) => v));
  for (const [label, value] of POS_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    posSel.appendChild(opt);
  }
  const savedPos = localStorage.getItem("ravtext.torah.source_position");
  posSel.value = VALID_POS.has(savedPos) ? savedPos : "after";
  posSel.addEventListener("change", () => {
    localStorage.setItem("ravtext.torah.source_position", posSel.value);
  });

  // Locator extracted to src/sefaria_locate.js — see imports at top of file.
  const findVerseInSelection = _findVerseInSelection;

  function readRefInputs({ silent = false } = {}) {
    const raw = bookSel.value;
    const chap = parseInt(chapInput.value, 10);
    const verse = parseInt(verseInput.value, 10);
    if (!raw) {
      if (!silent) alert("בחר ספר.");
      return null;
    }
    const sep = raw.indexOf("::");
    const corpus = sep >= 0 ? raw.slice(0, sep) : "tanakh";
    const book = sep >= 0 ? raw.slice(sep + 2) : raw;
    if (!Number.isFinite(chap) || chap < 1) {
      if (!silent) chapInput.focus();
      return null;
    }
    if (!Number.isFinite(verse) || verse < 1) {
      if (!silent) verseInput.focus();
      return null;
    }
    return { book, chap, verse, corpus };
  }

  fetchBtn.addEventListener("click", async () => {
    const ref = readRefInputs();
    if (!ref) return;
    const ed = getEditor();
    if (!ed) { alert("פתח עורך פעיל לפני הכנסת פסוק."); return; }

    fetchBtn.disabled = true;
    status.textContent = "טוען מספריא…";
    try {
      let text = await fetchSefariaVerse(ref.book, ref.chap, ref.verse, ref.corpus);
      if (!text) throw new Error("הפסוק לא נמצא");
      text = applyNiqqudPref(text, niqqudCb.checked);
      const citation = " " + buildCitation(ref.book, ref.chap, ref.verse, ref.corpus);
      ed.chain().focus().insertContent(text + citation).run();
      status.textContent = "הוכנס.";
      setTimeout(() => { status.textContent = ""; }, 2000);
    } catch (e) {
      console.error("[torah] sefaria fetch:", e);
      status.textContent = `שגיאה: ${e.message || e}`;
      setTimeout(() => { status.textContent = ""; }, 4000);
    } finally {
      fetchBtn.disabled = false;
    }
  });

  function ensureSelection(ed) {
    const { from, to, empty } = ed.state.selection;
    if (empty) {
      alert("סמן טקסט בעורך לפני הפעולה.");
      return null;
    }
    // Quote-relative position math (origStart/origEnd → PM positions) assumes
    // the selection is contained in a single block. Across blocks, ProseMirror
    // inserts 2-position transitions while textBetween returns a 1-char
    // separator — the math drifts. Refuse with a clear message.
    const fromBlock = ed.state.doc.resolve(from).parent;
    const toBlock = ed.state.doc.resolve(to).parent;
    if (fromBlock !== toBlock) {
      alert("הסימון חוצה יותר מפסקה אחת. סמן בתוך פסקה אחת בלבד.");
      return null;
    }
    return { from, to };
  }

  // Resolve which Sefaria reference a button click should act on.
  // Priority:
  //   1. If the manual dropdown (book/chap/verse) is filled — use it (manual override)
  //   2. Else search the local mirror for the selected text:
  //      0 hits   → throws (caller shows the error in the status bar)
  //      1 hit    → use it
  //      2+ hits  → modal dialog, user picks
  // Returns:
  //   { match, withNiqqud, withSource }
  //   - match always present
  //   - withNiqqud / withSource only set when the user picked from the multi-match
  //     dialog (those checkboxes override the toolbar's niqqud + the button's cite).
  //     For manual / single-match paths they are undefined → caller falls back
  //     to button intent + toolbar checkbox.
  async function resolveMatch(selectionText, dialogDefaults) {
    const manual = readRefInputs({ silent: true });
    if (manual) {
      const original = await fetchSefariaVerse(manual.book, manual.chap, manual.verse, manual.corpus);
      const englishTitle = manual.corpus === "tanakh"
        ? (SEFARIA_REF[manual.book] || manual.book)
        : manual.book;
      return {
        match: {
          corpus: manual.corpus,
          bookTitle: englishTitle,
          heTitle: manual.book,
          chapter: manual.chap,
          verse: manual.verse,
          original,
          matchType: "manual",
        },
      };
    }
    status.textContent = "מאתר במאגר…";
    // Quick word-count sanity check — single-word selections produce thousands
    // of matches and a useless dialog, so we refuse them early with a clear
    // message rather than letting searchByText silently return [].
    const wordCount = selectionText
      .replace(/[֑-ׇ׃׀,.;:!?()[\]{}״׳"'׳״]/g, " ")
      .replace(/־/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (wordCount < 2) {
      throw new Error("נא חפש לפחות 2 מילים");
    }
    const matches = await _searchByText(selectionText);
    if (matches.length === 0) {
      throw new Error("הטקסט לא נמצא במאגר ספריא");
    }
    if (matches.length === 1) return { match: matches[0] };
    const picked = await _showMatchDialog(matches, dialogDefaults);
    if (!picked) {
      const e = new Error("בוטל");
      e.cancelled = true;
      throw e;
    }
    // picked is { match, withNiqqud, withSource } — flow it through to runAction.
    return picked;
  }

  async function runAction({ replace, cite, dialogDefaults }, btn) {
    const ed = getEditor();
    if (!ed) { alert("פתח עורך פעיל."); return; }
    const sel = ensureSelection(ed);
    if (!sel) return;

    btn.disabled = true;
    status.textContent = "מאתר במאגר…";
    try {
      const selectionText = ed.state.doc.textBetween(sel.from, sel.to, " ", " ");
      const resolved = await resolveMatch(selectionText, dialogDefaults);
      const match = resolved.match;

      const posValue = posSel.value;
      const isQuoteRelative = posValue.endsWith("-quote");
      const pos = isQuoteRelative ? posValue.replace("-quote", "") : posValue;

      // Multi-match dialog returns checkbox state — that overrides the toolbar
      // niqqud + the button's cite param for THIS interaction. Single-match
      // and manual paths use button intent + toolbar checkbox unchanged.
      const useNiqqud = resolved.withNiqqud !== undefined ? resolved.withNiqqud : niqqudCb.checked;
      const useCite   = resolved.withSource !== undefined ? resolved.withSource : cite;

      const verseText = applyNiqqudPref(match.original, useNiqqud);
      const citationHtml = useCite ? smallSourceHtml(_formatCitation(match)) : null;

      // For quote-relative modes, locate the verse inside the selection.
      // Hard-fail (per memory rule feedback_quote_target_strict_after_index)
      // now that the local index exists — the silent fallback was a Phase 1
      // workaround for the substring heuristic.
      let targetFrom = sel.from;
      let targetTo = sel.to;
      if (isQuoteRelative) {
        const inner = findVerseInSelection(match.original, selectionText);
        if (!inner) {
          throw new Error("הציטוט לא נמצא בתוך הטקסט המסומן");
        }
        targetFrom = sel.from + inner.origStart;
        targetTo = sel.from + inner.origEnd;
      }

      if (replace) {
        const verseHtml = escapeHtml(verseText);
        const html = citationHtml
          ? (pos === "before"
              ? `${citationHtml}&nbsp;${verseHtml}`
              : `${verseHtml}&nbsp;${citationHtml}`)
          : verseHtml;
        ed.chain().focus()
          .setTextSelection({ from: targetFrom, to: targetTo })
          .deleteSelection()
          .insertContent(html)
          .run();
      } else if (citationHtml) {
        const insertAt = pos === "before" ? targetFrom : targetTo;
        const html = pos === "before" ? `${citationHtml}&nbsp;` : `&nbsp;${citationHtml}`;
        ed.chain().focus()
          .setTextSelection({ from: insertAt, to: insertAt })
          .insertContent(html)
          .run();
      } else {
        // Cite-only button + user unchecked source in dialog → nothing to do.
        status.textContent = "לא בוצעה פעולה — סמן ניקוד או מקור בדיאלוג";
        setTimeout(() => { status.textContent = ""; }, 3000);
        return;
      }

      status.textContent = `הוכנס: ${_formatRefLabel(match)}`;
      setTimeout(() => { status.textContent = ""; }, 3000);
    } catch (e) {
      if (e && e.cancelled) {
        status.textContent = "";
        return;
      }
      console.error("[torah] action:", e);
      status.textContent = `שגיאה: ${e.message || e}`;
      setTimeout(() => { status.textContent = ""; }, 4000);
    } finally {
      btn.disabled = false;
    }
  }

  // Inline SVGs (Lucide-style strokes, 14px, currentColor — adapt to button text color).
  // Lighter visual weight than the previous colored-square emojis.
  const ICONS = {
    niqqud: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-inline-end:5px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
    source: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-inline-end:5px;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    both: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-inline-end:5px;"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>`,
    complete: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-inline-end:5px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  };

  function makeActionBtn(id, iconKey, label, title, opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.innerHTML = ICONS[iconKey] + label;
    b.title = title;
    b.addEventListener("click", () => runAction(opts, b));
    return b;
  }

  // Per-button defaults for the multi-match dialog (per Moshe 2026-05-09):
  //   ניקוד    → niqqud=ON,  source=OFF
  //   מקור     → niqqud=OFF, source=ON
  //   ניקוד+מקור → niqqud=ON, source=ON
  //   השלמה    → niqqud=OFF, source=ON
  const niqqudActionBtn = makeActionBtn(
    "torah-action-niqqud",
    "niqqud",
    "ניקוד",
    "מזהה את הפסוק במאגר וממיר את המסומן לטקסט מנוקד. אם לא מזוהה — מחפש לפי הספר/פרק/פסוק שבחרת",
    { replace: true, cite: false, dialogDefaults: { withNiqqud: true, withSource: false } }
  );
  const sourceActionBtn = makeActionBtn(
    "torah-action-source",
    "source",
    "מקור",
    "מזהה את הפסוק ומוסיף מקור בכתב קטן (70%) — לא משנה את הטקסט המסומן",
    { replace: false, cite: true, dialogDefaults: { withNiqqud: false, withSource: true } }
  );
  const bothActionBtn = makeActionBtn(
    "torah-action-both",
    "both",
    "ניקוד + מקור",
    "מזהה את הפסוק, ממיר למנוקד, ומוסיף מקור בכתב קטן",
    { replace: true, cite: true, dialogDefaults: { withNiqqud: true, withSource: true } }
  );
  const completeActionBtn = makeActionBtn(
    "torah-action-complete",
    "complete",
    "השלמת כל המקור",
    "מחליף את המסומן בנוסח המקורי המלא מהמאגר. אם המסומן הוא רק ראשי-תיבות או פרפרזה — מתבצע ניסיון זיהוי",
    { replace: true, cite: false, dialogDefaults: { withNiqqud: false, withSource: true } }
  );

  // "זהה מקור" — the user selects an address (e.g. "מלכים ב ג ד" or "תהילים
  // קיט") and we resolve it to one or more concrete refs. If a single match
  // is unambiguous we offer to insert the verse text right after the
  // selection; if multiple parses exist, the user picks from a small dialog.
  const parseRefBtn = document.createElement("button");
  parseRefBtn.type = "button";
  parseRefBtn.id = "torah-action-parse-ref";
  parseRefBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-inline-end:5px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>זהה מקור`;
  parseRefBtn.title = "סמן מקור (כמו \"מלכים ב ג ד\" או \"תהילים קיט\") והכלי יביא את הפסוק";
  parseRefBtn.addEventListener("click", async () => {
    const ed = getEditor();
    if (!ed) { alert("פתח עורך פעיל."); return; }
    const sel = ensureSelection(ed);
    if (!sel) return;
    parseRefBtn.disabled = true;
    status.textContent = "מפענח מקור…";
    try {
      const selectionText = ed.state.doc.textBetween(sel.from, sel.to, " ", " ");
      const candidates = await _parseUserRef(selectionText);
      if (candidates.length === 0) {
        throw new Error("לא זוהה מקור בטקסט המסומן (לדוגמה: \"מלכים ב ג ד\")");
      }
      // Try to fetch each candidate's verse text. Drop ones that don't resolve
      // (e.g. chapter that doesn't exist in the book). If one survives → use it;
      // if several → show the picker dialog.
      const enriched = [];
      for (const c of candidates) {
        try {
          let original = "";
          if (c.kind === "verse") {
            original = await _getVerseTextFromMirror(c.englishTitle, c.chapter, c.verse, { corpus: c.corpus });
          } else {
            // Whole chapter — concatenate. Caller can trim later.
            await _ensureCorpus(c.corpus);
            // Fetch a tiny preview to confirm chapter exists.
            const v1 = await _getVerseTextFromMirror(c.englishTitle, c.chapter, 1, { corpus: c.corpus });
            original = v1;
          }
          enriched.push({
            match: {
              corpus: c.corpus,
              bookTitle: c.englishTitle,
              heTitle: c.heTitle,
              chapter: c.chapter,
              verse: c.kind === "verse" ? c.verse : 1,
              original,
              normalized: original,
              matchType: c.kind === "verse" ? "ref-verse" : "ref-chapter",
              score: 1,
            },
          });
        } catch (e) {
          // Skip — this candidate doesn't exist in the corpus.
        }
      }
      if (enriched.length === 0) {
        throw new Error("המקור זוהה אבל הפסוק לא נמצא במאגר");
      }
      let picked;
      if (enriched.length === 1) {
        picked = enriched[0];
      } else {
        const dialogPick = await _showMatchDialog(
          enriched.map((e) => e.match),
          { withNiqqud: niqqudCb.checked, withSource: true }
        );
        if (!dialogPick) { status.textContent = ""; return; }
        picked = dialogPick;
      }
      const match = picked.match;
      const useNiqqud = picked.withNiqqud !== undefined ? picked.withNiqqud : niqqudCb.checked;
      const useCite = picked.withSource !== undefined ? picked.withSource : true;
      const verseText = applyNiqqudPref(match.original, useNiqqud);
      const citationHtml = useCite ? smallSourceHtml(_formatCitation(match)) : null;
      const verseHtml = escapeHtml(verseText);
      const html = citationHtml
        ? `${verseHtml}&nbsp;${citationHtml}`
        : verseHtml;
      ed.chain().focus()
        .setTextSelection({ from: sel.from, to: sel.to })
        .deleteSelection()
        .insertContent(html)
        .run();
      status.textContent = `הוכנס: ${_formatRefLabel(match)}`;
      setTimeout(() => { status.textContent = ""; }, 3000);
    } catch (e) {
      console.error("[torah] parse-ref:", e);
      status.textContent = `שגיאה: ${e.message || e}`;
      setTimeout(() => { status.textContent = ""; }, 4000);
    } finally {
      parseRefBtn.disabled = false;
    }
  });

  // Inputs group: book picker, chapter, verse, niqqud toggle, position select,
  // and 📜 הכנס פסוק. The fetch button drives off the inputs directly (it
  // inserts the chosen ref's verse text into the editor) so it belongs here,
  // not with the selection-aware action buttons below.
  const inputsHint = document.createElement("span");
  inputsHint.className = "torah-group-hint";
  inputsHint.textContent = "בחר מקור להכנסה לטקסט:";
  groupVerseInputs.appendChild(inputsHint);
  groupVerseInputs.appendChild(labelBook);
  groupVerseInputs.appendChild(bookSel);
  groupVerseInputs.appendChild(chapInput);
  groupVerseInputs.appendChild(verseInput);
  groupVerseInputs.appendChild(niqqudLabel);
  groupVerseInputs.appendChild(posSel);
  groupVerseInputs.appendChild(fetchBtn);

  // Actions group: the four buttons that operate on the selected text using
  // auto-detect across the local mirror (Tanakh + Mishnah + Bavli) + status.
  const actionsHint = document.createElement("span");
  actionsHint.className = "torah-group-hint";
  actionsHint.textContent = "עובד על טקסט מסומן — סמן 2 מילים או יותר:";
  groupVerseActions.appendChild(actionsHint);
  groupVerseActions.appendChild(niqqudActionBtn);
  groupVerseActions.appendChild(sourceActionBtn);
  groupVerseActions.appendChild(bothActionBtn);
  groupVerseActions.appendChild(completeActionBtn);
  groupVerseActions.appendChild(parseRefBtn);
  groupVerseActions.appendChild(status);

  function makeSep() {
    const s = document.createElement("span");
    s.className = "sep";
    return s;
  }

  toolbar.appendChild(groupChars);
  toolbar.appendChild(makeSep());
  toolbar.appendChild(groupCalc);
  toolbar.appendChild(makeSep());
  toolbar.appendChild(groupVerseInputs);
  toolbar.appendChild(makeSep());
  toolbar.appendChild(groupVerseActions);
}
