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
  if (loadedFromStorage && !isLegacyDemoState()) {
    return { loaded: true, source: "local-storage" };
  }

  if (!loadedFromStorage) {
    try {
      const recovered = await loadDeferredLocalRecovery();
      if (recovered && !isLegacyDemoState()) {
        return { loaded: true, source: "local-recovery" };
      }
    } catch (error) {
      console.warn("[recovery] deferred local restore failed:", error);
    }
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
