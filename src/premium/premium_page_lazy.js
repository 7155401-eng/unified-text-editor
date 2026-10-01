// Lightweight lazy boundary for the purchase/payment UI.
// Core editor startup only needs a callable action; the full premium page is
// loaded on demand when a user opens it or when the URL explicitly requests it.

let premiumModulePromise = null;

function loadPremiumPageModule() {
  if (!premiumModulePromise) {
    premiumModulePromise = import("./premium_page.js").catch((error) => {
      premiumModulePromise = null;
      throw error;
    });
  }
  return premiumModulePromise;
}

export async function openPremiumPage(opts = {}) {
  const mod = await loadPremiumPageModule();
  return mod.openPremiumPage(opts);
}

function urlNeedsPremiumUi() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const premium = params.get("premium");
    return premium === "1"
      || premium === "success"
      || premium === "failed"
      || params.get("upgrade") === "1"
      || !!params.get("pkg");
  } catch (_) {
    return false;
  }
}

export function maybeAutoOpenFromUrl() {
  if (!urlNeedsPremiumUi()) return;
  void loadPremiumPageModule()
    .then((mod) => mod.maybeAutoOpenFromUrl())
    .catch((error) => {
      console.error("[premium] lazy URL bootstrap failed", error);
    });
}
