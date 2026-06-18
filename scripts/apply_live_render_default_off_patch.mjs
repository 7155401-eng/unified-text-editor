import fs from "node:fs";

const MAIN_TARGET = "src/main.js";
const PAUSE_TARGET = "src/render_pause_controls.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after === before) {
    console.log(`[live-render-default-off] no changes needed for ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[live-render-default-off] patched ${path}`);
}

function replaceRequired(source, name, pattern, replacement) {
  if (!pattern.test(source)) throw new Error(`[live-render-default-off] ${name} anchor not found`);
  return source.replace(pattern, replacement);
}

function patchMain(source) {
  let next = source;
  next = replaceRequired(
    next,
    "main isLiveRenderEnabled",
    /function\s+isLiveRenderEnabled\s*\([^)]*\)\s*\{[\s\S]*?\}\s*(?=function\s+paneManagerDocSize\s*\()/,
    "function isLiveRenderEnabled() {\n  try {\n    const userChoice = localStorage.getItem(LIVE_RENDER_KEY + \".userChoice\") === \"1\";\n    return userChoice && localStorage.getItem(LIVE_RENDER_KEY) === \"1\";\n  } catch (_) {\n    return false;\n  }\n} "
  );
  next = replaceRequired(
    next,
    "main setupLiveRenderToggle",
    /function\s+setupLiveRenderToggle\s*\([^)]*\)\s*\{[\s\S]*?\}\s*(?=function\s+setupRibbonTabs\s*\()/,
    "function setupLiveRenderToggle() {\n  const oldToggle = document.getElementById(\"live-render-toggle\");\n  const oldControl = oldToggle?.closest?.(\".toolbar-checkbox, .live-render-control, label\");\n  oldControl?.remove?.();\n} "
  );
  return next;
}

const LIVE_TOGGLE_HELPER = "  function ensureLiveRenderToggleButton() {\n    const render = renderButton();\n    const pause = pauseButton();\n    const host = render?.parentElement || pause?.parentElement;\n    if (!host) return;\n\n    function renderMenuAnchor() {\n      const ids = new Set([\"btn-render\", \"btn-render-pause\", \"btn-render-resume\", \"btn-render-diagnostics\", \"btn-reset-display-only\", \"btn-ravtext-snapshots\"]);\n      const controls = Array.from(host.children).filter((el) => ids.has(el.id));\n      return controls[controls.length - 1] || pause || render;\n    }\n\n    function place(wrap) {\n      wrap.classList.add(\"live-render-menu-control\", \"live-render-pause-control\");\n      wrap.dir = \"rtl\";\n      wrap.style.cssText = \"display:inline-flex;align-items:center;gap:6px;margin-inline-start:8px;white-space:nowrap;font-size:12px;\";\n      const anchor = renderMenuAnchor();\n      if (anchor && anchor.parentElement === host) {\n        if (anchor.nextElementSibling !== wrap) anchor.insertAdjacentElement(\"afterend\", wrap);\n      } else if (wrap.parentElement !== host) {\n        host.appendChild(wrap);\n      }\n    }\n\n    const existingBtn = byId(\"live-render-toggle-button\");\n    const existingWrap = existingBtn?.closest?.(\".live-render-menu-control\") || null;\n    if (existingWrap) {\n      place(existingWrap);\n      return;\n    }\n\n    const wrap = document.createElement(\"span\");\n    wrap.className = \"live-render-menu-control live-render-pause-control\";\n\n    const btn = document.createElement(\"button\");\n    btn.type = \"button\";\n    btn.id = \"live-render-toggle-button\";\n    btn.className = \"live-render-toggle-btn\";\n    btn.style.cssText = \"white-space:nowrap;\";\n\n    const warning = document.createElement(\"span\");\n    warning.className = \"live-render-warning\";\n    warning.textContent = \"⚠ עלול להאט או לתקוע במסמכים גדולים\";\n    warning.style.cssText = \"opacity:.78;font-size:11px;\";\n\n    function paintLiveToggle() {\n      const enabled = liveEnabled();\n      btn.classList.toggle(\"active\", enabled);\n      btn.setAttribute(\"aria-pressed\", enabled ? \"true\" : \"false\");\n      btn.textContent = enabled ? \"רינדור אוטומטי: פעיל\" : \"רינדור אוטומטי: כבוי\";\n      btn.title = enabled\n        ? \"לחץ כדי לכבות רינדור אוטומטי אחרי כל שינוי\"\n        : \"לחץ כדי להפעיל רינדור אוטומטי אחרי כל שינוי. עלול להאט או לתקוע במסמכים גדולים.\";\n    }\n\n    btn.addEventListener(\"click\", () => {\n      const next = !liveEnabled();\n      if (next) {\n        const ok = confirm(\"רינדור אוטומטי לאחר כל שינוי עלול להאט ואף לתקוע את העריכה במסמכים גדולים. להפעיל בכל זאת?\");\n        if (!ok) return;\n      }\n\n      setLiveEnabled(next, { userChoice: true });\n      paintLiveToggle();\n      if (next) {\n        try { renderButton()?.click(); } catch (_) {}\n      }\n    });\n\n    wrap.appendChild(btn);\n    wrap.appendChild(warning);\n    place(wrap);\n    paintLiveToggle();\n  }\n\n";

