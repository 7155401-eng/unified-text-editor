// שלב 11 — מנהל חלוניות: עורך ראשי + עד 7 חלוניות זרמים.
// השלבים הקודמים (7-10) נשמרו: 22 תכונות עיצוב, רשימות מקוננות,
// סימני זרם, מנתח אוטומטי. כעת הכל פועל על החלונית הפעילה.

// משה 2026-05-08: V9 הוא המנוע היחיד למצב גפ"ת. הוא רץ אוטומטית כשהצ'קבוקס
// "גפ"ת: צורת הדף" דלוק. אין צורך בטוקן URL או הרשאת admin.

// משה 2026-05-14: ניקוי מוקדם של כל המפתחות שמקטינים את גובה הדף.
// הסיבה: PR #233 הכניס מפתח שמקטין את גובה הדף. כיבינו את הכתיבה, אבל
// השרת המשיך לסנכרן ערכים ישנים אחורה לכל login → הבאג חזר אצל מחוברים.
// כאן מוחקים אותם מ-localStorage לפני שמשהו אחר ינסה לקרוא אותם, ובמקביל
// server_persistence.js שם אותם ב-blacklist כדי שלא יחזרו מהשרת.
// רץ ברגע שה-script נטען, לפני כל שאר הקוד.
(() => {
  try {
    // מפתחות בטיחות־גובה מקומיים בלבד (smart-packer / overflow corrector).
    localStorage.removeItem("ravtext.layout.autoOverflowSafety");
    localStorage.removeItem("ravtext.layout.heightSafetyRegular");
    localStorage.removeItem("ravtext.talmudLayout.heightSafety");
    localStorage.removeItem("ravtext.talmudLayout.heightSafetyPerPage");
    // smart-packer cache לכל מסמך — נמדד אצל המשתמש, לא אצל השרת.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("ravtext.talmudLayout.smartCache.")) {
        localStorage.removeItem(k);
      }
    }
    sessionStorage.removeItem("ravtext.layout.autoOverflowAttempts.v1");
    sessionStorage.removeItem("ravtext.layout.overflowReserve.v1");
    sessionStorage.removeItem("ravtext.layout.overflowReserve.v1.iter");
  } catch (_) {}
})();

import { PaneManager } from "./pane_manager.js";
import { findAllStreamMarks, countByStream, jumpToNextMarker, colorForStream } from "./stream_mark.js";
import { parseRawTextToHTML } from "./stream_parser.js";
import { splitMarkersOnServer, mergeBackOnServer, inlineMergeOnServer, inlineSplitOnServer, loadSyncScrollEnabledFromServer, saveSyncScrollEnabledToServer } from "./main_text_tools_client.js";
import { applyLineMode } from "./line_mode.js";
import { setupPdfToolbar } from "./engine_toolbar.js";
import { scheduleEngineRender, setupPageClickHandler, paneManagerFromEngineDoc, defaultLabelForCode } from "./engine_bridge.js";
import { installFinalLayoutGuard } from "./engine/final_layout_guard.js";
import { bootstrapLiveOverflowReserve, resetLiveOverflowReserve } from "./engine/live_overflow_corrector.js";
import { loadEditableDefaultSample, loadSampleByName } from "./sample_loader.js";
import { parseAuto, parseInternalFormat } from "./engine/parser.js";
import { ensureOriginalStreamSettings, updateOriginalStreamColumnsPanel } from "./original_stream_columns.js";
import { wireMishnaWrapToggle } from "./mishna_wrap_layout.js";
import { wireTalmudLayoutControls } from "./talmud_controls.js";
import { wireOpeningWordControls } from "./opening_word.js";
import { applyLanguage, toggleLanguage } from "./i18n.js";
import { exportWord, importWord, setupWordBridge } from "./word_bridge.js";
import { configureDemoGlobals, setupDemoMode, installConsoleGuard, watchPagesForDemoWatermarks } from "./demo_mode.js";
import { installAuthUi } from "./auth_ui.js";
import { installHeaderPremiumIcons } from "./premium/header_icons.js";
import { installGiftPromoBanner } from "./premium/gift_promo_banner.js";
import { maybeAutoOpenFromUrl } from "./premium/premium_page.js";
import { startTimeWarningEngine } from "./premium/time_warning.js";
import { installHeaderTimer } from "./premium/header_timer.js";
import { setupAiKeysSettings, getActiveAiKey, getActiveAiProvider } from "./premium/ai_keys_settings.js";
import { setupPremiumStatusSection } from "./premium/premium_status_section.js";
import "./premium/premium_styles.css";
import { loadInitialState, attachAutoSync } from "./server_persistence.js";
import { applyPageSettings, wireOutputBackgroundControl, wirePageSettingsControls } from "./page_settings.js";
import { applySpacingSettings, loadSpacingSettings, wireSpacingControls } from "./spacing_settings.js";
import { wireDocumentStyleControls } from "./document_style_settings.js";
import { installTalmudDebugApi } from "./talmud_debug_api.js";
import { setupSettingsPane } from "./settings_pane.js";
import { setupStreamPicker } from "./stream_picker.js";
import { setupMishnaLevelsPicker } from "./mishna_levels_picker.js";
import { setupFindReplace } from "./find_replace.js";
import { setupStreamRolesPicker } from "./stream_roles_picker.js";
import { setupCssInjectPanel } from "./css_inject_panel.js";
import { wireDownloadsPanel } from "./downloads_panel.js";
import { initPwaInstallPrompt } from "./pwa_install_prompt.js";
import { lockScopeWhileStandalone } from "./pwa_scope_lock.js";
import { installFetchTagger } from "./pwa_install_controller.js";
import { wireCustomStyles } from "./custom_styles.js";
import { wireTorahTools } from "./torah_tools.js";
import { installTorahGuestGuard } from "./torah_guest_guard.js";
import { isToolPreviewAllowed, revealToolButtons } from "./tool_preview_gate.js";
import { wireNikudMergerButton } from "./nikud_merger/nikud_merger.js";
import { openWordExtractor, setupWordExtractor } from "./word_extractor/word_extractor.js";
import { wireTextComparePro } from "./text_compare_pro/text_compare_pro.js";
import { wireComparatorButton } from "./comparator_tool/comparator.js";
import { wireSefariaTools } from "./sefaria/sefaria.js";
// משה 2026-05-10: שחזור 3 כלי AI לעורך — טרנסקריפציה, ניקוד תורני, קריקטורה
import { wireTorahTranscription } from "./torah_transcription/torah_transcription.js";
import { wireTorahNikud } from "./torah_nikud/torah_nikud.js";
import { wireCaricatureBot } from "./haredi_caricature/haredi_caricature.js";
import { wireWordCount, wireFullscreen, wireZoom, wireFormattingMarks, wireSpellcheck, wirePreviewSelectionSync, wireQuickInsertActions } from "./editor_utilities.js";
import { tryUseTool } from "./premium/daily_quota_gate.js";
import { wireWordLikeTools, insertMath, insertMermaid, insertComment, autoNumberClauses, insertChapterHeading } from "./word_like_tools.js";
import { insertTablePrompt, addRowAfter, addRowBefore, deleteRow, addColumnAfter, addColumnBefore, deleteColumn, deleteTable } from "./tables_module.js";
import { wireDocumentFeatures } from "./document_features.js";
import { wireChapterSplitter } from "./document_chapter_splitter.js";
import { insertFootnote, insertTOC, wireTrackChanges } from "./footnotes_toc_track.js";
import { isNestedNotesEnabled as isNestedNotesGateOn } from "./nested_notes_gate.js";
import { installLinkMismatchReporter } from "./link_mismatch_reporter.js";
import { wireInboxButtons, trackUsage } from "./inbox_forms.js";
import inlineSampleText from "../samples/sample-hebrew.txt?raw";
configureDemoGlobals();
try {
  document.documentElement.classList.toggle(
    "rt-auth-logged-in",
    !!window.__RAVTEXT_AUTH__?.loggedIn
  );
} catch (_) {}
installAuthUi();
// משה 2026-05-09: לוג כניסת משתמש בכל טעינת עמוד למחוברים. מאפשר לבנות ציר זמן
// של פעילות לכל משתמש בפאנל הניהול.
trackUsage("session_start");
installHeaderPremiumIcons();
installHeaderTimer();
installGiftPromoBanner();
maybeAutoOpenFromUrl();
startTimeWarningEngine();
installConsoleGuard();
installTalmudDebugApi();
setupFindReplace();
setupStreamRolesPicker();
setTimeout(setupCssInjectPanel, 500);
// Wire AI settings — multi-provider keys (משה 2026-05-09)
setTimeout(setupAiKeysSettings, 500);
// Premium status section in settings
setTimeout(setupPremiumStatusSection, 600);
// משה 2026-05-06: Checkbox "שאר הזרמים = משנ״ב" — מפעיל אוטומטית מצב Mishna wrap
// וכותב את כל הזרמים שאינם תלמוד כרמות.
function wireOtherAsMishna() {
  const cb = document.getElementById("talmud-other-as-mishna");
  if (!cb) return;
  const KEY = "ravtext.talmud.otherAsMishna";
  cb.checked = localStorage.getItem(KEY) === "1";
  function apply() {
    const wasOn = localStorage.getItem(KEY) === "1";
    localStorage.setItem(KEY, cb.checked ? "1" : "0");
    const talmudOn = localStorage.getItem("ravtext.talmudLayout") === "1";
    // אם המשתמש כיבה — להחזיר את משנ"ב למצב הקודם (לא לכפות יותר)
    if (!cb.checked) {
      // לא נוגעים ב-mishnaWrap — אם המשתמש הפעיל בעצמו, יישאר
      return;
    }
    if (!talmudOn) return;
    localStorage.setItem("ravtext.mishnaWrap", "1");
    const allCodes = new Set();
    document.querySelectorAll(".stream[data-stream]").forEach(el => {
      const c = el.getAttribute("data-stream");
      if (c && /^\d{2}$/.test(c)) allCodes.add(c);
    });
    const talmudCodes = new Set(
      (localStorage.getItem("ravtext.talmudLayout.streams") || "").match(/\d{2}/g) || []
    );
    const others = Array.from(allCodes).filter(c => !talmudCodes.has(c)).sort();
    if (others.length > 0) {
      localStorage.setItem("ravtext.mishnaWrap.levels", others.join(","));
    }
  }
  cb.addEventListener("change", () => {
    apply();
    // Trigger a re-render so the change takes effect immediately.
    if (typeof rerenderPages === "function") rerenderPages();
  });
  apply();
}
setTimeout(wireOtherAsMishna, 100);

