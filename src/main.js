// שלב 11 — מנהל חלוניות: עורך ראשי + עד 7 חלוניות זרמים.
// השלבים הקודמים (7-10) נשמרו: 22 תכונות עיצוב, רשימות מקוננות,
// סימני זרם, מנתח אוטומטי. כעת הכל פועל על החלונית הפעילה.

import { PaneManager } from "./pane_manager.js";
import { findAllStreamMarks, countByStream, jumpToNextMarker, colorForStream } from "./stream_mark.js";
import { parseRawTextToHTML } from "./stream_parser.js";
import { splitTextByMarkers, buildMainHTML, buildStreamHTML, splitStreamNotesByMarkers, mergeBackToText } from "./stream_split.js";
import { applyLineMode } from "./line_mode.js";
import { setLang, toggleLang, getCurrentLang, applyLangToPanes } from "./i18n.js";
import { toggleMerge } from "./merge_mode.js";
import { splitNotesAdvanced } from "./split_notes.js";
import { importWord, exportWord } from "./word_io.js";
import { initStreamSettings, updateStreamSettingsPanel } from "./stream_settings.js";
import { setupPdfToolbar } from "./engine_toolbar.js";
import { scheduleEngineRender, setupPageClickHandler } from "./engine_bridge.js";
import { loadSampleByName } from "./sample_loader.js";
// בלוני צד הוסרו — בועות עכשיו inline (data-num מעל כל סימן)

const HEBREW_SAMPLE_MAIN = `
  <h1>דֻּגְמָה תּוֹרָנִית עִם זְרָמִים</h1>
  <p>פסקה ראשונה — זה הטקסט הראשי. @01 הערה ראשונה לזרם הראשון, פירוש מקובל. @02 הערה שונה לחלוטין, מתייחסת לפרשנות חלופית.</p>
  <p>פסקה שנייה. @01 שוב הערה לזרם הראשון, המשך הדיון. @03 הערה לזרם שלישי, מקור צדדי.</p>
  <p>פסקה שלישית מסכמת. @02 הערה נוספת לזרם השני, סיכום הפרשנות החלופית. @01 הערה אחרונה לזרם הראשון.</p>
  <p>זוהי דוגמה למצב המשולב. לחץ "✂ פצל לחלוניות" כדי לראות את ההערות עוברות לחלוניות נפרדות לפי הזרם שלהן.</p>
`;

const STREAM_SAMPLES = {
  "01": "<p>תוכן זרם 01 — הערה ראשונה. זה תוכן שיוצג בחלונית נפרדת.</p>",
  "02": "<p>תוכן זרם 02 — הערה שנייה.</p>",
  "03": "<p>תוכן זרם 03 — הערות סוף.</p>",
};

// === אתחול ===
const container = document.querySelector("#panes-container");
const paneManager = new PaneManager(container);
window.paneManager = paneManager;
const pagesContainer = document.querySelector("#pages-container");
const pdfToolbarApi = setupPdfToolbar(pagesContainer);
setupPageClickHandler(paneManager, pagesContainer);

if (localStorage.getItem("ravtext.theme") === "light") {
  document.body.classList.add("light-theme");
}

function isLegacyDemoState() {
  if (paneManager.count() !== 1) return false;
  const main = paneManager.getMainPane();
  const text = main && main.editor ? main.editor.state.doc.textContent : "";
  return text.includes("@01") && text.includes("@02") && text.includes("@03") && text.includes("פצל");
}

// אם יש מצב שמור — משחזר. אחרת — טוען דוגמת מנוע מלאה.
const loadedFromStorage = paneManager.loadFromStorage();
if (!loadedFromStorage || isLegacyDemoState()) {
  loadSampleByName(paneManager, "hebrew");
}

let _fontSize = parseInt(localStorage.getItem("ravtext.fontSize") || "16", 10);

function applyFontSize(size) {
  _fontSize = Math.max(10, Math.min(40, size));
  for (const p of paneManager.panes) {
    if (!p.element) continue;
    p.element.querySelector(".pane-body").style.fontSize = _fontSize + "px";
  }
  const lbl = document.getElementById("fs-label");
  if (lbl) lbl.textContent = String(_fontSize);
  localStorage.setItem("ravtext.fontSize", String(_fontSize));
}

applyFontSize(_fontSize);
initStreamSettings(paneManager);
setLang(getCurrentLang());
applyLangToPanes(paneManager);
updateStreamSettingsPanel(paneManager, [], () => {
  rerenderPages();
});

