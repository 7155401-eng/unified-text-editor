// Lazy owner for the optional Torah toolbar.
//
// The full toolbar builder is intentionally absent from the startup static
// graph. It replaces the toolbar contents, so all secondary tool wires must be
// attached only after that replacement has completed.

import { isToolPreviewAllowed, revealToolButtons } from "./tool_preview_gate.js";
import { wireVilnaImportButton } from "./vilna_import_lazy.js";

let _modulePromise = null;
let _loadPromise = null;
let _loaded = false;

function loadToolbarModules() {
  if (!_modulePromise) {
    _modulePromise = Promise.all([
      import("./torah_tools.js"),
      import("./sefaria/sefaria.js"),
      import("./torah_transcription/torah_transcription_lazy_wire.js"),
      import("./torah_nikud_lazy_wire.js"),
      import("./haredi_caricature_lazy_wire.js"),
    ]).then(([base, sefaria, transcription, nikud, caricature]) => ({
      base,
      sefaria,
      transcription,
      nikud,
      caricature,
    })).catch((error) => {
      _modulePromise = null;
      throw error;
    });
  }
  return _modulePromise;
}

function loadingHint(toolbar) {
  if (!toolbar) return null;
  let hint = toolbar.querySelector("[data-torah-toolbar-loading]");
  if (!hint) {
    hint = document.createElement("span");
    hint.dataset.torahToolbarLoading = "1";
    hint.className = "tb-group";
    hint.textContent = "טוען כלים…";
    toolbar.appendChild(hint);
  }
  return hint;
}

export async function ensureTorahToolbarLoaded(paneManager, onVilnaImport) {
  if (_loaded) return true;
  if (_loadPromise) return _loadPromise;

  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return false;

  toolbar.setAttribute("aria-busy", "true");
  const hint = loadingHint(toolbar);

  _loadPromise = (async () => {
    const mods = await loadToolbarModules();

    // This call owns the toolbar root and starts with replaceChildren().
    mods.base.wireTorahTools(paneManager);

    // Everything below must run only after the base replacement.
    mods.sefaria.wireSefariaTools(paneManager);

    if (isToolPreviewAllowed("torah-transcription")) {
      mods.transcription.wireTorahTranscription(paneManager);
    }
    if (isToolPreviewAllowed("torah-nikud")) {
      mods.nikud.wireTorahNikud(paneManager);
    }
    if (isToolPreviewAllowed("haredi-caricature")) {
      mods.caricature.wireCaricatureBot(paneManager);
    }

    wireVilnaImportButton(paneManager, onVilnaImport);
    revealToolButtons();

    _loaded = true;
    toolbar.dataset.torahToolbarLoaded = "1";
    try {
      window.dispatchEvent(new CustomEvent("ravtext:torah-toolbar-ready"));
    } catch (_) {}
    return true;
  })().catch((error) => {
    console.warn("[torah-toolbar] lazy load failed:", error);
    return false;
  }).finally(() => {
    _loadPromise = null;
    toolbar.removeAttribute("aria-busy");
    hint?.remove();
  });

  return _loadPromise;
}

export function wireTorahToolbarLazy(paneManager, onVilnaImport) {
  const tab = document.querySelector('.ribbon-tab[data-ribbon-tab="torah"]');
  const toolbar = document.querySelector(".torah-toolbar");
  if (!tab || !toolbar) return false;
  if (tab.dataset.torahToolbarLazyWired === "1") return true;
  tab.dataset.torahToolbarLazyWired = "1";

  const ensure = () => {
    void ensureTorahToolbarLoaded(paneManager, onVilnaImport);
  };

  // Pointer hover preloads before a typical click; focus covers keyboard
  // navigation; click is the correctness fallback.
  tab.addEventListener("pointerenter", ensure, { passive: true });
  tab.addEventListener("focus", ensure);
  tab.addEventListener("click", ensure);

  // setupRibbonTabs() restores the saved tab before this wire is installed.
  // If Torah was already active, do not leave an empty toolbar on reload.
  const savedActive = (() => {
    try { return localStorage.getItem("ravtext.ribbonTab") === "torah"; }
    catch (_) { return false; }
  })();
  if (
    savedActive ||
    tab.classList.contains("active") ||
    tab.getAttribute("aria-selected") === "true" ||
    !toolbar.classList.contains("ribbon-hidden")
  ) {
    queueMicrotask(ensure);
  }

  return true;
}