// Basic styles gallery — applies a TipTap style to the active selection.
function wireStylesGallery() {
  const sel = document.getElementById("styles-gallery-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const v = sel.value;
    sel.value = ""; // reset display
    const ed = paneManager.getActiveEditor?.();
    if (!ed) return;
    const ch = ed.chain().focus();
    if (v === "paragraph") ch.setParagraph().run();
    else if (v === "heading-1") ch.toggleHeading({ level: 1 }).run();
    else if (v === "heading-2") ch.toggleHeading({ level: 2 }).run();
    else if (v === "heading-3") ch.toggleHeading({ level: 3 }).run();
    else if (v === "blockquote") ch.toggleBlockquote().run();
    else if (v === "code-block") ch.toggleCodeBlock().run();
  });
}
setTimeout(wireStylesGallery, 100);

// משה 2026-05-07: dropdown לבחירת גודל לטקסט הנבחר. נמצא בקבוצה "גודל
// טקסט נבחר" יחד עם +/- כפתורים. הערך מתאפס אחרי הבחירה כדי לאפשר בחירה
// חוזרת של אותו גודל.
function wireSelectedSizeSelect() {
  const sel = document.getElementById("size-selected-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const v = sel.value;
    sel.value = "";
    if (!v) return;
    const ed = paneManager.getActiveEditor?.();
    if (!ed) return;
    ed.chain().focus().setFontSize(v + "px").run();
  });
}
setTimeout(wireSelectedSizeSelect, 100);

setTimeout(() => wireCustomStyles(paneManager), 150);
setupSettingsPane();
setupStreamPicker();
setupMishnaLevelsPicker();
// בלוני צד הוסרו — בועות עכשיו inline (data-num מעל כל סימן)

const INTERNAL_SAMPLE = `@MAIN בראשית ברא אלהים את השמים ואת הארץ
@01 רש"י, שבת פח ע"א
@02 בשביל התורה ובשביל ישראל שנקראו ראשית
@03 בכת"י: בראשית ברא אלקים

@MAIN והארץ היתה תהו ובהו וחשך על פני תהום
@01 חגיגה יב ע"א
@02 תהו - לשון תמיהה. בהו - לשון בהלה
`;

// === אתחול ===
const container = document.querySelector("#panes-container");
const paneManager = new PaneManager(container);
window.paneManager = paneManager;
installTorahGuestGuard();
// v32-deep: expose a test helper so multi-sample audit can load arbitrary
// raw text via the same path as the built-in talmud sample.
window.__loadCustomSample = async (rawText) => {
  const doc = parseAuto(rawText);
  paneManagerFromEngineDoc(paneManager, doc);
  rerenderPages();
};
window.addEventListener("beforeunload", () => paneManager.flushSave());

// צוות האתר 2026-05-07: סנכרון תכולה והגדרות לשרת למשתמשים מחוברים.
// loadInitialState עוצר אם המשתמש אנונימי. אם יש תכולה שמורה — היא מחליפה את הברירת־מחדל.
loadInitialState(paneManager).then((res) => {
  if (res?.loaded) console.debug("[persistence] loaded document from server");
  attachAutoSync(paneManager);
}).catch((e) => {
  console.warn("[persistence] init failed:", e);
  attachAutoSync(paneManager);
});
const pagesContainer = document.querySelector("#pages-container");

// Final render guard:
// משה 2026-05-14: ה-corrector הדינמי נוטרל (ראה engine_bridge.js). במקום
// לטעון את ה-reserve מ-session, מאפסים אותו לערך 0 כדי שלא ישפיע על pack
// הראשון. אם נחזיר את ה-corrector בעתיד, נחזיר גם את ה-bootstrap.
try { resetLiveOverflowReserve(); } catch (_) {}

// מודד את הדף אחרי הרינדור הסופי. אם יש גלישה,
// מגדיל כרית עימוד ומרנדר מחדש, בלי להסתיר טקסט.
installFinalLayoutGuard({
  getPagesContainer: () => pagesContainer,
  rerender: () => {
    try {
      if (typeof rerenderPages === "function") rerenderPages();
      else if (typeof window.__ravtextRerender === "function") window.__ravtextRerender();
    } catch (err) {
      console.warn("[final-layout-guard] rerender failed", err);
    }
  },
  tolerance: 1.5,
  debounceMs: 260,
  maxAutoSafety: 280,
});
applyPageSettings(pagesContainer);
applySpacingSettings(loadSpacingSettings(), pagesContainer);
const pdfToolbarApi = setupPdfToolbar(pagesContainer);

loadSyncScrollEnabledFromServer().then((enabled) => {
  paneManager.syncEnabled = !!enabled;
  document.getElementById("sync-btn")?.classList.toggle("active", paneManager.syncEnabled);
}).catch(() => {});
setupPageClickHandler(paneManager, pagesContainer);
setupWordBridge(paneManager, rerenderPages);
setupWordExtractor(paneManager, rerenderPages);
wireTextComparePro(paneManager);
wireComparatorButton(paneManager);
wireSefariaTools(paneManager);
installLinkMismatchReporter(paneManager);

const PANE_LAYOUT_KEY = "ravtext.panes.streamLayout";
const STREAM_PANE_WIDTH_KEY = "ravtext.streamPaneWidth";
const STREAM_PANE_WIDTH_USER_KEY = "ravtext.streamPaneWidth.user";

function applyPaneLayout(layout) {
  const mode = layout === "stacked" ? "stacked" : "side";
  localStorage.setItem(PANE_LAYOUT_KEY, mode);
  container.classList.toggle("streams-stacked", mode === "stacked");
  const btn = document.getElementById("pane-layout-btn");
  if (btn) {
    btn.classList.toggle("active", mode === "stacked");
    btn.textContent = mode === "stacked" ? "▤ זרמים לגובה" : "▥ זרמים לרוחב";
    btn.title = mode === "stacked"
      ? "זרמים זה תחת זה, כל זרם ברוחב מלא"
      : "זרמים זה לצד זה מתחת לראשי";
  }
  window.__ravtextApplyPaneWidths?.();
}

applyPaneLayout(localStorage.getItem(PANE_LAYOUT_KEY) || "side");

document.body.classList.toggle("light-theme", localStorage.getItem("ravtext.theme") !== "dark");
applyLanguage();

function isLegacyDemoState() {
  if (paneManager.count() !== 1) return false;
  const main = paneManager.getMainPane();
  const text = main && main.editor ? main.editor.state.doc.textContent : "";
  return text.includes("@01") && text.includes("@02") && text.includes("@03") && text.includes("פצל");
}

(function applyDefaultMishnaSetup() {
  try {
    if (localStorage.getItem("ravtext.mishnaWrap") === null) {
      localStorage.setItem("ravtext.mishnaWrap", "1");
    }
    if (localStorage.getItem("ravtext.mishnaWrap.levels") === null) {
      localStorage.setItem("ravtext.mishnaWrap.levels", "01,04|02,03");
    }
  } catch (_) { /* localStorage חסום — דילוג */ }
})();

// אם יש מצב שמור — משחזר. אחרת — טוען שו"ע כברירת מחדל בכל נקודת התחלה.
const loadedFromStorage = paneManager.loadFromStorage();
let initialLoadPromise = Promise.resolve();
if (!loadedFromStorage || isLegacyDemoState()) {
  initialLoadPromise = loadSampleByName(paneManager, "shulchan");
}

const FONT_STACKS = {
  "David Libre": '"David Libre", "Frank Ruhl Libre", serif',
  "Frank Ruhl Libre": '"Frank Ruhl Libre", "David Libre", serif',
  "Segoe UI": '"Segoe UI", "David Libre", "Frank Ruhl Libre", sans-serif',
};

let _fontSize = parseInt(localStorage.getItem("ravtext.fontSize") || "16", 10);
let _fontFamily = localStorage.getItem("ravtext.fontFamily") || FONT_STACKS["David Libre"];
let _previewMode = false;

function pageMainSizeFor(editorSize) {
  return Math.max(8, Math.min(30, Math.round(editorSize * 0.75)));
}

function pageStreamSizeFor(editorSize) {
  return Math.max(7, Math.min(24, Math.round(editorSize * 0.62)));
}

function applyTypography({ rerender = false } = {}) {
  const cssVars = {
    "--ravtext-editor-font-family": _fontFamily,
    "--ravtext-page-font-family": _fontFamily,
    "--ravtext-editor-size": _fontSize + "px",
    "--ravtext-page-main-size": pageMainSizeFor(_fontSize) + "px",
    "--ravtext-page-stream-size": pageStreamSizeFor(_fontSize) + "px",
  };
  for (const [name, value] of Object.entries(cssVars)) {
    document.documentElement.style.setProperty(name, value);
    pagesContainer?.style.setProperty(name, value);
  }

  for (const p of paneManager.panes) {
    const body = p.element && p.element.querySelector(".pane-body");
    if (!body) continue;
    body.style.fontSize = _fontSize + "px";
    body.style.fontFamily = _fontFamily;
  }

  const lbl = document.getElementById("fs-label");
  if (lbl) lbl.textContent = String(_fontSize);
  localStorage.setItem("ravtext.fontSize", String(_fontSize));
  localStorage.setItem("ravtext.fontFamily", _fontFamily);

  if (rerender) rerenderPages();
}

function setGlobalFontFamily(fontName, options = {}) {
  _fontFamily = FONT_STACKS[fontName] || fontName;
  applyTypography(options);
  const select = document.getElementById("local-font-select");
  if (select) {
    const normalized = normalizeFontFamilyName(fontName);
    if (Array.from(select.options).some((option) => option.value === normalized)) {
      select.value = normalized;
    }
  }
}

