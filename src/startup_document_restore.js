// Resolve the browser's initial document source without racing the default
// sample against an async server restore.
//
// Fast, valid localStorage content stays visible immediately. When that fast
// path is unavailable (or is only the obsolete demo state), try the browser
// recovery store first, then wait for the already-running server request, and
// only then fall back to the built-in sample.

export async function finishInitialDocumentRestore({
  loadedFromStorage = false,
  isLegacyDemoState = () => false,
  loadDeferredLocalRecovery = async () => false,
  serverInitialStatePromise = Promise.resolve({ loaded: false }),
  loadSample = async () => {},
} = {}) {
  // Even when the fast localStorage path loaded successfully, reconcile it
  // once with the emergency IDB snapshot. A quota failure leaves the previous
  // localStorage value in place, so "a primary value exists" does not prove it
  // is the newest browser-local document.
  try {
    const recovered = await loadDeferredLocalRecovery();
    if (recovered && !isLegacyDemoState()) {
      return { loaded: true, source: "local-recovery" };
    }
  } catch (error) {
    console.warn("[recovery] deferred local restore failed:", error);
  }

  if (loadedFromStorage && !isLegacyDemoState()) {
    return { loaded: true, source: "local-storage" };
  }

  let serverResult = null;
  try {
    serverResult = await serverInitialStatePromise;
  } catch (error) {
    serverResult = { loaded: false, error: error?.message || String(error) };
  }
  if (serverResult?.loaded) return serverResult;

  await loadSample();
  return { loaded: true, source: "sample" };
}
