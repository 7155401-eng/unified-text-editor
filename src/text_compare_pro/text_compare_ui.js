// Text Compare Pro — modal UI.
// Verbatim port of work-files/text_compare_pro/web/index.html + the UI logic
// in work-files/text_compare_pro/web/app.js. Hebrew strings, structure,
// presets, ids (with tcp- prefix to avoid clashes), CSS class names — all
// preserved.

import {
  computeSmartCompare,
  renderSmartReport,
  computeIntegrity,
  renderIntegrityReport,
  getBlocks,
  escapeHtml,
  ensureVendorLoaded,
} from "./text_compare_engine.js";
import {
  loadSettings,
  saveSettings,
  loadHistory,
  addHistory,
  clearHistory,
} from "./text_compare_storage.js";
import { readDocx, readText } from "./text_compare_docx_reader.js";

let modalRoot = null; // overlay element
let modalEl = null; // .tcp-modal element
let settings = null;
let lastReports = { smart: null, integrity: null };
let _saveTimer = null;

function debouncedSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveSettings(settings), 800);
}

function persistSettings() {
  saveSettings(settings);
}

/* === Modal HTML — verbatim port of index.html === */
function buildModalHTML() {
  return `
<div class="tcp-modal" role="dialog" aria-modal="true">
  <aside class="tcp-sidebar">
    <div class="tcp-brand">
      <div class="tcp-brand-icon">⚖</div>
      <div class="tcp-brand-text">
        <div class="tcp-brand-title">השוואת טקסטים</div>
        <div class="tcp-brand-sub">מקצועי · גרסה 1.0</div>
      </div>
    </div>
    <nav class="tcp-tabs">
      <button class="tcp-tab-btn active" data-tab="smart">
        <span class="tcp-tab-icon">🔀</span>
        <span class="tcp-tab-label">השוואת קטעים חכמה</span>
        <span class="tcp-tab-desc">ללא תלות בסדר + זיהוי דמיון</span>
      </button>
      <button class="tcp-tab-btn" data-tab="integrity">
        <span class="tcp-tab-icon">{}</span>
        <span class="tcp-tab-label">בדיקת מיזוג טקסטים</span>
        <span class="tcp-tab-desc">בדיקת תוכן בתוך סוגריים מסולסלות</span>
      </button>
      <button class="tcp-tab-btn" data-tab="history">
        <span class="tcp-tab-icon">🕒</span>
        <span class="tcp-tab-label">היסטוריית השוואות</span>
        <span class="tcp-tab-desc">50 השוואות אחרונות</span>
      </button>
      <button class="tcp-tab-btn" data-tab="settings">
        <span class="tcp-tab-icon">⚙</span>
        <span class="tcp-tab-label">הגדרות</span>
        <span class="tcp-tab-desc">רשימת התעלמות ועוד</span>
      </button>
    </nav>
  </aside>

  <main class="tcp-main-area">
    <button type="button" class="tcp-close-btn" data-action="close" title="סגור">✕</button>

    <div class="tcp-loader-overlay" data-id="globalLoader" hidden>
      <div class="tcp-spinner"></div>
      <div class="tcp-loader-title" data-id="loaderTitle">מחשב נתונים...</div>
      <div class="tcp-loader-sub" data-id="loaderSub">אנא המתן.</div>
    </div>

    <!-- TAB: Smart Compare -->
    <section class="tcp-pane tcp-pane-active" data-pane="smart">
      <header class="tcp-pane-header">
        <h1>השוואת קטעים חכמה</h1>
        <p>מזהה קטעים זהים, דומים, חסרים ונוספים — ללא תלות בסדר השורות.</p>
      </header>

      <div class="tcp-settings-row">
        <div class="tcp-setting">
          <label>אחוז דמיון להשוואה צבעונית</label>
          <div class="tcp-num-with-suffix">
            <input type="number" data-id="simThreshold" value="60" min="1" max="99">
            <span>%</span>
          </div>
        </div>
        <div class="tcp-setting">
          <label>התעלם מקטעים עם רצף תווים זהה של</label>
          <div class="tcp-num-with-suffix">
            <input type="number" data-id="consecLimit" placeholder="0 = כבוי" min="0">
            <span>תווים</span>
          </div>
        </div>
        <div class="tcp-setting tcp-setting-flag">
          <label class="tcp-toggle">
            <input type="checkbox" data-id="ignoreNikud">
            <span class="tcp-toggle-slider"></span>
            <span class="tcp-toggle-label">התעלם מניקוד וטעמים</span>
          </label>
        </div>
        <div class="tcp-setting tcp-setting-flag">
          <label class="tcp-toggle">
            <input type="checkbox" data-id="useIgnoreList" checked>
            <span class="tcp-toggle-slider"></span>
            <span class="tcp-toggle-label">החל את רשימת ההתעלמות</span>
          </label>
        </div>
      </div>

      <div class="tcp-docs-row">
        <div class="tcp-doc-col">
          <div class="tcp-doc-head">
            <label>📄 מסמך 1 (המקור)</label>
            <div class="tcp-doc-meta" data-id="doc1Meta">0 קטעים · 0 תווים</div>
          </div>
          <textarea data-id="doc1" placeholder="הדבק כאן את הטקסט המקורי..."></textarea>
          <div class="tcp-doc-actions">
            <input type="file" data-id="doc1File" accept=".txt,.docx" hidden>
            <button class="tcp-action-btn" data-action="open-file" data-target="doc1">📁 פתח קובץ (TXT/DOCX)</button>
            <button class="tcp-action-btn" data-action="fill-from-active" data-target="doc1" title="טען את התוכן של החלונית הפעילה">⇩ מהעורך הפעיל</button>
            <button class="tcp-action-btn ghost" data-action="clear" data-target="doc1">🗑 נקה</button>
            <button class="tcp-action-btn ghost" data-action="swap-docs">↔ החלף 1↔2</button>
          </div>
        </div>

        <div class="tcp-doc-col">
          <div class="tcp-doc-head">
            <label>📄 מסמך 2 (החדש)</label>
            <div class="tcp-doc-meta" data-id="doc2Meta">0 קטעים · 0 תווים</div>
          </div>
          <textarea data-id="doc2" placeholder="הדבק כאן את הטקסט החדש..."></textarea>
          <div class="tcp-doc-actions">
            <input type="file" data-id="doc2File" accept=".txt,.docx" hidden>
            <button class="tcp-action-btn" data-action="open-file" data-target="doc2">📁 פתח קובץ (TXT/DOCX)</button>
            <button class="tcp-action-btn" data-action="fill-from-active" data-target="doc2" title="טען את התוכן של החלונית הפעילה">⇩ מהעורך הפעיל</button>
            <button class="tcp-action-btn ghost" data-action="clear" data-target="doc2">🗑 נקה</button>
          </div>
        </div>
      </div>

      <div class="tcp-action-bar">
        <button class="tcp-primary-btn" data-action="run-smart">🔍 השווה מסמכים</button>
        <button class="tcp-action-btn ghost" data-action="clear-all-smart">🗑 נקה הכל</button>
        <button class="tcp-action-btn ghost" data-action="export-smart" data-id="exportSmartBtn" disabled>💾 ייצא דוח HTML</button>
        <button class="tcp-action-btn ghost" data-action="copy-smart" data-id="copySmartBtn" disabled>📋 העתק תוצאות</button>
      </div>

      <div data-id="smartResults" class="tcp-results"></div>
    </section>

    <!-- TAB: Integrity -->
    <section class="tcp-pane" data-pane="integrity">
      <header class="tcp-pane-header">
        <h1>בדיקת מיזוג טקסטים</h1>
        <p>בודק שהטקסט המשולב = הטקסט הראשי + הטקסט המשני בתוך <code>{...}</code>.</p>
      </header>

      <div class="tcp-settings-row">
        <div class="tcp-setting tcp-setting-flag">
          <label class="tcp-toggle">
            <input type="checkbox" data-id="integrityIgnoreNikud">
            <span class="tcp-toggle-slider"></span>
            <span class="tcp-toggle-label">התעלם מניקוד וטעמים</span>
          </label>
        </div>
        <div class="tcp-setting tcp-setting-flag">
          <label class="tcp-toggle">
            <input type="checkbox" data-id="integrityUseIgnoreList" checked>
            <span class="tcp-toggle-slider"></span>
            <span class="tcp-toggle-label">החל את רשימת ההתעלמות</span>
          </label>
        </div>
      </div>

      <div class="tcp-docs-row">
        <div class="tcp-doc-col">
          <div class="tcp-doc-head">
            <label>1️⃣ טקסט ראשי (הבסיס)</label>
            <div class="tcp-doc-meta" data-id="baseMeta">0 תווים</div>
          </div>
          <textarea data-id="textBase" placeholder="הדבק כאן את הטקסט הראשי..."></textarea>
          <div class="tcp-doc-actions">
            <input type="file" data-id="baseFile" accept=".txt,.docx" hidden>
            <button class="tcp-action-btn" data-action="open-file" data-target="textBase">📁 פתח קובץ</button>
            <button class="tcp-action-btn ghost" data-action="clear" data-target="textBase">🗑 נקה</button>
          </div>
        </div>

        <div class="tcp-doc-col">
          <div class="tcp-doc-head">
            <label>2️⃣ טקסט משני (שנכנס ל-<code>{}</code>)</label>
            <div class="tcp-doc-meta" data-id="insertMeta">0 תווים</div>
          </div>
          <textarea data-id="textInsert" placeholder="הדבק כאן את הטקסט שאמור להיות בתוך הסוגריים..."></textarea>
          <div class="tcp-doc-actions">
            <input type="file" data-id="insertFile" accept=".txt,.docx" hidden>
            <button class="tcp-action-btn" data-action="open-file" data-target="textInsert">📁 פתח קובץ</button>
            <button class="tcp-action-btn ghost" data-action="clear" data-target="textInsert">🗑 נקה</button>
          </div>
        </div>
      </div>

      <div class="tcp-docs-row single">
        <div class="tcp-doc-col">
          <div class="tcp-doc-head">
            <label>3️⃣ טקסט משולב (התוצאה הסופית עם <code>{...}</code>)</label>
            <div class="tcp-doc-meta" data-id="mergedMeta">0 תווים · 0 בלוקי {}</div>
          </div>
          <textarea data-id="textMerged" placeholder="הדבק כאן את הטקסט המלא הכולל את הסוגריים המסולסלות..."></textarea>
          <div class="tcp-doc-actions">
            <input type="file" data-id="mergedFile" accept=".txt,.docx" hidden>
            <button class="tcp-action-btn" data-action="open-file" data-target="textMerged">📁 פתח קובץ</button>
            <button class="tcp-action-btn ghost" data-action="clear" data-target="textMerged">🗑 נקה</button>
            <button class="tcp-action-btn ghost" data-action="auto-detect">🔎 זהה 3 קבצים מתיקייה</button>
          </div>
        </div>
      </div>

      <div class="tcp-action-bar">
        <button class="tcp-primary-btn" data-action="run-integrity">✓ בצע בדיקה</button>
        <button class="tcp-action-btn ghost" data-action="clear-all-integrity">🗑 נקה הכל</button>
        <button class="tcp-action-btn ghost" data-action="export-integrity" data-id="exportIntegrityBtn" disabled>💾 ייצא דוח HTML</button>
        <button class="tcp-action-btn ghost" data-action="copy-integrity" data-id="copyIntegrityBtn" disabled>📋 העתק תוצאות</button>
      </div>

      <div data-id="integrityResults" class="tcp-results"></div>
    </section>

    <!-- TAB: History -->
    <section class="tcp-pane" data-pane="history">
      <header class="tcp-pane-header">
        <h1>היסטוריית השוואות</h1>
        <p>50 ההשוואות האחרונות נשמרות אוטומטית. לחץ על שורה כדי לפתוח שוב.</p>
      </header>
      <div class="tcp-action-bar">
        <button class="tcp-action-btn ghost" data-action="refresh-history">↻ רענן</button>
        <button class="tcp-action-btn ghost danger" data-action="clear-history">🗑 נקה היסטוריה</button>
      </div>
      <div data-id="historyList" class="tcp-history-list">טוען...</div>
    </section>

    <!-- TAB: Settings -->
    <section class="tcp-pane" data-pane="settings">
      <header class="tcp-pane-header">
        <h1>הגדרות גלובליות</h1>
        <p>השינויים נשמרים אוטומטית.</p>
      </header>

      <div class="tcp-result-box warn" style="margin-bottom: 18px;">
        <h3>⚠ תחולת ההגדרות</h3>
        <div class="muted">
          ההגדרות בעמוד זה (רשימת התעלמות, ספי דמיון, ברירות מחדל) משפיעות
          <strong>רק על שני הטאבים הראשונים:</strong>
          <br>· 🔀 השוואת קטעים חכמה
          <br>· {} בדיקת מיזוג טקסטים
        </div>
      </div>

      <div class="tcp-settings-card">
        <h3>📋 רשימת התעלמות</h3>
        <p class="muted">תווים או מילים שיוסרו מהטקסטים לפני ההשוואה (רלוונטי לשני הטאבים הראשונים בלבד).</p>

        <div class="tcp-ignore-input-row">
          <input type="text" data-id="ignoreInput" placeholder="הקלד תו או מילה ולחץ Enter / הוסף">
          <button class="tcp-action-btn" data-action="add-ignore">➕ הוסף</button>
        </div>

        <div class="tcp-ignore-presets">
          <span class="muted">הוספה מהירה:</span>
          <button class="tcp-chip-btn" data-action="add-preset" data-value=",">פסיק ,</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value=".">נקודה .</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value=";">פסיק נקודה ;</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value=":">נקודתיים :</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value="?">סימן שאלה ?</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value="!">סימן קריאה !</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value="&quot;">מרכאות "</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value="׳">גרש ׳</button>
          <button class="tcp-chip-btn" data-action="add-preset" data-value="״">גרשיים ״</button>
        </div>

        <div data-id="ignoreList" class="tcp-ignore-list"></div>
      </div>

      <div class="tcp-settings-card">
        <h3>🔧 ברירות מחדל</h3>
        <div class="tcp-settings-grid">
          <label>סף דמיון ברירת מחדל
            <div class="tcp-num-with-suffix">
              <input type="number" data-id="defSim" value="60" min="1" max="99">
              <span>%</span>
            </div>
          </label>
          <label>סף רצף תווים ברירת מחדל
            <div class="tcp-num-with-suffix">
              <input type="number" data-id="defConsec" value="0" min="0">
              <span>תווים</span>
            </div>
          </label>
          <label class="tcp-toggle inline">
            <input type="checkbox" data-id="autoLoadLast" checked>
            <span class="tcp-toggle-slider"></span>
            <span>טען אוטומטית את הטקסטים האחרונים בפתיחה</span>
          </label>
        </div>
      </div>

      <div class="tcp-settings-card">
        <h3>📂 מיקום הקבצים</h3>
        <p class="muted small">הגדרות והיסטוריה נשמרים בדפדפן (localStorage):</p>
        <code class="tcp-path-display">ravtext.text_compare_pro.settings · ravtext.text_compare_pro.history</code>
      </div>
    </section>
  </main>
</div>
`;
}