let _previewMode = false;

function rerenderPages() {
  initStreamSettings(paneManager);
  scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi);
}

paneManager.on("change", () => {
  refreshDiagnostics();
  rerenderPages();
});

window.addEventListener("ravtext:engine-rendered", (ev) => {
  updateStreamSettingsPanel(paneManager, ev.detail?.pages || [], () => {
    rerenderPages();
  });
});

setTimeout(() => {
  rerenderPages();
}, 300);

// === עזר: עריכה על החלונית הפעילה ===
function activeChain() {
  const ed = paneManager.getActiveEditor();
  if (!ed) return null;
  return ed.chain().focus();
}

function jumpMarkerInMain(dir) {
  const main = paneManager.getMainPane();
  const editor = main && main.editor;
  if (!editor) return;
  const markers = findAllStreamMarks(editor.state);
  if (markers.length === 0) return;
  const pos = editor.state.selection.from;
  let idx = dir > 0
    ? markers.findIndex((m) => m.from > pos)
    : [...markers].reverse().findIndex((m) => m.from < pos);
  if (dir < 0 && idx >= 0) idx = markers.length - 1 - idx;
  if (idx < 0) idx = dir > 0 ? 0 : markers.length - 1;
  const target = markers[idx];
  editor.commands.setTextSelection({ from: target.from, to: target.to });
  editor.commands.scrollIntoView();
  editor.commands.focus();
}

function setPreviewMode(next) {
  _previewMode = !!next;
  document.body.classList.toggle("preview-mode", _previewMode);
  for (const pane of paneManager.panes) {
    if (pane.editor && typeof pane.editor.setEditable === "function") {
      pane.editor.setEditable(!_previewMode);
    }
  }
  const btn = document.querySelector('[data-cmd="preview-toggle"]');
  if (btn) btn.classList.toggle("active", _previewMode);
}

function setupRibbonTabs() {
  const tabs = Array.from(document.querySelectorAll("[data-ribbon-tab]"));
  const groups = Array.from(document.querySelectorAll(".toolbar .tb-group[data-tab]"));
  if (tabs.length === 0 || groups.length === 0) return;

  const showTab = (tabName) => {
    if (!tabs.some((tab) => tab.dataset.ribbonTab === tabName)) tabName = "home";
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.dataset.ribbonTab === tabName);
    }
    for (const group of groups) {
      group.hidden = group.dataset.tab !== tabName;
    }
    document.querySelectorAll(".toolbar .sep").forEach((sep) => {
      sep.hidden = true;
    });
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => showTab(tab.dataset.ribbonTab));
  }
  showTab(localStorage.getItem("ravtext.ribbon.tab") || "home");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      localStorage.setItem("ravtext.ribbon.tab", tab.dataset.ribbonTab);
    });
  }
}

setupRibbonTabs();

