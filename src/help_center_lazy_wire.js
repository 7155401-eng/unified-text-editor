let helpModulePromise = null;

function loadHelpCenterModule() {
  if (!helpModulePromise) {
    helpModulePromise = import("./help_center.js").catch((error) => {
      helpModulePromise = null;
      throw error;
    });
  }
  return helpModulePromise;
}

export function wireHelpCenterLazy() {
  const btn = document.getElementById("btn-help-center");
  if (!btn || btn.dataset.helpCenterLazyBound === "1") return;
  btn.dataset.helpCenterLazyBound = "1";

  btn.addEventListener("click", async () => {
    if (btn.dataset.helpCenterLoading === "1") return;
    btn.dataset.helpCenterLoading = "1";
    btn.setAttribute("aria-busy", "true");
    try {
      const { openHelpCenter } = await loadHelpCenterModule();
      openHelpCenter();
    } catch (error) {
      console.error("[help-center] lazy load failed", error);
    } finally {
      delete btn.dataset.helpCenterLoading;
      btn.removeAttribute("aria-busy");
    }
  });
}
