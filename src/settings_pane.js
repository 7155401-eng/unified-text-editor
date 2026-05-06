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

const LOG_BUFFER_MAX = 5000; // entries
const _logBuffer = [];

export function logEvent(phase, detail = {}) {
  if (localStorage.getItem(STORAGE.saveLog) !== "1") return;
  _logBuffer.push({
    t: new Date().toISOString().slice(11, 23), // HH:MM:SS.mmm
    phase,
    ...detail,
  });
  if (_logBuffer.length > LOG_BUFFER_MAX) _logBuffer.shift();
  // Live update if pane is open and log textarea visible.
  const out = document.getElementById("settings-log-output");
  if (out && !out.hidden) {
    out.value = formatLog();
    out.scrollTop = out.scrollHeight;
  }
}

function formatLog() {
  return _logBuffer.map(e => {
    const detail = Object.entries(e)
      .filter(([k]) => k !== "t" && k !== "phase")
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
    return `[${e.t}] ${e.phase}${detail ? "  " + detail : ""}`;
  }).join("\n");
}

function applyDarkMode(enabled) {
  document.body.classList.toggle("dark-theme", enabled);
  document.body.classList.toggle("light-theme", !enabled);
  document.documentElement.dataset.theme = enabled ? "dark" : "light";
}

export function setupSettingsPane() {
  // Toggle open/close
  const toggle = document.getElementById("settings-toggle");
  const body = document.getElementById("settings-body");
  if (toggle && body) {
    toggle.addEventListener("click", () => {
      body.hidden = !body.hidden;
      toggle.classList.toggle("active", !body.hidden);
    });
  }

  // Dark mode
  const darkMode = document.getElementById("settings-dark-mode");
  if (darkMode) {
    const saved = localStorage.getItem(STORAGE.darkMode) === "1";
    darkMode.checked = saved;
    applyDarkMode(saved);
    darkMode.addEventListener("change", () => {
      localStorage.setItem(STORAGE.darkMode, darkMode.checked ? "1" : "0");
      applyDarkMode(darkMode.checked);
    });
  }

  // Language
  const langSelect = document.getElementById("settings-language");
  if (langSelect) {
    const saved = localStorage.getItem(STORAGE.language) || "he";
    langSelect.value = saved;
    langSelect.addEventListener("change", () => {
      const newLang = langSelect.value;
      localStorage.setItem(STORAGE.language, newLang);
      try { applyLanguage(newLang); } catch (_) {}
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