/* === Element helpers === */
function $(id) {
  return modalEl ? modalEl.querySelector(`[data-id="${id}"]`) : null;
}
function $$(sel) {
  return modalEl ? Array.from(modalEl.querySelectorAll(sel)) : [];
}

/* === Apply settings to UI === */
function applySettingsToUI() {
  $("simThreshold").value = settings.sim_threshold;
  $("consecLimit").value = settings.consec_limit || "";
  $("defSim").value = settings.sim_threshold;
  $("defConsec").value = settings.consec_limit;
  $("autoLoadLast").checked = !!settings.auto_load_last;
}

function restoreLastTexts() {
  if (settings.last_doc1) $("doc1").value = settings.last_doc1;
  if (settings.last_doc2) $("doc2").value = settings.last_doc2;
  if (settings.last_base) $("textBase").value = settings.last_base;
  if (settings.last_insert) $("textInsert").value = settings.last_insert;
  if (settings.last_merged) $("textMerged").value = settings.last_merged;
}

/* === Meta updates === */
function updateMeta(id) {
  const el = $(id);
  if (!el) return;
  const txt = el.value;
  const blocks = getBlocks(txt).length;
  const chars = txt.length;
  const metaMap = {
    doc1: "doc1Meta",
    doc2: "doc2Meta",
    textBase: "baseMeta",
    textInsert: "insertMeta",
    textMerged: "mergedMeta",
  };
  const m = $(metaMap[id]);
  if (!m) return;
  if (id === "textMerged") {
    const braceCount = (txt.match(/\{[\s\S]*?\}/g) || []).length;
    m.textContent = `${chars} תווים · ${braceCount} בלוקי {}`;
  } else if (id === "textBase" || id === "textInsert") {
    m.textContent = `${chars} תווים`;
  } else {
    m.textContent = `${blocks} קטעים · ${chars} תווים`;
  }
}