function patchPauseControls(source) {
  let next = source;

  next = replaceRequired(
    next,
    "pause controls liveEnabled",
    /function\s+liveEnabled\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+setLiveEnabled\s*\()/,
    "function liveEnabled() {\n    try {\n      const userChoice = localStorage.getItem(LIVE_KEY + \".userChoice\") === \"1\";\n      return userChoice && localStorage.getItem(LIVE_KEY) === \"1\";\n    } catch (_) {\n      return false;\n    }\n  }\n  "
  );

  next = replaceRequired(
    next,
    "pause controls setLiveEnabled",
    /function\s+setLiveEnabled\s*\(\s*on(?:\s*,\s*options\s*=\s*\{\})?\s*\)\s*\{[\s\S]*?\}\s*(?=function\s+snapshotPreview\s*\()/,
    "function setLiveEnabled(on, options = {}) {\n    try {\n      if (options.userChoice) localStorage.setItem(LIVE_KEY + \".userChoice\", \"1\");\n      localStorage.setItem(LIVE_KEY, on ? \"1\" : \"0\");\n    } catch (_) {}\n\n    const oldCheckbox = byId(\"live-render-toggle\");\n    if (oldCheckbox && \"checked\" in oldCheckbox) oldCheckbox.checked = !!on;\n\n    const btn = byId(\"live-render-toggle-button\");\n    if (btn) {\n      btn.classList.toggle(\"active\", !!on);\n      btn.setAttribute(\"aria-pressed\", on ? \"true\" : \"false\");\n      btn.textContent = on ? \"רינדור אוטומטי: פעיל\" : \"רינדור אוטומטי: כבוי\";\n    }\n  }\n  "
  );

  if (!next.includes("LIVE_RENDER_DEFAULT_OFF_GUARD")) {
    next = next.replace("const STOP_GUARD_MS = 15000;", "const STOP_GUARD_MS = 15000;\n  const LIVE_RENDER_DEFAULT_OFF_GUARD = \"__ravtextLiveRenderDefaultOffGuard\";\n\n  try {\n    if (!window[LIVE_RENDER_DEFAULT_OFF_GUARD]) {\n      window[LIVE_RENDER_DEFAULT_OFF_GUARD] = true;\n      if (localStorage.getItem(LIVE_KEY + \".userChoice\") !== \"1\") {\n        localStorage.setItem(LIVE_KEY, \"0\");\n      }\n    }\n  } catch (_) {}");
  }

  if (!next.includes("function ensureLiveRenderToggleButton()")) {
    next = next.replace("  function wireButtons()", LIVE_TOGGLE_HELPER + "  function wireButtons()");
  }

  next = replaceRequired(
    next,
    "pause controls wireButtons",
    /function\s+wireButtons\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+installNow\s*\()/,
    (match) => match.includes("ensureLiveRenderToggleButton();")
      ? match
      : match.replace("ensurePauseButton();", "ensurePauseButton();\n    ensureLiveRenderToggleButton();")
  );

  if (!next.includes("ensureLiveRenderToggleButton();")) {
    throw new Error("[live-render-default-off] ensureLiveRenderToggleButton call was not inserted");
  }

  return next;
}

function patchFile(path, patcher) {
  const before = readFile(path);
  const after = patcher(before);
  writeIfChanged(path, before, after);
}

patchFile(MAIN_TARGET, patchMain);
patchFile(PAUSE_TARGET, patchPauseControls);
