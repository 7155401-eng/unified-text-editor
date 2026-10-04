let findReplaceModulePromise = null;

function loadFindReplaceModule() {
  if (!findReplaceModulePromise) {
    findReplaceModulePromise = import("./find_replace.js").catch((error) => {
      findReplaceModulePromise = null;
      throw error;
    });
  }
  return findReplaceModulePromise;
}

export function wireFindReplaceLazy() {
  if (typeof window === "undefined" || window.__ravtextFindReplaceLazyBound) return;
  window.__ravtextFindReplaceLazyBound = true;

  let loading = false;
  const onFirstFind = async (event) => {
    if (!(event.ctrlKey || event.metaKey) || (event.key !== "f" && event.key !== "F")) return;
    event.preventDefault();
    if (loading) return;
    loading = true;

    try {
      const mod = await loadFindReplaceModule();
      window.removeEventListener("keydown", onFirstFind);
      // Keep the sentinel set after handoff so a repeated app bootstrap/HMR
      // cannot install a second lazy Ctrl+F handler beside the full one.
      mod.setupFindReplace();
      mod.openFindReplace();
    } catch (error) {
      console.error("[find-replace] lazy load failed", error);
    } finally {
      loading = false;
    }
  };

  window.addEventListener("keydown", onFirstFind);
}
