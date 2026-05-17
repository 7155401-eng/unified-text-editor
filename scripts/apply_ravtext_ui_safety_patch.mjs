import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function abs(rel) {
  return path.resolve(root, rel);
}

function read(rel) {
  return fs.readFileSync(abs(rel), "utf8");
}

function write(rel, value) {
  fs.writeFileSync(abs(rel), value, "utf8");
}

function patchOnce(rel, name, oldText, newText, marker) {
  let src = read(rel);
  if (src.includes(marker)) {
    console.log(`[ravtext-ui-safety] ${name}: already patched`);
    return false;
  }
  if (!src.includes(oldText)) {
    throw new Error(`[ravtext-ui-safety] ${name}: expected source block not found in ${rel}`);
  }
  src = src.replace(oldText, newText);
  write(rel, src);
  console.log(`[ravtext-ui-safety] ${name}: patched`);
  return true;
}

function replaceAllSafe(rel, replacements) {
  let src = read(rel);
  let changed = false;
  for (const [name, oldText, newText] of replacements) {
    if (src.includes(newText)) {
      console.log(`[ravtext-ui-safety] ${name}: already patched`);
      continue;
    }
    if (!src.includes(oldText)) {
      throw new Error(`[ravtext-ui-safety] ${name}: expected text not found in ${rel}`);
    }
    src = src.replaceAll(oldText, newText);
    changed = true;
    console.log(`[ravtext-ui-safety] ${name}: patched`);
  }
  if (changed) write(rel, src);
}

function appendOnce(rel, marker, text) {
  let src = read(rel);
  if (src.includes(marker)) {
    console.log(`[ravtext-ui-safety] ${rel}: css already patched`);
    return false;
  }
  src += text;
  write(rel, src);
  console.log(`[ravtext-ui-safety] ${rel}: css appended`);
  return true;
}

patchOnce(
  "index.html",
  "render pause/stop buttons",
`          <button type="button" id="btn-render" data-i18n="renderPages">
            רנדר
          </button>`,
`          <button type="button" id="btn-render" data-i18n="renderPages">
            רנדר
          </button>
          <button
            type="button"
            id="btn-render-pause"
            data-cmd="render-pause-toggle"
            title="השהה רינדור אוטומטי בזמן שינוי כמה הגדרות יחד"
            aria-pressed="false"
          >
            ⏸ השהה רינדור
          </button>
          <button
            type="button"
            id="btn-render-stop"
            data-cmd="render-stop"
            title="עצור את הרינדור הנוכחי או בטל רינדור שממתין בתור"
          >
            ■ עצור
          </button>`,
  `id="btn-render-pause"`
);

patchOnce(
  "index.html",
  "safe display reset button",
`            <button
              data-cmd="reset-system-state"
              title="ניקוי מטמון ועוגיות ויציאה מהחשבון — חזרה למצב התחלתי"
            >
              ↻ אפס מצב מערכת
            </button>`,
`            <button
              data-cmd="reset-display-settings"
              title="איפוס הגדרות תצוגה, רינדור וזרמים בלבד — בלי למחוק את הטקסט"
            >
              🧹 אפס תצוגה בלבד
            </button>
            <button
              data-cmd="reset-system-state"
              title="ניקוי מטמון ועוגיות ויציאה מהחשבון — חזרה למצב התחלתי"
            >
              ↻ אפס מצב מערכת
            </button>`,
  `data-cmd="reset-display-settings"`
);

patchOnce(
  "src/engine_bridge.js",
  "export render cancel helper",
`export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);
}

// Smart-tune state: prevent re-entry while a tune cycle is active.`,
`export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);
}

export function cancelEngineRender() {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _renderToken++;
  const statusEl = typeof document !== "undefined" ? document.getElementById("status") : null;
  if (statusEl) statusEl.textContent = "הרינדור נעצר. לחץ רנדר כדי להתחיל מחדש.";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ravtext:engine-render-cancelled"));
  }
}

// Smart-tune state: prevent re-entry while a tune cycle is active.`,
  `export function cancelEngineRender()`
);

