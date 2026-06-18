import fs from "node:fs";

const MAIN_TARGET = "src/main.js";
const PAUSE_TARGET = "src/render_pause_controls.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after === before) {
    console.log(`[live-render-default-off] no changes needed for ${path}`);
    return false;
  }

  fs.writeFileSync(path, after);
  console.log(`[live-render-default-off] patched ${path}`);
  return true;
}

function replaceFunctionBefore(source, name, nextName, replacement) {
  const pattern = new RegExp(
    `function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}\\s*(?=function\\s+${nextName}\\s*\\()`
  );

  if (!pattern.test(source)) {
    throw new Error(`[live-render-default-off] ${name} anchor not found`);
  }

  return source.replace(pattern, replacement);
}

function patchMain(source) {
  let next = source;

  next = replaceFunctionBefore(
    next,
    "isLiveRenderEnabled",
    "paneManagerDocSize",
    `function isLiveRenderEnabled() {
  // Default OFF: live render is enabled only after the user explicitly enables it in the render menu.
  try {
    const userChoice = localStorage.getItem(LIVE_RENDER_KEY + ".userChoice") === "1";
    return userChoice && localStorage.getItem(LIVE_RENDER_KEY) === "1";
  } catch (_) {
    return false;
  }
} `
  );

  next = replaceFunctionBefore(
    next,
    "setupLiveRenderToggle",
    "setupRibbonTabs",
    `function setupLiveRenderToggle() {
  // The live render toggle is installed by render_pause_controls.js inside the lower render menu.
  // Remove the old checkbox if an older build or cached DOM inserted it in the top toolbar.
  const oldToggle = document.getElementById("live-render-toggle");
  const oldControl = oldToggle?.closest?.(".toolbar-checkbox, .live-render-control, label");
  oldControl?.remove?.();
} `
  );

  return next;
}