function updateAllMeta() {
  ["doc1", "doc2", "textBase", "textInsert", "textMerged"].forEach(updateMeta);
}

/* === Loader === */
function showLoader(title, sub, warning) {
  $("loaderTitle").textContent = title || "מחשב...";
  const subEl = $("loaderSub");
  subEl.textContent = sub || "";
  subEl.classList.toggle("warning", !!warning);
  $("globalLoader").hidden = false;
}
function hideLoader() {
  $("globalLoader").hidden = true;
}

/* === Tabs === */
function switchTab(name) {
  $$(".tcp-tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name)
  );
  $$(".tcp-pane").forEach((p) =>
    p.classList.toggle("tcp-pane-active", p.dataset.pane === name)
  );
  settings.active_tab = name;
  persistSettings();
  if (name === "history") refreshHistory();
}

/* === File reading === */
function bindFile(inputId, targetId) {
  const inp = $(inputId);
  if (!inp) return;
  inp.addEventListener("change", async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    showLoader("קורא קובץ...", "מחלץ טקסט מ-" + f.name);
    try {
      const name = f.name.toLowerCase();
      let text = "";
      if (name.endsWith(".docx")) {
        text = await readDocx(f);
      } else {
        text = await readText(f);
      }
      $(targetId).value = text;
      updateMeta(targetId);
      const map = {
        doc1: "last_doc1",
        doc2: "last_doc2",
        textBase: "last_base",
        textInsert: "last_insert",
        textMerged: "last_merged",
      };
      if (map[targetId]) {
        settings[map[targetId]] = text;
        persistSettings();
      }
    } catch (e) {
      alert("שגיאה בקריאת הקובץ: " + e.message);
    } finally {
      ev.target.value = "";
      hideLoader();
    }
  });
}