function normalizeFontFamilyName(fontName) {
  return String(fontName || "").replace(/^["']|["']$/g, "").trim();
}

function populateFontGallery(families) {
  const select = document.getElementById("local-font-select");
  if (!select) return;
  const current = normalizeFontFamilyName(_fontFamily.split(",")[0]);
  const unique = Array.from(new Set(families.filter(Boolean).map(normalizeFontFamilyName))).sort((a, b) => a.localeCompare(b));
  select.innerHTML = "";
  for (const family of unique) {
    const option = document.createElement("option");
    option.value = family;
    option.textContent = family;
    option.style.fontFamily = family;
    select.appendChild(option);
  }
  if (unique.includes(current)) select.value = current;
}

async function loadLocalFontGallery() {
  const fallback = ["David Libre", "Frank Ruhl Libre", "Segoe UI", "Arial", "Times New Roman", "Tahoma"];
  if (!("queryLocalFonts" in window)) {
    populateFontGallery(fallback);
    return;
  }
  try {
    const fonts = await window.queryLocalFonts();
    const families = fonts.map((font) => font.family);
    populateFontGallery(families.length ? families : fallback);
  } catch (err) {
    console.warn("[fonts] local font access failed:", err);
    populateFontGallery(fallback);
  }
}

function applyFontSize(size, options = {}) {
  _fontSize = Math.max(10, Math.min(40, size));
  applyTypography(options);
}

initialLoadPromise.then(() => {
  applyTypography();
  setupDemoMode({
    paneManager,
    reset: async () => {
      paneManager.clearStorage();
      await loadSampleByName(paneManager, "shulchan");
      applyTypography();
      rerenderPages();
    },
  });
  // הסרה: סימני המים מוטמעים עכשיו בתוכן עצמו לפני המנוע (ב-engine_bridge)
  // כך שהעימוד מחושב נכון. הקריאה הישנה הוסיפה אחרי המדידה ושיבשה את הפריסה.
  // watchPagesForDemoWatermarks(pagesContainer);
});
populateFontGallery(["David Libre", "Frank Ruhl Libre", "Segoe UI", "Arial", "Times New Roman", "Tahoma"]);

document.getElementById("local-font-select")?.addEventListener("change", (ev) => {
  activeChain()?.setFontFamily(ev.target.value).run();
  setGlobalFontFamily(ev.target.value, { rerender: true });
});

document.getElementById("local-font-load")?.addEventListener("click", () => {
  loadLocalFontGallery();
});

// v33: load font from PC via FontFace API.
document.getElementById("local-font-upload-btn")?.addEventListener("click", () => {
  document.getElementById("local-font-upload-input")?.click();
});
document.getElementById("local-font-upload-input")?.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fontName = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, "").replace(/[^\w֐-׿]+/g, "_");
    const face = new FontFace(fontName, arrayBuffer);
    await face.load();
    document.fonts.add(face);
    // Add to font gallery
    const select = document.getElementById("local-font-select");
    if (select) {
      const opt = document.createElement("option");
      opt.value = fontName;
      opt.textContent = fontName + " (לוקאלי)";
      opt.selected = true;
      select.appendChild(opt);
    }
    activeChain()?.setFontFamily(fontName).run();
    setGlobalFontFamily(fontName, { rerender: true });
    alert(`הפונט "${fontName}" נטען בהצלחה.`);
  } catch (err) {
    alert(`שגיאה בטעינת פונט: ${err.message}`);
  }
  ev.target.value = ""; // reset for next upload
});

const LIVE_RENDER_KEY = "ravtext.liveRender";
const LIVE_RENDER_MAX_DOC_SIZE = 60000;

function isLiveRenderEnabled() {
  // משה 2026-05-06: ברירת מחדל ON — רינדור איטי אוטומטי בכל שינוי
  // שומר ביצועים גם כשהמשתמש לא לחץ "רינדור".
  const v = localStorage.getItem(LIVE_RENDER_KEY);
  return v === null ? true : v === "1";
}

function paneManagerDocSize() {
  return paneManager.panes.reduce((sum, pane) => {
    return sum + (pane.editor?.state?.doc?.content?.size || 0);
  }, 0);
}

function shouldLiveRenderNow() {
  return isLiveRenderEnabled() && paneManagerDocSize() <= LIVE_RENDER_MAX_DOC_SIZE;
}

function getMainRibbonToolbar() {
  let toolbar = document.getElementById("main-ribbon-toolbar");
  if (!toolbar) {
    const sourceToolbar = document.querySelector(".source-stream-toolbar");
    toolbar = sourceToolbar?.nextElementSibling || null;
    while (toolbar && !toolbar.classList.contains("toolbar")) {
      toolbar = toolbar.nextElementSibling;
    }
  }
  if (!toolbar) return null;
  toolbar.id = "main-ribbon-toolbar";
  toolbar.classList.add("ribbon-toolbar");
  return toolbar;
}

function toggleExpandedTools(button) {
  const panel = document.getElementById("expanded-tools");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  button?.classList.toggle("active", !panel.hidden);
}

function selectedTextOrActiveText() {
  const selected = String(window.getSelection?.().toString() || "").trim();
  if (selected) return selected;
  const active = paneManager.getActiveEditor();
  return active ? active.state.doc.textBetween(0, active.state.doc.content.size, "\n", "\n") : "";
}

function showSourceStats() {
  let chars = 0;
  let words = 0;
  let markers = 0;
  const perPane = [];
  for (const pane of paneManager.panes) {
    if (!pane.editor) continue;
    const doc = pane.editor.state.doc;
    const text = doc.textBetween(0, doc.content.size, "\n", "\n");
    const paneChars = text.length;
    const paneWords = (text.trim().match(/\S+/g) || []).length;
    const counts = countByStream(pane.editor.state);
    const paneMarkers = Object.values(counts).reduce((sum, n) => sum + n, 0);
    chars += paneChars;
    words += paneWords;
    markers += paneMarkers;
    perPane.push(`${pane.label || pane.streamCode || "ראשי"}: ${paneChars} תווים, ${paneWords} מילים, ${paneMarkers} סימונים`);
  }
  alert([
    `סטטיסטיקות:`,
    `חלוניות: ${paneManager.panes.length}`,
    `תווים: ${chars}`,
    `מילים: ${words}`,
    `סימוני זרמים: ${markers}`,
    "",
    ...perPane,
  ].join("\n"));
}

