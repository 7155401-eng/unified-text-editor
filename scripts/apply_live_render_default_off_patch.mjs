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

function replaceBlock(source, name, pattern, replacement) {
  if (!pattern.test(source)) {
    throw new Error(`[live-render-default-off] ${name} anchor not found in src/main.js`);
  }

  return source.replace(pattern, replacement);
}

function patchLiveRenderDefault(source) {
  const functionPattern =
    /function\s+isLiveRenderEnabled\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+paneManagerDocSize\s*\()/;

  return replaceBlock(
    source,
    "isLiveRenderEnabled",
    functionPattern,
    `function isLiveRenderEnabled() {
  // Default OFF: live render is enabled only after the user explicitly enables it in the render menu.
  const userChoice = localStorage.getItem(LIVE_RENDER_KEY + ".userChoice") === "1";
  if (!userChoice) return false;
  const v = localStorage.getItem(LIVE_RENDER_KEY);
  return v === "1";
} `
  );
}

function patchLiveRenderMenuToggle(source) {
  const functionPattern =
    /function\s+setupLiveRenderToggle\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+setupRibbonTabs\s*\()/;

  return replaceBlock(
    source,
    "setupLiveRenderToggle",
    functionPattern,
    `function setupLiveRenderToggle() {
  const oldOrExisting = document.getElementById("live-render-toggle");
  if (oldOrExisting) {
    const correctControl = oldOrExisting.closest(".live-render-menu-control");
    if (correctControl && !oldOrExisting.closest(".ribbon-tab-render-slot")) {
      return;
    }

    const removable = oldOrExisting.closest(".live-render-menu-control, .toolbar-checkbox, label");
    removable?.remove();
  }

  const isTopRenderArea = (el) => {
    if (!el) return false;
    if (el.id === "btn-render") return true;
    return !!el.closest?.(".ribbon-tab-render-slot");
  };
  const isLowerRenderMenuArea = (el) => !!el && !isTopRenderArea(el);

  function installRetryHook() {
    if (document.documentElement.dataset.liveRenderToggleRetryHook === "1") return;
    document.documentElement.dataset.liveRenderToggleRetryHook = "1";

    document.addEventListener("click", (ev) => {
      const target = ev.target?.closest?.("button,[role='tab'],.ribbon-tab,.tab");
      if (!target) return;

      const text = (target.textContent || "") + " " + (target.title || "");
      if (/רנדר|רינדור/.test(text)) {
        setTimeout(setupLiveRenderToggle, 50);
        setTimeout(setupLiveRenderToggle, 250);
        setTimeout(setupLiveRenderToggle, 700);
      }
    }, true);
  }

  function findRenderMenuHost() {
    const ids = [
      "btn-render-pause",
      "btn-render-resume",
      "btn-render-diagnostics",
      "btn-reset-display-only",
      "btn-ravtext-snapshots",
    ];

    for (const id of ids) {
      const btn = document.getElementById(id);
      if (isLowerRenderMenuArea(btn)) {
        return btn.closest(".tb-group, .ribbon-panel, .toolbar, section, fieldset, div") || btn.parentElement;
      }
    }

    const renderTextPattern = /המשך רינדור|עצור רינדור|בדיקת רינדור|אפס תצוגה/;
    const renderButton = Array.from(document.querySelectorAll("button")).find((btn) => {
      if (!isLowerRenderMenuArea(btn)) return false;
      const text = (btn.textContent || "") + " " + (btn.title || "");
      return renderTextPattern.test(text);
    });
    if (renderButton) {
      return renderButton.closest(".tb-group, .ribbon-panel, .toolbar, section, fieldset, div") || renderButton.parentElement;
    }

    const groups = Array.from(document.querySelectorAll(".tb-group, .ribbon-panel, .toolbar, section, fieldset, div"))
      .filter(isLowerRenderMenuArea);
    const renderGroup = groups.find((group) => {
      const text = group.textContent || "";
      return /המשך רינדור|עצור רינדור|בדיקת רינדור|אפס תצוגה|אבחון ושחזור/.test(text);
    });
    if (renderGroup) return renderGroup;

    return null;
  }

  installRetryHook();

  const host = findRenderMenuHost();
  if (!host) {
    setupLiveRenderToggle._retries = (setupLiveRenderToggle._retries || 0) + 1;
    if (setupLiveRenderToggle._retries <= 80) {
      setTimeout(setupLiveRenderToggle, 250);
    } else {
      console.warn("[live-render-default-off] lower render menu host not found; live render toggle was not inserted");
    }
    return;
  }

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

    localStorage.setItem(LIVE_RENDER_KEY + ".userChoice", "1");
    localStorage.setItem(LIVE_RENDER_KEY, next ? "1" : "0");
    syncState();
    if (next && shouldLiveRenderNow()) rerenderPages();
  });

  wrap.appendChild(button);
  wrap.appendChild(warning);

  const anchor = [
    "btn-render-pause",
    "btn-render-resume",
    "btn-render-diagnostics",
    "btn-reset-display-only",
    "btn-ravtext-snapshots",
  ].map((id) => document.getElementById(id)).find((btn) => btn && host.contains(btn) && isLowerRenderMenuArea(btn));

  if (anchor) {
    anchor.insertAdjacentElement("afterend", wrap);
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