patchOnce(
  "src/main.js",
  "import cancelEngineRender",
`import { scheduleEngineRender, setupPageClickHandler, paneManagerFromEngineDoc, defaultLabelForCode } from "./engine_bridge.js";`,
`import { scheduleEngineRender, cancelEngineRender, setupPageClickHandler, paneManagerFromEngineDoc, defaultLabelForCode } from "./engine_bridge.js";`,
  `cancelEngineRender, setupPageClickHandler`
);

patchOnce(
  "src/main.js",
  "render pause state",
`const LIVE_RENDER_KEY = "ravtext.liveRender";
const LIVE_RENDER_MAX_DOC_SIZE = 60000;`,
`const LIVE_RENDER_KEY = "ravtext.liveRender";
const RENDER_PAUSED_KEY = "ravtext.renderPaused.v1";
const LIVE_RENDER_MAX_DOC_SIZE = 60000;

function isRenderPaused() {
  try {
    return localStorage.getItem(RENDER_PAUSED_KEY) === "1";
  } catch (_) {
    return false;
  }
}`,
  `const RENDER_PAUSED_KEY = "ravtext.renderPaused.v1"`
);

patchOnce(
  "src/main.js",
  "live render respects pause",
`function shouldLiveRenderNow() {
  return isLiveRenderEnabled() && paneManagerDocSize() <= LIVE_RENDER_MAX_DOC_SIZE;
}`,
`function shouldLiveRenderNow() {
  return !isRenderPaused() && isLiveRenderEnabled() && paneManagerDocSize() <= LIVE_RENDER_MAX_DOC_SIZE;
}`,
  `return !isRenderPaused() && isLiveRenderEnabled()`
);

patchOnce(
  "src/main.js",
  "render pause controls",
`  label.appendChild(input);
  label.appendChild(document.createTextNode("רינדור חי"));
  targetGroup.appendChild(label);
}

function setupRibbonTabs() {`,
`  label.appendChild(input);
  label.appendChild(document.createTextNode("רינדור חי"));
  targetGroup.appendChild(label);
}

function updateRenderPauseButton() {
  const btn = document.getElementById("btn-render-pause");
  if (!btn) return;
  const paused = isRenderPaused();
  btn.classList.toggle("active", paused);
  btn.setAttribute("aria-pressed", paused ? "true" : "false");
  btn.textContent = paused ? "▶ המשך רינדור" : "⏸ השהה רינדור";
  btn.title = paused
    ? "הפעל מחדש רינדור אוטומטי אחרי עריכה"
    : "השהה רינדור אוטומטי בזמן שינוי כמה הגדרות יחד";
}

function setRenderPaused(paused, { notify = true } = {}) {
  try {
    localStorage.setItem(RENDER_PAUSED_KEY, paused ? "1" : "0");
  } catch (_) {}
  updateRenderPauseButton();
  if (notify) {
    showToast(paused
      ? "הרינדור האוטומטי הושהה. לחץ רנדר כשתרצה לעדכן את התצוגה."
      : "הרינדור האוטומטי הופעל מחדש.");
  }
  if (!paused && shouldLiveRenderNow()) rerenderPages();
}

function setupRenderPauseControls() {
  updateRenderPauseButton();
  window.addEventListener("storage", (ev) => {
    if (ev.key === RENDER_PAUSED_KEY) updateRenderPauseButton();
  });
}

function setupRibbonTabs() {`,
  `function setupRenderPauseControls()`
);

patchOnce(
  "src/main.js",
  "wire render pause controls",
`setupLiveRenderToggle();
wirePageSettingsControls(() => {`,
`setupLiveRenderToggle();
setupRenderPauseControls();
wirePageSettingsControls(() => {`,
  `setupRenderPauseControls();`
);