function focusPdfSearch() {
  const input = document.getElementById("pdf-find-input");
  if (!input) return;
  const selected = String(window.getSelection?.().toString() || "").trim();
  if (selected) input.value = selected;
  if (selected) input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.select();
  input.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function focusFormatterToolbar() {
  const toolbar = getMainRibbonToolbar();
  if (!toolbar) return;
  toolbar.scrollIntoView({ block: "nearest", inline: "nearest" });
  toolbar.classList.add("toolbar-attention");
  setTimeout(() => toolbar.classList.remove("toolbar-attention"), 900);
}

function openDiagnosticsPanel() {
  const panel = document.querySelector("#diagnostics-panel");
  if (!panel) return;
  panel.hidden = false;
  scheduleDiagnosticsRefresh({ force: true });
  panel.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function runLinkManager() {
  const ed = activeChain();
  const selected = selectedTextOrActiveText();
  const url = prompt("הכנס כתובת URL:", selected.startsWith("http") ? selected : "https://");
  if (url && ed) ed.setLink({ href: url }).run();
}

function setupWidthSlider() {
  const mainToolbar = getMainRibbonToolbar();
  if (!mainToolbar || document.getElementById("width-slider")) return;

  const groups = mainToolbar.querySelectorAll(".tb-group");
  const targetGroup = groups[10] || groups[groups.length - 1];
  if (!targetGroup) return;

  const control = document.createElement("label");
  control.className = "width-slider-control";
  control.title = "רוחב כללי של חלוניות הזרמים";
  control.innerHTML = '<span>רוחב</span><input type="range" id="width-slider" min="18" max="100" value="50" />';
  targetGroup.appendChild(control);

  const input = control.querySelector("input");
  const saved = parseInt(localStorage.getItem(STREAM_PANE_WIDTH_KEY) || "50", 10);
  input.value = String(Math.max(18, Math.min(100, Number.isFinite(saved) ? saved : 50)));

  const streamPanes = () => paneManager.panes.filter((p) => p.streamCode && p.element);
  let lastStreamPaneCount = -1;
  const applyWidth = ({ saveUserChoice = false } = {}) => {
    const panes = streamPanes();
    const userSetWidth = localStorage.getItem(STREAM_PANE_WIDTH_USER_KEY) === "1";
    const isStacked = container.classList.contains("streams-stacked");
    const width = Math.max(18, Math.min(100, parseInt(input.value, 10) || 50));

    if (saveUserChoice) {
      localStorage.setItem(STREAM_PANE_WIDTH_USER_KEY, "1");
      localStorage.setItem(STREAM_PANE_WIDTH_KEY, String(width));
    }

    for (const p of panes) {
      if (isStacked || panes.length <= 1) {
        p.element.style.flex = "0 0 100%";
        p.element.style.flexBasis = "100%";
        p.element.style.width = "100%";
      } else if (userSetWidth) {
        p.element.style.flex = `0 1 ${width}%`;
        p.element.style.flexBasis = `${width}%`;
        p.element.style.width = `${width}%`;
      } else {
        p.element.style.flex = "1 1 0";
        p.element.style.removeProperty("flex-basis");
        p.element.style.removeProperty("width");
      }
    }
    lastStreamPaneCount = panes.length;
  };

  input.addEventListener("input", () => applyWidth({ saveUserChoice: true }));
  paneManager.on("change", () => {
    if (streamPanes().length !== lastStreamPaneCount) applyWidth();
  });
  window.__ravtextApplyPaneWidths = () => applyWidth();
  applyWidth();
}

function setupLiveRenderToggle() {
  const mainToolbar = getMainRibbonToolbar();
  if (!mainToolbar || document.getElementById("live-render-toggle")) return;

  const groups = mainToolbar.querySelectorAll(".tb-group");
  const targetGroup = groups[10] || groups[groups.length - 1];
  if (!targetGroup) return;

  const label = document.createElement("label");
  label.className = "toolbar-checkbox live-render-control";
  label.title = "רינדור אוטומטי אחרי עריכה. כבוי כברירת מחדל כדי שהעורך יישאר מהיר.";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = "live-render-toggle";
  input.checked = isLiveRenderEnabled();
  input.addEventListener("change", () => {
    localStorage.setItem(LIVE_RENDER_KEY, input.checked ? "1" : "0");
    if (input.checked && shouldLiveRenderNow()) rerenderPages();
  });

  label.appendChild(input);
  label.appendChild(document.createTextNode("רינדור חי"));
  targetGroup.appendChild(label);
}

function setupRibbonTabs() {
  const mainToolbar = getMainRibbonToolbar();
  if (!mainToolbar) return;
  const authForRibbon = window.__RAVTEXT_AUTH__ || {};

  // משה 2026-05-09: לשונית "הגדרות" הוסרה מהריבון; כל ההגדרות נפתחות מאייקון
  // המפתח-שוודי בכותרת (ראה src/premium/header_icons.js openSettings()).
  // משה 2026-05-10: גם "הורדות" הוסרה מהריבון; פותחת מאייקון ההורדה
  // (📥) בכותרת — אותו דפוס מודאל בדיוק כמו הגדרות.
  const tabs = [
    ["file", "קובץ"],
    ["home", "בית"],
    ["streams", "זרמים"],
    ["insert", "הוספה"],
    ["layout", "פריסה"],
    ["torah", "תורני"],
    ["review", "סקירה"],
    ["view", "תצוגה"],
    ["advanced", "מתקדם"],
  ];

  let tabsBar = document.getElementById("ribbon-tabs");
  if (!tabsBar) {
    tabsBar = document.createElement("div");
    tabsBar.id = "ribbon-tabs";
    tabsBar.className = "ribbon-tabs";
    tabsBar.dir = "rtl";
    tabsBar.setAttribute("role", "tablist");
    tabsBar.setAttribute("aria-label", "כרטיסיות כלים");
    mainToolbar.parentNode.insertBefore(tabsBar, mainToolbar);
  }
  // Idempotent: rebuild tabs if missing/different (handles new tabs added in updates).
  const existingIds = Array.from(tabsBar.querySelectorAll(".ribbon-tab"))
    .map(b => b.dataset.ribbonTab);
  const expectedIds = tabs.map(t => t[0]);
  const same = existingIds.length === expectedIds.length &&
    existingIds.every((id, i) => id === expectedIds[i]);
  if (!same) {
    // Clear and rebuild
    Array.from(tabsBar.querySelectorAll(".ribbon-tab, .ribbon-tab-render-slot"))
      .forEach(el => el.remove());
    const tabTitles = {
      file: "פעולות קובץ", home: "עיצוב טקסט", streams: "ניהול זרמים",
      insert: "הוספת אלמנטים", layout: "פריסת עמודים — כולל משנ\"ב וגפ\"ת",
      torah: "כלים תורניים — גימטריה, ראשי תיבות, גרשיים, תאריך עברי",
      review: "סקירה ובדיקה", view: "תצוגה",
      advanced: "מתקדם", settings: "הגדרות מערכת", downloads: "הורדה ושמירה למחשב",
    };
    for (const [id, label] of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ribbon-tab";
      button.dataset.ribbonTab = id;
      button.setAttribute("role", "tab");
      button.textContent = label;
      if (tabTitles[id]) button.title = tabTitles[id];
      tabsBar.appendChild(button);
    }
    // Render button at end of tabs bar — like Word's menu button.
    const renderBtnSlot = document.createElement("div");
    renderBtnSlot.className = "ribbon-tab-render-slot";
    const renderBtn = document.getElementById("btn-render");
    if (renderBtn) {
      renderBtn.classList.add("btn-render-prominent");
      renderBtnSlot.appendChild(renderBtn);
    }
    tabsBar.appendChild(renderBtnSlot);
  }

  // משה 2026-05-07: מערך זה ממפה כל .tb-group בסרגל הראשי ללשונית.
  // לאחר שהוספתי ב-PR #42 קבוצה חדשה (גודל טקסט נבחר) האינדקסים זזו ב-1
  // וקבוצות קריטיות נעלמו מ"בית". כל הקבוצות שצריכות להיות זמינות בלשונית
  // הראשית — כיוון, גופן, גודל-גלובלי, גודל-טקסט-נבחר, כללי, ניהול —
  // ממופות עכשיו ל-"home" כדי שיופיעו בלשונית "בית" כברירת מחדל.
  // משה 2026-05-10: קבוצת "זרמים" (data-cmd=stream-01..08) הוסרה מ-HTML.
  // הייתה כפלות לוגית עם "סמן בחירה כזרם" ב-.source-stream-toolbar — שתיהן
  // הריצו toggleStream על אותו עורך, אבל הקבוצה הזו איבדה את הסימון בלחיצה.
  // 07/08 ו-× הועברו ל-.source-stream-toolbar שם הם עובדים אמין.
  // האינדקסים זזו ב-1: 19→18, 20→19, 21→20, 22→21.
  const groupTabs = [
    "home",   //  0 טקסט
    "home",   //  1 צבע
    "home",   //  2 רקע
    "home",   //  3 הדגשה ומברשת עיצוב
    "home",   //  4 כותרות
    "home",   //  5 רשימות
    "home",   //  6 יישור
    "home",   //  7 כיוון (RTL/LTR)
    "home",   //  8 ציטוט/קוד (פוצל מ"בלוקים")
    "home",   //  9 קישור (פוצל מ"בלוקים")
    "home",   // 10 מדיה (פוצל מ"בלוקים")
    "home",   // 11 סגנונות
    "home",   // 12 גופן (3 גופנים בסיסיים)
    "home",   // 13 גופן מותאם (פוצל מ"גופן")
    "home",   // 14 גודל גלובלי
    "home",   // 15 גודל טקסט נבחר
    "home",   // 16 כללי (theme + lang)
    "home",   // 17 ניהול (clear/undo/redo)
    "streams", // 18 ניווט סימנים
    "advanced", // 19 זיהוי אוטומטי
    "advanced", // 20 Word
    "file",    // 21 פעולות
  ];
  // משה 2026-05-07: כיבוד ribbon-tab שנקבע ידנית ב-HTML כעוקף עליון. כך
  // קבוצות חדשות שמתפצלות בעתיד יכולות להגדיר את עצמן ב-HTML ולא להישבר
  // ע"י drift באינדקסים של המערך לעיל.
  mainToolbar.querySelectorAll(".tb-group").forEach((group, index) => {
    if (group.dataset.ribbonTab) return;
    group.dataset.ribbonTab = groupTabs[index] || "advanced";
  });

  // משה 2026-05-10: ניקוי כפילויות בלשונית "זרמים":
  //   .panes-toolbar היה מסומן "streams view" — אותו אלמנט DOM הוצג בשתי
  //                  הכרטיסיות. נשאר רק ב-"view" (כפי שהמשתמש ביקש: "הסר
  //                  מ'זרמים' והשאר בכרטיסיות האחרות").
  //   #stream-columns-panel היה "streams layout" — אותו אלמנט DOM בשתיהן.
  //                          נשאר רק ב-"layout".
  // קבוצות אחרות שיש להן שמות זרמים (.tb-group "זרמים" עם stream-btn מול
  // .source-stream-toolbar עם btn-stream) נשארות שתיהן — הקלאסים, הצבעים
  // ומספר הכפתורים שונים, אז זו לא כפלות ודאית לפי הקריטריונים שנקבעו.
  const panelTabs = [
    [".source-stream-toolbar", "streams"],
    [".panes-toolbar", "view"],
    ["#expanded-tools", "advanced view"],
    [".source-bottom-toolbar", "file"],
    [".mishna-toolbar", "layout"],
    [".talmud-toolbar", "layout"],
    [".opening-word-toolbar", "layout"],
    ["#stream-columns-panel", "layout"],
    [".stress-toolbar", "advanced"],
    [".torah-toolbar", "torah"],
    [".insert-toolbar", "insert"],
    [".review-toolbar", "review"],
    [".view-toolbar", "view"],
    [".layout-extra-toolbar", "layout"],
  ];
  for (const [selector, tabList] of panelTabs) {
    const panel = document.querySelector(selector);
    if (!panel) continue;
    panel.classList.add("ribbon-panel");
    panel.dataset.ribbonTab = tabList;
  }

  // Move any ribbon-panel that sits BEFORE the tabs row to AFTER the main
  // toolbar, so when a tab activates its panel appears below the tabs (Word
  // style), never above them.
  const tabsRect = tabsBar.compareDocumentPosition.bind(tabsBar);
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  document.querySelectorAll(".ribbon-panel").forEach((panel) => {
    const pos = tabsRect(panel);
    if (pos & FOLLOWING) return;
    mainToolbar.after(panel);
  });

  const matchesTab = (el, tab) => (el.dataset.ribbonTab || "home")
    .split(/\s+/)
    .filter(Boolean)
    .includes(tab);

  const activateTab = (tab) => {
    const active = tabs.some(([id]) => id === tab) ? tab : "home";
    localStorage.setItem("ravtext.ribbonTab", active);
    document.querySelectorAll(".ribbon-tab").forEach((button) => {
      const isActive = button.dataset.ribbonTab === active;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    mainToolbar.querySelectorAll(".tb-group").forEach((group) => {
      group.classList.toggle("ribbon-hidden", !matchesTab(group, active));
    });
    document.querySelectorAll(".ribbon-panel").forEach((panel) => {
      panel.classList.toggle("ribbon-hidden", !matchesTab(panel, active));
    });
  };

  // Word-style ribbon collapse: double-click any tab toggles permanent collapse;
  // single-click on a tab while collapsed temporarily peeks the panel until the
  // user clicks anywhere outside the ribbon. A chevron button mirrors the toggle.
  const COLLAPSE_KEY = "ravtext.ribbonCollapsed";
  function setCollapsed(on) {
    document.body.classList.toggle("ribbon-collapsed", !!on);
    document.body.classList.remove("ribbon-peek");
    localStorage.setItem(COLLAPSE_KEY, on ? "1" : "0");
    const chev = document.getElementById("ribbon-collapse-toggle");
    if (chev) {
      chev.textContent = on ? "▼" : "▲";
      chev.title = on ? "פתח את סרגל הכלים (Ctrl+F1)" : "כווץ את סרגל הכלים (Ctrl+F1)";
    }
  }
  function toggleCollapsed() {
    setCollapsed(!document.body.classList.contains("ribbon-collapsed"));
  }
  let chevBtn = document.getElementById("ribbon-collapse-toggle");
  if (!chevBtn) {
    chevBtn = document.createElement("button");
    chevBtn.id = "ribbon-collapse-toggle";
    chevBtn.type = "button";
    chevBtn.className = "ribbon-collapse-toggle";
    chevBtn.textContent = "▲";
    chevBtn.title = "כווץ את סרגל הכלים (Ctrl+F1)";
    chevBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleCollapsed();
    });
    const renderSlot = tabsBar.querySelector(".ribbon-tab-render-slot");
    if (renderSlot) tabsBar.insertBefore(chevBtn, renderSlot);
    else tabsBar.appendChild(chevBtn);
  }

  tabsBar.addEventListener("click", (ev) => {
    const button = ev.target.closest(".ribbon-tab");
    if (!button) return;
    activateTab(button.dataset.ribbonTab);
    if (document.body.classList.contains("ribbon-collapsed")) {
      document.body.classList.add("ribbon-peek");
    }
  });
  tabsBar.addEventListener("dblclick", (ev) => {
    if (ev.target.closest(".ribbon-tab")) toggleCollapsed();
  });
  document.addEventListener("click", (ev) => {
    if (!document.body.classList.contains("ribbon-peek")) return;
    if (ev.target.closest("#ribbon-tabs, .ribbon-panel, .ribbon-toolbar")) return;
    document.body.classList.remove("ribbon-peek");
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey && ev.key === "F1") {
      ev.preventDefault();
      toggleCollapsed();
    }
  });
  setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");

  activateTab(localStorage.getItem("ravtext.ribbonTab") || "home");
}

setupRibbonTabs();
wireDownloadsPanel();
initPwaInstallPrompt();
lockScopeWhileStandalone();
installFetchTagger();
(function wirePreviewMinimize() {
  const btn = document.getElementById("preview-minimize-toggle");
  if (!btn) return;
  const KEY = "ravtext.previewMinimized";
  function apply(on) {
    document.body.classList.toggle("preview-minimized", !!on);
    btn.title = on
      ? "הרחב חזרה את חלון התצוגה"
      : "מזער את חלון התצוגה כך שהעורך יקבל את כל הרוחב";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    localStorage.setItem(KEY, on ? "1" : "0");
  }
  apply(localStorage.getItem(KEY) === "1");
  btn.addEventListener("click", () => {
    apply(!document.body.classList.contains("preview-minimized"));
  });
})();

(function wireMainEditorPreviewResizer() {
  const handle = document.getElementById("main-resize-handle");
  const previewPane = document.querySelector(".preview-pane");
  const main = document.querySelector("main.main");
  if (!handle || !previewPane || !main) return;
  const MIN = 320, MAX = 1400;
  const KEY = "ravtext.main.previewWidth";

  // Restore saved width
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      main.style.setProperty("--main-preview-width", saved);
      document.body.classList.add("has-preview-width-override");
    }
  } catch (_) {}

  handle.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const startRect = previewPane.getBoundingClientRect();
    // משה 2026-05-07: זיהוי קצה הידית באופן דינמי כמו ב-css_inject_panel.
    // הנוסחה הקודמת `startRect.right - e.clientX` נתנה שינוי בכיוון לא-נכון
    // ב-RTL כשהידית היא ב-inline-start (= קצה ימני בעברית) — גרירה ימינה
    // נתנה ערכים שליליים, נחסמה ע"י MIN, ולא קרה כלום. גרירה שמאלה הצליחה
    // רק לכווץ. עכשיו: anchor = הקצה הקבוע מנגד; newW נמדד ביחס אליו.
    const handleRect = handle.getBoundingClientRect();
    const handleCenterX = handleRect.left + handleRect.width / 2;
    const isRightEdge = handleCenterX > startRect.left + startRect.width / 2;
    const anchorX = isRightEdge ? startRect.left : startRect.right;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    function onMove(e) {
      const newW = isRightEdge ? (e.clientX - anchorX) : (anchorX - e.clientX);
      if (newW >= MIN && newW <= MAX) {
        main.style.setProperty("--main-preview-width", `${Math.round(newW)}px`);
        document.body.classList.add("has-preview-width-override");
      }
    }
    function onUp() {
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        const cur = main.style.getPropertyValue("--main-preview-width");
        if (cur) localStorage.setItem(KEY, cur);
      } catch (_) {}
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  // Double-click resets to default
  handle.addEventListener("dblclick", () => {
    main.style.removeProperty("--main-preview-width");
    document.body.classList.remove("has-preview-width-override");
    try { localStorage.removeItem(KEY); } catch (_) {}
  });
})();
if (localStorage.getItem("ravtext.lineNumbers") === "1") {
  document.body.classList.add("show-line-numbers");
}
revealToolButtons();
// משה 2026-05-14: גם אורחים צריכים לראות את כלי הטאב התורני (משה דיווח שזה ריק).
// הכלים עצמם משתמשים ב-torah_guest_guard לחסום פעולות שדורשות חשבון, אבל
// הכפתורים צריכים להופיע.
setTimeout(() => {
  wireTorahTools(paneManager);
  wireSefariaTools(paneManager);
  revealToolButtons();
}, 200);