/* === Smart Compare action === */
function runSmartCompare() {
  if (typeof window.Diff === "undefined") {
    alert("ספריית diff לא נטענה. נסה שוב בעוד רגע.");
    return;
  }
  const t1 = $("doc1").value;
  const t2 = $("doc2").value;
  if (!t1.trim() || !t2.trim()) {
    alert("יש להזין טקסט בשני המסמכים.");
    return;
  }

  const totalLen = t1.length + t2.length;
  const long = totalLen > 10000;
  showLoader(
    "מחשב השוואה...",
    long ? `טקסט ארוך (${totalLen.toLocaleString()} תווים) — עשוי לקחת מספר שניות.` : "אנא המתן.",
    long
  );

  setTimeout(() => {
    try {
      const report = computeSmartCompare(t1, t2, {
        simThreshold: parseInt($("simThreshold").value, 10) || 60,
        consecLimit: parseInt($("consecLimit").value, 10) || 0,
        ignoreNikud: $("ignoreNikud").checked,
        useIgnoreList: $("useIgnoreList").checked,
        ignoreItems: settings.ignore_items,
      });
      $("smartResults").innerHTML = renderSmartReport(report);
      lastReports.smart = report;
      modalEl.querySelector('[data-action="export-smart"]').disabled = false;
      modalEl.querySelector('[data-action="copy-smart"]').disabled = false;
      addHistory({
        type: "smart",
        doc1_size: t1.length,
        doc2_size: t2.length,
        identical: report.identicalCount,
        similar: report.similar.length,
        missing: report.onlyIn1.length,
        added: report.onlyIn2.length,
        sim_threshold: report.simThreshold,
        consec_limit: report.consecLimit,
      });
    } catch (e) {
      alert("שגיאה בחישוב: " + e.message);
      console.error(e);
    } finally {
      hideLoader();
    }
  }, 100);
}

