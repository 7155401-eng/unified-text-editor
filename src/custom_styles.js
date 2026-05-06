// Custom styles — opens a TipTap-style settings dialog from the styles
// dropdown ("+ הוסף סגנון משלך"), persists user-defined styles, and applies
// them to the active selection via TipTap chain commands.

const STORAGE_KEY = "ravtext.customStyles.v1";
const ID_PREFIX = "user-";

function loadStyles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveStyles(styles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
}

function uniqueId(existing) {
  let n = existing.length + 1;
  while (existing.some(s => s.id === ID_PREFIX + n)) n++;
  return ID_PREFIX + n;
}

function refreshDropdown(select, styles) {
  Array.from(select.querySelectorAll("option[data-user-style]")).forEach(o => o.remove());
  const addOption = select.querySelector('option[value="__add-custom__"]');
  for (const s of styles) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    opt.dataset.userStyle = "1";
    if (addOption) select.insertBefore(opt, addOption);
    else select.appendChild(opt);
  }
}

function applyCustomStyleToActiveEditor(style, paneManager) {
  const editor = paneManager.getActiveEditor?.();
  if (!editor) return;
  let chain = editor.chain().focus();
  switch (style.block) {
    case "paragraph": chain = chain.setParagraph(); break;
    case "heading-1": chain = chain.setHeading({ level: 1 }); break;
    case "heading-2": chain = chain.setHeading({ level: 2 }); break;
    case "heading-3": chain = chain.setHeading({ level: 3 }); break;
    case "heading-4": chain = chain.setHeading({ level: 4 }); break;
    case "heading-5": chain = chain.setHeading({ level: 5 }); break;
    case "heading-6": chain = chain.setHeading({ level: 6 }); break;
    case "blockquote": chain = chain.setBlockquote?.() || chain; break;
  }
  if (style.fontFamily) chain = chain.setFontFamily(style.fontFamily);
  if (style.fontSize) chain = chain.setFontSize(`${style.fontSize}px`);
  if (style.color) chain = chain.setColor(style.color);
  if (style.bgColor) chain = chain.setBackgroundColor?.(style.bgColor) || chain;
  if (style.bold) chain = chain.setBold?.() || chain;
  else chain = chain.unsetBold?.() || chain;
  if (style.italic) chain = chain.setItalic?.() || chain;
  else chain = chain.unsetItalic?.() || chain;
  if (style.underline) chain = chain.setUnderline?.() || chain;
  else chain = chain.unsetUnderline?.() || chain;
  if (style.align) chain = chain.setTextAlign?.(style.align) || chain;
  chain.run();
  if (style.lineHeight || style.indent || style.marginTop || style.marginBottom) {
    requestAnimationFrame(() => {
      const sel = editor.view?.state.selection;
      if (!sel) return;
      const dom = editor.view.domAtPos(sel.from)?.node;
      const block = (dom && (dom.nodeType === 1 ? dom : dom.parentElement))
        ?.closest("p, h1, h2, h3, h4, h5, h6, blockquote, li");
      if (!block) return;
      if (style.lineHeight) block.style.lineHeight = String(style.lineHeight);
      if (style.indent) block.style.textIndent = `${style.indent}em`;
      if (style.marginTop != null) block.style.marginTop = `${style.marginTop}px`;
      if (style.marginBottom != null) block.style.marginBottom = `${style.marginBottom}px`;
    });
  }
}