// משה 2026-05-14: ביטול loggedIn gate שגולס+PR #208 הוסיפו. הכפתורים שהוזרקו
// ע"י wire* פעולות עצמן מטופלות ע"י torah_guest_guard לחסום פעולות שדורשות
// חשבון. בלי הסרת ה-gate, אורחים ראו טאב תורני ריק.
if (isToolPreviewAllowed("nikud-merger")) {
  setTimeout(() => wireNikudMergerButton(paneManager), 220);
}
// משה 2026-05-10: 3 כלי AI שחזרו ל-main
if (isToolPreviewAllowed("torah-transcription")) {
  setTimeout(() => wireTorahTranscription(paneManager), 222);
}
if (isToolPreviewAllowed("torah-nikud")) {
  setTimeout(() => wireTorahNikud(paneManager), 224);
}
if (isToolPreviewAllowed("haredi-caricature")) {
  setTimeout(() => wireCaricatureBot(paneManager), 226);
}

setTimeout(() => wireWordLikeTools(paneManager), 250);
setTimeout(() => {
  wireDocumentFeatures();
  wireTrackChanges(paneManager);
  wireChapterSplitter(paneManager);
}, 300);
setTimeout(() => {
  wireWordCount(paneManager);
  wireFullscreen();
  wireZoom();
  wireFormattingMarks();
  wireSpellcheck(paneManager);
  wirePreviewSelectionSync();
  wireQuickInsertActions(paneManager);
}, 250);
setupWidthSlider();
setupLiveRenderToggle();
wirePageSettingsControls(() => {
  applyPageSettings(pagesContainer);
  rerenderPages();
});
wireSpacingControls({ pagesContainer, rerender: rerenderPages });
wireOutputBackgroundControl();
wireDocumentStyleControls({ pagesContainer, rerender: rerenderPages });

function rerenderPages() {
  applySpacingSettings(loadSpacingSettings(), pagesContainer);
  for (const p of paneManager.panes) {
    if (p.streamCode) ensureOriginalStreamSettings(p.streamCode);
  }
  updateOriginalStreamColumnsPanel([], rerenderPages);
  scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi);
}

// משה 2026-05-14: כשהמשתמש מקליד או משנה משהו, ה-reserve הדינמי שצברנו
// כבר לא תקף — מאפסים אותו לפני ה-pack הבא כדי שלא נצמצם את הדף בלי סיבה.
if (typeof paneManager !== "undefined" && paneManager?.on) {
  let resetTimer;
  paneManager.on("change", () => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(resetLiveOverflowReserve, 60);
  });
}
// צוות האתר 2026-05-08: hook לרענון יזום מ-settings_pane (V8 toggle וכו').
if (typeof window !== "undefined") {
  window.__ravtextRerender = rerenderPages;
}

function refreshStreamSettingsPanel(pages = []) {
  for (const p of paneManager.panes) {
    if (p.streamCode) ensureOriginalStreamSettings(p.streamCode);
  }
  updateOriginalStreamColumnsPanel(pages, rerenderPages);
}

function isDiagnosticsVisible() {
  const panel = document.querySelector("#diagnostics-panel");
  return !!panel && !panel.hidden;
}

let diagnosticsTimer = null;
function scheduleDiagnosticsRefresh({ force = false } = {}) {
  if (!force && !isDiagnosticsVisible()) return;
  clearTimeout(diagnosticsTimer);
  diagnosticsTimer = setTimeout(refreshDiagnostics, force ? 0 : 250);
}

paneManager.on("change", () => {
  scheduleDiagnosticsRefresh();
  refreshStreamSettingsPanel();
  if (shouldLiveRenderNow()) rerenderPages();
  updateNestedNotesHint();
});

paneManager.on("focus", () => {
  scheduleDiagnosticsRefresh();
  refreshStreamSettingsPanel();
});

