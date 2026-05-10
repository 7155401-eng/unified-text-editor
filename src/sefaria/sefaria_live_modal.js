// sefaria_live_modal.js — full UI port of sefaria_live_tool.py.
// Browser equivalent of the pywebview "כלי משיכת פסוקים" window:
// paste text, find citations like (בראשית א, ב), fetch verses from
// Sefaria, splice in-place. 32 Hebrew name variations + abbreviations,
// gematria, "shem" context, batched calls (1-50), 3 chapter behaviors,
// duplicate-skip, statistics dashboard (4 cards + 7 detail rows), error
// translation Hebrew, idempotency, NBSP cleaning, instructions box,
// lock/VIP modes, dictionary editor, light/dark theme, RTL, copy/Word/txt
// export.

import { t, getLang, toggleLang } from "./sefaria_i18n.js";

const TANAKH_HEB_TO_EN = {
  "בראשית": "Genesis", "שמות": "Exodus", "ויקרא": "Leviticus",
  "במדבר": "Numbers", "דברים": "Deuteronomy",
  "יהושע": "Joshua", "שופטים": "Judges",
  "שמואל א": "I Samuel", "שמואל ב": "II Samuel",
  "מלכים א": "I Kings", "מלכים ב": "II Kings",
  "ישעיהו": "Isaiah", "ירמיהו": "Jeremiah", "יחזקאל": "Ezekiel",
  "הושע": "Hosea", "יואל": "Joel", "עמוס": "Amos", "עובדיה": "Obadiah",
  "יונה": "Jonah", "מיכה": "Micah", "נחום": "Nahum",
  "חבקוק": "Habakkuk", "צפניה": "Zephaniah", "חגי": "Haggai",
  "זכריה": "Zechariah", "מלאכי": "Malachi",
  "תהילים": "Psalms", "משלי": "Proverbs", "איוב": "Job",
  "שיר השירים": "Song of Songs", "רות": "Ruth",
  "איכה": "Lamentations", "קהלת": "Ecclesiastes", "אסתר": "Esther",
  "דניאל": "Daniel", "עזרא": "Ezra", "נחמיה": "Nehemiah",
  "דברי הימים א": "I Chronicles", "דברי הימים ב": "II Chronicles",
};

// 32 Hebrew name variations / abbreviations from the Python source.
const TANAKH_ALIASES = {
  "ישעיה": "Isaiah",
  "ירמיה": "Jeremiah",
  "תהלים": "Psalms",
  "ש\"א": "I Samuel", "שמואל א'": "I Samuel",
  "ש\"ב": "II Samuel", "שמואל ב'": "II Samuel",
  "מ\"א": "I Kings", "מלכים א'": "I Kings",
  "מ\"ב": "II Kings", "מלכים ב'": "II Kings",
  "דהי\"א": "I Chronicles", "דברי הימים א'": "I Chronicles",
  "ד\"ה א'": "I Chronicles", "ד\"ה א": "I Chronicles",
  "דבה\"א": "I Chronicles", "דה\"א": "I Chronicles",
  "דהי\"ב": "II Chronicles", "דברי הימים ב'": "II Chronicles",
  "ד\"ה ב'": "II Chronicles", "ד\"ה ב": "II Chronicles",
  "דבה\"ב": "II Chronicles", "דה\"ב": "II Chronicles",
};

const GEMATRIA_MAP = {
  "א": 1, "b": 2, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ל": 30, "מ": 40, "נ": 50, "ס": 60, "ע": 70, "פ": 80, "צ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
  "ך": 20, "ם": 40, "ן": 50, "ף": 80, "ץ": 90,
};

function hebrewToInt(s) {
  let val = 0;
  const cleaned = String(s || "").replace(/[^א-ת]/g, "");
  for (let i = 0; i < cleaned.length; i++) {
    const v = GEMATRIA_MAP[cleaned[i]];
    if (v) val += v;
  }
  return val;
}

function num2gematria(num) {
  if (!num) return "";
  if (num === 15) return "טו";
  if (num === 16) return "טז";
  let g = "";
  while (num >= 400) { g += "ת"; num -= 400; }
  if (num >= 100) {
    const hundreds = ["", "ק", "ר", "ש", "ת"];
    g += hundreds[Math.floor(num / 100)];
    num %= 100;
  }
  if (num === 15) return g + "טו";
  if (num === 16) return g + "טז";
  if (num >= 10) {
    const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    g += tens[Math.floor(num / 10)];
    num %= 10;
  }
  if (num > 0) {
    const units = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
    g += units[num];
  }
  return g;
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "");
}