function buildDialog() {
  let dialog = document.getElementById("custom-style-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.id = "custom-style-dialog";
  dialog.className = "custom-style-dialog";
  dialog.dir = "rtl";
  dialog.innerHTML = `
    <div class="csd-backdrop"></div>
    <div class="csd-window" role="dialog" aria-modal="true" aria-label="הגדרות סגנון משלך">
      <header class="csd-header">
        <span class="csd-title">סגנון משלך — הגדרות TipTap</span>
        <button type="button" class="csd-close" title="סגור">✕</button>
      </header>
      <div class="csd-body">
        <label class="csd-row">
          <span>שם הסגנון:</span>
          <input type="text" id="csd-name" placeholder="למשל: כותרת אדומה" />
        </label>
        <label class="csd-row">
          <span>סוג בלוק:</span>
          <select id="csd-block">
            <option value="">— אל תשנה —</option>
            <option value="paragraph">פסקה רגילה</option>
            <option value="heading-1">כותרת 1</option>
            <option value="heading-2">כותרת 2</option>
            <option value="heading-3">כותרת 3</option>
            <option value="heading-4">כותרת 4</option>
            <option value="heading-5">כותרת 5</option>
            <option value="heading-6">כותרת 6</option>
            <option value="blockquote">ציטוט</option>
          </select>
        </label>
        <label class="csd-row">
          <span>גופן:</span>
          <input type="text" id="csd-font-family" list="csd-font-list" placeholder="David Libre, Frank Ruhl Libre, ..." />
          <datalist id="csd-font-list">
            <option value="David Libre"></option>
            <option value="Frank Ruhl Libre"></option>
            <option value="Segoe UI"></option>
            <option value="Times New Roman"></option>
            <option value="Arial"></option>
          </datalist>
        </label>
        <label class="csd-row">
          <span>גודל גופן (px):</span>
          <input type="number" id="csd-font-size" min="6" max="200" placeholder="16" />
        </label>
        <div class="csd-row">
          <span>סגנון:</span>
          <label class="csd-toggle"><input type="checkbox" id="csd-bold" /> מודגש</label>
          <label class="csd-toggle"><input type="checkbox" id="csd-italic" /> נטוי</label>
          <label class="csd-toggle"><input type="checkbox" id="csd-underline" /> קו תחתי</label>
        </div>
        <label class="csd-row">
          <span>צבע טקסט:</span>
          <input type="color" id="csd-color" value="#000000" />
          <button type="button" class="csd-clear" data-target="csd-color">ניקוי</button>
        </label>
        <label class="csd-row">
          <span>צבע רקע:</span>
          <input type="color" id="csd-bg" value="#ffffff" />
          <button type="button" class="csd-clear" data-target="csd-bg">ניקוי</button>
        </label>
        <label class="csd-row">
          <span>יישור:</span>
          <select id="csd-align">
            <option value="">— אל תשנה —</option>
            <option value="right">ימין</option>
            <option value="center">מרכז</option>
            <option value="justify">מוצדק</option>
            <option value="left">שמאל</option>
          </select>
        </label>
        <label class="csd-row">
          <span>גובה שורה:</span>
          <input type="number" id="csd-line-height" min="0.8" max="3" step="0.05" placeholder="1.4" />
        </label>
        <label class="csd-row">
          <span>הזחת שורה ראשונה (em):</span>
          <input type="number" id="csd-indent" min="0" max="10" step="0.1" placeholder="0" />
        </label>
        <label class="csd-row">
          <span>רווח עליון (px):</span>
          <input type="number" id="csd-margin-top" min="0" max="200" placeholder="0" />
        </label>
        <label class="csd-row">
          <span>רווח תחתון (px):</span>
          <input type="number" id="csd-margin-bottom" min="0" max="200" placeholder="0" />
        </label>
        <div class="csd-saved-list">
          <h4>סגנונות שמורים:</h4>
          <ul id="csd-list"></ul>
        </div>
      </div>
      <footer class="csd-footer">
        <button type="button" id="csd-apply-only">החל על הבחירה (בלי לשמור)</button>
        <button type="button" class="primary" id="csd-save">שמור והוסף לתפריט</button>
        <button type="button" id="csd-cancel">סגור</button>
      </footer>
    </div>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

function readForm() {
  const v = (id) => document.getElementById(id)?.value || "";
  const ch = (id) => document.getElementById(id)?.checked || false;
  const isReset = (id) => document.getElementById(id)?.dataset.cleared === "1";
  return {
    name: v("csd-name").trim(),
    block: v("csd-block"),
    fontFamily: v("csd-font-family").trim(),
    fontSize: v("csd-font-size") ? Number(v("csd-font-size")) : null,
    bold: ch("csd-bold"),
    italic: ch("csd-italic"),
    underline: ch("csd-underline"),
    color: isReset("csd-color") ? "" : v("csd-color"),
    bgColor: isReset("csd-bg") ? "" : v("csd-bg"),
    align: v("csd-align"),
    lineHeight: v("csd-line-height") ? Number(v("csd-line-height")) : null,
    indent: v("csd-indent") ? Number(v("csd-indent")) : null,
    marginTop: v("csd-margin-top") ? Number(v("csd-margin-top")) : null,
    marginBottom: v("csd-margin-bottom") ? Number(v("csd-margin-bottom")) : null,
  };
}

function fillForm(style) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  const setCh = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  set("csd-name", style.name || "");
  set("csd-block", style.block || "");
  set("csd-font-family", style.fontFamily || "");
  set("csd-font-size", style.fontSize ?? "");
  setCh("csd-bold", style.bold);
  setCh("csd-italic", style.italic);
  setCh("csd-underline", style.underline);
  set("csd-color", style.color || "#000000");
  set("csd-bg", style.bgColor || "#ffffff");
  set("csd-align", style.align || "");
  set("csd-line-height", style.lineHeight ?? "");
  set("csd-indent", style.indent ?? "");
  set("csd-margin-top", style.marginTop ?? "");
  set("csd-margin-bottom", style.marginBottom ?? "");
}

function refreshSavedList(dialog, paneManager, select) {
  const ul = dialog.querySelector("#csd-list");
  if (!ul) return;
  const styles = loadStyles();
  ul.innerHTML = "";
  if (styles.length === 0) {
    ul.innerHTML = '<li class="csd-empty">(אין סגנונות שמורים)</li>';
    return;
  }
  for (const s of styles) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="csd-name-preview">${s.name}</span>
      <button type="button" data-action="edit" data-id="${s.id}">ערוך</button>
      <button type="button" data-action="delete" data-id="${s.id}">מחק</button>`;
    ul.appendChild(li);
  }
  ul.onclick = (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    const styles = loadStyles();
    if (btn.dataset.action === "delete") {
      const next = styles.filter(s => s.id !== id);
      saveStyles(next);
      refreshDropdown(select, next);
      refreshSavedList(dialog, paneManager, select);
    } else if (btn.dataset.action === "edit") {
      const target = styles.find(s => s.id === id);
      if (target) {
        fillForm(target);
        dialog.dataset.editingId = id;
      }
    }
  };
}