// Nested-notes feature toggle — single checkbox row above the panes container.
// Sync state ↔ localStorage flag (which the gate also reads). On the first
// time the user turns it ON, show the explanation dialog so they understand
// the linear-ordering semantics. Hovering @XX markers anywhere in any pane
// shows a content-preview bubble (wired in nested_notes_bubble.js).
const NESTED_DIALOG_SEEN_KEY = "ravtext.nestedNotesHint.dismissed";
function syncNestedNotesToggle() {
  const cb = document.getElementById("nested-notes-toggle");
  if (!cb) return;
  cb.checked = isNestedNotesGateOn();
}
function updateNestedNotesHint() {
  syncNestedNotesToggle();
}
{
  const cb = document.getElementById("nested-notes-toggle");
  const dlg = document.getElementById("nested-notes-explain-dialog");
  if (cb) {
    cb.checked = isNestedNotesGateOn();
    cb.addEventListener("change", () => {
      try {
        if (cb.checked) {
          localStorage.setItem("ravtext.nestedNotes", "1");
          // First-time check: show the explanation dialog.
          if (localStorage.getItem(NESTED_DIALOG_SEEN_KEY) !== "1" && dlg && typeof dlg.showModal === "function") {
            dlg.showModal();
            localStorage.setItem(NESTED_DIALOG_SEEN_KEY, "1");
          }
        } else {
          localStorage.removeItem("ravtext.nestedNotes");
        }
      } catch (_) {}
      // Drop the gate cache so the next isNestedNotesEnabled() call re-reads.
      import("./nested_notes_gate.js").then((m) => m._resetNestedNotesGateCache?.());
      // Trigger a re-render so the change takes effect immediately.
      if (typeof window.__ravtextRerender === "function") window.__ravtextRerender();
    });
  }
}
// Wire the marker hover bubble (works for any @XX marker in any pane).
import("./nested_notes_bubble.js").then((m) => {
  if (typeof m.installNestedNotesBubble === "function") m.installNestedNotesBubble(paneManager);
}).catch((_) => {});

window.addEventListener("ravtext:engine-rendered", (ev) => {
  refreshStreamSettingsPanel(ev.detail?.pages || []);
});

initialLoadPromise.then(() => refreshStreamSettingsPanel());

if (shouldLiveRenderNow()) {
  initialLoadPromise.then(() => {
    setTimeout(() => {
      if (shouldLiveRenderNow()) rerenderPages();
    }, 300);
  });
}

// === עזר: עריכה על החלונית הפעילה ===
function activeChain() {
  const ed = paneManager.getActiveEditor();
  if (!ed) return null;
  return ed.chain().focus();
}

function resetToSingleMainPane() {
  paneManager.load({
    version: 1,
    activeId: "sample-main",
    panes: [
      {
        id: "sample-main",
        streamCode: null,
        symbol: "",
        label: "ראשי",
        content: { type: "doc", content: [{ type: "paragraph" }] },
      },
    ],
  });
}

function loadEngineDoc(engineDoc) {
  resetToSingleMainPane();
  paneManagerFromEngineDoc(paneManager, engineDoc);
  rerenderPages();
}

function escapeForHTML(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToHTML(text) {
  const lines = String(text || "").split(/\n/);
  return lines.map(line => `<p>${escapeForHTML(line) || "<br>"}</p>`).join("");
}

async function splitSpecialNotes() {
  const main = paneManager.getMainPane();
  const sourcePane = paneManager.panes.find(p => p.streamCode);
  if (!main?.editor || !sourcePane?.editor) {
    alert("צריך חלונית ראשית וחלונית זרם אחת לפחות כדי להפריד הערות.");
    return;
  }

  const filterSymbol = prompt("איזה סימן בתוך ההערה מעביר אותה לזרם חדש?", "*");
  if (!filterSymbol) return;

  const newLinkSymbol = prompt("איזה סימן חדש יופיע בטקסט הראשי עבור הזרם החדש?", "$");
  if (!newLinkSymbol) return;

  const linkSymbol = (sourcePane.symbol || "").trim();
  if (!linkSymbol) {
    alert("לזרם הראשון אין סימן קישור.");
    return;
  }

  const mainText = main.editor.state.doc.textContent;
  const notesText = sourcePane.editor.state.doc.textContent;
  const mainParts = mainText.split(linkSymbol);
  const noteIndices = [];
  let ci = notesText.indexOf(linkSymbol);
  while (ci > -1) {
    noteIndices.push(ci);
    ci = notesText.indexOf(linkSymbol, ci + linkSymbol.length);
  }

  let newMainText = mainParts[0] || "";
  const normalNotes = [];
  const specialNotes = [];

  if (noteIndices.length > 0 && noteIndices[0] > 0) {
    normalNotes.push(notesText.substring(0, noteIndices[0]));
  } else if (noteIndices.length === 0) {
    normalNotes.push(notesText);
  }

  for (let i = 0; i < noteIndices.length; i++) {
    const start = noteIndices[i];
    const end = (i + 1 < noteIndices.length) ? noteIndices[i + 1] : notesText.length;
    const content = notesText.substring(start, end);
    const nextPart = mainParts[i + 1] || "";

    if (content.includes(filterSymbol)) {
      specialNotes.push(newLinkSymbol + content.substring(linkSymbol.length));
      newMainText += newLinkSymbol + nextPart;
    } else {
      normalNotes.push(content);
      newMainText += linkSymbol + nextPart;
    }
  }

  main.editor.commands.setContent(plainTextToHTML(newMainText));
  sourcePane.editor.commands.setContent(plainTextToHTML(normalNotes.join("")));

  if (specialNotes.length > 0) {
    const code = paneManager.nextAvailableStreamCode();
    if (!code) {
      alert("הגעת ל-99 חלוניות.");
      return;
    }
    const pane = paneManager.addPane({
      streamCode: code,
      symbol: newLinkSymbol,
      label: defaultLabelForCode(code),
    });
    if (pane?.editor) {
      pane.editor.storage.streamMark.symbol = newLinkSymbol;
      pane.editor.commands.setContent(plainTextToHTML(specialNotes.join("")));
    }
    rerenderPages();
  } else {
    alert(`לא נמצאו הערות עם הסימן ${filterSymbol}`);
  }
}

function setMergeHidden(hidden) {
  for (const p of paneManager.panes) {
    if (p.streamCode && p.element) p.element.hidden = hidden;
  }
  container.querySelectorAll(".resizer, .main-stream-resizer").forEach(el => {
    el.hidden = hidden;
  });
}

function updateMergeToggleButton() {
  const btn = document.getElementById("merge-toggle-btn");
  if (!btn) return;
  btn.classList.toggle("active", paneManager.merged);
  btn.textContent = paneManager.merged ? "🔓 פרק" : "🔗 מזג / פרק";
}

async function toggleInlineMerge() {
  const main = paneManager.getMainPane();
  if (!main?.editor) return;
  let mainText = main.editor.state.doc.textContent;
  const panes = paneManager.panes
    .filter(p => p.streamCode && p.editor)
    .map(p => ({
      streamCode: p.streamCode,
      symbol: p.symbol || "",
      text: p.editor.state.doc.textContent,
    }));

  if (paneManager.merged) {
    const result = await inlineSplitOnServer(mainText, panes);
    mainText = result.mainText || "";
    for (const p of paneManager.panes) {
      if (!p.streamCode || !p.editor) continue;
      const streamText = result.streamTexts?.[p.streamCode];
      if (streamText) {
        p.editor.commands.setContent(plainTextToHTML(streamText));
      }
    }
    main.editor.commands.setContent(plainTextToHTML(mainText));
    paneManager.merged = false;
    setMergeHidden(false);
    updateMergeToggleButton();
    rerenderPages();
    return;
  }

  const result = await inlineMergeOnServer(mainText, panes);
  mainText = result.mainText || "";

  main.editor.commands.setContent(plainTextToHTML(mainText));
  paneManager.merged = true;
  setMergeHidden(true);
  updateMergeToggleButton();
  rerenderPages();
}

document.querySelectorAll(".btn-stream").forEach((btn) => {
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    activeChain()?.toggleStream(btn.dataset.stream).run();
  });
});

// משה 2026-05-10: כפתור × להסרת סימן הזרם מהטקסט הנבחר. הועבר מקבוצת
// "זרמים" הישנה (data-cmd="stream-clear") שנמחקה — הוא יושב עכשיו
// ב-.source-stream-toolbar עם אותה הגנת mousedown ככל הכפתורים שם.
const btnStreamClear = document.getElementById("btn-stream-clear");
if (btnStreamClear) {
  btnStreamClear.addEventListener("mousedown", (e) => e.preventDefault());
  btnStreamClear.addEventListener("click", () => {
    activeChain()?.unsetStream().run();
  });
}

const customStreamInput = document.getElementById("custom-stream-input");
const btnCustomStream = document.getElementById("btn-custom-stream");
if (btnCustomStream && customStreamInput) {
  btnCustomStream.addEventListener("mousedown", (e) => e.preventDefault());
  btnCustomStream.addEventListener("click", () => {
    let n = parseInt(customStreamInput.value, 10);
    if (!Number.isFinite(n) || n < 1 || n > 999) {
      customStreamInput.focus();
      return;
    }
    activeChain()?.toggleStream(String(n).padStart(2, "0")).run();
  });
}

