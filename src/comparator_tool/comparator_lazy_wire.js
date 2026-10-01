// Lightweight startup wire for the Comparator tool.
// The full Comparator UI/engine/CSS stay outside the editor startup graph and
// are loaded only when the user explicitly activates one of its host buttons.

let _comparatorModulePromise = null;
let _wired = false;

async function loadComparatorModule() {
  if (!_comparatorModulePromise) {
    _comparatorModulePromise = import("./comparator.js")
      .catch((error) => {
        // A transient chunk/network failure must not poison future attempts.
        _comparatorModulePromise = null;
        throw error;
      });
  }
  return _comparatorModulePromise;
}

async function openFromButton(button, variant) {
  if (!button || button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");

  try {
    const { openComparator } = await loadComparatorModule();
    await openComparator({ variant });
  } catch (error) {
    console.warn("[comparator] lazy load/open failed:", error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

export function wireComparatorButton(_paneManager) {
  if (_wired) return false;
  _wired = true;

  document.addEventListener("click", (event) => {
    const fullButton = event.target.closest('[data-cmd="open-comparator"]');
    if (fullButton) {
      event.preventDefault();
      const variant = fullButton.getAttribute("data-variant") === "integrated"
        ? "integrated"
        : "full";
      void openFromButton(fullButton, variant);
      return;
    }

    const integratedButton = event.target.closest('[data-cmd="open-comparator-integrated"]');
    if (integratedButton) {
      event.preventDefault();
      void openFromButton(integratedButton, "integrated");
    }
  });

  return true;
}