patchOnce(
  "src/main.js",
  "display settings reset function",
`document.querySelectorAll(".btn-stress").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mul = parseInt(btn.dataset.mul, 10);
    const big = Array(mul).fill(inlineSampleText).join("\n\n");
    loadEngineDoc(parseAuto(big));
  });
});

// === Toolbar ===`,
`document.querySelectorAll(".btn-stress").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mul = parseInt(btn.dataset.mul, 10);
    const big = Array(mul).fill(inlineSampleText).join("\n\n");
    loadEngineDoc(parseAuto(big));
  });
});

const DISPLAY_RESET_KEYS = [
  "ravtext.streamSettings.v1",
  "ravtext.globalStreamOverrides.v1",
  "ravtext.streamOrder.v1",
  "ravtext.talmudLayout",
  "ravtext.mishnaWrap",
  "ravtext.mishnaWrap.levels",
  "ravtext.spacing.v1",
  "ravtext.pageSettings.v1",
  "ravtext.documentStyle.v1",
  "ravtext.outputBackground",
  "ravtext.vilnaV9Beta",
  "ravtext.layout.autoOverflowSafety",
  RENDER_PAUSED_KEY,
];

const DISPLAY_RESET_PREFIXES = [
  "ravtext.talmudLayout.",
  "ravtext.mishnaWrap.",
  "ravtext.v9.",
  "ravtext.layout.",
  "ravtext.liveOverflow.",
];

function removeStorageKeys(storage, exactKeys, prefixes) {
  const removed = [];
  try {
    for (const key of exactKeys) {
      if (storage.getItem(key) !== null) {
        storage.removeItem(key);
        removed.push(key);
      }
    }
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    for (const key of keys) {
      if (!key) continue;
      if (prefixes.some(prefix => key.startsWith(prefix))) {
        storage.removeItem(key);
        removed.push(key);
      }
    }
  } catch (_) {}
  return removed;
}

function resetDisplaySettingsOnly() {
  const ok = confirm([
    "לאפס רק הגדרות תצוגה ורינדור?",
    "",
    "הטקסט והחלוניות לא יימחקו.",
    "יאופסו: הגדרות זרמים, גפ״ת/משנ״ב, ריווח, עימוד, מטמון עימוד והשהיית רינדור."
  ].join("\n"));
  if (!ok) return;

  const removed = [
    ...removeStorageKeys(localStorage, DISPLAY_RESET_KEYS, DISPLAY_RESET_PREFIXES),
    ...removeStorageKeys(sessionStorage, ["ravtext.layout.autoOverflowAttempts.v1"], DISPLAY_RESET_PREFIXES),
  ];
  try { delete window.__STREAM_SETTINGS__; } catch (_) {}
  try { delete window.__STREAM_LABELS__; } catch (_) {}
  try { resetLiveOverflowReserve(); } catch (_) {}
  updateRenderPauseButton();
  refreshStreamSettingsPanel();
  rerenderPages();
  showToast("איפוס תצוגה הושלם (" + removed.length + " הגדרות נוקו).");
}

// === Toolbar ===`,
  `function resetDisplaySettingsOnly()`
);

patchOnce(
  "src/main.js",
  "toolbar commands for render controls",
`    case "reset-system-state": {
      openResetSystemStateDialog();
      break;
    }`,
`    case "render-pause-toggle": {
      setRenderPaused(!isRenderPaused());
      break;
    }
    case "render-stop": {
      cancelEngineRender();
      showToast("הרינדור נעצר. אם צריך — לחץ רנדר כדי להתחיל מחדש.");
      break;
    }
    case "reset-display-settings": {
      resetDisplaySettingsOnly();
      break;
    }
    case "reset-system-state": {
      openResetSystemStateDialog();
      break;
    }`,
  `case "render-pause-toggle"`
);