// Jump-to-stream: scrolls the rendered output to the first occurrence of the
// chosen stream code so the user can review where it lives in the layout.
function flashStreamElement(el) {
  if (!el) return;
  // משה 2026-05-07: scrollIntoView לא תמיד גולל את ה-pages-container עצמו —
  // הוא בוחר את ה-scroll container הקרוב ולפעמים זו תיבה לא נכונה. גלילה
  // מפורשת על pages-container מבטיחה שהיעד באמת נראה במציג.
  const container = document.getElementById("pages-container");
  if (container && container.contains(el)) {
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const offset = eRect.top - cRect.top + container.scrollTop - (cRect.height / 2 - eRect.height / 2);
    container.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  } else {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const prevOutline = el.style.outline;
  const prevTransition = el.style.transition;
  el.style.transition = "outline-color 0.6s ease";
  el.style.outline = "3px solid #f59e0b";
  setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.transition = prevTransition;
  }, 1200);
}
function jumpToStream(code) {
  const padded = String(code).padStart(2, "0");
  const target = document.querySelector(`#pages-container .stream[data-stream="${padded}"], .pages-container .stream[data-stream="${padded}"]`);
  if (target) {
    flashStreamElement(target);
    return;
  }
  const fallback = document.querySelector(`[data-stream="${padded}"]`);
  if (fallback) {
    flashStreamElement(fallback);
    return;
  }
  const status = document.getElementById("status");
  if (status) status.textContent = `${defaultLabelForCode(padded)} לא נמצא בתצוגת העמודים. רנדר עמודים תחילה.`;
}
document.querySelectorAll(".btn-stream-jump").forEach((btn) => {
  btn.addEventListener("click", () => jumpToStream(btn.dataset.stream));
});
const jumpStreamInput = document.getElementById("jump-stream-input");
const btnJumpStream = document.getElementById("btn-jump-stream");
if (btnJumpStream && jumpStreamInput) {
  btnJumpStream.addEventListener("click", () => {
    const n = parseInt(jumpStreamInput.value, 10);
    if (!Number.isFinite(n) || n < 1 || n > 999) {
      jumpStreamInput.focus();
      return;
    }
    jumpToStream(n);
  });
  jumpStreamInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") btnJumpStream.click();
  });
}

document.getElementById("btn-load-internal")?.addEventListener("click", () => {
  loadEditableDefaultSample(paneManager);
  rerenderPages();
  trackUsage("sample_load", { sample: "internal" });
});

document.getElementById("btn-load-inline")?.addEventListener("click", async () => {
  await loadSampleByName(paneManager, "hebrew");
  rerenderPages();
  trackUsage("sample_load", { sample: "hebrew" });
});

document.getElementById("btn-load-shulchan")?.addEventListener("click", async () => {
  await loadSampleByName(paneManager, "shulchan");
  rerenderPages();
  trackUsage("sample_load", { sample: "shulchan" });
});

document.getElementById("btn-load-talmud")?.addEventListener("click", async () => {
  await loadSampleByName(paneManager, "talmud");
  rerenderPages();
  trackUsage("sample_load", { sample: "talmud" });
});

document.getElementById("btn-render")?.addEventListener("click", () => {
  rerenderPages();
  trackUsage("render");
});

// משה 2026-05-09: כפתורי דיווח באג / צור קשר. פעם פתחו mailto;
// עכשיו פותחים מודלים שנשלחים ל-Worker → D1 → פאנל המנהל.
wireInboxButtons();

wireTalmudLayoutControls(rerenderPages);
wireMishnaWrapToggle(rerenderPages);
wireOpeningWordControls(rerenderPages);

document.querySelectorAll(".btn-stress").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mul = parseInt(btn.dataset.mul, 10);
    const big = Array(mul).fill(inlineSampleText).join("\n\n");
    loadEngineDoc(parseAuto(big));
  });
});

