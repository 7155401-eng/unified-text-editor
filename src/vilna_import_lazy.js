let _vilnaImportModulePromise = null;

export function loadVilnaImportModule() {
  if (!_vilnaImportModulePromise) {
    _vilnaImportModulePromise = import("./vilna_import_modal.js").catch((error) => {
      _vilnaImportModulePromise = null;
      throw error;
    });
  }
  return _vilnaImportModulePromise;
}

export function wireVilnaImportButton(paneManager, onImported) {
  const toolbar = document.querySelector(".torah-toolbar");
  if (!toolbar) return false;
  if (toolbar.querySelector("#btn-vilna-import")) return false;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = 'ש"ס וילנא';

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-vilna-import";
  btn.textContent = "📖 ייבוא גמרא (וילנא)";
  btn.title = 'ייבוא גמרא ורש"י מהמאגר המקומי, בצורת ש"ס וילנא — עם סימני דף כדי שכל עמוד ייגמר היכן שנגמר העמוד בוילנא';

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    try {
      const { openVilnaImportModal } = await loadVilnaImportModule();
      await openVilnaImportModal(paneManager, onImported);
    } catch (error) {
      console.warn("[vilna-import] lazy module load failed", error);
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });

  group.appendChild(btn);
  toolbar.appendChild(group);
  return true;
}
