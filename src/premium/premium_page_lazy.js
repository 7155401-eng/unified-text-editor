// Lightweight boundary for the premium purchase UI.
// Keep the full purchase/payment DOM implementation out of editor startup.

let premiumModulePromise = null;

function loadPremiumPageModule() {
  if (!premiumModulePromise) {
    premiumModulePromise = import("./premium_page.js").catch((err) => {
      premiumModulePromise = null;
      throw err;
    });
  }
  return premiumModulePromise;
}

export async function openPremiumPage(opts = {}) {
  try {
    const mod = await loadPremiumPageModule();
    return await mod.openPremiumPage(opts);
  } catch (err) {
    console.error("[premium] lazy page load failed", err);
    try {
      window.dispatchEvent(new CustomEvent("ravtext:premium-load-failed", {
        detail: { message: err?.message || String(err) },
      }));
    } catch (_) {}
    return undefined;
  }
}

function urlNeedsPremiumUi() {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search);
    const premium = p.get("premium");
    return premium === "1"
      || premium === "success"
      || premium === "failed"
      || p.get("upgrade") === "1"
      || !!p.get("pkg");
  } catch (_) {
    return false;
  }
}

export function maybeAutoOpenFromUrl() {
  if (!urlNeedsPremiumUi()) return;
  loadPremiumPageModule()
    .then((mod) => mod.maybeAutoOpenFromUrl())
    .catch((err) => {
      premiumModulePromise = null;
      console.error("[premium] lazy URL bootstrap failed", err);
    });
}