/* === Integrity action === */
function runIntegrityCheck() {
  if (typeof window.Diff === "undefined") {
    alert("ספריית diff לא נטענה. נסה שוב בעוד רגע.");
    return;
  }
  const base = $("textBase").value;
  const insert = $("textInsert").value;
  const merged = $("textMerged").value;
  if (!base.trim() || !merged.trim()) {
    alert("יש למלא לפחות טקסט ראשי וטקסט משולב.");
    return;
  }

  const longLen = base.length + merged.length;
  showLoader(
    "בודק שלמות מיזוג...",
    longLen > 5000 ? `טקסט גדול (${longLen.toLocaleString()} תווים) — עשוי לקחת זמן.` : "אנא המתן.",
    longLen > 5000
  );

  setTimeout(() => {
    try {
      const report = computeIntegrity(base, insert, merged, {
        ignoreNikud: $("integrityIgnoreNikud").checked,
        useIgnoreList: $("integrityUseIgnoreList").checked,
        ignoreItems: settings.ignore_items,
      });
      $("integrityResults").innerHTML = renderIntegrityReport(report);
      lastReports.integrity = report;
      modalEl.querySelector('[data-action="export-integrity"]').disabled = false;
      modalEl.querySelector('[data-action="copy-integrity"]').disabled = false;
      addHistory({
        type: "integrity",
        base_size: base.length,
        insert_size: insert.length,
        merged_size: merged.length,
        base_pass: report.basePass,
        insert_pass: report.insertPass,
        brace_blocks: report.braceCount,
      });
    } catch (e) {
      alert("שגיאה: " + e.message);
      console.error(e);
    } finally {
      hideLoader();
    }
  }, 100);
}

/* === Auto-detect 3 files from a folder — verbatim port === */
async function autoDetectFromFolder() {
  alert("בחר 3 קבצים מאותה תיקייה — base, insert, merged.\n\nהכלי יזהה אוטומטית מי מהם הוא איזה לפי שמות.");
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.accept = ".txt,.docx";
  inp.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length < 2) return;
    const reads = await Promise.all(
      files.map(async (f) => ({
        name: f.name.toLowerCase(),
        content: f.name.toLowerCase().endsWith(".docx") ? await readDocx(f) : await readText(f),
      }))
    );
    const findOne = (patterns) => reads.find((r) => patterns.some((p) => r.name.includes(p)));
    const baseF = findOne(["base", "main", "ראשי", "בסיס", "main", "א", "1"]);
    const insertF = findOne(["insert", "sub", "משני", "ב", "2"]);
    const mergedF = findOne(["merged", "final", "משולב", "combined", "ג", "3"]);
    if (baseF) $("textBase").value = baseF.content;
    if (insertF) $("textInsert").value = insertF.content;
    if (mergedF) $("textMerged").value = mergedF.content;
    updateAllMeta();
  };
  inp.click();
}

