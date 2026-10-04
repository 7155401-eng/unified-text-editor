// Lightweight startup wiring for the optional caricature tool.
// The full UI/CSS graph is loaded only after the user clicks its toolbar button.

let _modulePromise = null;

function loadCaricatureModule() {
  if (!_modulePromise) {
    _modulePromise = import("./haredi_caricature/haredi_caricature.js").catch((error) => {
      _modulePromise = null;
      throw error;
    });
  }
  return _modulePromise;
}

function selectedText(paneManager) {
  try {
    const editor = paneManager?.getActiveEditor?.();
    if (!editor?.state?.selection) return "";
    const { from, to } = editor.state.selection;
    if (from === to) return "";
    return editor.state.doc.textBetween(from, to, " ").trim();
  } catch (_) {
    return "";
  }
}

export function wireCaricatureBot(paneManager) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return false;
  if (toolbar.querySelector("#hc-trigger-btn")) return true;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "קריקטורה AI";

  const btn = document.createElement("button");
  btn.id = "hc-trigger-btn";
  btn.type = "button";
  btn.textContent = "🎭 צור איור AI";
  btn.title = "פתיחת חלון יצירת קריקטורה חרדית — Imagen דרך Apps Script";

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");

    try {
      const mod = await loadCaricatureModule();
      await mod.openCaricatureBot({
        initialScene: selectedText(paneManager),
        onInsertImage: (img) => {
          try {
            const editor = paneManager?.getActiveEditor?.();
            if (!editor) return;
            editor.chain().focus().setImage({
              src: img.dataUrl,
              alt: img.alt || "",
            }).run();
          } catch (error) {
            console.warn("[caricature] insert image failed:", error);
          }
        },
      });
    } catch (error) {
      console.warn("[caricature] lazy load/open failed:", error);
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });

  group.appendChild(btn);
  toolbar.appendChild(group);
  return true;
}