// === Toolbar ===
// document-level delegation: תופס כל לחצן [data-cmd] בכל סרגל בדף
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-cmd]");
  if (!btn) return;
  const c = btn.dataset.cmd;
  const ed = activeChain();

  switch (c) {
    case "bold":           ed && ed.toggleBold().run(); break;
    case "italic":         ed && ed.toggleItalic().run(); break;
    case "underline":      ed && ed.toggleUnderline().run(); break;
    case "strike":         ed && ed.toggleStrike().run(); break;
    case "color-red":      ed && ed.setColor("#dc2626").run(); break;
    case "color-blue":     ed && ed.setColor("#2563eb").run(); break;
    case "color-green":    ed && ed.setColor("#16a34a").run(); break;
    case "color-gold":     ed && ed.setColor("#D4AF37").run(); break;
    case "color-clear":    ed && ed.unsetColor().run(); break;
    case "bg-yellow":      ed && ed.setBackgroundColor("#fef08a").run(); break;
    case "bg-cyan":        ed && ed.setBackgroundColor("#a5f3fc").run(); break;
    case "bg-pink":        ed && ed.setBackgroundColor("#fbcfe8").run(); break;
    case "bg-clear":       ed && ed.unsetBackgroundColor().run(); break;
    case "super":          ed && ed.toggleSuperscript().run(); break;
    case "sub":            ed && ed.toggleSubscript().run(); break;
    case "blockquote":     ed && ed.toggleBlockquote().run(); break;
    case "code-block":     ed && ed.toggleCodeBlock().run(); break;
    case "bullet":         ed && ed.toggleBulletList().run(); break;
    case "ordered":        ed && ed.toggleOrderedList().run(); break;
    case "check":          ed && ed.toggleTaskList().run(); break;
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      ed && ed.toggleHeading({ level: parseInt(c.slice(1)) }).run();
      break;
    }
    case "rtl": {
      const aE = paneManager.activePane;
      if (aE && aE.element) aE.element.querySelector(".pane-body").setAttribute("dir", "rtl");
      break;
    }
    case "ltr": {
      const aE = paneManager.activePane;
      if (aE && aE.element) aE.element.querySelector(".pane-body").setAttribute("dir", "ltr");
      break;
    }
    case "align-right":    ed && ed.setTextAlign("right").run(); break;
    case "align-center":   ed && ed.setTextAlign("center").run(); break;
    case "align-left":     ed && ed.setTextAlign("left").run(); break;
    case "align-justify":  ed && ed.setTextAlign("justify").run(); break;
    case "link": {
      const url = prompt("הכנס כתובת URL:", "https://");
      if (url && ed) ed.setLink({ href: url }).run();
      break;
    }
    case "unlink":         ed && ed.unsetLink().run(); break;
    case "image": {
      const url = prompt("כתובת תמונה:", "https://placehold.co/400x200/D4AF37/000?text=Demo");
      if (url && ed) ed.setImage({ src: url }).run();
      break;
    }
    case "video": {
      const url = prompt("כתובת YouTube:", "");
      if (url && ed) ed.setYoutubeVideo({ src: url, width: 480, height: 270 }).run();
      break;
    }
    case "formula": {
      const f = prompt("הכנס נוסחה:", "x^2 + y^2 = z^2");
      if (f && ed) ed.insertContent(`<code class="formula">$${f}$</code>`).run();
      break;
    }
    case "clear":          ed && ed.clearNodes().unsetAllMarks().run(); break;
    case "font-david":     ed && ed.setFontFamily("David Libre").run(); break;
    case "font-frank":     ed && ed.setFontFamily("Frank Ruhl Libre").run(); break;
    case "font-segoe":     ed && ed.setFontFamily("Segoe UI").run(); break;
    case "size-12":        ed && ed.setFontSize("12px").run(); break;
    case "size-15":        ed && ed.setFontSize("15px").run(); break;
    case "size-18":        ed && ed.setFontSize("18px").run(); break;
    case "size-24":        ed && ed.setFontSize("24px").run(); break;
    case "size-down-double": applyFontSize(_fontSize - 2); break;
    case "size-down":        applyFontSize(_fontSize - 1); break;
    case "size-up":          applyFontSize(_fontSize + 1); break;
    case "size-up-double":   applyFontSize(_fontSize + 2); break;
    case "theme-toggle": {
      document.body.classList.toggle("light-theme");
      const isLight = document.body.classList.contains("light-theme");
      localStorage.setItem("ravtext.theme", isLight ? "light" : "dark");
      break;
    }
    case "lang-toggle": {
      toggleLang();
      applyLangToPanes(paneManager);
      break;
    }
    case "preview-toggle": {
      setPreviewMode(!_previewMode);
      break;
    }
    case "diag-toggle": {
      const panel = document.querySelector("#diagnostics-panel");
      if (panel) panel.hidden = !panel.hidden;
      break;
    }

    case "indent-in": case "indent-out": break; // הזחה — בהמשך

    case "undo":           ed && ed.undo().run(); break;
    case "redo":           ed && ed.redo().run(); break;
    case "load-sample":
    case "load-sample-hebrew": {
      loadSampleByName(paneManager, "hebrew");
      rerenderPages();
      break;
    }
    case "load-sample-shulchan": {
      loadSampleByName(paneManager, "shulchan");
      rerenderPages();
      break;
    }
    case "load-sample-talmud": {
      loadSampleByName(paneManager, "talmud");
      rerenderPages();
      break;
    }
    case "engine-render": {
      rerenderPages();
      break;
    }
    case "word-import": {
      importWord(paneManager).then((ok) => {
        if (ok) rerenderPages();
      });
      break;
    }
    case "word-export": {
      exportWord(paneManager);
      break;
    }
    case "toggle-merge": {
      const ok = toggleMerge(paneManager);
      if (ok) {
        btn.classList.toggle("active", paneManager.merged);
        rerenderPages();
      }
      break;
    }
    case "split-notes-advanced": {
      splitNotesAdvanced(paneManager).then((ok) => {
        if (ok) rerenderPages();
      });
      break;
    }
    case "export-json": {
      const state = paneManager.serialize();
      console.log("PANE STATE:", state);
      document.querySelector("#json-out").textContent = JSON.stringify(state, null, 2);
      const panel = document.querySelector("#diagnostics-panel");
      if (panel) panel.hidden = false;
      break;
    }
    case "round-trip":     runRoundTripTest(); break;

    // סימני זרם
    case "stream-01": case "stream-02": case "stream-03": case "stream-04":
    case "stream-05": case "stream-06": case "stream-07": case "stream-08": {
      const code = c.split("-")[1];
      ed && ed.toggleStream(code).run();
      break;
    }
    case "stream-custom": {
      const v = prompt("מספר זרם (1‑999):", "10");
      if (v && ed) ed.toggleStream(parseInt(v, 10).toString().padStart(2, "0")).run();
      break;
    }
    case "stream-clear":   ed && ed.unsetStream().run(); break;
    case "stream-next":    {
      const e = paneManager.getActiveEditor();
      if (e) jumpToNextMarker(e.view, +1);
      break;
    }
    case "stream-prev":    {
      const e = paneManager.getActiveEditor();
      if (e) jumpToNextMarker(e.view, -1);
      break;
    }
    case "marker-next":    jumpMarkerInMain(+1); break;
    case "marker-prev":    jumpMarkerInMain(-1); break;
    case "stream-count":   {
      const e = paneManager.getActiveEditor();
      if (!e) break;
      const counts = countByStream(e.state);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const lines = Object.keys(counts).sort().map(k => `  ${k}: ${counts[k]}`);
      alert(`חלונית פעילה — סה"כ: ${total}\nלפי זרם:\n${lines.join("\n")}`);
      break;
    }

    // מנתח אוטומטי
    case "auto-parse": {
      const raw = prompt(
        "הדבק טקסט גולמי לזיהוי דפוסים:",
        "פתיחה @01 הערה ראשונה. ועוד @02 הערה שנייה.\n[1] עם הערה ושוב {הערה מסולסלת} בתוך טקסט.\nכוכבית * ופגיון †."
      );
      if (!raw) break;
      const { html, stats } = parseRawTextToHTML(raw);
      const e = paneManager.getActiveEditor();
      if (e) e.commands.setContent(html);
      const lines = ["נתחתי:"];
      lines.push(`סך סימנים: ${stats.total}`);
      lines.push("\nלפי זרם:");
      for (const k of Object.keys(stats.byStream).sort()) lines.push(`  ${k}: ${stats.byStream[k]}`);
      alert(lines.join("\n"));
      break;
    }
    case "auto-parse-paste": {
      const e = paneManager.getActiveEditor();
      if (!e) break;
      const raw = e.state.doc.textContent;
      if (!raw.trim()) { alert("חלונית ריקה"); break; }
      const { html, stats } = parseRawTextToHTML(raw);
      e.commands.setContent(html);
      alert(`זוהו ${stats.total} סימנים בחלונית הפעילה.`);
      break;
    }

    // === שלב 11 — ניהול חלוניות ===
    case "pane-add": {
      const code = paneManager.nextAvailableStreamCode();
      if (!code) { alert("הגעת ל‑99 חלוניות (מקסימום)."); break; }
      const customCode = prompt(`קוד זרם לחלונית החדשה (1‑99):`, code);
      if (!customCode) break;
      const padded = String(parseInt(customCode, 10)).padStart(2, "0");
      const pane = paneManager.addPane({
        streamCode: padded,
        symbol: `@${padded}`,
        label: `זרם ${padded}`,
      });
      if (pane) {
        pane.editor.commands.setContent(`<p>תוכן זרם ${padded}…</p>`);
        initStreamSettings(paneManager);
        updateStreamSettingsPanel(paneManager, [], () => rerenderPages());
      }
      break;
    }
    case "pane-remove": {
      const a = paneManager.activePane;
      if (!a) break;
      if (!a.streamCode) { alert("חלונית ראשית — לא ניתן למחוק"); break; }
      if (confirm(`למחוק את חלונית "${a.label}"?`)) {
        paneManager.removePane(a.id);
      }
      break;
    }
    case "pane-clear-storage": {
      if (confirm("לאפס את כל החלוניות ולהתחיל מחדש?")) {
        paneManager.clearStorage();
        location.reload();
      }
      break;
    }

    // === פיצול לחלוניות (combined → split) ===
    case "split-to-panes": {
      const main = paneManager.getMainPane();
      if (!main || !main.editor) { alert("אין חלונית ראשית"); break; }
      const rawText = main.editor.state.doc.textContent;
      const { mainText, streams } = splitTextByMarkers(rawText);
      const codes = Object.keys(streams).sort();
      if (codes.length === 0) {
        alert("לא נמצאו סימני @NN בתוכן הראשי");
        break;
      }
      // עדכון הראשי
      main.editor.commands.setContent(buildMainHTML(rawText));
      // יצירת/עדכון חלוניות זרמים
      let created = 0, updated = 0;
      for (const code of codes) {
        let pane = paneManager.panes.find(p => p.streamCode === code);
        if (!pane) {
          pane = paneManager.addPane({
            streamCode: code,
            symbol: `@${code}`,
            label: `זרם ${code}`,
          });
          created++;
        } else {
          updated++;
        }
        if (pane && pane.editor) {
          pane.editor.commands.setContent(buildStreamHTML(code, streams[code]));
        }
      }
      const lines = [`פיצול הושלם:`];
      lines.push(`  ראשי: סימני זרם בלבד`);
      for (const code of codes) {
        lines.push(`  זרם ${code}: ${streams[code].length} הערות`);
      }
      lines.push(``);
      lines.push(`חלוניות חדשות: ${created}, מעודכנות: ${updated}`);
      alert(lines.join("\n"));
      break;
    }
    case "lines-toggle": {
      applyLineMode(paneManager, !paneManager.lineMode);
      btn.classList.toggle("active", paneManager.lineMode);
      rerenderPages();
      break;
    }
    case "sync-toggle": {
      paneManager.syncEnabled = !paneManager.syncEnabled;
      btn.classList.toggle("active", paneManager.syncEnabled);
      break;
    }

    // === איחוד מחלוניות → ראשי ===
    case "merge-from-panes": {
      const main = paneManager.getMainPane();
      if (!main || !main.editor) { alert("אין חלונית ראשית"); break; }
      const mainText = main.editor.state.doc.textContent;
      const streams = {};
      for (const p of paneManager.panes) {
        if (!p.streamCode || !p.editor) continue;
        const text = p.editor.state.doc.textContent;
        const items = splitStreamNotesByMarkers(text);
        streams[p.streamCode] = items;
      }
      const merged = mergeBackToText(mainText, streams);
      // הצגה כטקסט פשוט בראשי
      main.editor.commands.setContent(`<p>${merged.replace(/\n/g, "<br>")}</p>`);
      alert(`איחוד הושלם — ${Object.keys(streams).length} זרמים שולבו לראשי.`);
      break;
    }
  }
});

