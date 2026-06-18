import fs from "node:fs";

const TARGET = "src/main.js";

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

function patchLiveRenderDefault(source) {
  const alreadyOff = /return\s+v\s*===\s*null\s*\?\s*false\s*:\s*v\s*===\s*["']1["']\s*;/.test(source);
  if (alreadyOff) return source;

  const returnDefaultPattern = /return\s+v\s*===\s*null\s*\?\s*true\s*:\s*v\s*===\s*["']1["']\s*;/;
  if (returnDefaultPattern.test(source)) {
    return source.replace(returnDefaultPattern, 'return v === null ? false : v === "1";');
  }

  const functionPattern = /function\s+isLiveRenderEnabled\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+paneManagerDocSize\s*\()/;
  if (functionPattern.test(source)) {
    return source.replace(
      functionPattern,
      `function isLiveRenderEnabled() {
  // Default OFF: live render runs only after the user enables it in the render menu.
  const v = localStorage.getItem(LIVE_RENDER_KEY);
  return v === null ? false : v === "1";
} `
    );
  }

  console.warn("[live-render-default-off] live render default anchor not found in src/main.js; leaving default unchanged");
  return source;
}

function patchLiveRenderMenuToggle(source) {
  const functionPattern = /function\s+setupLiveRenderToggle\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+setupRibbonTabs\s*\()/;
  if (!functionPattern.test(source)) {
    console.warn("[live-render-default-off] live render toggle UI anchor not found in src/main.js; leaving UI unchanged");
    return source;
  }

  return source.replace(
    functionPattern,
    `function setupLiveRenderToggle() {
  if (document.getElementById("live-render-toggle")) return;

  const renderBtn = document.getElementById("btn-render");
  const renderSlot = document.querySelector(".ribbon-tab-render-slot");
  const mainToolbar = getMainRibbonToolbar();
  const fallbackGroups = mainToolbar?.querySelectorAll(".tb-group") || [];
  const fallbackGroup = fallbackGroups[10] || fallbackGroups[fallbackGroups.length - 1] || null;
  const host = renderSlot || renderBtn?.parentElement || fallbackGroup;
  if (!host) return;

  const wrap = document.createElement("div");
  wrap.className = "live-render-menu-control";
  wrap.dir = "rtl";
  wrap.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin-inline-start:8px;white-space:nowrap;font-size:12px;";

  const button = document.createElement("button");
  button.type = "button";
  button.id = "live-render-toggle";
  button.className = "live-render-toggle-btn";

  const warning = document.createElement("span");
  warning.className = "live-render-warning";
  warning.textContent = "⚠ עלול להאט או לתקוע במסמכים גדולים";
  warning.style.cssText = "opacity:.78;font-size:11px;";

  function syncState() {
    const enabled = isLiveRenderEnabled();
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.textContent = enabled ? "רינדור אוטומטי: פעיל" : "רינדור אוטומטי: כבוי";
    button.title = enabled
      ? "לחץ כדי לכבות רינדור אוטומטי אחרי כל שינוי"
      : "לחץ כדי להפעיל רינדור אוטומטי אחרי כל שינוי. עלול להאט או לתקוע במסמכים גדולים.";
  }

  button.addEventListener("click", () => {
    const next = !isLiveRenderEnabled();

    if (next) {
      const ok = confirm("רינדור אוטומטי לאחר כל שינוי עלול להאט ואף לתקוע את העריכה במסמכים גדולים. להפעיל בכל זאת?");
      if (!ok) return;
    }

    localStorage.setItem(LIVE_RENDER_KEY, next ? "1" : "0");
    syncState();
    if (next && shouldLiveRenderNow()) rerenderPages();
  });

  wrap.appendChild(button);
  wrap.appendChild(warning);

  if (renderBtn && renderBtn.parentElement === host) {
    renderBtn.insertAdjacentElement("afterend", wrap);
  } else {
    host.appendChild(wrap);
  }

  syncState();
} `
  );
}

const before = readFile(TARGET);
let after = patchLiveRenderDefault(before);
after = patchLiveRenderMenuToggle(after);
writeIfChanged(TARGET, before, after);