function patchPauseControlsDefault(source) {
  let next = source;

  next = next.replace(
    /function\s+liveEnabled\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+setLiveEnabled\s*\()/,
    `function liveEnabled() {
    try {
      const userChoice = localStorage.getItem(LIVE_KEY + ".userChoice") === "1";
      return userChoice && localStorage.getItem(LIVE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }
  `
  );

  next = next.replace(
    /function\s+setLiveEnabled\s*\(\s*on(?:\s*,\s*options\s*=\s*\{\})?\s*\)\s*\{[\s\S]*?\}\s*(?=function\s+snapshotPreview\s*\()/,
    `function setLiveEnabled(on, options = {}) {
    try {
      if (options.userChoice) localStorage.setItem(LIVE_KEY + ".userChoice", "1");
      localStorage.setItem(LIVE_KEY, on ? "1" : "0");
    } catch (_) {}

    const oldCheckbox = byId("live-render-toggle");
    if (oldCheckbox && "checked" in oldCheckbox) oldCheckbox.checked = !!on;

    const btn = byId("live-render-toggle-button");
    if (btn) {
      btn.classList.toggle("active", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "רינדור אוטומטי: פעיל" : "רינדור אוטומטי: כבוי";
    }
  }
  `
  );

  if (!/function\s+liveEnabled\s*\(\)\s*\{[\s\S]*?userChoice[\s\S]*?LIVE_KEY[\s\S]*?\}/.test(next)) {
    throw new Error("[live-render-default-off] render_pause_controls liveEnabled patch failed");
  }

  if (!/function\s+setLiveEnabled\s*\(\s*on,\s*options\s*=\s*\{\}\s*\)/.test(next)) {
    throw new Error("[live-render-default-off] render_pause_controls setLiveEnabled patch failed");
  }

  if (!next.includes("LIVE_RENDER_DEFAULT_OFF_GUARD")) {
    const guard = `const STOP_GUARD_MS = 15000;
  const LIVE_RENDER_DEFAULT_OFF_GUARD = "__ravtextLiveRenderDefaultOffGuard";

  try {
    if (!window[LIVE_RENDER_DEFAULT_OFF_GUARD]) {
      window[LIVE_RENDER_DEFAULT_OFF_GUARD] = true;
      if (localStorage.getItem(LIVE_KEY + ".userChoice") !== "1") {
        localStorage.setItem(LIVE_KEY, "0");
      }
    }
  } catch (_) {}`;
    next = next.replace("const STOP_GUARD_MS = 15000;", guard);
  }

  return next;
}

function liveRenderToggleHelper() {
  return `
  function ensureLiveRenderToggleButton() {
    const render = renderButton();
    const pause = pauseButton();
    const host = render?.parentElement || pause?.parentElement;
    if (!host) return;

    function renderMenuAnchor() {
      const renderControlIds = new Set([
        "btn-render",
        "btn-render-pause",
        "btn-render-resume",
        "btn-render-diagnostics",
        "btn-reset-display-only",
        "btn-ravtext-snapshots",
      ]);

      const controlsInDomOrder = Array.from(host.children).filter((el) => renderControlIds.has(el.id));
      return controlsInDomOrder[controlsInDomOrder.length - 1] || pause || render;
    }

    function placeLiveRenderControl(wrap) {
      wrap.classList.add("live-render-menu-control", "live-render-pause-control");
      wrap.dir = "rtl";
      wrap.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin-inline-start:8px;white-space:nowrap;font-size:12px;";

      const anchor = renderMenuAnchor();
      if (anchor && anchor.parentElement === host) {
        if (anchor.nextElementSibling !== wrap) anchor.insertAdjacentElement("afterend", wrap);
      } else if (wrap.parentElement !== host) {
        host.appendChild(wrap);
      }
    }

    const existingButton = byId("live-render-toggle-button");
    const existingWrap = existingButton?.closest?.(".live-render-menu-control") || null;
    if (existingWrap) {
      placeLiveRenderControl(existingWrap);
      return;
    }

    const wrap = document.createElement("span");
    wrap.className = "live-render-menu-control live-render-pause-control";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "live-render-toggle-button";
    btn.className = "live-render-toggle-btn";
    btn.style.cssText = "white-space:nowrap;";

    const warning = document.createElement("span");
    warning.className = "live-render-warning";
    warning.textContent = "⚠ עלול להאט או לתקוע במסמכים גדולים";
    warning.style.cssText = "opacity:.78;font-size:11px;";

    function paintLiveToggle() {
      const enabled = liveEnabled();
      btn.classList.toggle("active", enabled);
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.textContent = enabled ? "רינדור אוטומטי: פעיל" : "רינדור אוטומטי: כבוי";
      btn.title = enabled
        ? "לחץ כדי לכבות רינדור אוטומטי אחרי כל שינוי"
        : "לחץ כדי להפעיל רינדור אוטומטי אחרי כל שינוי. עלול להאט או לתקוע במסמכים גדולים.";
    }

    btn.addEventListener("click", () => {
      const next = !liveEnabled();
      if (next) {
        const ok = confirm("רינדור אוטומטי לאחר כל שינוי עלול להאט ואף לתקוע את העריכה במסמכים גדולים. להפעיל בכל זאת?");
        if (!ok) return;
      }

      setLiveEnabled(next, { userChoice: true });
      paintLiveToggle();

      if (next) {
        try { renderButton()?.click(); } catch (_) {}
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(warning);

    placeLiveRenderControl(wrap);
    paintLiveToggle();
  }

;
}

function patchPauseControlsToggleUi(source) {
  let next = source;

  if (!next.includes("function ensureLiveRenderToggleButton()")) {
    next = next.replace("  function wireButtons()", liveRenderToggleHelper() + "  function wireButtons()");
  }

  next = next.replace(
    /function\s+wireButtons\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+installNow\s*\()/,
    (match) => {
      if (match.includes("ensureLiveRenderToggleButton();")) return match;
      return match.replace("ensurePauseButton();", "ensurePauseButton();\n    ensureLiveRenderToggleButton();");
    }
  );

  if (!next.includes("ensureLiveRenderToggleButton();")) {
    throw new Error("[live-render-default-off] ensureLiveRenderToggleButton call was not inserted");
  }

  return next;
}

function patchPauseControls(source) {
  let next = patchPauseControlsDefault(source);
  next = patchPauseControlsToggleUi(next);
  return next;
}

function patchFile(path, patcher) {
  const before = readFile(path);
  const after = patcher(before);
  writeIfChanged(path, before, after);
}

patchFile(MAIN_TARGET, patchMain);
patchFile(PAUSE_TARGET, patchPauseControls);