patchOnce(
  "src/main.js",
  "diagnostics rendering checks",
`  const checks = [
    check(`,
`  let streamSettingsCount = 0;
  try { streamSettingsCount = Object.keys(JSON.parse(localStorage.getItem("ravtext.streamSettings.v1") || "{}") || {}).length; } catch (_) {}
  let staleKeys = [];
  try {
    staleKeys = ["ravtext.layout.autoOverflowSafety", "ravtext.layout.autoOverflowAttempts.v1"]
      .filter(k => localStorage.getItem(k) !== null || sessionStorage.getItem(k) !== null);
  } catch (_) {}
  const pageCount = pagesContainer?.querySelectorAll?.(".page:not(.page-placeholder)").length || 0;
  const talmudActive = (() => {
    try { return localStorage.getItem("ravtext.talmudLayout") === "1"; } catch (_) { return false; }
  })();
  const renderMode = talmudActive ? "גפ״ת / V9" : "רגיל";
  const fontsStatus = document.fonts?.status || "לא ידוע";

  const checks = [
    check(`,
  `const renderMode = talmudActive ? "גפ״ת / V9" : "רגיל";`
);

patchOnce(
  "src/main.js",
  "diagnostics extra rows",
`    check("RTL פעיל", true),
    check("גופן David מוטמע", paneManager.activePane && getComputedStyle(paneManager.activePane.element.querySelector(".pane-body")).fontFamily.includes("David")),`,
`    check("RTL פעיל", true),
    check("מנוע רינדור — " + renderMode, true, talmudActive ? "מסלול גפ״ת פעיל" : "מסלול רגיל פעיל"),
    check("רינדור חי — " + (isLiveRenderEnabled() ? (isRenderPaused() ? "מושהה" : "פעיל") : "כבוי"), true),
    check("עמודים מרונדרים — " + pageCount, true),
    check("הגדרות זרמים שמורות — " + streamSettingsCount, true),
    check("אין מפתחות עימוד ישנים ידועים", staleKeys.length === 0, staleKeys.length ? staleKeys.join(", ") : "נקי"),
    check("מצב טעינת פונטים — " + fontsStatus, true),
    check("גופן David מוטמע", paneManager.activePane && getComputedStyle(paneManager.activePane.element.querySelector(".pane-body")).fontFamily.includes("David")),`,
  `מנוע רינדור — ${renderMode}`
);

