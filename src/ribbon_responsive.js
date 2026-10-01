const RESPONSIVE_CLASSES = ["rt-compact", "rt-compact-2", "rt-compact-3"];

function clearResponsiveClasses(tabsBar) {
  for (const cls of RESPONSIVE_CLASSES) tabsBar.classList.remove(cls);
  tabsBar.classList.remove("has-overflow");
}

function hasHorizontalOverflow(tabsBar) {
  return Number(tabsBar.scrollWidth || 0) - Number(tabsBar.clientWidth || 0) > 1;
}

/**
 * Fit the ribbon without hiding tabs.
 * Order matters: preserve normal spacing first, then tighten progressively,
 * finally allow a two-row wrap. Only show the overflow hint if even the
 * wrapped compact layout still cannot fit.
 */
export function applyRibbonResponsiveLayout(tabsBar) {
  if (!tabsBar) return { level: 0, overflow: false };

  clearResponsiveClasses(tabsBar);
  const stages = [
    [],
    ["rt-compact"],
    ["rt-compact", "rt-compact-2"],
    ["rt-compact", "rt-compact-2", "rt-compact-3"],
  ];

  for (let level = 0; level < stages.length; level += 1) {
    clearResponsiveClasses(tabsBar);
    for (const cls of stages[level]) tabsBar.classList.add(cls);

    if (!hasHorizontalOverflow(tabsBar)) {
      tabsBar.dataset.ribbonResponsiveLevel = String(level);
      return { level, overflow: false };
    }
  }

  tabsBar.classList.add("has-overflow");
  tabsBar.dataset.ribbonResponsiveLevel = "3";
  return { level: 3, overflow: true };
}

export function installRibbonResponsiveLayout(tabsBar) {
  if (!tabsBar || tabsBar.dataset.ribbonResponsiveBound === "1") {
    return () => {};
  }
  tabsBar.dataset.ribbonResponsiveBound = "1";

  let frame = 0;
  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      applyRibbonResponsiveLayout(tabsBar);
    });
  };

  schedule();

  const ro = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(schedule)
    : null;
  ro?.observe(tabsBar);

  window.addEventListener("resize", schedule);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    ro?.disconnect();
    window.removeEventListener("resize", schedule);
    delete tabsBar.dataset.ribbonResponsiveBound;
  };
}
