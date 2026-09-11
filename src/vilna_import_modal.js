// vilna_import_modal.js — חלון "ייבוא גמרא (ש"ס וילנא)".
//
// המשתמש בוחר מסכת, ואז פרק שלם או טווח דפים, ומקבל מסמך מוכן:
// גמרא בצורת וילנא, רש"י כזרם צדדי, וסימן ⟦דף …⟧ בראש כל עמוד — כך שהעימוד
// יסיים כל עמוד בדיוק היכן שהוא נגמר בש"ס וילנא.
//
// כל הנתונים מהמאגר המקומי (public/data/sefaria/vilna_shas). אין פנייה
// לאינטרנט בזמן הייבוא, ולכן זה עובד גם כשספריא חסומה.

import "./sefaria/sefaria_modal.css";
import {
  loadVilnaManifest, loadVilnaTractate, buildVilnaRawText,
  amudLabel, amudLabelLong, parseDafInput, perekRange,
} from "./vilna_import.js";
import { DAF_LOCK_KEYS } from "./vilna_daf_lock.js";

const SEDER_HE = {
  "Seder Zeraim": "זרעים",
  "Seder Moed": "מועד",
  "Seder Nashim": "נשים",
  "Seder Nezikin": "נזיקין",
  "Seder Kodashim": "קדשים",
  "Seder Tahorot": "טהרות",
};