/* === Ignore list === */
function addIgnoreItem() {
  const inp = $("ignoreInput");
  const v = inp.value;
  if (!v) return;
  if (settings.ignore_items.includes(v)) {
    inp.value = "";
    return;
  }
  settings.ignore_items.push(v);
  inp.value = "";
  refreshIgnoreList();
  persistSettings();
}
function addIgnoreFromPreset(v) {
  if (settings.ignore_items.includes(v)) return;
  settings.ignore_items.push(v);
  refreshIgnoreList();
  persistSettings();
}
function removeIgnoreItem(idx) {
  settings.ignore_items.splice(idx, 1);
  refreshIgnoreList();
  persistSettings();
}
function refreshIgnoreList() {
  const list = $("ignoreList");
  if (!list) return;
  list.innerHTML = "";
  settings.ignore_items.forEach((it, i) => {
    const tag = document.createElement("div");
    tag.className = "tcp-ignore-tag";
    tag.innerHTML = `<span>${escapeHtml(it)}</span><button data-action="remove-ignore" data-idx="${i}" title="הסר">×</button>`;
    list.appendChild(tag);
  });
  if (!settings.ignore_items.length) {
    list.innerHTML = '<div class="muted small" style="padding:8px;">רשימה ריקה — הוסף תווים או מילים להתעלמות.</div>';
  }
}

/* === History === */
function refreshHistory() {
  const list = $("historyList");
  if (!list) return;
  const items = loadHistory();
  if (!items.length) {
    list.innerHTML = '<div class="tcp-history-empty">אין השוואות שמורות עדיין.</div>';
    return;
  }
  list.innerHTML = items
    .map((it) => {
      const dt = new Date(it.ts * 1000);
      const when = dt.toLocaleString("he-IL");
      let icon = it.type === "smart" ? "🔀" : "{}";
      let title;
      let summary;
      if (it.type === "smart") {
        title = `השוואת קטעים חכמה`;
        summary = `${it.identical} זהים · ${it.similar} דומים · ${it.missing} חסרים · ${it.added} נוספו`;
      } else {
        title = `בדיקת מיזוג {}`;
        summary = `ראשי: ${it.base_pass ? "✓" : "✗"} · משני: ${it.insert_pass ? "✓" : "✗"} · ${it.brace_blocks} בלוקים`;
      }
      return `<div class="tcp-history-row">
        <div class="tcp-history-icon">${icon}</div>
        <div>
          <div><strong>${title}</strong></div>
          <div class="tcp-history-meta">${summary}</div>
        </div>
        <div class="tcp-history-meta">${when}</div>
      </div>`;
    })
    .join("");
}

function clearHistoryConfirm() {
  if (!confirm("למחוק את כל ההיסטוריה?")) return;
  clearHistory();
  refreshHistory();
}

/* === Clear helpers === */
function clearArea(id) {
  $(id).value = "";
  updateMeta(id);
  const map = {
    doc1: "last_doc1",
    doc2: "last_doc2",
    textBase: "last_base",
    textInsert: "last_insert",
    textMerged: "last_merged",
  };
  if (map[id]) {
    settings[map[id]] = "";
    persistSettings();
  }
}

function clearAllSmart() {
  ["doc1", "doc2"].forEach(clearArea);
  $("smartResults").innerHTML = "";
  modalEl.querySelector('[data-action="export-smart"]').disabled = true;
  modalEl.querySelector('[data-action="copy-smart"]').disabled = true;
}

function clearAllIntegrity() {
  ["textBase", "textInsert", "textMerged"].forEach(clearArea);
  $("integrityResults").innerHTML = "";
  modalEl.querySelector('[data-action="export-integrity"]').disabled = true;
  modalEl.querySelector('[data-action="copy-integrity"]').disabled = true;
}

function swapDocs() {
  const a = $("doc1");
  const b = $("doc2");
  const tmp = a.value;
  a.value = b.value;
  b.value = tmp;
  updateMeta("doc1");
  updateMeta("doc2");
  settings.last_doc1 = a.value;
  settings.last_doc2 = b.value;
  persistSettings();
}