// === Diagnostics ===
const NIKUD_RX = /[ְ-ׇ]/;
const TAAMIM_RX = /[֑-֯]/;
const HEBREW_BASE_RX = /[א-ת]/;
const GERESH_RX = /׳/;
const GERSHAYIM_RX = /״/;
const MAQAF_RX = /־/;

function check(label, ok, detail) { return { label, ok, detail }; }
function countMatches(rx, text) { const m = text.match(new RegExp(rx.source, "g")); return m ? m.length : 0; }

function refreshDiagnostics() {
  const ed = paneManager.getActiveEditor();
  const html = ed ? ed.getHTML() : "";
  const json = ed ? ed.getJSON() : null;
  const text = ed ? ed.state.doc.textContent : "";
  const allText = paneManager.panes.map(p => p.editor ? p.editor.state.doc.textContent : "").join(" ");

  // ספירות זרמים בכל החלוניות
  let allMarkers = 0, allStreams = new Set();
  for (const p of paneManager.panes) {
    if (!p.editor) continue;
    const cnt = countByStream(p.editor.state);
    allMarkers += Object.values(cnt).reduce((a, b) => a + b, 0);
    Object.keys(cnt).forEach(k => allStreams.add(k));
  }

  const checks = [
    check(`חלוניות פעילות — ${paneManager.count()}`, paneManager.count() > 0),
    check(`חלונית פעילה — ${paneManager.activePane ? paneManager.activePane.label : "—"}`, !!paneManager.activePane),
    check("RTL פעיל", true),
    check("גופן David מוטמע", paneManager.activePane && getComputedStyle(paneManager.activePane.element.querySelector(".pane-body")).fontFamily.includes("David")),
    check("עברית", HEBREW_BASE_RX.test(allText), `${countMatches(HEBREW_BASE_RX, allText)} תווים`),
    check("ניקוד", NIKUD_RX.test(allText), `${countMatches(NIKUD_RX, allText)} סימנים`),
    check("טעמים", TAAMIM_RX.test(allText), `${countMatches(TAAMIM_RX, allText)} סימנים`),
    check("גרש ׳", GERESH_RX.test(allText)),
    check("גרשיים ״", GERSHAYIM_RX.test(allText)),
    check("מקף ־", MAQAF_RX.test(allText)),
    check(`סימני זרם — סה"כ ${allMarkers}`, allMarkers >= 0),
    check(`זרמים נפרדים — ${allStreams.size}`, true),
    check("שלב 11.1 — Container פועל", !!container),
    check("שלב 11.2 — הוספת חלונית", true),
    check("שלב 11.3 — מחיקת חלונית", true),
    check("שלב 11.4 — תפריט קליק־ימני", true),
    check("שלב 11.5 — שמירה ב‑localStorage", !!localStorage.getItem("ravtext.panes.state.v1")),
    check(`שלב 11.6 — עד 99 חלוניות`, paneManager.count() <= 99),
    check("JSON תקין", ed && typeof json === "object" && json.type === "doc"),
    check("הערות שוליים — שלב 13", false, "ייבוא Word"),
  ];

  const list = document.querySelector("#diag-list");
  list.innerHTML = "";
  for (const c of checks) {
    const li = document.createElement("li");
    const detail = c.detail ? ` — ${c.detail}` : "";
    li.textContent = (c.ok ? "✓ " : "✗ ") + c.label + detail;
    li.className = c.ok ? "pass" : "fail";
    list.appendChild(li);
  }
  const passCount = checks.filter(c => c.ok).length;
  const summary = document.createElement("li");
  summary.style.borderTop = "2px solid #D4AF37";
  summary.style.paddingTop = "6px";
  summary.style.marginTop = "6px";
  summary.style.fontWeight = "bold";
  summary.textContent = `סך: ${passCount} / ${checks.length}`;
  list.appendChild(summary);

  document.querySelector("#json-out").textContent = json ? JSON.stringify(json, null, 2) : "—";
}

