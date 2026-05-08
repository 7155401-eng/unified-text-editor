// Torah-editor toolbox — Sefaria verse picker, gimatria, Hebrew date,
// Hebrew typographic special characters.

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

async function fetchSefariaVerse(book, chap, verse) {
  const ref = `${book} ${chap}.${verse}`;
  const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0&pad=0`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Sefaria HTTP ${r.status}`);
  const data = await r.json();
  let he = data.he;
  if (Array.isArray(he)) he = he.flat(Infinity).join(" ");
  return String(he || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

  // === Group: Sefaria verse picker ===
  const groupVerse = document.createElement("span");
  groupVerse.className = "tb-group torah-verse-group";
  groupVerse.dataset.title = "פסוק מהתנ\"ך — ספריא";

  const labelBook = document.createElement("span");
  labelBook.style.cssText = "font-size:12px;color:#555;";
  labelBook.textContent = "ספר:";
  const bookSel = buildSelect("torah-book-select", "בחר ספר מהתנ\"ך", TANACH_BOOKS, "— בחר —");

  const chapInput = document.createElement("input");
  chapInput.type = "number";
  chapInput.min = "1";
  chapInput.placeholder = "פרק";
  chapInput.title = "מספר פרק";
  chapInput.id = "torah-chap-input";
  chapInput.style.cssText = "width:60px;font-size:12px;padding:3px 6px;";

  const verseInput = document.createElement("input");
  verseInput.type = "number";
  verseInput.min = "1";
  verseInput.placeholder = "פסוק";
  verseInput.title = "מספר פסוק";
  verseInput.id = "torah-verse-input";
  verseInput.style.cssText = "width:60px;font-size:12px;padding:3px 6px;";

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

  fetchBtn.addEventListener("click", async () => {
    const book = bookSel.value;
    const chap = parseInt(chapInput.value, 10);
    const verse = parseInt(verseInput.value, 10);
    if (!book) { alert("בחר ספר."); return; }
    if (!Number.isFinite(chap) || chap < 1) { chapInput.focus(); return; }
    if (!Number.isFinite(verse) || verse < 1) { verseInput.focus(); return; }

    const ed = getEditor();
    if (!ed) { alert("פתח עורך פעיל לפני הכנסת פסוק."); return; }

    fetchBtn.disabled = true;
    status.textContent = "טוען מספריא…";
    try {
      let text = await fetchSefariaVerse(book, chap, verse);
      if (!text) throw new Error("הפסוק לא נמצא");
      text = niqqudCb.checked ? stripTaamim(text) : stripAllNiqqud(text);
      const citation = ` (${book} ${numberToHebrewLetters(chap)}, ${numberToHebrewLetters(verse)})`;
      ed.chain().focus().insertContent(text + citation).run();
      status.textContent = "הוכנס.";
      setTimeout(() => { status.textContent = ""; }, 2000);
    } catch (e) {
      console.error("[torah] sefaria fetch:", e);
      status.textContent = `שגיאה: ${e.message || e}`;
    } finally {
      fetchBtn.disabled = false;
    }
  });

  groupVerse.appendChild(labelBook);
  groupVerse.appendChild(bookSel);
  groupVerse.appendChild(chapInput);
  groupVerse.appendChild(verseInput);
  groupVerse.appendChild(niqqudLabel);
  groupVerse.appendChild(fetchBtn);
  groupVerse.appendChild(status);

  const sep1 = document.createElement("span");
  sep1.className = "sep";
  const sep2 = document.createElement("span");
  sep2.className = "sep";

  toolbar.appendChild(groupChars);
  toolbar.appendChild(sep1);
  toolbar.appendChild(groupCalc);
  toolbar.appendChild(sep2);
  toolbar.appendChild(groupVerse);

  // === Group: AI caricature bot ===
  const sep3 = document.createElement("span");
  sep3.className = "sep";
  toolbar.appendChild(sep3);
  const groupAi = document.createElement("span");
  groupAi.className = "tb-group";
  groupAi.dataset.title = "איור AI";
  const aiBtn = document.createElement("button");
  aiBtn.type = "button";
  aiBtn.id = "caricature-launch-btn";
  aiBtn.textContent = "🎭 צור איור AI";
  aiBtn.title = "פותח את בוט הקריקטורות החרדיות — תיאור הסצנה הופך לתמונה דרך Gemini Imagen";
  aiBtn.addEventListener("click", async () => {
    try {
      const ed = getEditor();
      const initialScene = selectedText(ed);
      const mod = await import("./haredi_caricature/haredi_caricature.js");
      mod.openCaricatureBot({
        licensed: false,
        initialScene,
        onInsertImage: ({ dataUrl, alt }) => {
          try {
            const editor = getEditor();
            if (!editor) return;
            if (editor.chain && editor.chain().focus) {
              editor.chain().focus()
                .insertContent(`<img src="${dataUrl}" alt="${(alt || "")
                  .replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;" />`)
                .run();
            }
          } catch (e) {
            console.error("[caricature] insert image:", e);
          }
        },
      });
    } catch (e) {
      console.error("[caricature] launch:", e);
      alert("לא הצלחתי לפתוח את בוט הקריקטורות:\n" + (e && e.message ? e.message : e));
    }
  });
  groupAi.appendChild(aiBtn);
  toolbar.appendChild(groupAi);
}