let _openDialog = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") node.setAttribute("style", v);
    else if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export async function openVilnaImportModal(paneManager, onImported) {
  if (_openDialog) { _openDialog.remove(); _openDialog = null; }

  const overlay = el("div", { class: "sef-overlay" });
  const modal = el("div", { class: "sef-modal", dir: "rtl", style: "width: min(92vw, 720px); height: auto; max-height: 88vh; display: flex; flex-direction: column;" });
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _openDialog = overlay;

  const close = () => { overlay.remove(); _openDialog = null; };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const title = el("div", { class: "sef-toolbar" }, [
    el("div", { class: "sef-title" }, "📖 ייבוא גמרא — ש\"ס וילנא"),
    el("button", { class: "sef-btn", onclick: close }, "סגירה"),
  ]);
  modal.appendChild(title);

  const body = el("div", { style: "padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px;" });
  modal.appendChild(body);

  const status = el("div", { style: "font-size: 13px; color: var(--sef-muted); min-height: 20px;" }, "טוען את רשימת המסכתות…");
  body.appendChild(status);

  let manifest;
  try {
    manifest = await loadVilnaManifest();
  } catch (e) {
    status.textContent = `לא הצלחתי לטעון את המאגר: ${e.message}`;
    return;
  }

  // --- בחירת מסכת ---
  const tractateSelect = el("select", { class: "sef-select", id: "vilna-import-tractate", style: "min-width: 220px;" });
  const bySeder = new Map();
  for (const b of manifest.books) {
    const key = b.seder || "";
    if (!bySeder.has(key)) bySeder.set(key, []);
    bySeder.get(key).push(b);
  }
  for (const [seder, books] of bySeder) {
    const group = el("optgroup", { label: `סדר ${SEDER_HE[seder] || seder}` });
    for (const b of books) {
      group.appendChild(el("option", { value: b.slug }, b.heTitle || b.title));
    }
    tractateSelect.appendChild(group);
  }

  // --- טווח ---
  const rangeMode = el("select", { class: "sef-select" }, [
    el("option", { value: "perek" }, "פרק שלם"),
    el("option", { value: "dafim" }, "טווח דפים"),
    el("option", { value: "all" }, "כל המסכת"),
  ]);
  const perekSelect = el("select", { class: "sef-select", style: "min-width: 220px;" });
  const fromInput = el("input", { class: "sef-input", style: "width: 90px;", placeholder: "ב." });
  const toInput = el("input", { class: "sef-input", style: "width: 90px;", placeholder: "ה:" });

  const withRashi = el("input", { type: "checkbox", checked: "checked" });
  const wholeDafim = el("input", { type: "checkbox", checked: "checked" });
  const autoLayout = el("input", { type: "checkbox", checked: "checked" });
  const streamInput = el("input", { class: "sef-input", style: "width: 60px;", value: "01" });

  const row = (label, ...controls) => el("div", {
    style: "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;",
  }, [el("span", { style: "min-width: 110px; font-size: 13px;" }, label), ...controls]);

  const checkboxRow = (input, text, hint) => el("label", {
    style: "display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;",
    title: hint || "",
  }, [input, el("span", {}, text)]);

  const perekRow = row("פרק:", perekSelect);
  const dafRow = row("מדף:", fromInput, el("span", { style: "font-size: 13px;" }, "עד דף:"), toInput);

  body.appendChild(row("מסכת:", tractateSelect));
  body.appendChild(row("מה לייבא:", rangeMode));
  body.appendChild(perekRow);
  body.appendChild(dafRow);
  body.appendChild(checkboxRow(withRashi, 'לייבא גם רש"י', 'רש"י ייכנס כזרם צדדי, כל פירוש צמוד למילים שעליהן הוא מדבר'));
  body.appendChild(checkboxRow(wholeDafim, "להתחיל ולסיים בדף שלם",
    "פרק בגמרא מתחיל ונגמר באמצע דף. עם הסימון הזה מייבאים את הדפים השלמים, וכל עמוד אצלנו ייגמר בדיוק כמו בוילנא."));
  body.appendChild(checkboxRow(autoLayout, "להפעיל מיד את צורת הדף (גפ\"ת) ונעילת דף",
    "מדליק את העימוד של צורת הדף ואת נעילת הדף, כדי שתראה את התוצאה מיד"));
  body.appendChild(row('קוד זרם לרש"י:', streamInput));

  const preview = el("div", {
    style: "font-size: 13px; padding: 10px 12px; border-radius: 6px; background: var(--sef-tb-bg); border: 1px solid var(--sef-border); line-height: 1.7;",
  }, "…");
  body.appendChild(preview);

  const footer = el("div", { style: "display: flex; gap: 8px; justify-content: flex-start; padding: 12px 16px; border-top: 1px solid var(--sef-border);" });
  const importBtn = el("button", { class: "sef-btn sef-gold" }, "ייבא לעורך");
  footer.appendChild(importBtn);
  footer.appendChild(el("button", { class: "sef-btn", onclick: close }, "ביטול"));
  modal.appendChild(footer);

  // --- מצב פנימי ---
  let book = null;

  const currentRange = () => {
    if (!book) return null;
    const mode = rangeMode.value;
    if (mode === "all") return { fromAmud: book.firstAmud, toAmud: book.lastAmud };
    if (mode === "perek") {
      const n = parseInt(perekSelect.value, 10);
      const r = perekRange(book, n, wholeDafim.checked);
      if (!r) return null;
      return wholeDafim.checked
        ? { fromAmud: r.fromAmud, toAmud: r.toAmud }
        : { fromAmud: r.fromAmud, toAmud: r.toAmud, fromLine: r.fromLine, toLine: r.toLine };
    }
    const a = parseDafInput(fromInput.value);
    const b = parseDafInput(toInput.value);
    if (a < 0 || b < 0 || b < a) return null;
    return { fromAmud: Math.max(a, book.firstAmud), toAmud: Math.min(b, book.lastAmud) };
  };

  const refreshPreview = () => {
    perekRow.style.display = rangeMode.value === "perek" ? "" : "none";
    dafRow.style.display = rangeMode.value === "dafim" ? "" : "none";
    wholeDafim.parentElement.style.display = rangeMode.value === "perek" ? "" : "none";
    const r = currentRange();
    if (!book || !r) {
      preview.textContent = "בחר טווח תקין (למשל: מדף ב. עד דף ה:)";
      importBtn.disabled = true;
      return;
    }
    importBtn.disabled = false;
    const count = r.toAmud - r.fromAmud + 1;
    const partial = r.fromLine || r.toLine;
    preview.innerHTML = "";
    preview.appendChild(el("div", {}, `יתקבלו ${count} עמודים — מדף ${amudLabelLong(r.fromAmud)} עד דף ${amudLabelLong(r.toAmud)}.`));
    preview.appendChild(el("div", {}, `כל עמוד אצלך ייגמר בדיוק היכן שנגמר העמוד בש"ס וילנא.`));
    if (partial) {
      preview.appendChild(el("div", { style: "color: var(--sef-warn);" },
        "שים לב: בלי \"דף שלם\" העמוד הראשון והאחרון יהיו חלקיים, ולכן סופם לא יהיה סוף הדף בוילנא."));
    }
    if (count > 60) {
      preview.appendChild(el("div", { style: "color: var(--sef-warn);" },
        `${count} עמודים זה הרבה — הרינדור עלול לקחת כמה דקות.`));
    }
  };

  const loadBook = async () => {
    status.textContent = "טוען מסכת…";
    importBtn.disabled = true;
    try {
      const data = await loadVilnaTractate(tractateSelect.value);
      book = data.book;
      perekSelect.innerHTML = "";
      for (const p of book.perakim) {
        perekSelect.appendChild(el("option", { value: String(p.n) },
          `${p.n}. ${p.heTitle || p.title} (${amudLabel(p.startAmud)}–${amudLabel(p.endAmud)})`));
      }
      fromInput.value = amudLabel(book.firstAmud);
      toInput.value = amudLabel(Math.min(book.firstAmud + 3, book.lastAmud));
      const meta = manifest.books.find((b) => b.slug === tractateSelect.value);
      status.textContent = `מסכת ${book.heTitle}: ${meta?.stats?.amudim ?? "?"} עמודים · ` +
        `${book.perakim.length} פרקים · ${meta?.hasRashi ? 'עם רש"י' : 'בלי רש"י במאגר'}`;
      if (!meta?.hasRashi) { withRashi.checked = false; withRashi.disabled = true; }
      else withRashi.disabled = false;
      refreshPreview();
    } catch (e) {
      status.textContent = `שגיאה: ${e.message}`;
    }
  };

  tractateSelect.addEventListener("change", loadBook);
  rangeMode.addEventListener("change", refreshPreview);
  perekSelect.addEventListener("change", refreshPreview);
  wholeDafim.addEventListener("change", refreshPreview);
  fromInput.addEventListener("input", refreshPreview);
  toInput.addEventListener("input", refreshPreview);

  importBtn.addEventListener("click", async () => {
    const r = currentRange();
    if (!book || !r) return;
    importBtn.disabled = true;
    status.textContent = "בונה את המסמך…";
    try {
      const code = String(parseInt(streamInput.value, 10) || 1).padStart(2, "0");
      const { text, stats } = buildVilnaRawText(book, {
        ...r,
        withRashi: withRashi.checked,
        streamCode: code,
        // בלי שורת "מסכת ..." בראש: היא הייתה תופסת עמוד שלם לעצמה (היא
        // לפני סימן הדף הראשון, ולכן קטע-דף נפרד). שם המסכת שייך לכותרת
        // העליונה של המסמך, לא לגוף הטקסט.
        includeTitle: false,
      });
      await onImported({ text, stats, book, code, autoLayout: autoLayout.checked });
      close();
    } catch (e) {
      status.textContent = `הייבוא נכשל: ${e.message}`;
      importBtn.disabled = false;
    }
  });

  await loadBook();
}

