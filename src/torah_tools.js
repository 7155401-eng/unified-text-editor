// Torah-editor toolbox — gimatria, common abbreviations, sacred names,
// Hebrew typographic characters (gershayim/geresh/maqaf), Hebrew date,
// verse template insertion. Each action operates on the active TipTap
// editor's selection or cursor.

const GIMATRIA_VALUES = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
  "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
};

const ABBREVIATIONS = [
  ["רש\"י", "רש\"י"],
  ["רמב\"ם", "רמב\"ם"],
  ["רמב\"ן", "רמב\"ן"],
  ["רמ\"א", "רמ\"א"],
  ["ש\"ך", "ש\"ך"],
  ["ט\"ז", "ט\"ז"],
  ["מ\"ב", "מ\"ב"],
  ["ב\"ח", "ב\"ח"],
  ["רשב\"א", "רשב\"א"],
  ["ר\"י", "ר\"י"],
  ["ר\"ת", "ר\"ת"],
  ["חז\"ל", "חז\"ל"],
  ["ז\"ל", "ז\"ל"],
  ["זצ\"ל", "זצ\"ל"],
  ["שליט\"א", "שליט\"א"],
  ["שו\"ע", "שו\"ע"],
  ["או\"ח", "או\"ח"],
  ["יו\"ד", "יו\"ד"],
  ["אה\"ע", "אה\"ע"],
  ["חו\"מ", "חו\"מ"],
  ["וכו'", "וכו'"],
  ["ודו\"ק", "ודו\"ק"],
];

const SACRED_NAMES = [
  ["ה'", "ה'"],
  ["השם", "השם"],
  ["הקב\"ה", "הקב\"ה"],
  ["ית'", "ית'"],
  ["ב\"ה", "ב\"ה"],
  ["בס\"ד", "בס\"ד"],
  ["בעז\"ה", "בעז\"ה"],
  ["אי\"ה", "אי\"ה"],
  ["בל\"נ", "בל\"נ"],
  ["דעת ת'", "דעת ת'"],
];

const SPECIAL_CHARS = [
  ["גרשיים ״", "״"],
  ["גרש ׳", "׳"],
  ["מקף עברי ־", "־"],
  ["סוף פסוק ׃", "׃"],
  ["פסק ׀", "׀"],
  ["פסיק קל ‚", "‚"],
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

function gimatriaValue(text) {
  let sum = 0;
  const stripped = String(text || "").replace(/[֑-ֽֿ-ׇ]/g, "");
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

function buildSelect(id, title, items, placeholder) {
  const sel = document.createElement("select");
  sel.id = id;
  sel.title = title;
  sel.className = "torah-tool-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  sel.appendChild(blank);
  for (const [label, value] of items) {
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

  const getEditor = () => paneManager.getActiveEditor?.();

  const abbrSelect = buildSelect(
    "torah-abbr-select",
    "ראשי תיבות נפוצים — בחר להוסיף בנקודת הסמן",
    ABBREVIATIONS,
    "ראשי תיבות…"
  );
  abbrSelect.addEventListener("change", () => {
    if (abbrSelect.value) insertText(getEditor(), abbrSelect.value);
    abbrSelect.value = "";
  });

  const sacredSelect = buildSelect(
    "torah-sacred-select",
    "שמות קודש וראשי תיבות מקובלים",
    SACRED_NAMES,
    "שמות קודש…"
  );
  sacredSelect.addEventListener("change", () => {
    if (sacredSelect.value) insertText(getEditor(), sacredSelect.value);
    sacredSelect.value = "";
  });

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

  const groupQuick = document.createElement("span");
  groupQuick.className = "tb-group";
  groupQuick.dataset.title = "פתיחות נפוצות";
  for (const [label, value] of [["ב\"ה", "ב\"ה "], ["בס\"ד", "בס\"ד "], ["בעז\"ה", "בעז\"ה "], ["אי\"ה", "אי\"ה "]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = `הוסף "${label}" בנקודת הסמן`;
    btn.addEventListener("click", () => insertText(getEditor(), value));
    groupQuick.appendChild(btn);
  }

  const groupAbbr = document.createElement("span");
  groupAbbr.className = "tb-group";
  groupAbbr.dataset.title = "ראשי תיבות";
  groupAbbr.appendChild(abbrSelect);
  groupAbbr.appendChild(sacredSelect);
  groupAbbr.appendChild(charsSelect);

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

  const verseBtn = document.createElement("button");
  verseBtn.type = "button";
  verseBtn.textContent = "📜 תבנית פסוק";
  verseBtn.title = "הוסף תבנית מקור: (ספר פרק:פסוק)";
  verseBtn.addEventListener("click", () => {
    const book = prompt("שם הספר:", "בראשית");
    if (!book) return;
    const chap = prompt("פרק:", "א");
    if (!chap) return;
    const verse = prompt("פסוק:", "א");
    if (!verse) return;
    insertText(getEditor(), `(${book} ${chap}:${verse})`);
  });
  groupCalc.appendChild(verseBtn);

  const sep1 = document.createElement("span");
  sep1.className = "sep";
  const sep2 = document.createElement("span");
  sep2.className = "sep";

  toolbar.appendChild(groupQuick);
  toolbar.appendChild(sep1);
  toolbar.appendChild(groupAbbr);
  toolbar.appendChild(sep2);
  toolbar.appendChild(groupCalc);
}
