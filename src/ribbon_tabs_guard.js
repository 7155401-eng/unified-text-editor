// Runtime guard for the Word-style ribbon tabs.
// Keeps every active tab on one visual level by hiding empty toolbar rows
// and separators that belong to hidden groups.
let installed = false;
let queued = false;
let observer = null;

const STYLE_ID = "ravtext-ribbon-tabs-guard-style";
const HIDDEN_SEP_CLASS = "ribbon-guard-hidden-sep";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#main-ribbon-toolbar.ribbon-toolbar-empty {
  display: none !important;
  min-height: 0 !important;
  height: 0 !important;
  padding-block: 0 !important;
  margin-block: 0 !important;
  border: 0 !important;
}
#main-ribbon-toolbar .sep.${HIDDEN_SEP_CLASS} {
  display: none !important;
}
`;
  document.head.appendChild(style);
}

function tabTokens(el) {
  return String(el?.dataset?.ribbonTab || "home")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesTab(el, active) {
  return tabTokens(el).includes(active);
}

function hasVisibleContent(group) {
  if (!group || group.hidden || group.classList.contains("ribbon-hidden")) return false;
  if (group.matches("[aria-hidden='true']")) return false;
  return Array.from(group.children).some((child) => {
    if (child.hidden || child.classList.contains("ribbon-hidden")) return false;
    const style = window.getComputedStyle(child);
    return style.display !== "none" && style.visibility !== "hidden";
  }) || group.textContent.trim().length > 0;
}

function syncRibbonTabs() {
  const toolbar = document.getElementById("main-ribbon-toolbar");
  const tabsBar = document.getElementById("ribbon-tabs");
  if (!toolbar || !tabsBar) return false;

  const active =
    tabsBar.querySelector(".ribbon-tab.active")?.dataset?.ribbonTab ||
    localStorage.getItem("ravtext.ribbonTab") ||
    "home";

  const groups = Array.from(toolbar.querySelectorAll(":scope > .tb-group"));
  for (const group of groups) {
    group.classList.toggle("ribbon-hidden", !matchesTab(group, active));
  }

  const visibleGroups = groups.filter(hasVisibleContent);
  const visibleGroupSet = new Set(visibleGroups);
  const children = Array.from(toolbar.children);

  children.forEach((child, index) => {
    if (!child.classList.contains("sep")) return;
    const hasBefore = children.slice(0, index).some((el) => visibleGroupSet.has(el));
    const hasAfter = children.slice(index + 1).some((el) => visibleGroupSet.has(el));
    child.classList.toggle(HIDDEN_SEP_CLASS, !(hasBefore && hasAfter));
  });

  toolbar.classList.toggle("ribbon-toolbar-empty", visibleGroups.length === 0);
  toolbar.dataset.ribbonActiveTab = active;

  document.querySelectorAll(".ribbon-panel").forEach((panel) => {
    panel.classList.toggle("ribbon-hidden", !matchesTab(panel, active));
  });

  return true;
}

function queueSync() {
  if (queued) return;
  queued = true;
  const run = () => {
    queued = false;
    try {
      syncRibbonTabs();
    } catch (err) {
      console.warn("[ribbon-tabs-guard] sync failed", err);
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function attachObserver() {
  const toolbar = document.getElementById("main-ribbon-toolbar");
  const tabsBar = document.getElementById("ribbon-tabs");
  if (!toolbar || !tabsBar || typeof MutationObserver === "undefined") return false;

  observer?.disconnect();
  observer = new MutationObserver(queueSync);
  observer.observe(tabsBar, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "aria-selected"] });
  observer.observe(toolbar, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "hidden", "style", "data-ribbon-tab"] });
  document.querySelectorAll(".ribbon-panel").forEach((panel) => {
    observer.observe(panel, { attributes: true, attributeFilter: ["class", "hidden", "style", "data-ribbon-tab"] });
  });
  return true;
}

export function installRibbonTabsGuard() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  ensureStyle();

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.(".ribbon-tab, #ribbon-collapse-toggle, #ribbon-tabs")) queueSync();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "F1") queueSync();
  }, true);
  window.addEventListener("resize", queueSync);

  let attempts = 0;
  const boot = () => {
    attempts += 1;
    queueSync();
    if (attachObserver() || attempts >= 30) return;
    setTimeout(boot, 100);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  [0, 50, 150, 400, 900, 1800, 3000].forEach((delay) => setTimeout(queueSync, delay));
}
