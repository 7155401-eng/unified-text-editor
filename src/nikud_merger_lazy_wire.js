// Lightweight startup wire for Nikud Merger.
// Keep the merger UI/engine/CSS out of the editor startup graph and load it
// only after the user explicitly clicks the tool button.

let _nikudMergerModulePromise = null;

async function loadNikudMergerModule() {
  if (!_nikudMergerModulePromise) {
    _nikudMergerModulePromise = import("./nikud_merger/nikud_merger.js")
      .catch((error) => {
        // A transient chunk/network failure must remain retryable.
        _nikudMergerModulePromise = null;
        throw error;
      });
  }
  return _nikudMergerModulePromise;
}

function selectedCleanText(paneManager) {
  try {
    const ed = paneManager?.getActiveEditor?.();
    if (!ed?.state?.selection) return "";
    const { from, to } = ed.state.selection;
    if (from === to) return "";
    return ed.state.doc.textBetween(from, to, "\n");
  } catch (_) {
    return "";
  }
}

export function wireNikudMergerButton(paneManager) {
  const reviewToolbar = document.querySelector(".review-toolbar");
  const torahToolbar = document.querySelector(".torah-toolbar");
  const insertToolbar = document.querySelector(".insert-toolbar");
  const target = reviewToolbar || torahToolbar || insertToolbar;
  if (!target) return false;

  if (document.getElementById("btn-nikud-merger")) return true;

  const sep = document.createElement("span");
  sep.className = "sep";

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "מיזוג ניקוד";

  const btn = document.createElement("button");
  btn.id = "btn-nikud-merger";
  btn.type = "button";
  btn.title = "פתח חלון מיזוג ניקוד — מיזוג טקסט מקור עם מקור מנוקד";
  btn.textContent = "📜 מיזוג ניקוד";

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");

    const cleanText = selectedCleanText(paneManager);

    try {
      const { openNikudMerger } = await loadNikudMergerModule();
      await openNikudMerger({ cleanText });
    } catch (err) {
      console.warn("[nikud-merger] lazy load/open failed:", err);
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });

  group.appendChild(btn);
  target.appendChild(sep);
  target.appendChild(group);
  return true;
}