export function wireCustomStyles(paneManager) {
  const select = document.getElementById("styles-gallery-select");
  if (!select) return;

  if (!select.querySelector('option[value="__add-custom__"]')) {
    const opt = document.createElement("option");
    opt.value = "__add-custom__";
    opt.textContent = "+ הוסף סגנון משלך…";
    select.appendChild(opt);
  }

  refreshDropdown(select, loadStyles());

  const dialog = buildDialog();

  function openDialog() {
    dialog.classList.add("open");
    delete dialog.dataset.editingId;
    fillForm({});
    refreshSavedList(dialog, paneManager, select);
    document.getElementById("csd-name")?.focus();
  }
  function closeDialog() { dialog.classList.remove("open"); }

  dialog.querySelector(".csd-close")?.addEventListener("click", closeDialog);
  dialog.querySelector(".csd-backdrop")?.addEventListener("click", closeDialog);
  dialog.querySelector("#csd-cancel")?.addEventListener("click", closeDialog);
  dialog.querySelectorAll(".csd-clear").forEach(b => {
    b.addEventListener("click", () => {
      const target = document.getElementById(b.dataset.target);
      if (target) target.dataset.cleared = "1";
    });
  });
  dialog.querySelectorAll('input[type="color"]').forEach(c => {
    c.addEventListener("input", () => { c.dataset.cleared = "0"; });
  });

  dialog.querySelector("#csd-apply-only")?.addEventListener("click", () => {
    applyCustomStyleToActiveEditor(readForm(), paneManager);
  });

  dialog.querySelector("#csd-save")?.addEventListener("click", () => {
    const style = readForm();
    if (!style.name) {
      alert("חובה לתת שם לסגנון.");
      return;
    }
    const styles = loadStyles();
    const editingId = dialog.dataset.editingId;
    if (editingId) {
      const idx = styles.findIndex(s => s.id === editingId);
      if (idx >= 0) styles[idx] = { ...styles[idx], ...style };
    } else {
      styles.push({ id: uniqueId(styles), ...style });
    }
    saveStyles(styles);
    refreshDropdown(select, styles);
    refreshSavedList(dialog, paneManager, select);
    delete dialog.dataset.editingId;
  });

  // Hook the dropdown's change event via capture so we can intercept the
  // "add custom" option without breaking the existing styles handler.
  select.addEventListener("change", (ev) => {
    const v = select.value;
    if (v === "__add-custom__") {
      ev.stopImmediatePropagation();
      select.value = "";
      openDialog();
      return;
    }
    if (v && v.startsWith(ID_PREFIX)) {
      ev.stopImmediatePropagation();
      const styles = loadStyles();
      const target = styles.find(s => s.id === v);
      select.value = "";
      if (target) applyCustomStyleToActiveEditor(target, paneManager);
    }
  }, true);
}
