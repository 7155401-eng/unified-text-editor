// settings_pane.js — display + dark mode + language + render log toggle.
//
// Independent UI section below the editor. Controls:
//   - Dark mode toggle (settings-dark-mode)
//   - Language select (settings-language) — he / en
//   - License status placeholder (settings-license-status)
//   - Save render log toggle (settings-save-log) — when ON, captures every
//     render pipeline phase (engine, talmud_layout, mishna, opening_word,
//     etc.) into an in-memory ring buffer. Buttons to copy/download/clear.

import { applyLanguage, toggleLanguage } from "./i18n.js";

const STORAGE = {
  darkMode: "ravtext.settings.darkMode",
  language: "ravtext.settings.language",
  saveLog:  "ravtext.settings.saveRenderLog",
};

const LOG_BUFFER_MAX = 50000; // big enough for full-detail per-element traces
const _logBuffer = [];

export function isLogActive() {
  return localStorage.getItem(STORAGE.saveLog) === "1";
}

function liveUpdateLogTextarea() {
  const out = document.getElementById("settings-log-output");
  if (out && !out.hidden) {
    out.value = formatLog();
    out.scrollTop = out.scrollHeight;
  }
}

export function logEvent(phase, detail = {}) {
  if (!isLogActive()) return;
  _logBuffer.push({
    t: new Date().toISOString().slice(11, 23),
    phase,
    ...detail,
  });
  if (_logBuffer.length > LOG_BUFFER_MAX) _logBuffer.shift();
  liveUpdateLogTextarea();
}

/**
 * v33: log a rule violation as ERROR with full diagnostic info.
 * Used to trace why a fix didn't work — every time a rule is broken,
 * we record what rule, what element, what was expected vs actual.
 */
export function logViolation(rule, opts = {}) {
  if (!isLogActive()) return;
  const { el, expected, actual, attemptedFix, why } = opts;
  const elInfo = el && el.tagName ? {
    tag: el.tagName,
    cls: (el.className || "").slice(0, 80),
    stream: el.getAttribute?.("data-stream") || null,
    text: ((el.textContent || "").slice(0, 60).trim()).replace(/\s+/g, " "),
  } : null;
  _logBuffer.push({
    t: new Date().toISOString().slice(11, 23),
    phase: "ERROR",
    rule,
    el: elInfo,
    expected, actual, attemptedFix, why,
  });
  if (_logBuffer.length > LOG_BUFFER_MAX) _logBuffer.shift();
  liveUpdateLogTextarea();
}

/**
 * v33: detailed per-element movement log. Captures: action verb, what element
 * (cls/data-stream/data-talmud-*), source location, destination location,
 * text preview (first/last 40 chars), trigger phase.
 */
export function logMove(action, opts = {}) {
  if (!isLogActive()) return;
  const { el, fromPage, toPage, fromIdx, toIdx, trigger, textBefore, textAfter, reason } = opts;
  const elInfo = el ? {
    tag: el.tagName,
    cls: (el.className || "").slice(0, 80),
    stream: el.getAttribute?.("data-stream") || null,
    bodyOf: el.dataset?.talmudBodyOf || null,
    role: el.dataset?.talmudRole || null,
    text: ((el.textContent || "").slice(0, 60).trim()).replace(/\s+/g, " "),
    height: el.getBoundingClientRect ? Math.round(el.getBoundingClientRect().height) : null,
  } : null;
  _logBuffer.push({
    t: new Date().toISOString().slice(11, 23),
    phase: "MOVE",
    action,
    el: elInfo,
    fromPage, toPage,
    fromIdx, toIdx,
    trigger, reason,
    textBefore, textAfter,
  });
  if (_logBuffer.length > LOG_BUFFER_MAX) _logBuffer.shift();
  liveUpdateLogTextarea();
}

function formatLog() {
  return _logBuffer.map(e => {
    if (e.phase === "MOVE") {
      // Multi-line detailed format for moves.
      const head = `[${e.t}] MOVE  action=${e.action}  trigger=${e.trigger || "-"}`;
      const elPart = e.el
        ? `\n        <${e.el.tag}.${e.el.cls}> stream=${e.el.stream || "-"} role=${e.el.role || "-"} h=${e.el.height || "-"}px`
        : "";
      const text = e.el?.text ? `\n        text="${e.el.text}"` : "";
      const route = (e.fromPage !== undefined || e.toPage !== undefined)
        ? `\n        from=page${e.fromPage}${e.fromIdx !== undefined ? `[${e.fromIdx}]` : ""}  →  page${e.toPage}${e.toIdx !== undefined ? `[${e.toIdx}]` : ""}`
        : "";
      const reason = e.reason ? `\n        reason: ${e.reason}` : "";
      return head + elPart + text + route + reason;
    }
    const detail = Object.entries(e)
      .filter(([k]) => k !== "t" && k !== "phase")
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
    return `[${e.t}] ${e.phase}${detail ? "  " + detail : ""}`;
  }).join("\n");
}