replaceAllSafe("src/original_stream_columns.js", [
  ["global bold override label", `boldOverrideEnabled: { label: "סגנון מותאם לבולד", type: "boolean", value: false }`, `boldOverrideEnabled: { label: "החלף טקסט מודגש בסגנון נבחר", type: "boolean", value: false }`],
  ["global bold override style label", `boldOverrideStyleId: { label: "סגנון לבולד", type: "style", value: "" }`, `boldOverrideStyleId: { label: "סגנון שיוחל על טקסט מודגש", type: "style", value: "" }`],
  ["global main ref label", `mainRefEnabled: { label: "מספר בראשי", type: "boolean", value: false }`, `mainRefEnabled: { label: "הצג מספר הפניה בתוך הטקסט הראשי", type: "boolean", value: false }`],
  ["global main ref bold label", `mainRefBold: { label: "ראשי מודגש", type: "boolean", value: false }`, `mainRefBold: { label: "מספר הפניה בראשי מודגש", type: "boolean", value: false }`],
  ["global note num label", `noteNumEnabled: { label: "מספר בהערה", type: "boolean", value: true }`, `noteNumEnabled: { label: "הצג מספר בתחילת ההערה", type: "boolean", value: true }`],
  ["global note num bold label", `noteNumBold: { label: "הערה מודגש", type: "boolean", value: false }`, `noteNumBold: { label: "מספר ההערה מודגש", type: "boolean", value: false }`],
  ["global lemma label", `lemmaBold: { label: "דיבור המתחיל מודגש", type: "boolean", value: true }`, `lemmaBold: { label: "דיבור המתחיל מודגש אוטומטית", type: "boolean", value: true }`],
  ["per stream bold checkbox", `makeCheckbox("סגנון מותאם לבולד", !!cur.boldOverrideEnabled`, `makeCheckbox("החלף טקסט מודגש בסגנון נבחר", !!cur.boldOverrideEnabled`],
  ["per stream bold style select", `makeStyleSelect("סגנון לבולד:", cur.boldOverrideStyleId || ""`, `makeStyleSelect("סגנון שיוחל על טקסט מודגש:", cur.boldOverrideStyleId || ""`],
  ["per stream main ref checkbox", `makeCheckbox("מספר בראשי", cur.mainRefEnabled !== undefined ? cur.mainRefEnabled : false`, `makeCheckbox("הצג מספר הפניה בתוך הטקסט הראשי", cur.mainRefEnabled !== undefined ? cur.mainRefEnabled : false`],
  ["per stream main bold checkbox", `makeCheckbox("ראשי מודגש", !!cur.mainRefBold`, `makeCheckbox("מספר הפניה בראשי מודגש", !!cur.mainRefBold`],
  ["per stream note num checkbox", `makeCheckbox("מספר בהערה", cur.noteNumEnabled !== false`, `makeCheckbox("הצג מספר בתחילת ההערה", cur.noteNumEnabled !== false`],
  ["per stream note bold checkbox", `makeCheckbox("הערה מודגש", !!cur.noteNumBold`, `makeCheckbox("מספר ההערה מודגש", !!cur.noteNumBold`],
  ["per stream lemma checkbox", `makeCheckbox('"דיבור המתחיל" מודגש', cur.lemmaBold !== false`, `makeCheckbox('"דיבור המתחיל" מודגש אוטומטית', cur.lemmaBold !== false`],
]);

patchOnce(
  "src/original_stream_columns.js",
  "bold explanation row",
`    // משה 2026-05-15: סגנון מותאם לבולד — מחליף את ההצגה הרגילה של בולד
    // (font-weight:700) בסגנון מהרשימה. ברירת מחדל = לא מסומן.
    block.appendChild(makeCheckbox("החלף טקסט מודגש בסגנון נבחר", !!cur.boldOverrideEnabled, (checked) => {`,
`    const boldHelp = document.createElement("span");
    boldHelp.className = "stream-settings-help";
    boldHelp.textContent = "הבהרה: בולד אמיתי הוא סימון B בעורך. דיבור המתחיל הוא הדגשה אוטומטית. האפשרות הבאה רק מחליפה איך טקסט שכבר מודגש נראה.";
    block.appendChild(boldHelp);

    // משה 2026-05-15: סגנון מותאם לבולד — מחליף את ההצגה הרגילה של בולד
    // (font-weight:700) בסגנון מהרשימה. ברירת מחדל = לא מסומן.
    block.appendChild(makeCheckbox("החלף טקסט מודגש בסגנון נבחר", !!cur.boldOverrideEnabled, (checked) => {`,
  `className = "stream-settings-help"`
);

appendOnce("styles.css", "ravtext-ui-safety patch", `

/* ravtext-ui-safety patch: clearer render controls + stream-settings help */
#btn-render-pause.active {
  background: #fff3cd;
  border-color: #d39e00;
  color: #4b3700;
  font-weight: 700;
}
#btn-render-stop {
  color: #8a1f11;
  font-weight: 700;
}
.stream-settings-help {
  display: inline-block;
  max-width: 520px;
  padding: 3px 7px;
  margin-inline: 4px;
  border: 1px solid var(--rt-line, #d7d0be);
  border-radius: 6px;
  background: var(--rt-surface-2, #fbf8ef);
  color: var(--rt-ink-2, #5a4d3a);
  font-size: 12px;
  line-height: 1.35;
}
`);

console.log("[ravtext-ui-safety] done");