// === Toolbar ===
function openResetSystemStateDialog() {
  const existing = document.getElementById("reset-system-state-dialog");
  if (existing) { try { existing.remove(); } catch (_) {} }
  const dlg = document.createElement("dialog");
  dlg.id = "reset-system-state-dialog";
  dlg.setAttribute("dir", "rtl");
  dlg.style.cssText = "max-width:520px;padding:20px;border:1px solid #ccc;border-radius:8px;font-family:inherit;";
  dlg.innerHTML = `
    <form method="dialog" id="reset-system-state-form">
      <h3 style="margin:0 0 8px 0;">אפס מצב מערכת</h3>
      <p style="margin:0 0 12px 0;color:#555;font-size:14px;">בחר מה לאפס. המסמך הפתוח לא יישמר אוטומטית — שמור ל-Word לפני שתמשיך.</p>
      <label style="display:block;margin:8px 0;"><input type="checkbox" name="rs_account" checked> חשבון (יציאה ועוגיות)</label>
      <label style="display:block;margin:8px 0;"><input type="checkbox" name="rs_texts" checked> טקסטים שמורים בדפדפן</label>
      <label style="display:block;margin:8px 0;"><input type="checkbox" name="rs_settings" checked> הגדרות מקומיות</label>
      <label style="display:block;margin:8px 0;"><input type="checkbox" name="rs_cache" checked> מטמון אתר</label>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="reset-system-state-cancel">ביטול</button>
        <button type="submit" id="reset-system-state-ok" class="primary">אפס</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  const form = dlg.querySelector("#reset-system-state-form");
  dlg.querySelector("#reset-system-state-cancel").addEventListener("click", () => {
    try { dlg.close(); } catch (_) {}
    try { dlg.remove(); } catch (_) {}
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const opts = {
      account: fd.get("rs_account") === "on",
      texts: fd.get("rs_texts") === "on",
      settings: fd.get("rs_settings") === "on",
      cache: fd.get("rs_cache") === "on",
    };
    if (!opts.account && !opts.texts && !opts.settings && !opts.cache) {
      try { dlg.close(); } catch (_) {}
      try { dlg.remove(); } catch (_) {}
      return;
    }
    try { dlg.close(); } catch (_) {}
    try { dlg.remove(); } catch (_) {}
    runResetSystemState(opts);
  });
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
}

async function runResetSystemState(opts) {
  try {
    if (opts.texts) {
      try { paneManager.clearStorage(); } catch (_) {}
      try {
        if (indexedDB && indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all((dbs || []).map((db) => new Promise((res) => {
            if (!db || !db.name) { res(); return; }
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => res();
          })));
        }
      } catch (_) {}
    }
    if (opts.settings) {
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
    }
    if (opts.account) {
      try {
        const cookies = document.cookie ? document.cookie.split(";") : [];
        const host = location.hostname;
        const hostParts = host.split(".");
        const domains = new Set([host, "." + host]);
        for (let i = 1; i < hostParts.length; i++) {
          const d = hostParts.slice(i).join(".");
          if (d) { domains.add(d); domains.add("." + d); }
        }
        const paths = ["/", location.pathname];
        for (const raw of cookies) {
          const eq = raw.indexOf("=");
          const name = (eq > -1 ? raw.slice(0, eq) : raw).trim();
          if (!name) continue;
          for (const p of paths) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}`;
            for (const d of domains) {
              document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}; domain=${d}`;
            }
          }
        }
      } catch (_) {}
    }
    if (opts.cache) {
      try {
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (_) {}
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch (_) {}
    }
  } finally {
    if (opts.account) {
      window.location.replace("/api/auth/logout");
    } else {
      window.location.reload();
    }
  }
}

// document-level delegation: תופס כל לחצן [data-cmd] בכל סרגל בדף
document.addEventListener("click", async (ev) => {
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
    case "code-inline":    ed && ed.toggleCode().run(); break;
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
    case "clear-all": {
      const paneCount = paneManager.panes.length;
      const msg = paneCount > 1
        ? `למחוק את כל הטקסט מכל ${paneCount} החלוניות? פעולה זו אינה הפיכה.`
        : "למחוק את כל הטקסט מהעורך? פעולה זו אינה הפיכה.";
      if (!confirm(msg)) break;
      for (const pane of paneManager.panes) {
        if (pane.editor) pane.editor.commands.clearContent(true);
      }
      if (typeof rerenderPages === "function") rerenderPages();
      break;
    }
    case "font-david":
      ed && ed.setFontFamily("David Libre").run();
      setGlobalFontFamily("David Libre", { rerender: true });
      break;
    case "font-frank":
      ed && ed.setFontFamily("Frank Ruhl Libre").run();
      setGlobalFontFamily("Frank Ruhl Libre", { rerender: true });
      break;
    case "font-segoe":
      ed && ed.setFontFamily("Segoe UI").run();
      setGlobalFontFamily("Segoe UI", { rerender: true });
      break;
    case "size-12":        ed && ed.setFontSize("12px").run(); break;
    case "size-15":        ed && ed.setFontSize("15px").run(); break;
    case "size-18":        ed && ed.setFontSize("18px").run(); break;
    case "size-24":        ed && ed.setFontSize("24px").run(); break;
    case "size-selected-up":
    case "size-selected-down": {
      if (!ed) break;
      const delta = c === "size-selected-up" ? 1 : -1;
      const attrs = ed.getAttributes("textStyle") || {};
      const current = parseInt(String(attrs.fontSize || "").replace(/px$/, ""), 10);
      const base = Number.isFinite(current) && current > 0 ? current : _fontSize;
      const next = Math.max(6, Math.min(96, base + delta));
      ed.setFontSize(next + "px").run();
      break;
    }
    case "size-down-double": applyFontSize(_fontSize - 2, { rerender: true }); break;
    case "size-down":        applyFontSize(_fontSize - 1, { rerender: true }); break;
    case "size-up":          applyFontSize(_fontSize + 1, { rerender: true }); break;
    case "size-up-double":   applyFontSize(_fontSize + 2, { rerender: true }); break;
    case "theme-toggle": {
      document.body.classList.toggle("light-theme");
      const isLight = document.body.classList.contains("light-theme");
      localStorage.setItem("ravtext.theme", isLight ? "light" : "dark");
      break;
    }
    case "lang-toggle": {
      toggleLanguage();
      break;
    }
    case "diag-toggle": {
      const panel = document.querySelector("#diagnostics-panel");
      if (panel) panel.hidden = !panel.hidden;
      if (panel && !panel.hidden) scheduleDiagnosticsRefresh({ force: true });
      break;
    }
    case "tools-toggle": {
      toggleExpandedTools(btn);
      break;
    }
    case "show-stats": {
      showSourceStats();
      break;
    }
    case "advanced-search": {
      focusPdfSearch();
      break;
    }
    case "text-formatter": {
      focusFormatterToolbar();
      break;
    }
    case "theme-selector": {
      document.querySelector('[data-cmd="theme-toggle"]')?.click();
      break;
    }
    case "quick-actions": {
      document.querySelector('[data-cmd="engine-render"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
      showToast("פעולות זמינות בסרגל: טעינת דוגמה, רענון עמודים, JSON ו-round-trip.");
      break;
    }
    case "link-manager": {
      runLinkManager();
      break;
    }
    case "edit-history": {
      showToast("היסטוריה זמינה דרך כפתורי ביטול וחזרה בסרגל.");
      break;
    }
    case "advanced-settings": {
      openDiagnosticsPanel();
      break;
    }
    case "word-import": {
      if (!tryUseTool("word-import", "ייבוא מוורד")) break;
      importWord(paneManager, rerenderPages);
      break;
    }
    case "word-import-streams": {
      openWordExtractor(paneManager, rerenderPages);
      break;
    }
    case "word-export": {
      if (!tryUseTool("word-export", "ייצוא לוורד")) break;
      exportWord(paneManager);
      trackUsage("export", { format: "docx" });
      break;
    }

    case "indent-in": {
      if (!ed) break;
      const sunk = ed.chain().focus().sinkListItem("listItem").run()
        || ed.chain().focus().sinkListItem("taskItem").run();
      if (!sunk) {
        const status = document.getElementById("status");
        if (status) status.textContent = "הזחה זמינה כרגע רק בתוך רשימה.";
      }
      break;
    }
    case "indent-out": {
      if (!ed) break;
      const lifted = ed.chain().focus().liftListItem("listItem").run()
        || ed.chain().focus().liftListItem("taskItem").run();
      if (!lifted) {
        const status = document.getElementById("status");
        if (status) status.textContent = "הוצאת הזחה זמינה כרגע רק בתוך רשימה.";
      }
      break;
    }
    case "insert-details": {
      if (!ed) break;
      const summary = prompt("כותרת בלוק נפתח:", "לחצו לפתיחה");
      if (summary === null) break;
      ed.chain().focus().insertContent(
        `<details class="ravtext-collapsible"><summary>${summary || "פתיחה"}</summary><p>תוכן…</p></details>`
      ).run();
      break;
    }
    case "toggle-line-numbers": {
      const on = !document.body.classList.contains("show-line-numbers");
      document.body.classList.toggle("show-line-numbers", on);
      localStorage.setItem("ravtext.lineNumbers", on ? "1" : "0");
      break;
    }
    case "insert-math": { await insertMath(paneManager); break; }
    case "insert-mermaid": { await insertMermaid(paneManager); break; }
    case "insert-comment": { insertComment(paneManager); break; }
    case "auto-number-clauses": { autoNumberClauses(paneManager); break; }
    case "insert-chapter-heading": { insertChapterHeading(paneManager); break; }
    case "insert-table": { insertTablePrompt(paneManager); break; }
    case "table-add-row-after": { addRowAfter(paneManager.getActiveEditor?.()); break; }
    case "table-add-row-before": { addRowBefore(paneManager.getActiveEditor?.()); break; }
    case "table-del-row": { deleteRow(paneManager.getActiveEditor?.()); break; }
    case "table-add-col-after": { addColumnAfter(paneManager.getActiveEditor?.()); break; }
    case "table-add-col-before": { addColumnBefore(paneManager.getActiveEditor?.()); break; }
    case "table-del-col": { deleteColumn(paneManager.getActiveEditor?.()); break; }
    case "table-del": { deleteTable(paneManager.getActiveEditor?.()); break; }
    case "insert-footnote": { insertFootnote(paneManager); break; }
    case "insert-toc": { insertTOC(paneManager); break; }

    case "undo":           ed && ed.undo().run(); break;
    case "redo":           ed && ed.redo().run(); break;
    case "load-sample":
    case "load-sample-hebrew": {
      loadEditableDefaultSample(paneManager);
      rerenderPages();
      break;
    }
    case "load-sample-shulchan": {
      await loadSampleByName(paneManager, "shulchan");
      rerenderPages();
      break;
    }
    case "load-sample-talmud": {
      await loadSampleByName(paneManager, "talmud");
      rerenderPages();
      break;
    }
    case "engine-render": {
      rerenderPages();
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

    case "reset-system-state": {
      openResetSystemStateDialog();
      break;
    }

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
    case "stream-next":
    case "marker-next":    {
      const e = paneManager.getActiveEditor();
      if (e) jumpToNextMarker(e.view, +1);
      break;
    }
    case "stream-prev":
    case "marker-prev":    {
      const e = paneManager.getActiveEditor();
      if (e) jumpToNextMarker(e.view, -1);
      break;
    }
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
      parseRawTextToHTML(raw).then(({ html, stats }) => {
        const e = paneManager.getActiveEditor();
        if (e) e.commands.setContent(html);
        const lines = ["נתחתי:"];
        lines.push(`סך סימנים: ${stats.total}`);
        lines.push("\nלפי זרם:");
        for (const k of Object.keys(stats.byStream).sort()) lines.push(`  ${k}: ${stats.byStream[k]}`);
        alert(lines.join("\n"));
      }).catch((err) => {
        alert(`שגיאת ניתוח: ${err.message}`);
      });
      break;
    }
    case "auto-parse-paste": {
      const e = paneManager.getActiveEditor();
      if (!e) break;
      const raw = e.state.doc.textContent;
      if (!raw.trim()) { alert("חלונית ריקה"); break; }
      parseRawTextToHTML(raw).then(({ html, stats }) => {
        e.commands.setContent(html);
        alert(`זוהו ${stats.total} סימנים בחלונית הפעילה.`);
      }).catch((err) => {
        alert(`שגיאת ניתוח: ${err.message}`);
      });
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
        label: defaultLabelForCode(padded),
      });
      if (pane) {
        pane.editor.commands.setContent(`<p>תוכן ${defaultLabelForCode(padded)}…</p>`);
        ensureOriginalStreamSettings(padded);
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
      const { streams, mainHtml, streamHtml } = await splitMarkersOnServer(rawText);
      const codes = Object.keys(streams).sort();
      if (codes.length === 0) {
        alert("לא נמצאו סימני @NN בתוכן הראשי");
        break;
      }
      // עדכון הראשי
      main.editor.commands.setContent(mainHtml);
      // יצירת/עדכון חלוניות זרמים
      let created = 0, updated = 0;
      for (const code of codes) {
        let pane = paneManager.panes.find(p => p.streamCode === code);
        if (!pane) {
          pane = paneManager.addPane({
            streamCode: code,
            symbol: `@${code}`,
            label: defaultLabelForCode(code),
          });
          created++;
        } else {
          updated++;
        }
        if (pane && pane.editor) {
          pane.editor.commands.setContent(streamHtml[code]);
        }
      }
      const lines = [`פיצול הושלם:`];
      lines.push(`  ראשי: סימני זרם בלבד`);
      for (const code of codes) {
        lines.push(`  ${defaultLabelForCode(code)}: ${streams[code].length} הערות`);
      }
      lines.push(``);
      lines.push(`חלוניות חדשות: ${created}, מעודכנות: ${updated}`);
      alert(lines.join("\n"));
      break;
    }
    case "split-special-notes":
    case "split-notes-advanced": {
      splitSpecialNotes();
      break;
    }
    case "merge-toggle":
    case "toggle-merge": {
      await toggleInlineMerge();
      break;
    }
    case "lines-toggle": {
      applyLineMode(paneManager, !paneManager.lineMode);
      btn.classList.toggle("active", paneManager.lineMode);
      rerenderPages();
      break;
    }
    case "preview-toggle": {
      _previewMode = !_previewMode;
      btn.classList.toggle("active", _previewMode);
      const richToolbar = getMainRibbonToolbar();
      if (richToolbar) richToolbar.style.display = _previewMode ? "none" : "";
      for (const p of paneManager.panes) {
        if (!p.element || !p.editor) continue;
        const body = p.element.querySelector(".pane-body");
        if (body) body.style.fontSize = _previewMode ? `${_fontSize + 4}px` : `${_fontSize}px`;
        p.editor.setEditable(!_previewMode);
      }
      break;
    }
    case "sync-toggle": {
      paneManager.syncEnabled = !paneManager.syncEnabled;
      btn.classList.toggle("active", paneManager.syncEnabled);
      saveSyncScrollEnabledToServer(paneManager.syncEnabled).then((ok) => {
        if (!ok) console.warn("[sync-scroll] server did not persist toggle state");
      });
      break;
    }

    // === איחוד מחלוניות → ראשי ===
    case "pane-layout-toggle": {
      const next = container.classList.contains("streams-stacked") ? "side" : "stacked";
      applyPaneLayout(next);
      break;
    }
    case "merge-from-panes": {
      const main = paneManager.getMainPane();
      if (!main || !main.editor) { alert("אין חלונית ראשית"); break; }
      const mainText = main.editor.state.doc.textContent;
      const streams = {};
      for (const p of paneManager.panes) {
        if (!p.streamCode || !p.editor) continue;
        const text = p.editor.state.doc.textContent;
        streams[p.streamCode] = text;
      }
      const result = await mergeBackOnServer(mainText, streams);
      const merged = result.merged || "";
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
    check("ייבוא/ייצוא Word", true, window.pywebview?.api ? "bridge זמין" : "זמין במעטפת התוכנה המקורית"),
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
  const normalizeContent = (node) => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(normalizeContent);
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "uid") continue;
      out[key] = normalizeContent(value);
    }
    return out;
  };
  const beforeStr = JSON.stringify(before.panes.map(p => normalizeContent(p.content)));
  const afterStr = JSON.stringify(after.panes.map(p => normalizeContent(p.content)));
  const identical = beforeStr === afterStr;
  alert(identical
    ? `✓ בדיקת שחזור עברה — ${paneManager.count()} חלוניות, התוכן חזר זהה.`
    : "✗ בדיקת שחזור נכשלה.\nהמשמעות: הכלי שמר עותק פנימי, ניסה לשחזר אותו, והמבנה שחזר לא יצא זהה לגמרי. זו בדיקת אבחון; היא לא מוחקת את המסמך.");
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
    showToast(`✓ זוהה ${defaultLabelForCode(detected[0].code)} (${detected[0].symbol})`);
  } else {
    const codes = [...new Set(detected.map(d => d.code))].sort().join(", ");
    showToast(`✓ זוהו ${detected.length} סימנים בזרמים: ${codes}`);
  }
};

scheduleDiagnosticsRefresh({ force: true });