/* === Export / copy — verbatim port === */
function buildHTMLReport(type) {
  const date = new Date().toLocaleString("he-IL");
  let body = "";
  if (type === "smart") {
    body = $("smartResults").innerHTML;
  } else {
    body = $("integrityResults").innerHTML;
  }
  // Strip the "tcp-" prefix from class names so the standalone HTML report
  // matches the exported style block (which uses non-prefixed names — same
  // as the original Python tool).
  body = body.replace(/class="tcp-/g, 'class="').replace(/class='tcp-/g, "class='");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>דוח השוואת טקסטים — ${date}</title>
<style>
body { font-family: 'Segoe UI', sans-serif; background: #fff; color: #111; padding: 30px; max-width: 1100px; margin: 0 auto; }
h1 { color: #1e40af; }
.report-meta { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
.diff-added { background: #d1fae5; color: #065f46; padding: 0 3px; border-radius: 3px; }
.diff-removed { background: #fee2e2; color: #991b1b; padding: 0 3px; border-radius: 3px; text-decoration: line-through; }
.result-box { padding: 16px 20px; margin: 14px 0; border-right: 5px solid #ccc; border-radius: 8px; background: #f9fafb; }
.result-box.pass { border-right-color: #10b981; background: #ecfdf5; }
.result-box.fail { border-right-color: #ef4444; background: #fef2f2; }
.result-box.warn { border-right-color: #f59e0b; background: #fffbeb; }
.diff-container { background: #fff; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; margin-top: 8px; font-family: monospace; line-height: 1.7; white-space: pre-wrap; }
.missing-item, .added-item { background: #fff; padding: 10px; margin: 6px 0; border: 1px solid #e5e7eb; border-radius: 4px; font-family: monospace; }
.missing-item { border-right: 3px solid #ef4444; }
.added-item { border-right: 3px solid #3b82f6; }
.summary-counts { display: flex; gap: 12px; margin-bottom: 18px; }
.count-card { flex: 1; padding: 14px; text-align: center; background: #f3f4f6; border-radius: 8px; }
.count-card .num { font-size: 26px; font-weight: 700; }
.count-card .label { font-size: 11px; color: #6b7280; }
.count-card.pass .num { color: #10b981; }
.count-card.warn .num { color: #f59e0b; }
.count-card.fail .num { color: #ef4444; }
.score-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 600; margin-left: 6px; }
</style></head><body>
<h1>דוח השוואת טקסטים</h1>
<div class="report-meta">${type === "smart" ? "השוואת קטעים חכמה" : "בדיקת מיזוג טקסטים"} · ${date}</div>
${body}
</body></html>`;
}

function exportReport(type) {
  if (!lastReports[type]) return;
  const html = buildHTMLReport(type);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `text-compare-${type}-${Date.now()}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyResults(type) {
  const node = type === "smart" ? $("smartResults") : $("integrityResults");
  const txt = node ? node.innerText : "";
  navigator.clipboard.writeText(txt).then(() => {
    const btn = modalEl.querySelector(
      type === "smart" ? '[data-action="copy-smart"]' : '[data-action="copy-integrity"]'
    );
    const orig = btn.textContent;
    btn.textContent = "✓ הועתק";
    setTimeout(() => (btn.textContent = orig), 1200);
  });
}

/* === Pre-fill from active editor pane (per design rule: active stream's content can pre-fill one side) === */
function fillFromActive(targetId) {
  let txt = "";
  try {
    const pm = window.__tcpPaneManager;
    if (pm && typeof pm.getActiveEditor === "function") {
      const ed = pm.getActiveEditor();
      if (ed && ed.getText) txt = ed.getText();
      else if (ed && ed.state && ed.state.doc) txt = ed.state.doc.textContent || "";
    }
  } catch (_) {}
  if (!txt) {
    // Fallback: read from any visible ProseMirror surface.
    const pm = document.querySelector(".pane-active .ProseMirror, .ProseMirror");
    if (pm) txt = pm.innerText || "";
  }
  if (!txt) {
    alert("אין תוכן בעורך הפעיל.");
    return;
  }
  $(targetId).value = txt;
  updateMeta(targetId);
  const map = {
    doc1: "last_doc1",
    doc2: "last_doc2",
    textBase: "last_base",
    textInsert: "last_insert",
    textMerged: "last_merged",
  };
  if (map[targetId]) {
    settings[map[targetId]] = txt;
    persistSettings();
  }
}

/* === Wire all events === */
function bindUI() {
  // Tab switching
  $$(".tcp-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // File pickers
  bindFile("doc1File", "doc1");
  bindFile("doc2File", "doc2");
  bindFile("baseFile", "textBase");
  bindFile("insertFile", "textInsert");
  bindFile("mergedFile", "textMerged");

  // Live meta + autosave of last texts
  ["doc1", "doc2", "textBase", "textInsert", "textMerged"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      updateMeta(id);
      if (id === "doc1") settings.last_doc1 = el.value;
      if (id === "doc2") settings.last_doc2 = el.value;
      if (id === "textBase") settings.last_base = el.value;
      if (id === "textInsert") settings.last_insert = el.value;
      if (id === "textMerged") settings.last_merged = el.value;
      debouncedSave();
    });
  });

  // Smart-tab settings sync
  ["simThreshold", "consecLimit"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      settings.sim_threshold = parseInt($("simThreshold").value, 10) || 60;
      settings.consec_limit = parseInt($("consecLimit").value, 10) || 0;
      $("defSim").value = settings.sim_threshold;
      $("defConsec").value = settings.consec_limit;
      persistSettings();
    });
  });

  // Settings tab default sync
  ["defSim", "defConsec", "autoLoadLast"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      settings.sim_threshold = parseInt($("defSim").value, 10) || 60;
      settings.consec_limit = parseInt($("defConsec").value, 10) || 0;
      settings.auto_load_last = $("autoLoadLast").checked;
      $("simThreshold").value = settings.sim_threshold;
      $("consecLimit").value = settings.consec_limit || "";
      persistSettings();
    });
  });

  // Ignore-input enter key
  $("ignoreInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addIgnoreItem();
    }
  });

  // Delegated action clicks
  modalEl.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    const target = t.dataset.target;
    switch (action) {
      case "close": closeModal(); break;
      case "open-file": $(target + "File").click(); break;
      case "fill-from-active": fillFromActive(target); break;
      case "clear": clearArea(target); break;
      case "swap-docs": swapDocs(); break;
      case "run-smart": runSmartCompare(); break;
      case "clear-all-smart": clearAllSmart(); break;
      case "export-smart": exportReport("smart"); break;
      case "copy-smart": copyResults("smart"); break;
      case "run-integrity": runIntegrityCheck(); break;
      case "clear-all-integrity": clearAllIntegrity(); break;
      case "export-integrity": exportReport("integrity"); break;
      case "copy-integrity": copyResults("integrity"); break;
      case "auto-detect": autoDetectFromFolder(); break;
      case "refresh-history": refreshHistory(); break;
      case "clear-history": clearHistoryConfirm(); break;
      case "add-ignore": addIgnoreItem(); break;
      case "add-preset": addIgnoreFromPreset(t.dataset.value); break;
      case "remove-ignore": removeIgnoreItem(parseInt(t.dataset.idx, 10)); break;
    }
  });

  // ESC to close
  modalRoot.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeModal();
  });
  // Click overlay to close
  modalRoot.addEventListener("click", (ev) => {
    if (ev.target === modalRoot) closeModal();
  });
}

/* === Open / close === */
export async function openModal(opts) {
  opts = opts || {};
  if (modalRoot) {
    modalRoot.style.display = "flex";
    return;
  }
  // Ensure CSS loaded — the host imports the .css via import statement so
  // bundlers handle it. Vendor scripts (diff + mammoth) are loaded on demand.
  await ensureVendorLoaded().catch((e) => console.warn("vendor load:", e));

  settings = loadSettings();
  modalRoot = document.createElement("div");
  modalRoot.className = "tcp-overlay";
  modalRoot.tabIndex = -1;
  modalRoot.innerHTML = buildModalHTML();
  document.body.appendChild(modalRoot);
  modalEl = modalRoot.querySelector(".tcp-modal");

  // Light-theme follow: if host body has 'dark' or 'theme-dark' we leave
  // the default dark theme; otherwise add tcp-light.
  const hostDark =
    document.body.classList.contains("dark") ||
    document.body.classList.contains("theme-dark") ||
    document.documentElement.getAttribute("data-theme") === "dark";
  if (!hostDark) modalEl.classList.add("tcp-light");

  bindUI();
  applySettingsToUI();
  refreshIgnoreList();
  if (settings.auto_load_last) restoreLastTexts();
  updateAllMeta();

  // Pre-fill from the active stream IF caller asked (per design rule)
  if (opts.prefillFromActive) {
    fillFromActive("doc1");
  }

  // Restore active tab (default to smart_compare === 'smart')
  const tab = settings.active_tab;
  if (tab === "integrity" || tab === "history" || tab === "settings") {
    switchTab(tab);
  } else {
    switchTab("smart");
  }

  // Focus modal so ESC works
  setTimeout(() => modalRoot.focus(), 50);
}

export function closeModal() {
  if (!modalRoot) return;
  modalRoot.remove();
  modalRoot = null;
  modalEl = null;
}