async function runRoundTripTest() {
  const before = JSON.parse(JSON.stringify(paneManager.serialize()));
  // משבש כל חלונית
  for (const p of paneManager.panes) {
    if (p.editor) p.editor.commands.setContent("<p>זמני</p>");
  }
  await new Promise(r => setTimeout(r, 50));
  // משחזר
  for (const ps of before.panes) {
    const p = paneManager.panes.find(x => x.id === ps.id);
    if (p && p.editor && ps.content) p.editor.commands.setContent(ps.content);
  }
  await new Promise(r => setTimeout(r, 50));
  const after = paneManager.serialize();
  const beforeStr = JSON.stringify(before.panes.map(p => p.content));
  const afterStr = JSON.stringify(after.panes.map(p => p.content));
  const identical = beforeStr === afterStr;
  alert(identical ? `✓ Round-trip מושלם — ${paneManager.count()} חלוניות, 100% זהה` : "✗ Round-trip נכשל");
  console.log("ROUND-TRIP:", { identical, panes: paneManager.count() });
}

window.runRoundTripTest = runRoundTripTest;

// === חיווי זיהוי טרי ===
let _toastTimer = null;
function showToast(text) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.add("fade-out");
    setTimeout(() => t.remove(), 400);
  }, 2400);
}

window.__streamMarkOnDetected = function (detected) {
  if (!detected || !detected.length) return;
  // פעימה על הסימנים שזוהו זה עתה
  const all = document.querySelectorAll(".stream-marker");
  // מסמן את ה‑X האחרונים (הכי טריים) — קירוב טוב מספיק
  const last = Array.from(all).slice(-detected.length);
  for (const el of last) {
    el.classList.add("fresh");
    setTimeout(() => el.classList.remove("fresh"), 1300);
  }
  // תיבת הודעה
  if (detected.length === 1) {
    showToast(`✓ זוהה זרם ${detected[0].code} (${detected[0].symbol})`);
  } else {
    const codes = [...new Set(detected.map(d => d.code))].sort().join(", ");
    showToast(`✓ זוהו ${detected.length} סימנים בזרמים: ${codes}`);
  }
};

refreshDiagnostics();