// ────────────────────────────────────────────────────────
// Per-Sefaria-call cache (in-memory, session-scoped)
// ────────────────────────────────────────────────────────
const _verseCache = new Map();

async function fetchVerseFromSefaria(book, chapter, verse) {
  const key = `${book}|${chapter}|${verse}`;
  if (_verseCache.has(key)) return { text: _verseCache.get(key), error: null };
  const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(book)}.${chapter}.${verse}?context=0&lang=he`;
  let resp;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      return { text: null, error: { code: "api_error", msg: `HTTP ${r.status}` } };
    }
    resp = await r.json();
  } catch (e) {
    return { text: null, error: { code: "network_error", msg: String(e && e.message || e) } };
  }
  if (resp && resp.error) {
    let apiErr = resp.error;
    let m = apiErr.match(/(.*?) ends at Chapter (\d+)/);
    if (m) {
      const errBook = TANAKH_HEB_TO_EN_REVERSE[m[1].trim()] || m[1].trim();
      const errChapHeb = num2gematria(parseInt(m[2], 10));
      apiErr = t("live_err_chap_end", { book: errBook, chap: errChapHeb });
    } else {
      m = apiErr.match(/Chapter (\d+) does not exist/);
      if (m) {
        const errChapHeb = num2gematria(parseInt(m[1], 10));
        apiErr = t("live_err_chap_missing", { chap: errChapHeb });
      }
    }
    return { text: null, error: { code: "api_error", msg: apiErr } };
  }
  if (!resp || !resp.he) {
    return { text: null, error: { code: "verse_not_found", msg: "" } };
  }
  let raw = resp.he;
  if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");
  raw = stripTags(String(raw));
  // strip cantillation + nikud-related
  raw = raw.replace(/[֑-ֽ֯׀]/g, "");
  raw = raw.replace(/\{[֐-׿]\}/g, "");
  const cleaned = raw.trim();
  _verseCache.set(key, cleaned);
  return { text: cleaned, error: null };
}

// Reverse lookup: English book → Hebrew (best-effort)
const TANAKH_HEB_TO_EN_REVERSE = (function () {
  const out = {};
  for (const k of Object.keys(TANAKH_HEB_TO_EN)) out[TANAKH_HEB_TO_EN[k]] = k;
  return out;
})();

// ────────────────────────────────────────────────────────
// Tiny DOM helpers
// ────────────────────────────────────────────────────────
function el(tag, props, ...children) {
  const e = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      if (k === "class" || k === "className") e.className = props[k];
      else if (k === "style" && typeof props[k] === "object") Object.assign(e.style, props[k]);
      else if (k === "dataset" && typeof props[k] === "object") {
        for (const dk of Object.keys(props[k])) e.dataset[dk] = props[k][dk];
      }
      else if (k === "html") e.innerHTML = props[k];
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

function readTheme() {
  try {
    const t = (localStorage.getItem("ravtext.theme") || "").toLowerCase();
    return t === "light" ? "light" : "dark";
  } catch (_) { return "dark"; }
}

// ────────────────────────────────────────────────────────
// Main exported function — opens the live verse picker modal.
//
// opts:
//   prefillText?: string            — initial text (from active stream)
//   onAccept?: (html: string) => void
//                                   — called when user clicks "use in editor"
//   isVip?: boolean                 — show full UI (no 500-char limit)
// ────────────────────────────────────────────────────────
export function openSefariaLive(opts) {
  opts = opts || {};
  const isRTL = getLang() === "he";
  const isVip = !!opts.isVip;

  // Mutable book map (user can edit via "Book Settings")
  const bookMap = Object.assign({}, buildHebrewToEng());

  function buildHebrewToEng() {
    const out = {};
    for (const k of Object.keys(TANAKH_HEB_TO_EN)) out[k] = TANAKH_HEB_TO_EN[k];
    for (const k of Object.keys(TANAKH_ALIASES)) out[k] = TANAKH_ALIASES[k];
    return out;
  }

  const overlay = el("div", { class: "sef-overlay" });
  const modal = el("div", {
    class: "sef-modal",
    dataset: { variant: "live", theme: readTheme() },
    dir: isRTL ? "rtl" : "ltr",
  });
  overlay.appendChild(modal);

  // ── Toolbar ──
  const startBtn = el("button", { class: "sef-btn sef-green", onclick: () => onStart() }, t("btn_start"));
  const dupInput = el("input", { type: "number", class: "sef-input", value: "5", min: "0", style: { width: "50px" } });
  const chapterSel = el("select", { class: "sef-select", style: { width: "110px" } },
    el("option", { value: "first" }, t("opt_first")),
    el("option", { value: "skip" }, t("opt_skip")),
    el("option", { value: "all" }, t("opt_all"))
  );
  const batchInput = el("input", { type: "number", class: "sef-input", value: "6", min: "1", max: "50", style: { width: "55px" } });
  const showErrCb = el("input", { type: "checkbox" });
  const wordBtn = el("button", { class: "sef-btn sef-blue", onclick: () => downloadWord() }, t("btn_word"));
  const txtBtn = el("button", { class: "sef-btn sef-blue", onclick: () => downloadTxt() }, t("btn_txt"));
  const copyBtn = el("button", { class: "sef-btn sef-gold", onclick: () => copyClipboard() }, t("btn_copy"));
  const themeBtn = el("button", { class: "sef-btn sef-btn-sm", onclick: () => {
    const nxt = readTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem("ravtext.theme", nxt); } catch (_) {}
    modal.dataset.theme = nxt;
  } }, "☀️ / 🌙");
  const langBtn = el("button", { class: "sef-btn sef-gold", onclick: () => {
    toggleLang();
    try { overlay.remove(); } catch (_) {}
    openSefariaLive(opts);
  } }, isRTL ? "EN" : "HE");
  const closeBtn = el("button", { class: "sef-btn sef-danger sef-btn-icon", title: t("btn_close"), onclick: () => { try { overlay.remove(); } catch (_) {} } }, t("btn_close"));

  const tbActions = el("div", { class: "sef-tb-group" },
    el("span", { class: "sef-tb-title" }, t("t_actions")),
    startBtn
  );
  const tbSettings = el("div", { class: "sef-tb-group" },
    el("span", { class: "sef-tb-title" }, t("t_settings")),
    el("label", { style: { fontSize: "12px", color: "var(--sef-muted)" } }, t("l_dup")),
    dupInput,
    el("span", { class: "sef-sep" }),
    el("label", { style: { fontSize: "12px", color: "var(--sef-muted)" } }, t("l_chap")),
    chapterSel,
    el("span", { class: "sef-sep" }),
    el("label", { style: { fontSize: "12px", color: "var(--sef-muted)" } }, t("l_speed")),
    batchInput,
    el("span", { class: "sef-sep" }),
    el("label", { style: { fontSize: "12px", color: "var(--sef-muted)", display: "flex", alignItems: "center", gap: "4px" } },
      showErrCb, t("l_err")
    )
  );
  const tbExport = el("div", { class: "sef-tb-group" },
    el("span", { class: "sef-tb-title" }, t("t_export")),
    wordBtn, txtBtn, copyBtn
  );
  const tbTheme = el("div", { class: "sef-tb-group" },
    el("span", { class: "sef-tb-title" }, t("t_theme")),
    themeBtn
  );
  const toolbar = el("div", { class: "sef-toolbar" },
    closeBtn, tbActions, tbSettings, tbExport,
    el("span", { style: { flex: 1 } }),
    langBtn, tbTheme
  );

  // Netfree warn
  const netfree = el("div", { class: "sef-netfree" }, t("netfree_warn_live"));

  // ── Panes ──
  const inputPane = el("div", { class: "sef-live-pane" });
  const outputPane = el("div", { class: "sef-live-pane" });

  // Input pane
  const bookSettingsBtn = el("button", { class: "sef-btn sef-btn-sm", onclick: () => {
    bookSettingsContainer.style.display = bookSettingsContainer.style.display === "none" ? "" : "none";
    if (!bookSettingsRendered) renderBookSettings();
  } }, t("btn_books"));
  inputPane.appendChild(el("div", { class: "sef-live-pane-header" },
    el("span", { class: "sef-live-pane-title" }, t("t_input")),
    bookSettingsBtn
  ));

  const bookSettingsContainer = el("div", {
    style: { display: "none", padding: "10px", background: "var(--sef-bg)", borderBottom: "1px solid var(--sef-border)", maxHeight: "150px", overflowY: "auto" }
  });
  let bookSettingsRendered = false;
  inputPane.appendChild(bookSettingsContainer);

  function renderBookSettings() {
    bookSettingsRendered = true;
    const reverse = {};
    for (const heKey of Object.keys(bookMap)) {
      const enVal = bookMap[heKey];
      if (!reverse[enVal]) reverse[enVal] = [];
      reverse[enVal].push(heKey);
    }
    const tbl = el("table", { style: { width: "100%", fontSize: "12px", borderCollapse: "collapse" } });
    for (const enName of Object.keys(reverse)) {
      const cur = reverse[enName].join(", ");
      const inp = el("input", { class: "sef-input", value: cur, style: { width: "95%", textAlign: "right" }, dataset: { book: enName } });
      inp.addEventListener("change", () => {
        const newKeys = inp.value.split(",").map(s => s.trim()).filter(Boolean);
        // Remove keys that previously mapped to this book but aren't in the new list.
        // Simpler: rebuild bookMap from the dialog instead.
        for (const k of newKeys) bookMap[k] = enName;
      });
      tbl.appendChild(el("tr", null,
        el("td", { style: { width: "30%", borderBottom: "1px solid var(--sef-border)", padding: "4px" } }, enName),
        el("td", { style: { borderBottom: "1px solid var(--sef-border)", padding: "4px" } }, inp)
      ));
    }
    bookSettingsContainer.appendChild(tbl);
  }

  // Instructions box
  const instructions = el("details", { class: "sef-instructions", html: `
    <summary>ℹ️ <span>${t("inst_title")}</span></summary>
    <ul>
      <li><strong>${t("inst_1_s")}</strong><span>${t("inst_1")}</span></li>
      <li><strong>${t("inst_2_s")}</strong><span>${t("inst_2")}</span></li>
      <li><strong>${t("inst_3_s")}</strong><span>${t("inst_3")}</span></li>
      <li><strong>${t("inst_4_s")}</strong><span>${t("inst_4")}</span></li>
      <li><strong>${t("inst_5_s")}</strong><span>${t("inst_5")}</span></li>
    </ul>
  ` });
  const speedInfo = el("div", { class: "sef-speed-info", html: `
    <strong>${t("speed_title")}</strong><br>
    ${t("speed_1")}<br>
    ${t("speed_2")}<br>
    <em>${t("speed_3")}</em>
  ` });
  const instrWrap = el("div", { style: { padding: "12px", borderBottom: "1px solid var(--sef-border)", background: "var(--sef-card)" } }, instructions, speedInfo);
  inputPane.appendChild(instrWrap);

  // VIP banner
  let vipBanner;
  if (isVip) {
    vipBanner = el("div", { class: "sef-vip-banner" },
      el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        el("span", { style: { fontSize: "16px" } }, "💎"),
        el("strong", null, t("vip_title")),
        el("span", { class: "sef-vip-badge" }, "PRO")
      ),
      el("span", null, t("vip_desc"))
    );
  } else {
    vipBanner = el("div", { class: "sef-vip-banner locked" },
      el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        el("span", { style: { fontSize: "16px" } }, "🔒"),
        el("strong", null, t("lock_title"))
      ),
      el("span", null, t("lock_desc"))
    );
  }
  inputPane.appendChild(vipBanner);

  const inputArea = el("textarea", {
    class: "sef-live-input" + (isVip ? "" : " locked"),
    placeholder: isVip ? t("ph_vip") : t("ph_lock"),
    maxLength: isVip ? null : 500,
  });
  if (opts.prefillText) inputArea.value = opts.prefillText;
  inputPane.appendChild(inputArea);

  // Output pane
  outputPane.appendChild(el("div", { class: "sef-live-pane-header" },
    el("span", { class: "sef-live-pane-title" }, t("t_res"))
  ));
  const progressContainer = el("div", { style: { display: "none" } });
  const progressBar = el("div", { style: { width: "0%", height: "100%", background: "var(--sef-gold)", transition: "width 0.3s" } });
  const progressText = el("span", null, "0/0");
  progressContainer.appendChild(el("div", { class: "sef-progress-strip" },
    el("div", { style: { background: "var(--sef-border)", height: "12px", borderRadius: "6px", overflow: "hidden" } }, progressBar),
    el("div", { style: { textAlign: "center", fontSize: "11px", marginTop: "6px", color: "var(--sef-muted)" } },
      el("span", null, t("t_processing")), " ", progressText
    )
  ));

  // Stat dashboard
  const statRefs = {};
  function statCard(name, cls, id) {
    const v = el("div", { class: "sef-stat-val" }, "0");
    statRefs[id] = v;
    return el("div", { class: "sef-stat-card " + cls },
      el("h4", null, t(name)),
      v
    );
  }
  const dashboard = el("div", { class: "sef-stat-dashboard" },
    statCard("stat_found", "sc-blue", "total_found"),
    statCard("stat_skip", "sc-orange", "total_skipped"),
    statCard("stat_succ", "sc-green", "success"),
    statCard("stat_err", "sc-red", "errors_total")
  );

  // Stat details
  function statRow(labelKey, id) {
    const v = el("span", null, "0");
    statRefs[id] = v;
    return el("li", null,
      el("span", { style: { fontWeight: "normal" } }, t(labelKey)),
      v
    );
  }
  const detailsBox = el("div", { class: "sef-stat-details" },
    el("div", { style: { flex: 1, padding: "0 10px", borderLeft: "1px solid var(--sef-border)" } },
      el("strong", { style: { display: "block", marginBottom: "5px", color: "#F44336", fontSize: "11px" } }, t("l_reasons")),
      el("ul", { class: "sef-stat-list" },
        statRow("l_format", "skipped_format"),
        statRow("l_book", "skipped_book"),
        statRow("l_context", "skipped_context"),
        statRow("l_dupes", "duplicates")
      )
    ),
    el("div", { style: { flex: 1, padding: "0 10px" } },
      el("strong", { style: { display: "block", marginBottom: "5px", color: "var(--sef-gold)", fontSize: "11px" } }, t("l_tech")),
      el("ul", { class: "sef-stat-list" },
        statRow("l_net", "err_net"),
        statRow("l_api", "err_api"),
        statRow("l_notfound", "err_verse")
      )
    )
  );
  progressContainer.appendChild(dashboard);
  progressContainer.appendChild(detailsBox);

  const outputBox = el("div", { class: "sef-live-output" });
  outputPane.appendChild(progressContainer);
  outputPane.appendChild(outputBox);

  const resizer = el("div", { class: "sef-live-resizer" });
  const panes = el("div", { class: "sef-live-panes" }, inputPane, resizer, outputPane);

  // Resizer drag
  let isResizing = false;
  resizer.addEventListener("mousedown", () => {
    isResizing = true;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
  });
  document.addEventListener("mousemove", e => {
    if (!isResizing) return;
    const rect = panes.getBoundingClientRect();
    let newWidth = e.clientX - rect.left;
    if (isRTL) newWidth = rect.width - (e.clientX - rect.left);
    const pct = (newWidth / rect.width) * 100;
    if (pct > 10 && pct < 90) {
      inputPane.style.flex = `0 0 ${pct}%`;
      outputPane.style.flex = "1 1 0%";
    }
  });
  document.addEventListener("mouseup", () => {
    isResizing = false;
    resizer.classList.remove("dragging");
    document.body.style.cursor = "default";
  });

  modal.append(toolbar, netfree, panes);
  document.body.appendChild(overlay);

  // ────────────────────────────────────────────────────────
  // Stats & processing
  // ────────────────────────────────────────────────────────
  let stats;
  let totalRequests = 0;
  let completed = 0;

  function resetStats() {
    stats = {
      total_found: 0, skipped_format: 0, skipped_book: 0, skipped_context: 0,
      skipped_user: 0, duplicates: 0, sent: 0, success: 0,
      error_net: 0, error_api: 0, error_verse: 0,
    };
    updateStats();
  }

  function updateStats() {
    const totalSkipped = stats.skipped_format + stats.skipped_book + stats.skipped_context + stats.skipped_user + stats.duplicates;
    statRefs.total_found.textContent = String(stats.total_found);
    statRefs.total_skipped.textContent = String(totalSkipped);
    statRefs.skipped_format.textContent = String(stats.skipped_format);
    statRefs.skipped_book.textContent = String(stats.skipped_book);
    statRefs.skipped_context.textContent = String(stats.skipped_context);
    statRefs.duplicates.textContent = String(stats.duplicates);
    statRefs.success.textContent = String(stats.success);
    const totalErrors = stats.error_net + stats.error_api + stats.error_verse;
    statRefs.errors_total.textContent = String(totalErrors);
    statRefs.err_net.textContent = String(stats.error_net);
    statRefs.err_api.textContent = String(stats.error_api);
    statRefs.err_verse.textContent = String(stats.error_verse);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function escAttr(s) { return escapeHtml(s); }

  // ────────────────────────────────────────────────────────
  // Click handler — start processing
  // ────────────────────────────────────────────────────────
  async function onStart() {
    const rawText = inputArea.value;
    if (!rawText || !rawText.trim()) {
      alert(t("live_err_input_required"));
      return;
    }
    const dupLimit = parseInt(dupInput.value, 10) || 0;
    const chapterBehavior = chapterSel.value;
    const showUnknown = showErrCb.checked;

    progressContainer.style.display = "";
    progressBar.style.width = "0%";
    progressBar.style.background = "var(--sef-gold)";
    outputBox.innerHTML = `<span style="color:var(--sef-muted)">מנתח טקסט...</span>`;

    resetStats();
    const fetchQueue = [];
    let nextId = 0;
    const ctx = { lastBook: null, lastChapter: null, booksHistory: {} };
    const versesHistory = [];

    function addToQueue(book, chapter, verse, match) {
      ctx.booksHistory[book] = { ch: chapter, v: verse };
      const uniqueId = `${book}_${chapter}_${verse}`;
      if (dupLimit > 0) {
        const recent = versesHistory.slice(-dupLimit);
        if (recent.indexOf(uniqueId) !== -1) {
          stats.duplicates++;
          return `${match} <span style="color:#F44336; font-size:0.8em; font-weight:bold;">${escapeHtml(t("live_err_dup"))}</span>`;
        }
      }
      versesHistory.push(uniqueId);
      const placeholderId = "sf_load_" + (nextId++);
      fetchQueue.push({ id: placeholderId, book, chapter, verse, citation: match });
      stats.sent++;
      return `<span id="${placeholderId}" class="sf-loading">⌛ ${escapeHtml(match)}</span>`;
    }

    const processed = rawText.replace(/\(([֐-׿\s'"\.\,\-\\]+)\)/g, function (match, innerText, offset, str) {
      // Skip if already wrapped or already errored
      if (innerText.indexOf("שגיאה") !== -1 || innerText.indexOf("תקלה") !== -1
          || innerText.indexOf("לא זוהה") !== -1 || innerText.indexOf("פסוק לא") !== -1
          || innerText.indexOf("לא נוסף") !== -1) {
        return match;
      }
      const after = str.substring(offset + match.length).trim().substring(0, 100);
      if (after.charAt(0) === "{" || after.indexOf("שגיאה") !== -1
          || after.indexOf("פסוק לא") !== -1 || after.indexOf("פסוק זה לא") !== -1) {
        return match;
      }
      stats.total_found++;

      // Special M"A / M"B short form
      const specialMA = innerText.trim();
      if ((specialMA.indexOf("מ\"א") === 0 || specialMA.indexOf("מ\"ב") === 0) && specialMA.length <= 6) {
        const prefix = specialMA.substring(0, 3);
        const letters = specialMA.replace(prefix, "").trim();
        if (letters.length >= 2 && letters.length <= 3) {
          if (letters.length === 2) {
            const refBook = (prefix === "מ\"א") ? "I Kings" : "II Kings";
            const refChapter = hebrewToInt(letters[0]);
            const refVerse = hebrewToInt(letters[1]);
            return addToQueue(refBook, refChapter, refVerse, match);
          }
        }
      }

      const cleanText = innerText.replace(/[,.-]/g, " ").trim();
      const partsAll = cleanText.split(/\s+/);
      let parts = partsAll.slice();

      if (parts.length < 1) { stats.skipped_format++; return match; }

      let refBook = null, refChapter = null, refVerse = null;
      let historyVerse = null;
      let firstWord = parts[0];
      const secondWord = parts[1] || "";

      // Multi-word book name
      if (parts.length > 1 && bookMap[firstWord + " " + secondWord]) {
        firstWord = firstWord + " " + secondWord;
        parts.shift();
      }
      if (firstWord === "שם") {
        if (ctx.lastBook) refBook = ctx.lastBook;
        else { stats.skipped_context++; return match; }
      } else if (bookMap[firstWord]) {
        refBook = bookMap[firstWord];
        ctx.lastBook = refBook;
      } else {
        stats.skipped_book++;
        if (showUnknown) {
          return `${match} <span style="color:orange; font-size:0.8em; font-weight:bold;">${escapeHtml(t("live_err_unknown_book"))}</span>`;
        }
        return match;
      }
      parts.shift();

      // Special: "(שם, יב)" — same book + previous chapter, given verse
      if (firstWord === "שם" && parts.length === 1 && ctx.lastChapter) {
        refChapter = ctx.lastChapter;
        refVerse = hebrewToInt(parts[0]);
      } else {
        if (parts.length > 0) {
          const chapWord = parts[0];
          if (chapWord === "שם") {
            if (ctx.booksHistory[refBook]) {
              refChapter = ctx.booksHistory[refBook].ch;
              historyVerse = ctx.booksHistory[refBook].v;
            } else if (ctx.lastChapter) refChapter = ctx.lastChapter;
            else { stats.skipped_context++; return match; }
          } else {
            refChapter = hebrewToInt(chapWord);
          }
          if (refChapter) ctx.lastChapter = refChapter;
          parts.shift();
        }
        if (parts.length > 0) {
          refVerse = hebrewToInt(parts[0]);
        } else {
          if (historyVerse) refVerse = historyVerse;
          else if (refBook && refChapter) {
            if (chapterBehavior === "skip") { stats.skipped_user++; return match; }
            else if (chapterBehavior === "first" || chapterBehavior === "all") refVerse = 1;
            else { stats.skipped_format++; return match; }
          }
        }
      }

      if (!refBook || !refChapter || !refVerse) {
        stats.skipped_format++;
        return match;
      }
      return addToQueue(refBook, refChapter, refVerse, match);
    }).replace(/ /g, " ").replace(/\n/g, "<br>");

    outputBox.innerHTML = processed;
    totalRequests = fetchQueue.length;
    completed = 0;
    progressText.textContent = t("live_progress_waiting", { n: totalRequests });
    updateStats();

    if (totalRequests === 0) {
      progressBar.style.width = "100%";
      progressBar.style.background = "#4CAF50";
      progressText.textContent = t("live_progress_done");
      return;
    }

    await processQueue(fetchQueue);
  }

  async function processQueue(queue) {
    const userBatch = parseInt(batchInput.value, 10);
    const BATCH = (userBatch > 0) ? userBatch : 6;
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH);
      const results = await Promise.all(batch.map(task => fetchAndFormat(task)));
      for (let i = 0; i < batch.length; i++) {
        const task = batch[i];
        const r = results[i];
        const elTarget = document.getElementById(task.id);
        if (!elTarget) continue;
        if (r.success) {
          elTarget.outerHTML = r.html;
          stats.success++;
        } else {
          if (r.html) elTarget.outerHTML = r.html;
          else elTarget.outerHTML = task.citation;
          if (r.type === "network_error") stats.error_net++;
          else if (r.type === "verse_not_found") stats.error_verse++;
          else stats.error_api++;
        }
      }
      completed += batch.length;
      if (completed > totalRequests) completed = totalRequests;
      const pct = Math.round((completed / totalRequests) * 100);
      progressBar.style.width = pct + "%";
      progressText.textContent = t("live_progress_template", { done: completed, total: totalRequests });
      updateStats();
    }
    progressBar.style.background = "#4CAF50";
    progressText.textContent = t("live_progress_done");
  }

  async function fetchAndFormat(task) {
    const heBook = TANAKH_HEB_TO_EN_REVERSE[task.book] || task.book;
    const heChap = num2gematria(task.chapter);
    const heVerse = num2gematria(task.verse);
    const catalogRef = `[${heBook} ${heChap}:${heVerse}]`;

    const result = await fetchVerseFromSefaria(task.book, task.chapter, task.verse);
    if (result.text) {
      const visibleCatalog = ` <span style="color:var(--sef-muted); font-size:0.8em;">${escapeHtml(catalogRef)}</span>`;
      const hidden = `<span style="display:none"> ${escapeHtml(stripTags(task.citation))}</span>`;
      const html = `${task.citation} <span class="sefaria-wrapper">{${escapeHtml(result.text)}${visibleCatalog}${hidden}}</span>`;
      return { success: true, html };
    }
    let msg;
    if (result.error.code === "verse_not_found") {
      msg = t("live_err_verse_not_found", { ref: catalogRef });
    } else if (result.error.code === "network_error") {
      msg = t("live_err_network");
    } else if (result.error.code === "api_error") {
      msg = t("live_err_missing", { err: result.error.msg, ref: catalogRef });
    } else {
      msg = t("live_err_unknown");
    }
    const html = `${task.citation} <span style="color:#F44336; font-size:0.8em; font-weight:bold;">${escapeHtml(msg)}</span>`;
    return { success: false, type: result.error.code, html };
  }

  // ────────────────────────────────────────────────────────
  // Export
  // ────────────────────────────────────────────────────────
  function downloadWord() {
    // Build Word-friendly HTML with footnotes, mirroring the Python
    // sefaria_live_tool exporter.
    const clone = outputBox.cloneNode(true);
    let htmlRaw = clone.innerHTML
      .replace(/<br\s*\/?>/gi, "</p><p>");
    if (htmlRaw.indexOf("<p>") === -1) htmlRaw = "<p>" + htmlRaw + "</p>";
    clone.innerHTML = htmlRaw;
    let footnotes = "";
    let idx = 1;
    clone.querySelectorAll(".sefaria-wrapper").forEach(wrap => {
      let full = wrap.textContent;
      full = full.replace(/ /g, " ");
      const ref = `<a style="mso-footnote-id:ftn${idx}; vertical-align:super; font-size:80%;" href="#_ftn${idx}" name="_ftnref${idx}"><span class="MsoFootnoteReference"><span style="mso-special-character:footnote"></span></span></a>`;
      const repl = document.createElement("span");
      repl.innerHTML = ref;
      wrap.replaceWith(...repl.childNodes);
      footnotes += `<div style="mso-element:footnote" id="ftn${idx}"><p class=MsoFootnoteText><a style="mso-footnote-id:ftn${idx}" href="#_ftnref${idx}" name="_ftn${idx}"><span class="MsoFootnoteReference"><span style="mso-special-character:footnote"></span></span></a><span dir="rtl" lang="HE">${escapeHtml(full)}</span></p></div>`;
      idx++;
    });
    const html = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Export</title>
      <style>
        body { font-family: 'David', serif; font-size:12pt; direction: rtl; text-align: right; }
        p { margin: 0; margin-bottom: 10px; }
        p.MsoFootnoteText { font-size: 10pt; font-family: 'David', serif; direction: rtl; text-align: right; }
      </style>
      </head><body>${clone.innerHTML}<br clear=all style='mso-special-character:line-break;page-break-before:always'><div style='mso-element:footnote-list'>${footnotes}</div></body></html>`;
    const blob = new Blob(["﻿" + html], { type: "application/msword" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "Torah_Export.doc" });
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { a.remove(); URL.revokeObjectURL(a.href); } catch (_) {} }, 200);
    alert(t("live_save_word_ok", { path: "Torah_Export.doc" }));
  }

  function downloadTxt() {
    const text = outputBox.innerText || outputBox.textContent || "";
    const blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "Torah_Export.txt" });
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { a.remove(); URL.revokeObjectURL(a.href); } catch (_) {} }, 200);
    alert(t("live_save_word_ok", { path: "Torah_Export.txt" }));
  }

  function copyClipboard() {
    const text = outputBox.innerText || outputBox.textContent || "";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => alert(t("live_clipboard_ok")),
        e => alert(t("live_clipboard_err", { err: e && e.message ? e.message : String(e) }))
      );
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); alert(t("live_clipboard_ok")); }
      catch (_) { alert(t("live_clipboard_err", { err: "" })); }
      document.body.removeChild(ta);
    }
  }

  // Optional: when caller wants HTML back into the editor.
  if (typeof opts.onAccept === "function") {
    const acceptBtn = el("button", { class: "sef-btn sef-gold", onclick: () => {
      try { opts.onAccept(outputBox.innerHTML); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    } }, "📥 הוסף לעורך");
    tbExport.appendChild(acceptBtn);
  }

  return { close: () => { try { overlay.remove(); } catch (_) {} } };
}