function applyDarkMode(enabled) {
  // legacy class for older selectors
  document.body.classList.toggle("dark-theme", enabled);
  document.body.classList.toggle("light-theme", !enabled);
  document.documentElement.dataset.theme = enabled ? "dark" : "light";
  // v33: also set data-theme on body for the new var-based theming.
  if (enabled) {
    document.body.dataset.theme = "dark";
  } else if (document.body.dataset.theme === "dark") {
    delete document.body.dataset.theme;
  }
}

function applyTheme(themeId) {
  if (!themeId) {
    delete document.body.dataset.theme;
  } else {
    document.body.dataset.theme = themeId;
  }
  // Sync dark mode checkbox with theme
  const dm = document.getElementById("settings-dark-mode");
  if (dm) dm.checked = (themeId === "dark");
}

export function setupSettingsPane() {
  // v33: settings now lives as a ribbon panel — visibility is controlled
  // by the ribbon tab system. No toggle button needed.
  // Move panel content into the wrap that's positioned where ribbon-panels go.
  const panel = document.getElementById("settings-panel");
  const wrap = document.getElementById("settings-panel-wrap");
  if (panel && wrap && !wrap.contains(panel)) {
    wrap.appendChild(panel);
  }

  // Theme select (multi-theme)
  const themeSelect = document.getElementById("settings-theme");
  if (themeSelect) {
    const savedTheme = localStorage.getItem("ravtext.settings.theme") || "";
    themeSelect.value = savedTheme;
    applyTheme(savedTheme);
    themeSelect.addEventListener("change", () => {
      localStorage.setItem("ravtext.settings.theme", themeSelect.value);
      applyTheme(themeSelect.value);
    });
  }

  // Dark mode (shortcut — also drives the theme select)
  const darkMode = document.getElementById("settings-dark-mode");
  if (darkMode) {
    const saved = localStorage.getItem(STORAGE.darkMode) === "1";
    darkMode.checked = saved;
    if (saved) applyTheme("dark");
    darkMode.addEventListener("change", () => {
      localStorage.setItem(STORAGE.darkMode, darkMode.checked ? "1" : "0");
      if (darkMode.checked) {
        applyTheme("dark");
        if (themeSelect) themeSelect.value = "dark";
        localStorage.setItem("ravtext.settings.theme", "dark");
      } else {
        applyTheme("");
        if (themeSelect) themeSelect.value = "";
        localStorage.setItem("ravtext.settings.theme", "");
      }
    });
  }

  // Language — sync with the actual i18n storage key (ravtext.lang).
  const langSelect = document.getElementById("settings-language");
  if (langSelect) {
    const saved = localStorage.getItem("ravtext.lang") || localStorage.getItem(STORAGE.language) || "he";
    langSelect.value = saved;
    langSelect.addEventListener("change", () => {
      const newLang = langSelect.value;
      localStorage.setItem(STORAGE.language, newLang);
      localStorage.setItem("ravtext.lang", newLang);
      try { applyLanguage(newLang); } catch (e) { console.error("applyLanguage failed:", e); }
    });
  }

  // Save log toggle
  const saveLog = document.getElementById("settings-save-log");
  const logControls = document.getElementById("settings-log-controls");
  const logOutput = document.getElementById("settings-log-output");
  if (saveLog) {
    const saved = localStorage.getItem(STORAGE.saveLog) === "1";
    saveLog.checked = saved;
    if (logControls) logControls.hidden = !saved;
    if (logOutput) {
      logOutput.hidden = !saved;
      if (saved) logOutput.value = formatLog();
    }
    saveLog.addEventListener("change", () => {
      localStorage.setItem(STORAGE.saveLog, saveLog.checked ? "1" : "0");
      if (logControls) logControls.hidden = !saveLog.checked;
      if (logOutput) {
        logOutput.hidden = !saveLog.checked;
        if (saveLog.checked) logOutput.value = formatLog();
      }
    });
  }

  // Copy log
  document.getElementById("settings-log-copy")?.addEventListener("click", async () => {
    const text = formatLog();
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById("settings-log-copy");
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = "✓ הועתק";
        setTimeout(() => (btn.textContent = orig), 1500);
      }
    } catch (e) {
      alert("שגיאת העתקה: " + e.message);
    }
  });

  // Download log
  document.getElementById("settings-log-download")?.addEventListener("click", () => {
    const text = formatLog();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `ravtext-render-log-${ts}.txt`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  });

  // Clear log
  document.getElementById("settings-log-clear")?.addEventListener("click", () => {
    _logBuffer.length = 0;
    const out = document.getElementById("settings-log-output");
    if (out) out.value = "";
  });
}

export function isLoggingEnabled() {
  return localStorage.getItem(STORAGE.saveLog) === "1";
}
