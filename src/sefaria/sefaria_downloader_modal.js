// sefaria_downloader_modal.js — full UI port of sefaria_downloader_ui.py.
// Browser equivalent of SefariaDownloaderWindow: book tree (4 categories,
// 119 books), per-book-type structured selectors (Tanakh/Bavli/SA),
// commentator list with up/down reorder + colors + counts, vowels and
// cantillation toggles, today (daf+parsha), presets dialog (built-in +
// user CRUD, import/export JSON), favorites, recent, log viewer,
// refresh-API. Final action: build .docx via sefaria_docx_builder + open
// browser download.

import * as meta from "./sefaria_book_metadata.js";
import * as api from "./sefaria_api_client.js";
import * as presets from "./sefaria_preset_manager.js";
import { extractDh, findDhPosition } from "./sefaria_dh.js";
import { buildAndDownloadDocx } from "./sefaria_docx_builder.js";
import { t, getLang, toggleLang } from "./sefaria_i18n.js";

// ────────────────────────────────────────────────────────────────────
// Tiny DOM helpers (avoids JSX / external deps).
// ────────────────────────────────────────────────────────────────────
function el(tag, props, ...children) {
  const e = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      if (k === "class" || k === "className") e.className = props[k];
      else if (k === "style" && typeof props[k] === "object") Object.assign(e.style, props[k]);
      else if (k === "dataset" && typeof props[k] === "object") {
        for (const dk of Object.keys(props[k])) e.dataset[dk] = props[k][dk];
      }
      else if (k.startsWith("on") && typeof props[k] === "function") {
        e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      } else if (k in e) {
        try { e[k] = props[k]; } catch (_) { e.setAttribute(k, props[k]); }
      } else {
        e.setAttribute(k, props[k]);
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) c.forEach(x => x && e.appendChild(typeof x === "string" ? document.createTextNode(x) : x));
    else e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function readTheme() {
  try {
    const t = (localStorage.getItem("ravtext.theme") || "").toLowerCase();
    return t === "light" ? "light" : "dark";
  } catch (_) { return "dark"; }
}

// ────────────────────────────────────────────────────────────────────
// Small inner modal helpers (yes/no, info, custom)
// ────────────────────────────────────────────────────────────────────
function innerModal(content) {
  const overlay = el("div", { class: "sef-inner-overlay", dir: getLang() === "he" ? "rtl" : "ltr" });
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  const close = () => { try { overlay.remove(); } catch (_) {} };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  return { overlay, close };
}

function modalYesNo(title, message) {
  return new Promise(resolve => {
    const inner = el("div", { class: "sef-inner", style: { width: "min(480px, 90vw)" } },
      el("h3", null, title),
      el("div", { style: { whiteSpace: "pre-line", fontSize: "13px" } }, message),
      el("div", { class: "sef-inner-actions" },
        el("button", {
          class: "sef-btn sef-gold",
          onclick: () => { close(); resolve(true); },
        }, t("confirm_btn_continue")),
        el("button", {
          class: "sef-btn sef-danger",
          onclick: () => { close(); resolve(false); },
        }, t("confirm_btn_cancel"))
      )
    );
    const { close } = innerModal(inner);
  });
}

function modalInfo(title, message, kind) {
  return new Promise(resolve => {
    const icon = kind === "error" ? "❌" : (kind === "warn" ? "⚠" : "ℹ");
    const inner = el("div", { class: "sef-inner", style: { width: "min(460px, 90vw)" } },
      el("h3", null, `${icon} ${title}`),
      el("div", { style: { whiteSpace: "pre-line", fontSize: "13px" } }, message),
      el("div", { class: "sef-inner-actions" },
        el("button", {
          class: "sef-btn sef-gold",
          onclick: () => { close(); resolve(); },
        }, t("btn_close_word"))
      )
    );
    const { close } = innerModal(inner);
  });
}

function modalPrompt(title, fields) {
  // fields: [{label, value, placeholder, key}]
  return new Promise(resolve => {
    const inputs = {};
    const rows = fields.map(f => {
      const inp = el("input", {
        type: "text",
        class: "sef-input",
        value: f.value || "",
        placeholder: f.placeholder || "",
        style: { width: "100%" },
      });
      inputs[f.key] = inp;
      return el("div", { class: "sef-inner-row" },
        el("label", null, f.label),
        inp
      );
    });
    const inner = el("div", { class: "sef-inner", style: { width: "min(420px, 90vw)" } },
      el("h3", null, title),
      ...rows,
      el("div", { class: "sef-inner-actions" },
        el("button", {
          class: "sef-btn sef-gold",
          onclick: () => {
            const out = {};
            for (const k of Object.keys(inputs)) out[k] = inputs[k].value.trim();
            close(); resolve(out);
          },
        }, t("confirm_btn_continue")),
        el("button", {
          class: "sef-btn sef-danger",
          onclick: () => { close(); resolve(null); },
        }, t("btn_cancel_short"))
      )
    );
    const { close } = innerModal(inner);
    setTimeout(() => { try { rows[0].querySelector("input").focus(); } catch (_) {} }, 50);
  });
}

// ────────────────────────────────────────────────────────────────────
// Main exported function — opens the downloader modal.
//
// opts:
//   prefillRange?: string  — write into manual range field (from active stream).
//   loadDocxIntoEditor?: (Blob, filename) => Promise<void>   — wired into editor
// ────────────────────────────────────────────────────────────────────
export function openSefariaDownloader(opts) {
  opts = opts || {};
  const lang = getLang();
  const isRTL = lang === "he";

  const overlay = el("div", { class: "sef-overlay" });
  const modal = el("div", {
    class: "sef-modal",
    dataset: { variant: "download", theme: readTheme() },
    dir: isRTL ? "rtl" : "ltr",
  });
  overlay.appendChild(modal);

  // Toolbar ───────────────────────────────────────────────
  const closeBtn = el("button", {
    class: "sef-btn sef-danger sef-btn-icon",
    title: t("btn_close"),
    onclick: () => onClose(),
  }, t("btn_close"));

  const langBtn = el("button", {
    class: "sef-btn sef-btn-sm",
    style: { background: "transparent", color: "var(--sef-gold)", border: "1px solid var(--sef-gold)" },
    onclick: () => {
      toggleLang();
      // hard reopen with the new lang
      try { overlay.remove(); } catch (_) {}
      openSefariaDownloader(opts);
    },
  }, isRTL ? t("btn_lang_to_en") : t("btn_lang_to_he"));

  const todayBtn = el("button", { class: "sef-btn sef-btn-sm", onclick: () => onToday() }, t("btn_today"));
  const presetsBtn = el("button", { class: "sef-btn sef-btn-sm", onclick: () => onPresets() }, t("btn_presets"));
  const refreshBtn = el("button", { class: "sef-btn sef-btn-sm", onclick: () => onRefreshCache() }, t("btn_refresh_api"));
  const logBtn = el("button", { class: "sef-btn sef-btn-sm", onclick: () => onViewLog() }, t("btn_log"));
  const searchInput = el("input", {
    class: "sef-input",
    placeholder: t("placeholder_search_book"),
    style: { width: "200px" },
    oninput: () => filterTree(searchInput.value),
  });
  const titleEl = el("span", { class: "sef-title" }, t("title_main"));

  const toolbar = el("div", { class: "sef-toolbar" },
    closeBtn, langBtn, todayBtn, presetsBtn, refreshBtn, logBtn,
    el("span", { style: { width: "8px" } }),
    el("span", { style: { fontSize: "13px", color: "var(--sef-muted)" } }, "🔎"),
    searchInput,
    titleEl
  );

  // Netfree warning ───────────────────────────────────────
  const netfree = el("div", { class: "sef-netfree" }, t("netfree_warn_downloader"));

  // Main 3-column layout (RTL: settings left, preview center, tree right).
  // CSS handles ordering via grid; we just create the panes in DOM order.
  const settingsPane = el("div", { class: "sef-pane" });
  const previewPane = el("div", { class: "sef-pane" });
  const treePane = el("div", { class: "sef-pane" });
  const main = el("div", { class: "sef-main" }, settingsPane, previewPane, treePane);

  // ── Settings pane ──
  const vowelsCb = el("input", { type: "checkbox", checked: true });
  const cantCb = el("input", { type: "checkbox", checked: true });
  const versionSel = el("select", { class: "sef-select" },
    el("option", { value: "default" }, "default")
  );
  const summaryEl = el("div", { class: "sef-summary" }, "");
  const importsDirEl = el("div", { style: { fontFamily: "Consolas, monospace", fontSize: "10px", color: "#E8C66A" } }, meta.importsDir());

  settingsPane.append(
    el("div", { class: "sef-pane-title" }, t("settings_title")),
    el("div", { class: "sef-settings" },
      el("label", { style: { display: "flex", gap: "6px", alignItems: "center" } }, vowelsCb, t("settings_vowels")),
      el("label", { style: { display: "flex", gap: "6px", alignItems: "center" } }, cantCb, t("settings_cantillation")),
      el("div", { class: "sef-settings-label" }, t("settings_version")),
      versionSel,
      el("button", { class: "sef-btn", onclick: () => onSavePreset() }, t("btn_save_preset")),
      el("div", { class: "sef-pane-subtitle" }, t("summary_title")),
      summaryEl,
      el("div", { class: "sef-settings-label" }, t("settings_imports_dir_label")),
      importsDirEl
    )
  );

  // ── Tree pane ──
  const treeBody = el("div", { class: "sef-tree" });
  const favList = el("div", { class: "sef-fav-list" });
  const recentList = el("div", { class: "sef-recent-list" });
  treePane.append(
    el("div", { class: "sef-pane-title" }, t("tree_title")),
    treeBody,
    el("div", { class: "sef-pane-subtitle", style: { color: "#E8C66A" } }, t("tree_fav_title")),
    favList,
    el("div", { class: "sef-pane-subtitle", style: { color: "#E8C66A" } }, t("tree_recent_title")),
    recentList
  );

  // ── Preview pane ──
  const rangeLbl = el("div", { style: { color: "var(--sef-muted)", fontSize: "11px", textAlign: "right" } }, t("range_pick_book"));
  const structFrame = el("div", { class: "sef-struct-row", style: { padding: "4px 8px" } });
  const rangeInput = el("input", {
    class: "sef-input",
    placeholder: t("range_manual_placeholder"),
    style: { width: "100%" },
  });
  const refreshCommBtn = el("button", { class: "sef-btn", onclick: () => onRefreshCommentators() }, t("btn_refresh_commentators"));
  const previewBox = el("div", { class: "sef-preview" }, "");
  const commList = el("div", { class: "sef-comm-list" });

  const rangeBox = el("div", { class: "sef-range-box" },
    rangeLbl,
    structFrame,
    el("div", { class: "sef-settings-label" }, t("range_manual_label")),
    rangeInput,
    refreshCommBtn
  );

  previewPane.append(
    el("div", { class: "sef-pane-title" }, t("range_title")),
    rangeBox,
    el("div", { class: "sef-pane-subtitle" }, t("preview_title")),
    previewBox,
    el("div", { class: "sef-pane-subtitle" }, t("commentators_title")),
    el("div", { style: { display: "flex", gap: "6px", padding: "2px 8px", flexDirection: isRTL ? "row-reverse" : "row" } },
      el("button", { class: "sef-btn sef-gold sef-btn-sm", onclick: () => commentatorsSetAll(true) }, t("btn_select_all")),
      el("button", { class: "sef-btn sef-danger sef-btn-sm", onclick: () => commentatorsSetAll(false) }, t("btn_clear_all"))
    ),
    commList
  );

  // ── Bottom action area ──
  const exportLoadBtn = el("button", { class: "sef-btn sef-gold", style: { padding: "12px 18px" }, onclick: () => onExport(true) }, t("btn_export_load"));
  const exportOnlyBtn = el("button", { class: "sef-btn", style: { padding: "12px 18px" }, onclick: () => onExport(false) }, t("btn_export_only"));
  const cancelBtn = el("button", { class: "sef-btn sef-danger", disabled: true, onclick: () => { cancelFlag = true; setStatus(t("status_cancelling"), "warn"); } }, t("btn_cancel"));
  const progressBar = el("i", { style: { width: "0%" } });
  const progress = el("span", { class: "sef-progress" }, progressBar);
  const statusEl = el("div", { class: "sef-status" }, t("status_ready"));
  const bottom = el("div", { class: "sef-bottom" },
    el("div", { style: { textAlign: "center", color: "var(--sef-muted)", fontSize: "10px", padding: "2px 0" } }, t("hint_action_row")),
    el("div", { class: "sef-action-row" }, exportLoadBtn, exportOnlyBtn, cancelBtn),
    progress,
    statusEl
  );

  modal.append(toolbar, netfree, main, bottom);
  document.body.appendChild(overlay);

  // ── State ──
  let bookIndex = null;
  let currentBook = null;
  let commentatorData = [];
  let cancelFlag = false;
  let exportInProgress = false;
  let lastPreviewRef = null;
  let structuredMode = null;
  const struct = { a: "", b: "", amud: "a" };

  // ────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────
  populateTree();
  refreshFavorites();
  refreshRecent();
  setStatus(t("status_loading_index"), "gold");
  api.getIndex().then(idx => {
    bookIndex = idx;
    setStatus(idx ? t("status_ready") : t("status_index_failed"), idx ? "muted" : "warn");
  });

  // Pre-fill range if provided (from active stream)
  if (opts.prefillRange) {
    rangeInput.value = opts.prefillRange;
  }

  // ────────────────────────────────────────────────────────
  // Internal handlers (bound by closure)
  // ────────────────────────────────────────────────────────
  function setStatus(text, kind) {
    statusEl.textContent = text;
    const colors = { gold: "var(--sef-gold)", muted: "var(--sef-muted)", warn: "var(--sef-warn)", success: "#E8C66A" };
    statusEl.style.color = colors[kind] || "var(--sef-muted)";
  }
  function setProgress(frac) {
    const p = Math.max(0, Math.min(1, frac));
    progressBar.style.width = (p * 100).toFixed(1) + "%";
  }

  function buildRef() {
    if (!currentBook) return null;
    const rng = rangeInput.value.trim();
    return rng ? `${currentBook} ${rng}` : currentBook;
  }

  function updateSummary() {
    const book = currentBook ? meta.getHebrewName(currentBook) : t("summary_book_none");
    const rng = rangeInput.value.trim() || "—";
    const sel = commentatorData.filter(e => e.selected).length;
    summaryEl.textContent = t("summary_template", { book, rng, sel, total: commentatorData.length });
  }

  // ── Tree ──
  function populateTree() {
    clear(treeBody);
    const cats = [
      [t("cat_tanakh"), meta.TANAKH_BOOKS, "📄", true],
      [t("cat_bavli"), meta.BAVLI_TRACTATES, "📜", false],
      [t("cat_yerushalmi"), meta.YERUSHALMI_TRACTATES, "📜", false],
      [t("cat_shulchan"), meta.SHULCHAN_ARUKH_SECTIONS, "📕", true],
    ];
    for (const [label, list, icon, openByDefault] of cats) {
      const sum = el("summary", null, label);
      const det = el("details", { open: openByDefault }, sum);
      for (const b of list) {
        const item = el("div", {
          class: "sef-tree-item",
          dataset: { book: b },
          oncontextmenu: e => { e.preventDefault(); onTreeRightClick(b); },
          onclick: () => selectBook(b),
        }, `${icon} ${meta.getHebrewName(b)}`);
        det.appendChild(item);
      }
      treeBody.appendChild(det);
    }
  }

  function filterTree(q) {
    q = (q || "").trim();
    const ql = q.toLowerCase();
    treeBody.querySelectorAll(".sef-tree-item").forEach(item => {
      const b = item.dataset.book || "";
      const heb = meta.getHebrewName(b);
      if (!q || b.toLowerCase().indexOf(ql) !== -1 || heb.indexOf(q) !== -1) {
        item.style.display = "";
      } else {
        item.style.display = "none";
      }
    });
  }

  function selectBook(book) {
    currentBook = book;
    treeBody.querySelectorAll(".sef-tree-item").forEach(item => {
      item.setAttribute("aria-selected", item.dataset.book === book ? "true" : "false");
    });
    const bt = meta.getBookType(book);
    const preset = meta.LAYOUT_PRESETS[bt];
    vowelsCb.checked = !!preset.vowels_default;
    cantCb.checked = !!preset.cantillation_default;
    rebuildStructuredSelectors(bt);
    rangeLbl.textContent = `ספר: ${meta.getHebrewName(book)} (${meta.BOOK_TYPE_HEB[bt]})`;
    rangeLbl.style.color = "var(--sef-gold)";
    updateSummary();
    onRefreshCommentators();
    renderPreviewAsync();
  }

  function onTreeRightClick(book) {
    const favs = presets.toggleFavorite(book);
    refreshFavorites();
    const inFav = favs.indexOf(book) !== -1;
    setStatus(t(inFav ? "status_fav_added" : "status_fav_removed", { name: meta.getHebrewName(book) }), "success");
  }

  function refreshFavorites() {
    clear(favList);
    const favs = presets.getFavorites();
    if (!favs.length) {
      favList.appendChild(el("div", { class: "sef-fav-empty" }, t("tree_fav_empty")));
      return;
    }
    for (const book of favs) {
      const btn = el("button", {
        class: "sef-btn sef-btn-sm",
        style: { width: "100%", textAlign: isRTL ? "right" : "left", marginBottom: "2px", background: "var(--sef-card)" },
        onclick: () => selectBook(book),
      }, "⭐ " + meta.getHebrewName(book));
      favList.appendChild(btn);
    }
  }

  function refreshRecent() {
    clear(recentList);
    const rec = presets.getRecent();
    if (!rec.length) {
      recentList.appendChild(el("div", { class: "sef-recent-empty" }, t("tree_recent_empty")));
      return;
    }
    for (const entry of rec) {
      const heb = entry.book ? meta.getHebrewName(entry.book) : entry.ref;
      const btn = el("button", {
        class: "sef-btn sef-btn-sm",
        style: { width: "100%", textAlign: isRTL ? "right" : "left", marginBottom: "2px", background: "var(--sef-card)" },
        onclick: () => selectRecent(entry.book, entry.ref),
      }, `🕒 ${heb}`);
      recentList.appendChild(btn);
    }
  }

  function selectRecent(book, ref) {
    if (!book) return;
    selectBook(book);
    if (ref && ref.indexOf(" ") !== -1) {
      rangeInput.value = ref.split(" ").slice(1).join(" ");
      syncRangeFromManual();
    }
  }

  // ── Structured selectors per book type ──
  function rebuildStructuredSelectors(bookType) {
    if (structuredMode !== bookType) {
      structuredMode = bookType;
      clear(structFrame);
      if (bookType === meta.BOOK_TYPE_TANAKH) buildStructTanakh();
      else if (bookType === meta.BOOK_TYPE_BAVLI || bookType === meta.BOOK_TYPE_YERUSHALMI) buildStructTalmud();
      else if (bookType === meta.BOOK_TYPE_SHULCHAN_ARUKH) buildStructShulchan();
      else buildStructTanakh();
    }
    if (bookType === meta.BOOK_TYPE_TANAKH) { struct.a = "1"; struct.b = ""; }
    else if (bookType === meta.BOOK_TYPE_BAVLI || bookType === meta.BOOK_TYPE_YERUSHALMI) {
      struct.a = "2"; struct.b = ""; struct.amud = "a";
    }
    else if (bookType === meta.BOOK_TYPE_SHULCHAN_ARUKH) { struct.a = "1"; struct.b = ""; }
    else { struct.a = "1"; struct.b = ""; }
    syncRangeFromStructured();
    updateStructInputs();
  }

  function updateStructInputs() {
    const aIn = structFrame.querySelector("[data-struct=a]");
    const bIn = structFrame.querySelector("[data-struct=b]");
    const amudSel = structFrame.querySelector("[data-struct=amud]");
    if (aIn) aIn.value = struct.a;
    if (bIn) bIn.value = struct.b;
    if (amudSel) amudSel.value = struct.amud;
  }

  function buildStructTanakh() {
    const aIn = el("input", { class: "sef-input", style: { width: "60px" }, dataset: { struct: "a" }, placeholder: "1", oninput: e => { struct.a = e.target.value; syncRangeFromStructured(); } });
    const bIn = el("input", { class: "sef-input", style: { width: "80px" }, dataset: { struct: "b" }, placeholder: t("struct_verse_ph"), oninput: e => { struct.b = e.target.value; syncRangeFromStructured(); } });
    structFrame.append(
      el("label", null, t("struct_chapter")), aIn,
      el("label", null, t("struct_verse")), bIn
    );
  }

  function buildStructTalmud() {
    const aIn = el("input", { class: "sef-input", style: { width: "60px" }, dataset: { struct: "a" }, placeholder: "2", oninput: e => { struct.a = e.target.value; syncRangeFromStructured(); } });
    const amudSel = el("select", { class: "sef-select", style: { width: "60px" }, dataset: { struct: "amud" }, onchange: e => { struct.amud = e.target.value; syncRangeFromStructured(); } },
      el("option", { value: "a" }, "a"),
      el("option", { value: "b" }, "b")
    );
    structFrame.append(
      el("label", null, t("struct_daf")), aIn,
      el("label", null, t("struct_amud")), amudSel,
      el("span", { style: { fontSize: "10px", color: "var(--sef-muted)" } }, t("struct_amud_hint"))
    );
  }

  function buildStructShulchan() {
    const aIn = el("input", { class: "sef-input", style: { width: "60px" }, dataset: { struct: "a" }, placeholder: "1", oninput: e => { struct.a = e.target.value; syncRangeFromStructured(); } });
    const bIn = el("input", { class: "sef-input", style: { width: "80px" }, dataset: { struct: "b" }, placeholder: t("struct_seif_ph"), oninput: e => { struct.b = e.target.value; syncRangeFromStructured(); } });
    structFrame.append(
      el("label", null, t("struct_siman")), aIn,
      el("label", null, t("struct_seif")), bIn
    );
  }

  function syncRangeFromStructured() {
    if (!struct.a) return;
    const bt = structuredMode;
    let ref = "";
    if (bt === meta.BOOK_TYPE_TANAKH) ref = struct.b ? `${struct.a}:${struct.b}` : struct.a;
    else if (bt === meta.BOOK_TYPE_BAVLI || bt === meta.BOOK_TYPE_YERUSHALMI) ref = `${struct.a}${struct.amud || "a"}`;
    else if (bt === meta.BOOK_TYPE_SHULCHAN_ARUKH) ref = struct.b ? `${struct.a}:${struct.b}` : struct.a;
    else ref = struct.a;
    if (rangeInput.value !== ref) {
      rangeInput.value = ref;
      updateSummary();
    }
  }

  function syncRangeFromManual() { updateSummary(); }
  rangeInput.addEventListener("input", syncRangeFromManual);

  // ── Commentators ──
  function renderCommentatorsEmpty(msg) {
    clear(commList);
    commList.appendChild(el("div", { class: "sef-comm-empty" }, msg));
  }

  function commentatorsSetAll(value) {
    for (const ent of commentatorData) {
      ent.selected = value;
      if (ent._cb) ent._cb.checked = value;
    }
    updateSummary();
  }

  async function onRefreshCommentators() {
    if (!currentBook) return;
    const ref = buildRef();
    if (!ref) return;
    renderCommentatorsEmpty(t("commentators_loading"));
    setStatus(t("status_loading_commentators", { ref }), "gold");
    try {
      const rows = await api.listCommentariesForRef(ref);
      const entries = [];
      for (const r of rows || []) {
        if (!r) continue;
        const title = r.title || "";
        const count = r.count || 0;
        const apiHeb = r.heb;
        const info = meta.getCommentatorInfo(title);
        entries.push({
          title,
          count,
          heb: apiHeb || info.heb,
          color: info.color,
          selected: true,
        });
      }
      commentatorData = entries;
      renderCommentators();
      setStatus(t("status_found_commentators", { n: entries.length }), "success");
      updateSummary();
    } catch (e) {
      setStatus(t("status_loading_commentators_err", { err: e && e.message ? e.message : String(e) }), "warn");
      renderCommentatorsEmpty("שגיאה: " + (e && e.message ? e.message : String(e)));
    }
  }

  function renderCommentators() {
    clear(commList);
    if (!commentatorData.length) {
      renderCommentatorsEmpty(t("commentators_none"));
      return;
    }
    commentatorData.forEach((ent, idx) => {
      const cb = el("input", { type: "checkbox", class: "sef-comm-cb", checked: ent.selected });
      cb.addEventListener("change", () => { ent.selected = cb.checked; updateSummary(); });
      ent._cb = cb;
      const row = el("div", { class: "sef-comm-row" },
        el("button", { class: "sef-comm-arrow", title: "↓", onclick: () => moveCommentator(idx, +1) }, "↓"),
        el("button", { class: "sef-comm-arrow", title: "↑", onclick: () => moveCommentator(idx, -1) }, "↑"),
        el("div", { class: "sef-comm-swatch", style: { background: ent.color } }),
        el("div", { class: "sef-comm-order" }, `${idx + 1}.`),
        cb,
        el("div", { class: "sef-comm-label" }, `${ent.heb} (${ent.count})`)
      );
      commList.appendChild(row);
    });
  }

  function moveCommentator(idx, delta) {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= commentatorData.length) return;
    [commentatorData[idx], commentatorData[newIdx]] = [commentatorData[newIdx], commentatorData[idx]];
    renderCommentators();
  }

  // ── Preview ──
  async function renderPreviewAsync() {
    const ref = buildRef();
    if (!ref || ref === lastPreviewRef) return;
    lastPreviewRef = ref;
    previewBox.textContent = t("preview_loading");
    let data;
    try {
      data = await api.getText(ref, {
        with_vowels: vowelsCb.checked,
        with_cantillation: cantCb.checked,
      });
    } catch (_) { data = null; }
    if (!data) {
      const hint = invalidRefHint(ref);
      previewBox.textContent = hint
        ? t("invalid_template", { hint })
        : t("preview_invalid");
      return;
    }
    const verses = [];
    for (const v of data.versions || []) {
      const tt = v.text;
      if (Array.isArray(tt)) {
        for (const s of tt) if (s) verses.push(typeof s === "string" ? s : flattenVerse(s));
      } else if (typeof tt === "string" && tt) {
        verses.push(tt);
      }
      if (verses.length) break;
    }
    if (!verses.length) {
      previewBox.textContent = t("preview_empty");
      return;
    }
    let sample = verses.slice(0, 3).join("\n\n");
    if (verses.length > 3) sample += `\n\n… ועוד ${verses.length - 3} פסוקים …`;
    previewBox.textContent = sample;
  }

  function flattenVerse(x) {
    if (Array.isArray(x)) return x.filter(y => y).map(flattenVerse).join(" ");
    return x === null || x === undefined ? "" : String(x);
  }

  function invalidRefHint(ref) {
    if (!currentBook) return null;
    const bt = meta.getBookType(currentBook);
    const rng = ref.indexOf(" ") !== -1 ? ref.split(" ").slice(1).join(" ") : ref;
    if (bt === meta.BOOK_TYPE_BAVLI || bt === meta.BOOK_TYPE_YERUSHALMI) {
      const last = rng[rng.length - 1];
      if (!rng || (last !== "a" && last !== "b" && rng.indexOf(":") === -1)) {
        return t("hint_talmud", { heb: meta.getHebrewName(currentBook) });
      }
    }
    if (bt === meta.BOOK_TYPE_TANAKH) {
      if (rng && !/^\d/.test(rng)) return t("hint_tanakh");
    }
    return null;
  }

  // ── Today (daf + parsha) ──
  function onToday() {
    const inner = el("div", { class: "sef-inner", style: { width: "min(420px, 90vw)" } },
      el("h3", null, t("today_pick")),
      el("button", {
        class: "sef-btn", style: { padding: "10px" },
        onclick: async () => {
          close();
          setStatus(t("status_seek_daf"), "gold");
          const ref = await api.getDailyDafRef();
          if (!ref) { modalInfo(t("today_no_daf"), t("today_no_daf"), "info"); return; }
          const parts = ref.split(" ");
          const lastBit = parts[parts.length - 1];
          const book = parts.slice(0, parts.length - 1).join(" ");
          if (book) {
            selectBook(book);
            setTimeout(() => { rangeInput.value = lastBit; syncRangeFromManual(); onRefreshCommentators(); }, 60);
          }
          setStatus(t("today_loaded_daf", { ref }), "success");
        },
      }, t("btn_today_daf")),
      el("button", {
        class: "sef-btn sef-gold", style: { padding: "10px" },
        onclick: async () => {
          close();
          setStatus(t("status_seek_parsha"), "gold");
          const ref = await api.getWeeklyParshaRef();
          if (!ref) { modalInfo(t("today_no_parsha"), t("today_no_parsha"), "info"); return; }
          const parts = ref.split(" ");
          const book = parts[0];  // Tanakh book is single token (Genesis)
          const rest = parts.slice(1).join(" ");
          if (book && meta.TANAKH_BOOKS.indexOf(book) !== -1) {
            selectBook(book);
            setTimeout(() => { rangeInput.value = rest; syncRangeFromManual(); onRefreshCommentators(); }, 60);
          }
          setStatus(t("today_loaded_parsha", { ref }), "success");
        },
      }, t("btn_today_parsha")),
      el("button", { class: "sef-btn sef-danger", onclick: () => close() }, t("btn_cancel_short"))
    );
    const { close } = innerModal(inner);
  }

  // ── Presets dialog (built-in + user CRUD) ──
  function onPresets() {
    const list = el("div", { style: { width: "min(520px, 90vw)", maxHeight: "60vh", overflow: "auto" } });
    const all = presets.listAllPresets();
    for (const name of Object.keys(all)) {
      const p = all[name];
      const builtin = presets.isBuiltin(name);
      const card = el("div", { class: "sef-preset-card" },
        el("div", { class: "sef-preset-name" }, `${builtin ? "🔒" : "👤"} ${name}`),
        p.description ? el("div", { class: "sef-preset-desc" }, p.description) : null,
        el("div", { style: { display: "flex", gap: "4px", flexDirection: isRTL ? "row-reverse" : "row", marginTop: "4px" } },
          el("button", { class: "sef-btn sef-gold sef-btn-sm", onclick: () => { applyPreset(name); close(); } }, t("btn_load_preset")),
          builtin ? null : el("button", {
            class: "sef-btn sef-danger sef-btn-sm",
            onclick: async () => {
              const yes = await modalYesNo(t("err_close_title"), t("preset_delete_confirm", { name }));
              if (!yes) return;
              const [ok, msg] = presets.deletePreset(name);
              setStatus(t(msg), ok ? "success" : "warn");
              close();
              onPresets();
            },
          }, t("btn_delete_preset"))
        )
      );
      list.appendChild(card);
    }
    const inner = el("div", { class: "sef-inner" },
      el("h3", null, t("presets_header")),
      list,
      el("div", { class: "sef-inner-actions" },
        el("button", { class: "sef-btn", onclick: () => importPresetsDialog() }, t("btn_import_json")),
        el("button", { class: "sef-btn", onclick: () => exportPresetsDialog() }, t("btn_export_json")),
        el("button", { class: "sef-btn sef-danger", onclick: () => close() }, t("btn_close_word"))
      )
    );
    const { close } = innerModal(inner);
  }

  function applyPreset(name) {
    const p = presets.getPreset(name);
    if (!p) return;
    vowelsCb.checked = !!p.vowels;
    cantCb.checked = !!p.cantillation;
    const wanted = Array.isArray(p.commentators) ? p.commentators.slice() : [];
    for (const ent of commentatorData) ent.selected = wanted.indexOf(ent.title) !== -1;
    const orderMap = {};
    wanted.forEach((n, i) => { orderMap[n] = i; });
    commentatorData.sort((a, b) => (orderMap[a.title] === undefined ? 9999 : orderMap[a.title]) - (orderMap[b.title] === undefined ? 9999 : orderMap[b.title]));
    renderCommentators();
    updateSummary();
    setStatus(t("preset_applied", { name }), "success");
  }

  async function onSavePreset() {
    if (!commentatorData.length) {
      modalInfo(t("err_required_title"), t("preset_save_no_data"), "warn");
      return;
    }
    const result = await modalPrompt(t("preset_save_title"), [
      { key: "name", label: t("preset_name_label"), value: "", placeholder: "" },
      { key: "desc", label: t("preset_desc_label"), value: "", placeholder: "" },
    ]);
    if (!result) return;
    if (!result.name) {
      modalInfo(t("err_required_title"), t("preset_save_no_name"), "warn");
      return;
    }
    const payload = {
      book_type: currentBook ? meta.getBookType(currentBook) : 1,
      commentators: commentatorData.filter(e => e.selected).map(e => e.title),
      vowels: vowelsCb.checked,
      cantillation: cantCb.checked,
      description: result.desc || "",
    };
    const [ok, msg] = presets.savePreset(result.name, payload);
    if (ok) setStatus(t("preset_saved", { name: result.name }), "success");
    else modalInfo(t("preset_save_failed"), t(msg), "error");
  }

  function importPresetsDialog() {
    const fi = el("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
    fi.addEventListener("change", () => {
      const f = fi.files && fi.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        let parsed;
        try { parsed = JSON.parse(r.result); }
        catch (e) {
          modalInfo(t("presets_import_done"), t("presets_skip_read_err", { err: e.message }), "error");
          return;
        }
        const { added, skipped } = presets.importPresetsFromObject(parsed, false);
        let msg = t("presets_imported", { n: added });
        if (skipped.length) {
          msg += "\n\n" + t("presets_skipped") + "\n";
          for (const s of skipped) {
            if (typeof s === "string") msg += t(s) + "\n";
            else if (s.key) msg += t(s.key, { name: s.name || "" }) + "\n";
          }
        }
        modalInfo(t("presets_import_done"), msg, "info");
      };
      r.readAsText(f, "utf-8");
    });
    document.body.appendChild(fi);
    fi.click();
    setTimeout(() => { try { fi.remove(); } catch (_) {} }, 1000);
  }

  function exportPresetsDialog() {
    const { blob, count } = presets.exportPresetsBlob();
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "sefaria_presets.json" });
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (_) {} }, 200);
    modalInfo(t("presets_export_done"), t("presets_exported", { n: count }), "info");
  }

  // ── Cache refresh, log viewer ──
  function onRefreshCache() {
    if (!currentBook) {
      modalInfo(t("cache_refresh_title"), t("cache_select_book"), "info");
      return;
    }
    const n = api.cacheInvalidate(null);
    modalInfo(t("cache_refresh_title"), t("cache_refresh_msg", { n }), "info");
  }

  function onViewLog() {
    const text = api.readErrorLog(200) || t("log_not_yet");
    const pre = el("pre", null, text);
    const inner = el("div", { class: "sef-inner", style: { width: "min(780px, 92vw)", maxWidth: "90vw" } },
      el("h3", null, t("log_title")),
      el("div", { style: { fontFamily: "Consolas, monospace", fontSize: "10px", color: "var(--sef-muted)" } }, "(localStorage)"),
      pre,
      el("div", { class: "sef-inner-actions" },
        el("button", { class: "sef-btn", onclick: () => { pre.textContent = api.readErrorLog(200) || t("log_empty"); } }, t("btn_log_refresh")),
        el("button", { class: "sef-btn sef-danger", onclick: () => { api.clearErrorLog(); pre.textContent = t("log_empty"); } }, t("btn_log_clear")),
        el("button", { class: "sef-btn sef-gold", onclick: () => close() }, t("btn_close_word"))
      )
    );
    const { close } = innerModal(inner);
  }

  // ── Close ──
  async function onClose() {
    if (exportInProgress) {
      const yes = await modalYesNo(t("err_close_title"), t("err_close_running"));
      if (!yes) return;
      cancelFlag = true;
    }
    try { overlay.remove(); } catch (_) {}
  }

  // ── Export — the main action ──
  async function onExport(loadIntoEditor) {
    if (exportInProgress) {
      modalInfo(t("err_export_in_progress_title"), t("err_export_in_progress"), "warn");
      return;
    }
    if (!currentBook) {
      modalInfo(t("err_required_title"), t("err_no_book"), "warn");
      return;
    }
    const ref = buildRef();
    if (!ref) {
      modalInfo(t("err_required_title"), t("err_no_range"), "warn");
      return;
    }
    const selected = commentatorData.filter(e => e.selected);
    const yes = await confirmExportModal(ref, selected);
    if (!yes) return;

    cancelFlag = false;
    exportInProgress = true;
    cancelBtn.disabled = false;
    exportLoadBtn.disabled = true;
    exportOnlyBtn.disabled = true;

    try {
      await doExport(ref, selected, loadIntoEditor);
    } catch (e) {
      setStatus("❌ " + (e && e.message ? e.message : String(e)), "warn");
      modalInfo(t("err_export"), t("err_export_done_template", { err: e && e.message ? e.message : String(e), path: "log" }), "error");
    } finally {
      exportInProgress = false;
      cancelBtn.disabled = true;
      exportLoadBtn.disabled = false;
      exportOnlyBtn.disabled = false;
      setProgress(0);
    }
  }

  function confirmExportModal(ref, selected) {
    const book = meta.getHebrewName(currentBook);
    const rng = (ref.replace(currentBook, "").trim()) || t("confirm_range_all");
    const names = selected.slice(0, 5).map(e => e.heb).join(", ");
    const more = selected.length > 5 ? t("confirm_more_template", { n: selected.length - 5 }) : "";
    const tmin = Math.max(2, selected.length * 2);
    const tmax = selected.length * 5 + 5;
    const msg = t("confirm_template", { book, rng, n: selected.length, names, more, tmin, tmax });
    return modalYesNo(t("confirm_title"), msg);
  }

  async function doExport(ref, selected, loadIntoEditor) {
    setStatus(t("status_loading_book_text", { ref }), "gold");
    setProgress(0.05);
    if (cancelFlag) return cancelled();

    const textData = await api.getText(ref, {
      with_vowels: vowelsCb.checked,
      with_cantillation: cantCb.checked,
    });
    if (!textData) throw new Error(t("err_text_load_fail"));

    function flatten(x) {
      if (Array.isArray(x)) return x.filter(y => y).map(flatten).join(" ");
      return x === null || x === undefined ? "" : String(x);
    }

    let rawText = null;
    for (const v of textData.versions || []) {
      if (v.text) { rawText = v.text; break; }
    }
    if (rawText === null) throw new Error(t("err_empty_text"));

    const segments = expandToSegments(ref, rawText, flatten);
    if (!segments.length) throw new Error(t("err_empty_text"));

    const nSegs = segments.length;
    setStatus(t("status_collecting_segs"), "gold");

    const commentatorToIdx = {};
    selected.forEach((ent, i) => { commentatorToIdx[ent.title] = i; });

    const units = [];
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      if (cancelFlag) return cancelled();
      const [segRef, vText] = segments[segIdx];
      const pct = 0.10 + 0.80 * (segIdx / Math.max(1, nSegs));
      setProgress(pct);
      setStatus(t("status_loading_seg_links", { i: segIdx + 1, n: nSegs }), "gold");
      let segLinks = [];
      try {
        segLinks = (await api.getLinks(segRef, true)) || [];
      } catch (_) { segLinks = []; }

      const commentary = {};
      for (const link of segLinks) {
        if (!link || link.type !== "commentary") continue;
        const ct = link.collectiveTitle || {};
        const commentator = ct.en;
        if (!commentator || !(commentator in commentatorToIdx)) continue;
        const streamIdx = commentatorToIdx[commentator];
        let heText = flatten(link.he || "").trim();
        if (!heText) continue;
        if (heText.indexOf("data:") === 0 || heText.indexOf("<img") === 0) continue;
        if (heText.length >= 10000) continue;
        const dh = extractDh(heText);
        const pos = dh ? findDhPosition(vText, dh) : null;
        if (!commentary[streamIdx]) commentary[streamIdx] = [];
        commentary[streamIdx].push({ text: heText, pos });
      }
      units.push({ main_text: vText, commentary });
    }

    if (cancelFlag) return cancelled();

    // Build streams_meta
    const streamsMeta = selected.map((ent, sIdx) => {
      const info = meta.getCommentatorInfo(ent.title);
      const num = sIdx + 1;
      const marker = "@" + (num < 10 ? "0" + num : String(num));
      return {
        marker,
        title: ent.heb,
        english_title: ent.title,
        color: ent.color,
        font: meta.getDefaultFont(info.font_pref),
        source_type: "footnote",
        layout: "twocol",
        num_cols: 2,
        num_style_cmd: "\\arabic",
        before_mark: "",
        after_mark: ".",
      };
    });

    setStatus(t("status_building_docx"), "gold");
    setProgress(0.92);
    const safeBook = currentBook.replace(/ /g, "_");
    const ts = Math.floor(Date.now() / 1000);
    const filename = `${safeBook}_${ts}.docx`;
    const docTitle = `${meta.getHebrewName(currentBook)} — ספריא`;
    const { blob } = buildAndDownloadDocx(units, streamsMeta, docTitle, filename);

    presets.pushRecent(currentBook, ref);
    refreshRecent();

    setProgress(1.0);
    setStatus(t("status_saved", { path: filename }), "success");

    if (loadIntoEditor && typeof opts.loadDocxIntoEditor === "function") {
      try {
        await opts.loadDocxIntoEditor(blob, filename);
        setStatus(t("status_loaded_to_app"), "success");
      } catch (e) {
        setStatus("❌ " + (e && e.message ? e.message : String(e)), "warn");
      }
    } else if (!loadIntoEditor) {
      modalInfo(t("export_done_title"), t("export_done_msg", { path: filename }), "info");
    }
  }

  function cancelled() {
    setStatus(t("status_cancelled"), "warn");
    setProgress(0);
  }

  function expandToSegments(ref, rawText, flatten) {
    const parts = ref.indexOf(" ") !== -1 ? [ref.split(" ")[0], ref.split(" ").slice(1).join(" ")] : [ref, ""];
    const book = parts[0];
    const rng = parts[1];
    const btype = book ? meta.getBookType(book) : null;
    const isTalmud = btype === meta.BOOK_TYPE_BAVLI || btype === meta.BOOK_TYPE_YERUSHALMI;

    if (typeof rawText === "string") {
      return rawText.trim() ? [[ref, rawText]] : [];
    }
    if (!Array.isArray(rawText) || !rawText.length) return [];

    const allStrings = rawText.every(x => typeof x === "string");
    if (allStrings) {
      if (rng && rng.indexOf(":") !== -1) {
        return rawText.filter(s => s && s.trim()).map(s => [ref, s]);
      }
      const out = [];
      for (let i = 0; i < rawText.length; i++) {
        const s = rawText[i];
        if (!s || !s.trim()) continue;
        const segRef = rng ? `${book} ${rng}:${i + 1}` : `${ref}:${i + 1}`;
        out.push([segRef, s]);
      }
      return out;
    }

    // Bavli "99" → [[99a_segs], [99b_segs]]
    if (isTalmud && rawText.length === 2 && rng &&
        !rng.endsWith("a") && !rng.endsWith("b") &&
        Array.isArray(rawText[0]) && Array.isArray(rawText[1])) {
      const out = [];
      const sides = ["a", "b"];
      for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
        const side = sides[sideIdx];
        const segs = rawText[sideIdx] || [];
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (!s) continue;
          const sFlat = flatten(s);
          if (!sFlat.trim()) continue;
          out.push([`${book} ${rng}${side}:${i + 1}`, sFlat]);
        }
      }
      return out;
    }

    // Bavli "99a" already singular but API returned [[segs]] — unwrap once
    if (isTalmud && rawText.length === 1 && Array.isArray(rawText[0])) {
      return expandToSegments(ref, rawText[0], flatten);
    }

    // Tanakh / other nested
    let startCh = 1;
    try {
      if (rng) startCh = parseInt(rng.split("-")[0].split(":")[0], 10) || 1;
    } catch (_) { startCh = 1; }
    const out = [];
    for (let chOff = 0; chOff < rawText.length; chOff++) {
      const section = rawText[chOff];
      if (!Array.isArray(section)) {
        const sFlat = flatten(section);
        if (sFlat.trim()) out.push([`${book} ${startCh + chOff}`, sFlat]);
        continue;
      }
      const chNum = startCh + chOff;
      for (let vIdx = 0; vIdx < section.length; vIdx++) {
        const s = section[vIdx];
        if (!s) continue;
        const sFlat = flatten(s);
        if (!sFlat.trim()) continue;
        const segRef = book ? `${book} ${chNum}:${vIdx + 1}` : `${chNum}:${vIdx + 1}`;
        out.push([segRef, sFlat]);
      }
    }
    return out;
  }

  // Init summary now that all UI is wired
  updateSummary();

  return { close: () => { try { overlay.remove(); } catch (_) {} } };
}