/**
 * מוסיף את כפתור הייבוא לסרגל התורני.
 *
 * למה בקוד ולא ב-HTML: wireTorahTools מוחק את כל תוכן הסרגל התורני
 * (toolbar.replaceChildren) ובונה אותו מחדש, ולכן כפתור שכתוב ב-index.html
 * נמחק שנייה אחרי הטעינה. כל שאר הכלים בסרגל הזה מוזרקים באותה דרך.
 */
export function wireVilnaImportButton(paneManager, onImported) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return;
  if (toolbar.querySelector("#btn-vilna-import")) return;
  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = 'ש"ס וילנא';
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-vilna-import";
  btn.textContent = "📖 ייבוא גמרא (וילנא)";
  btn.title = 'ייבוא גמרא ורש"י מהמאגר המקומי, בצורת ש"ס וילנא — עם סימני דף כדי שכל עמוד ייגמר היכן שנגמר העמוד בוילנא';
  btn.addEventListener("click", () => openVilnaImportModal(paneManager, onImported));
  group.appendChild(btn);
  toolbar.appendChild(group);
}

/** מדליק את צורת הדף, מגדיר את זרם רש"י ואת נעילת הדף. */
export function enableVilnaLayoutFor(code) {
  try {
    localStorage.setItem("ravtext.talmudLayout", "1");
    const existing = (localStorage.getItem("ravtext.talmudLayout.streams") || "").trim();
    if (!existing.split(/[,\s]+/).filter(Boolean).includes(code)) {
      localStorage.setItem("ravtext.talmudLayout.streams", existing ? `${existing},${code}` : code);
    }
    localStorage.setItem(DAF_LOCK_KEYS.enabled, "auto");
  } catch { /* אין localStorage — לא נורא, ההגדרות פשוט לא יישמרו */ }
}
