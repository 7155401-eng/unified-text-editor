// Custom styles + automatic stream style rules.
// משה 2026-05-17: נוסף מנגנון סגנונות אוטומטיים לפי זרם:
// דיבור המתחיל, בולד, סוגריים עגולות/מרובעות, וטקסט בין קוד פתיחה/סיום.

import { loadTextStyles, saveTextStyles, resolveTextStyle, escapeHtml, escapeAttr, fontSizeCssValue } from "./style_registry.js";

const ID_PREFIX = "user-";
const AUTO_RULES_KEY = "ravtext.streamAutoStyleRules.v1";
const ALL_STREAMS = "ALL";

export function loadStyles() { return loadTextStyles(); }
export function saveStyles(styles) { saveTextStyles(styles); }

function uniqueId(existing) {
  let n = existing.length + 1;
  while (existing.some(s => s.id === ID_PREFIX + n)) n++;
  return ID_PREFIX + n;
}
function uniqueRuleId(existing) {
  let n = existing.length + 1;
  while (existing.some(r => r.id === `rule-${n}`)) n++;
  return `rule-${n}`;
}
function normalizeStreamCode(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "MAIN") return "MAIN";
  if (raw === ALL_STREAMS || raw === "__ALL__" || raw === "all") return ALL_STREAMS;
  const digits = raw.replace(/^@/, "");
  return /^\d+$/.test(digits) ? digits.padStart(2, "0") : raw;
}
function styleLabel(style) {
  if (!style) return "";
  return style.source === "docx" ? `${style.name} · Word` : style.name;
}

export function refreshCustomStylesGallery(select = document.getElementById("styles-gallery-select"), styles = loadStyles()) {
  if (!select) return;
  Array.from(select.querySelectorAll("option[data-user-style]")).forEach(o => o.remove());
  const addOption = select.querySelector('option[value="__add-custom__"]');
  for (const s of styles) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = styleLabel(s);
    opt.dataset.userStyle = "1";
    if (addOption) select.insertBefore(opt, addOption);
    else select.appendChild(opt);
  }
}

function applyStyleToChain(chain, style) {
  switch (style.block) {
    case "paragraph": chain = chain.setParagraph(); break;
    case "heading-1": chain = chain.setHeading({ level: 1 }); break;
    case "heading-2": chain = chain.setHeading({ level: 2 }); break;
    case "heading-3": chain = chain.setHeading({ level: 3 }); break;
    case "heading-4": chain = chain.setHeading({ level: 4 }); break;
    case "heading-5": chain = chain.setHeading({ level: 5 }); break;
    case "heading-6": chain = chain.setHeading({ level: 6 }); break;
    case "blockquote": chain = chain.setBlockquote?.() || chain; break;
    case "bullet-list": chain = chain.toggleBulletList?.() || chain; break;
    case "ordered-list": chain = chain.toggleOrderedList?.() || chain; break;
    case "task-list": chain = chain.toggleTaskList?.() || chain; break;
  }
  if (style.fontFamily) chain = chain.setFontFamily(style.fontFamily);
  const fontSizeCss = fontSizeCssValue(style);
  if (fontSizeCss) chain = chain.setFontSize(fontSizeCss);
  if (style.color) chain = chain.setColor(style.color);
  if (style.bgColor) chain = chain.setBackgroundColor?.(style.bgColor) || chain;
  if (style.bold) chain = chain.setBold?.() || chain; else chain = chain.unsetBold?.() || chain;
  if (style.italic) chain = chain.setItalic?.() || chain; else chain = chain.unsetItalic?.() || chain;
  if (style.underline) chain = chain.setUnderline?.() || chain; else chain = chain.unsetUnderline?.() || chain;
  if (style.superscript) {
    chain = chain.unsetSubscript?.() || chain;
    chain = chain.setSuperscript?.() || chain;
  } else if (style.subscript) {
    chain = chain.unsetSuperscript?.() || chain;
    chain = chain.setSubscript?.() || chain;
  } else {
    chain = chain.unsetSuperscript?.() || chain;
    chain = chain.unsetSubscript?.() || chain;
  }
  if (style.align) chain = chain.setTextAlign?.(style.align) || chain;
  if (style.lineHeight) chain = chain.setLineHeight?.(String(style.lineHeight)) || chain;
  if (style.indent != null) chain = chain.setTextIndent?.(style.indent) || chain;
  if (style.marginTop != null || style.marginBottom != null) {
    chain = chain.setBlockSpacing?.({ marginTop: style.marginTop, marginBottom: style.marginBottom }) || chain;
  }
  return chain;
}

export function applyCustomStyleToActiveEditor(style, paneManager) {
  const editor = paneManager.getActiveEditor?.();
  if (!editor) return;
  applyStyleToChain(editor.chain().focus(), style).run();
}
function applyCustomStyleToRange(editor, style, from, to) {
  if (!editor || !style || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
  try {
    editor.commands.setTextSelection({ from, to });
    applyStyleToChain(editor.chain().focus(), style).run();
    return true;
  } catch (err) {
    console.warn("[stream-auto-style] failed to apply range", { from, to, err });
    return false;
  }
}

function ensureStylesCss() {
  if (document.getElementById("ravtext-custom-style-css")) return;
  const s = document.createElement("style");
  s.id = "ravtext-custom-style-css";
  s.textContent = `
    .custom-style-dialog,.stream-auto-rules-dialog{display:none;position:fixed;inset:0;z-index:9999}.custom-style-dialog.open,.stream-auto-rules-dialog.open{display:block}.csd-backdrop,.sar-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}.csd-window,.sar-window{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(720px,94vw);max-height:90vh;background:var(--bg,#fff);color:var(--txt,#111);border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column}.csd-header,.sar-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(0,0,0,.1)}.csd-title,.sar-title{font-weight:700;font-size:15px}.csd-close,.sar-close{background:transparent;border:0;cursor:pointer;font-size:16px;padding:4px 8px;color:inherit}.csd-body,.sar-body{padding:12px 14px;overflow:auto;flex:1}.csd-row,.sar-row{display:flex;align-items:center;gap:8px;margin:7px 0}.csd-row>span:first-child,.sar-row>span:first-child{min-width:132px;font-size:13px;color:var(--muted,#555)}.csd-row input[type=text],.csd-row input[type=number],.csd-row select,.sar-row input[type=text],.sar-row input[type=number],.sar-row select{flex:1;min-width:0;padding:5px 7px;font:inherit;font-size:13px;border:1px solid var(--border,#cbd5e1);border-radius:4px;background:var(--panel,#fff);color:inherit}.csd-row input[type=color]{width:40px;height:28px;padding:0}.csd-toggle{display:inline-flex;align-items:center;gap:4px;font-size:13px;margin-inline-end:8px}.csd-saved-list,.sar-list-wrap{margin-top:14px;border-top:1px solid rgba(0,0,0,.1);padding-top:8px}.csd-saved-list h4,.sar-list-wrap h4{margin:0 0 6px;font-size:13px}.csd-saved-list ul,.sar-list-wrap ul{list-style:none;padding:0;margin:0;max-height:190px;overflow:auto}.csd-saved-list li,.sar-list-wrap li{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px dashed rgba(0,0,0,.08)}.csd-name-preview,.sar-rule-main{flex:1;font-size:13px}.csd-footer,.sar-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:10px 0 0}.csd-footer button,.sar-actions button,.csd-saved-list button,.sar-list-wrap button,.csd-clear{padding:5px 10px;font-size:12px;cursor:pointer;border:1px solid rgba(0,0,0,.18);background:rgba(0,0,0,.04);border-radius:4px;color:inherit}.csd-footer button.primary,.sar-actions button.primary{background:#2563eb;color:#fff;border-color:#1d4ed8}.csd-empty,.sar-empty{font-size:12px;color:var(--muted,#888)}.sar-help{margin:0 0 10px;color:var(--muted,#666);font-size:13px;line-height:1.55}.sar-custom-row,.sar-opening-row{display:none}.stream-auto-rules-dialog.sar-is-custom .sar-custom-row,.stream-auto-rules-dialog.sar-is-opening .sar-opening-row{display:flex}.sar-opening-row input{max-width:90px;flex:0 0 90px}.sar-opening-row small,.sar-rule-main small{color:var(--muted,#666)}#btn-stream-auto-rules{white-space:nowrap}.stream-row-auto-style-btn,.style-edit-selected-btn{min-width:30px;height:30px;padding:0 9px;border:1px solid var(--rt-line,#d7d0be);border-radius:6px;background:var(--rt-surface-3,#f4f1ea);color:var(--rt-ink,#222);font-weight:800;font-size:17px;line-height:1;cursor:pointer}.stream-row-auto-style-btn{margin-inline-start:auto}.style-edit-selected-btn{margin-inline-start:4px}.stream-row-auto-style-btn:hover,.style-edit-selected-btn:hover{background:#e7f0ff;border-color:#8fb8f6}
  `;
  document.head.appendChild(s);
}

function buildDialog() {
  ensureStylesCss();
  let dialog = document.getElementById("custom-style-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.id = "custom-style-dialog";
  dialog.className = "custom-style-dialog";
  dialog.dir = "rtl";
  dialog.innerHTML = `
    <div class="csd-backdrop"></div><div class="csd-window" role="dialog" aria-modal="true" aria-label="הגדרות סגנון משלך">
    <header class="csd-header"><span class="csd-title">סגנון משלך — הגדרות סגנון</span><button type="button" class="csd-close" aria-label="סגור">✕</button></header>
    <div class="csd-body">
      <label class="csd-row"><span>שם הסגנון:</span><input type="text" id="csd-name" placeholder="למשל: דיבור המתחיל" /></label>
      <label class="csd-row"><span>סוג בלוק:</span><select id="csd-block"><option value="">— אל תשנה —</option><option value="paragraph">פסקה רגילה</option><option value="heading-1">כותרת 1</option><option value="heading-2">כותרת 2</option><option value="heading-3">כותרת 3</option><option value="heading-4">כותרת 4</option><option value="heading-5">כותרת 5</option><option value="heading-6">כותרת 6</option><option value="blockquote">ציטוט</option><option value="bullet-list">רשימת נקודות</option><option value="ordered-list">רשימה ממוספרת</option><option value="task-list">רשימת סימון</option></select></label>
      <label class="csd-row"><span>גופן:</span><input type="text" id="csd-font-family" list="csd-font-list" placeholder="David Libre, Frank Ruhl Libre, ..." /><datalist id="csd-font-list"><option value="David Libre"></option><option value="Frank Ruhl Libre"></option><option value="Segoe UI"></option><option value="Times New Roman"></option><option value="Arial"></option></datalist></label>
      <label class="csd-row"><span>גודל גופן:</span><input type="number" id="csd-font-size" min="6" max="200" placeholder="16" /></label>
      <div class="csd-row"><span>סגנון:</span><label class="csd-toggle"><input type="checkbox" id="csd-bold" /> מודגש</label><label class="csd-toggle"><input type="checkbox" id="csd-italic" /> נטוי</label><label class="csd-toggle"><input type="checkbox" id="csd-underline" /> קו תחתי</label><label class="csd-toggle"><input type="checkbox" id="csd-superscript" /> כתב עילי</label><label class="csd-toggle"><input type="checkbox" id="csd-subscript" /> כתב תחתי</label></div>
      <label class="csd-row"><span>צבע טקסט:</span><input type="color" id="csd-color" value="#000000" /><button type="button" class="csd-clear" data-target="csd-color">ניקוי</button></label>
      <label class="csd-row"><span>צבע רקע:</span><input type="color" id="csd-bg" value="#ffffff" /><button type="button" class="csd-clear" data-target="csd-bg">ניקוי</button></label>
      <label class="csd-row"><span>יישור:</span><select id="csd-align"><option value="">— אל תשנה —</option><option value="right">ימין</option><option value="center">מרכז</option><option value="justify">מוצדק</option><option value="left">שמאל</option></select></label>
      <label class="csd-row"><span>גובה שורה:</span><input type="number" id="csd-line-height" min="0.8" max="3" step="0.05" placeholder="1.4" /></label>
      <label class="csd-row"><span>הזחת שורה ראשונה:</span><input type="number" id="csd-indent" min="0" max="10" step="0.1" placeholder="0" /></label>
      <label class="csd-row"><span>רווח עליון:</span><input type="number" id="csd-margin-top" min="0" max="200" placeholder="0" /></label>
      <label class="csd-row"><span>רווח תחתון:</span><input type="number" id="csd-margin-bottom" min="0" max="200" placeholder="0" /></label>
      <div class="csd-saved-list"><h4>סגנונות שמורים:</h4><ul id="csd-list"></ul></div>
    </div><footer class="csd-footer"><button type="button" id="csd-apply-only">החל על הבחירה</button><button type="button" class="primary" id="csd-save">שמור והוסף לתפריט</button><button type="button" id="csd-cancel">סגור</button></footer></div>`;
  document.body.appendChild(dialog);
  return dialog;
}

function readForm() {
  const v = id => document.getElementById(id)?.value || "";
  const ch = id => document.getElementById(id)?.checked || false;
  const isReset = id => document.getElementById(id)?.dataset.cleared === "1";
  const superscript = ch("csd-superscript");
  return {
    name: v("csd-name").trim(), block: v("csd-block"), fontFamily: v("csd-font-family").trim(),
    fontSize: v("csd-font-size") ? Number(v("csd-font-size")) : null, fontSizeUnit: "px",
    bold: ch("csd-bold"), italic: ch("csd-italic"), underline: ch("csd-underline"),
    superscript, subscript: superscript ? false : ch("csd-subscript"),
    color: isReset("csd-color") ? "" : v("csd-color"), bgColor: isReset("csd-bg") ? "" : v("csd-bg"),
    align: v("csd-align"), lineHeight: v("csd-line-height") ? Number(v("csd-line-height")) : null,
    indent: v("csd-indent") ? Number(v("csd-indent")) : null,
    marginTop: v("csd-margin-top") ? Number(v("csd-margin-top")) : null,
    marginBottom: v("csd-margin-bottom") ? Number(v("csd-margin-bottom")) : null,
  };
}
function fillForm(style = {}) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  const setCh = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  set("csd-name", style.name || ""); set("csd-block", style.block || ""); set("csd-font-family", style.fontFamily || ""); set("csd-font-size", style.fontSize ?? "");
  setCh("csd-bold", style.bold); setCh("csd-italic", style.italic); setCh("csd-underline", style.underline); setCh("csd-superscript", style.superscript); setCh("csd-subscript", style.subscript);
  set("csd-color", style.color || "#000000"); set("csd-bg", style.bgColor || "#ffffff"); set("csd-align", style.align || ""); set("csd-line-height", style.lineHeight ?? ""); set("csd-indent", style.indent ?? ""); set("csd-margin-top", style.marginTop ?? ""); set("csd-margin-bottom", style.marginBottom ?? "");
}
function refreshSavedList(dialog, paneManager, select) {
  const ul = dialog.querySelector("#csd-list"); if (!ul) return;
  const styles = loadStyles(); ul.innerHTML = "";
  if (!styles.length) { ul.innerHTML = '<li class="csd-empty">(אין סגנונות שמורים)</li>'; return; }
  for (const s of styles) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="csd-name-preview">${escapeHtml(styleLabel(s))}</span><button type="button" data-action="edit" data-id="${escapeAttr(s.id)}">ערוך</button><button type="button" data-action="delete" data-id="${escapeAttr(s.id)}">מחק</button>`;
    ul.appendChild(li);
  }
  ul.onclick = ev => {
    const btn = ev.target.closest("button"); if (!btn) return;
    const id = btn.dataset.id; const styles = loadStyles();
    if (btn.dataset.action === "delete") { const next = styles.filter(s => s.id !== id); saveStyles(next); refreshCustomStylesGallery(select, next); refreshSavedList(dialog, paneManager, select); refreshAutoRuleStyleOptions(); installStyleSelectEditButtons(paneManager); }
    if (btn.dataset.action === "edit") { const target = styles.find(s => s.id === id); if (target) { fillForm(target); dialog.dataset.editingId = id; } }
  };
}

function loadAutoRulesState() {
  try {
    const stored = localStorage.getItem(AUTO_RULES_KEY);
    const raw = stored ? JSON.parse(stored) : {};
    return {
      autoBeforeRender: raw.autoBeforeRender === false ? false : true,
      rules: Array.isArray(raw.rules) ? raw.rules : [],
    };
  } catch {
    return { autoBeforeRender: true, rules: [] };
  }
}
function saveAutoRulesState(state) { localStorage.setItem(AUTO_RULES_KEY, JSON.stringify({ autoBeforeRender: state.autoBeforeRender === false ? false : true, rules: Array.isArray(state.rules) ? state.rules : [] })); }
function streamKeyForPane(pane) { return pane?.streamCode ? normalizeStreamCode(pane.streamCode) : "MAIN"; }
function streamLabelForPane(pane) { return pane?.streamCode ? (pane.label || `זרם ${pane.streamCode}`) : "ראשי"; }
function paneStreams(paneManager, extraStream = "") { const m = new Map([[ALL_STREAMS, "כל הזרמים"]]); for (const p of paneManager?.panes || []) m.set(streamKeyForPane(p), streamLabelForPane(p)); if (!m.has("MAIN")) m.set("MAIN", "ראשי"); const ex = normalizeStreamCode(extraStream); if (ex && ex !== "MAIN" && ex !== ALL_STREAMS && !m.has(ex)) m.set(ex, `זרם ${ex}`); return Array.from(m, ([value, label]) => ({ value, label })); }
function styleOptions(selected = "") { return ['<option value="">בחר סגנון שמור…</option>', ...loadStyles().map(s => `<option value="${escapeAttr(s.id)}"${s.id === selected ? " selected" : ""}>${escapeHtml(styleLabel(s))}</option>`)].join(""); }
function typeLabel(t) { return ({ opening: "דיבור המתחיל", bold: "טקסט בולד", round: "סוגריים עגולות", square: "סוגריים מרובעות", custom: "מסימון פתיחה עד סימון סיום" })[t] || t; }
function ruleAppliesToStream(rule, streamCode) { const code = normalizeStreamCode(rule?.stream || "MAIN"); return code === ALL_STREAMS || code === normalizeStreamCode(streamCode); }
function streamDisplayLabel(value, streams) { const code = normalizeStreamCode(value); if (code === ALL_STREAMS) return "כל הזרמים"; return streams.get(code) || code; }

function buildAutoRulesDialog(paneManager) {
  ensureStylesCss();
  let dialog = document.getElementById("stream-auto-rules-dialog"); if (dialog) return dialog;
  dialog = document.createElement("div"); dialog.id = "stream-auto-rules-dialog"; dialog.className = "stream-auto-rules-dialog"; dialog.dir = "rtl";
  dialog.innerHTML = `<div class="sar-backdrop"></div><div class="sar-window"><header class="sar-header"><span class="sar-title">כללי סגנון אוטומטיים לפי זרם</span><button type="button" class="sar-close" aria-label="סגור">✕</button></header><div class="sar-body"><p class="sar-help">אפשר לבחור זרם מסוים או כל הזרמים. כאן מגדירים איזה סגנון יוחל על דיבור המתחיל, בולד, סוגריים, או טקסט שמתחיל בסימון פתיחה ונגמר בסימון סיום.</p><label class="sar-row"><span>זרם:</span><select id="sar-stream"></select></label><label class="sar-row"><span>על מה להחיל:</span><select id="sar-type"><option value="opening">דיבור המתחיל בתחילת פסקה</option><option value="bold">כל טקסט שכבר מסומן בולד</option><option value="round">טקסט בתוך סוגריים עגולות ( )</option><option value="square">טקסט בתוך סוגריים מרובעות [ ]</option><option value="custom">טקסט מסימון פתיחה עד סימון סיום</option></select></label><label class="sar-row"><span>סגנון להחלה:</span><select id="sar-style"></select><button type="button" class="style-edit-selected-btn" id="sar-edit-style" title="ערוך את הסגנון שנבחר">⋯</button></label><div class="sar-row sar-custom-row"><span>סימונים:</span><input type="text" id="sar-start" placeholder="סימון פתיחה, למשל @11" /><input type="text" id="sar-end" placeholder="סימון סיום, למשל @22" /></div><label class="sar-row sar-opening-row"><span>דיבור המתחיל:</span><input type="number" id="sar-max-words" min="1" max="80" value="8" /><small>מילים לכל היותר, או עד נקודתיים/מקף/נקודה.</small></label><label class="sar-row"><span></span><label><input type="checkbox" id="sar-auto-render" /> החל את הכללים אוטומטית לפני רנדר</label></label><div class="sar-actions"><button type="button" class="primary" id="sar-save-rule">שמור כלל</button><button type="button" id="sar-new-rule">נקה טופס</button><button type="button" id="sar-apply-active">החל עכשיו על הזרם שנבחר</button><button type="button" id="sar-apply-all">החל עכשיו על כל הזרמים</button></div><div class="sar-list-wrap"><h4>כללים שמורים</h4><ul id="sar-list"></ul></div></div></div>`;
  document.body.appendChild(dialog);
  const close = () => dialog.classList.remove("open");
  dialog.querySelector(".sar-close")?.addEventListener("click", close); dialog.querySelector(".sar-backdrop")?.addEventListener("click", close);
  dialog.querySelector("#sar-type")?.addEventListener("change", () => updateAutoRuleFormVisibility(dialog));
  dialog.querySelector("#sar-stream")?.addEventListener("change", () => renderAutoRulesList(dialog, paneManager));
  dialog.querySelector("#sar-new-rule")?.addEventListener("click", () => fillAutoRuleForm(dialog, { stream: dialog.querySelector("#sar-stream")?.value || "" }, paneManager));
  dialog.querySelector("#sar-save-rule")?.addEventListener("click", () => saveAutoRuleFromForm(dialog, paneManager));
  dialog.querySelector("#sar-edit-style")?.addEventListener("click", () => window.__ravtextOpenStyleEditor?.(dialog.querySelector("#sar-style")?.value));
  dialog.querySelector("#sar-apply-active")?.addEventListener("click", () => {
    const selected = normalizeStreamCode(dialog.querySelector("#sar-stream")?.value || ALL_STREAMS);
    const count = selected === ALL_STREAMS ? applyAutoStyleRules(paneManager, { scope: "all" }) : applyAutoStyleRulesForStream(paneManager, selected);
    toastAutoRules(`הוחלו ${count} התאמות ב${selected === ALL_STREAMS ? "כל הזרמים" : `זרם ${selected}`}.`);
  });
  dialog.querySelector("#sar-apply-all")?.addEventListener("click", () => toastAutoRules(`הוחלו ${applyAutoStyleRules(paneManager, { scope: "all" })} התאמות בכל הזרמים.`));
  dialog.querySelector("#sar-auto-render")?.addEventListener("change", ev => { const state = loadAutoRulesState(); state.autoBeforeRender = ev.target.checked !== false; saveAutoRulesState(state); });
  dialog.querySelector("#sar-list")?.addEventListener("click", ev => { const btn = ev.target.closest("button[data-action]"); if (!btn) return; const state = loadAutoRulesState(); const id = btn.dataset.id; if (btn.dataset.action === "delete") { state.rules = state.rules.filter(r => r.id !== id); saveAutoRulesState(state); renderAutoRulesList(dialog, paneManager); } else { const r = state.rules.find(r => r.id === id); if (r) fillAutoRuleForm(dialog, r, paneManager); } });
  return dialog;
}
function refreshAutoRuleStreamOptions(dialog, paneManager, selected = "") { const sel = dialog?.querySelector("#sar-stream"); if (!sel) return; const active = paneManager?.activePane ? streamKeyForPane(paneManager.activePane) : "MAIN"; const v = normalizeStreamCode(selected || active); sel.innerHTML = paneStreams(paneManager, v).map(s => `<option value="${escapeAttr(s.value)}"${s.value === v ? " selected" : ""}>${escapeHtml(s.label)}${s.value === ALL_STREAMS ? "" : ` (${escapeHtml(s.value)})`}</option>`).join(""); sel.value = v; sel.disabled = false; }
function refreshAutoRuleStyleOptions(dialog = document.getElementById("stream-auto-rules-dialog"), selected = "") { const sel = dialog?.querySelector("#sar-style"); if (sel) sel.innerHTML = styleOptions(selected || sel.value); installStyleSelectEditButtons(window.paneManager); }
function updateAutoRuleFormVisibility(dialog) { const type = dialog.querySelector("#sar-type")?.value || "opening"; dialog.classList.toggle("sar-is-custom", type === "custom"); dialog.classList.toggle("sar-is-opening", type === "opening"); }
function fillAutoRuleForm(dialog, rule = {}, paneManager) { dialog.dataset.editingRuleId = rule.id || ""; refreshAutoRuleStreamOptions(dialog, paneManager, rule.stream || dialog.querySelector("#sar-stream")?.value || ""); const set = (id, v) => { const el = dialog.querySelector(`#${id}`); if (el) el.value = v ?? ""; }; set("sar-type", rule.type || "opening"); refreshAutoRuleStyleOptions(dialog, rule.styleId || ""); set("sar-style", rule.styleId || ""); set("sar-start", rule.start || ""); set("sar-end", rule.end || ""); set("sar-max-words", rule.maxWords || 8); updateAutoRuleFormVisibility(dialog); renderAutoRulesList(dialog, paneManager); }
function readAutoRuleForm(dialog) { return { id: dialog.dataset.editingRuleId || "", stream: normalizeStreamCode(dialog.querySelector("#sar-stream")?.value || "MAIN"), type: dialog.querySelector("#sar-type")?.value || "opening", styleId: dialog.querySelector("#sar-style")?.value || "", start: (dialog.querySelector("#sar-start")?.value || "").trim(), end: (dialog.querySelector("#sar-end")?.value || "").trim(), maxWords: Number(dialog.querySelector("#sar-max-words")?.value || 8) || 8 }; }
function saveAutoRuleFromForm(dialog, paneManager) { const rule = readAutoRuleForm(dialog); if (!rule.styleId) return alert("צריך לבחור סגנון שמור להחלה."); if (rule.type === "custom" && (!rule.start || !rule.end)) return alert("בכלל מסוג סימון-עד-סימון צריך למלא גם סימון פתיחה וגם סימון סיום."); const state = loadAutoRulesState(); if (rule.id) { const i = state.rules.findIndex(r => r.id === rule.id); if (i >= 0) state.rules[i] = rule; else state.rules.push({ ...rule, id: uniqueRuleId(state.rules) }); } else state.rules.push({ ...rule, id: uniqueRuleId(state.rules) }); saveAutoRulesState(state); renderAutoRulesList(dialog, paneManager); fillAutoRuleForm(dialog, { stream: rule.stream }, paneManager); }
function renderAutoRulesList(dialog, paneManager) { const ul = dialog.querySelector("#sar-list"); if (!ul) return; const state = loadAutoRulesState(); const selected = normalizeStreamCode(dialog.querySelector("#sar-stream")?.value || ALL_STREAMS); const rows = selected === ALL_STREAMS ? state.rules : state.rules.filter(r => ruleAppliesToStream(r, selected)); const streams = new Map(paneStreams(paneManager, selected).map(s => [s.value, s.label])); const styles = new Map(loadStyles().map(s => [s.id, styleLabel(s)])); ul.innerHTML = ""; if (!rows.length) { ul.innerHTML = '<li class="sar-empty">עדיין אין כללים להצגה.</li>'; return; } for (const rule of rows) { const details = rule.type === "custom" ? ` · ${escapeHtml(rule.start)} ← ${escapeHtml(rule.end)}` : rule.type === "opening" ? ` · עד ${Number(rule.maxWords || 8)} מילים` : ""; const li = document.createElement("li"); li.innerHTML = `<span class="sar-rule-main"><b>${escapeHtml(streamDisplayLabel(rule.stream, streams))}</b> — ${escapeHtml(typeLabel(rule.type))}${details}<br><small>סגנון: ${escapeHtml(styles.get(rule.styleId) || rule.styleId || "חסר")}</small></span><button type="button" data-action="edit" data-id="${escapeAttr(rule.id)}">ערוך</button><button type="button" data-action="delete" data-id="${escapeAttr(rule.id)}">מחק</button>`; ul.appendChild(li); } }
function openAutoRulesDialog(paneManager, streamCode = "") { const d = buildAutoRulesDialog(paneManager); const selected = normalizeStreamCode(streamCode || (paneManager?.activePane ? streamKeyForPane(paneManager.activePane) : ALL_STREAMS)); const state = loadAutoRulesState(); const auto = d.querySelector("#sar-auto-render"); if (auto) auto.checked = state.autoBeforeRender !== false; fillAutoRuleForm(d, { stream: selected }, paneManager); renderAutoRulesList(d, paneManager); d.classList.add("open"); }
export function openStreamAutoStyleRulesDialog(paneManager, streamCode) { openAutoRulesDialog(paneManager || window.paneManager, normalizeStreamCode(streamCode)); }

function collectTextBlocks(editor) { const blocks = []; editor.state.doc.descendants((node, pos) => { if (!node.isTextblock) return; const chars = [], positions = []; node.descendants((child, childPos) => { if (!child.isText || !child.text) return; const start = pos + 1 + childPos; for (let i = 0; i < child.text.length; i++) { chars.push(child.text[i]); positions.push(start + i); } }); blocks.push({ text: chars.join(""), positions }); }); return blocks; }
function collectFullTextMap(editor) { const chars = [], positions = []; editor.state.doc.descendants((node, pos) => { if (!node.isTextblock) return; node.descendants((child, childPos) => { if (!child.isText || !child.text) return; const start = pos + 1 + childPos; for (let i = 0; i < child.text.length; i++) { chars.push(child.text[i]); positions.push(start + i); } }); chars.push("\n"); positions.push(null); }); return { text: chars.join(""), positions }; }
function rangeFromPositions(positions, start, end) { let from = null, to = null; for (let i = start; i < end; i++) if (positions[i] != null) { from = positions[i]; break; } for (let i = end - 1; i >= start; i--) if (positions[i] != null) { to = positions[i] + 1; break; } return from == null || to == null || to <= from ? null : { from, to }; }
function delimitedInBlock(block, opener, closer) { const ranges = []; let i = 0; while (i < block.text.length) { const open = block.text.indexOf(opener, i); if (open < 0) break; const close = block.text.indexOf(closer, open + opener.length); if (close < 0) break; const r = rangeFromPositions(block.positions, open + opener.length, close); if (r) ranges.push(r); i = close + closer.length; } return ranges; }
function customCodeRanges(editor, startCode, endCode) { const map = collectFullTextMap(editor); const ranges = []; if (!startCode || !endCode || startCode === endCode) return ranges; let i = 0; while (i < map.text.length) { const open = map.text.indexOf(startCode, i); if (open < 0) break; const start = open + startCode.length; const close = map.text.indexOf(endCode, start); if (close < 0) break; const r = rangeFromPositions(map.positions, start, close); if (r) ranges.push(r); i = close + endCode.length; } return ranges; }
function openingRanges(editor, maxWords = 8) { const ranges = []; const limit = Math.max(1, Math.min(80, Number(maxWords) || 8)); for (const b of collectTextBlocks(editor)) { const start = b.text.search(/\S/); if (start < 0) continue; const rest = b.text.slice(start); const stop = rest.search(/[׃:;.,!?־–—-]/); let end = stop >= 0 ? start + stop : b.text.length; if (stop < 0) { const m = rest.match(new RegExp(`^(?:\\S+\\s+){0,${limit - 1}}\\S+`)); if (m) end = start + m[0].length; } while (end > start && /\s/.test(b.text[end - 1])) end--; const r = rangeFromPositions(b.positions, start, end); if (r) ranges.push(r); } return ranges; }
function boldRanges(editor) { const ranges = []; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text && node.marks?.some(m => m.type?.name === "bold" || m.type?.name === "strong")) ranges.push({ from: pos, to: pos + node.text.length }); }); return ranges; }
function rangesForRule(editor, rule) { if (rule.type === "opening") return openingRanges(editor, rule.maxWords); if (rule.type === "bold") return boldRanges(editor); if (rule.type === "round") return collectTextBlocks(editor).flatMap(b => delimitedInBlock(b, "(", ")")); if (rule.type === "square") return collectTextBlocks(editor).flatMap(b => delimitedInBlock(b, "[", "]")); if (rule.type === "custom") return customCodeRanges(editor, rule.start, rule.end); return []; }
function applyRuleToPane(pane, rule) { const editor = pane?.editor, style = resolveTextStyle(rule.styleId); if (!editor || !style) return 0; const seen = new Set(); const ranges = rangesForRule(editor, rule).filter(r => r && r.to > r.from).filter(r => { const k = `${r.from}:${r.to}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.from - a.from || b.to - a.to); let count = 0; const sel = editor.state.selection; for (const r of ranges) if (applyCustomStyleToRange(editor, style, r.from, r.to)) count++; try { editor.commands.setTextSelection({ from: sel.from, to: sel.to }); } catch (_) {} return count; }
function applyAutoStyleRules(paneManager, { scope = "all" } = {}) { const state = loadAutoRulesState(); const panes = scope === "active" && paneManager?.activePane ? [paneManager.activePane] : Array.from(paneManager?.panes || []); let count = 0; for (const p of panes) for (const r of state.rules.filter(r => ruleAppliesToStream(r, streamKeyForPane(p)))) count += applyRuleToPane(p, r); return count; }
function applyAutoStyleRulesForStream(paneManager, streamCode) { const state = loadAutoRulesState(); const code = normalizeStreamCode(streamCode); const panes = Array.from(paneManager?.panes || []).filter(p => code === ALL_STREAMS || streamKeyForPane(p) === code); let count = 0; for (const p of panes) for (const r of state.rules.filter(r => ruleAppliesToStream(r, streamKeyForPane(p)))) count += applyRuleToPane(p, r); return count; }
function toastAutoRules(msg) { const status = document.getElementById("status"); if (status) status.textContent = msg; else console.info(msg); }
function installAutoRulesButton(paneManager, select) { if (document.getElementById("btn-stream-auto-rules")) return; const btn = document.createElement("button"); btn.type = "button"; btn.id = "btn-stream-auto-rules"; btn.title = "הגדרת סגנונות אוטומטיים לפי זרם"; btn.textContent = "כללי סגנון לכל זרם"; btn.addEventListener("click", () => openAutoRulesDialog(paneManager, ALL_STREAMS)); select?.closest(".tb-group")?.appendChild(btn); }
function installAutoBeforeRenderHook(paneManager) { const btn = document.getElementById("btn-render"); if (!btn || btn.dataset.streamAutoRulesHook === "1") return; btn.dataset.streamAutoRulesHook = "1"; btn.addEventListener("click", () => { const state = loadAutoRulesState(); if (state.autoBeforeRender === false || !state.rules.length) return; const count = applyAutoStyleRules(paneManager, { scope: "all" }); if (count) toastAutoRules(`כללי סגנון אוטומטיים: הוחלו ${count} התאמות לפני הרנדר.`); }, true); }
function installStreamRowButtons(paneManager) {
  const panel = document.getElementById("stream-columns-panel");
  if (!panel || panel.dataset.streamAutoRowsBound === "1") return;
  panel.dataset.streamAutoRowsBound = "1";
  const ensure = () => {
    for (const block of panel.querySelectorAll(".stream-settings-block[data-stream-code]")) {
      if (block.querySelector(".stream-row-auto-style-btn")) continue;
      const code = normalizeStreamCode(block.dataset.streamCode);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stream-row-auto-style-btn";
      btn.textContent = "⋯";
      btn.title = `עריכת סגנונות אוטומטיים לזרם ${code}`;
      btn.setAttribute("aria-label", `עריכת סגנונות אוטומטיים לזרם ${code}`);
      btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openStreamAutoStyleRulesDialog(paneManager, code); });
      block.appendChild(btn);
    }
  };
  ensure();
  const obs = new MutationObserver(ensure);
  obs.observe(panel, { childList: true, subtree: true });
}
function looksLikeStyleSelect(select) {
  if (!select || select.dataset.styleEditButtonAttached === "1") return false;
  if (select.id === "styles-gallery-select" || select.id === "sar-style") return true;
  const ids = new Set(loadStyles().map(s => s.id));
  return Array.from(select.options || []).some(o => ids.has(o.value) || o.value === "__add-custom__");
}
function installStyleSelectEditButtons(paneManager) {
  for (const sel of document.querySelectorAll("select")) {
    if (!looksLikeStyleSelect(sel)) continue;
    if (sel.nextElementSibling?.classList?.contains("style-edit-selected-btn")) { sel.dataset.styleEditButtonAttached = "1"; continue; }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "style-edit-selected-btn";
    btn.textContent = "⋯";
    btn.title = "ערוך את הסגנון שנבחר מהרשימה";
    btn.setAttribute("aria-label", "ערוך את הסגנון שנבחר מהרשימה");
    btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); window.__ravtextOpenStyleEditor?.(sel.value); });
    sel.insertAdjacentElement("afterend", btn);
    sel.dataset.styleEditButtonAttached = "1";
  }
}
function wireStreamAutoStyleRules(paneManager, select) { installAutoRulesButton(paneManager, select); installAutoBeforeRenderHook(paneManager); installStreamRowButtons(paneManager); installStyleSelectEditButtons(paneManager); window.addEventListener("ravtext:styles-changed", () => { refreshAutoRuleStyleOptions(); installStyleSelectEditButtons(paneManager); }); const panel = document.getElementById("stream-columns-panel"); if (panel && !panel.dataset.styleSelectObserverBound) { panel.dataset.styleSelectObserverBound = "1"; new MutationObserver(() => installStyleSelectEditButtons(paneManager)).observe(panel, { childList: true, subtree: true }); } }

export function wireCustomStyles(paneManager) {
  const select = document.getElementById("styles-gallery-select"); if (!select) return;
  if (!select.querySelector('option[value="__add-custom__"]')) { const opt = document.createElement("option"); opt.value = "__add-custom__"; opt.textContent = "+ הוסף סגנון משלך…"; select.appendChild(opt); }
  refreshCustomStylesGallery(select, loadStyles());
  window.addEventListener("ravtext:styles-changed", () => refreshCustomStylesGallery(select, loadStyles()));
  const dialog = buildDialog();
  const openDialog = () => { dialog.classList.add("open"); delete dialog.dataset.editingId; fillForm({}); refreshSavedList(dialog, paneManager, select); document.getElementById("csd-name")?.focus(); };
  const openStyleEditor = (styleId) => {
    if (styleId === "__add-custom__") { openDialog(); return; }
    const target = loadStyles().find(s => s.id === styleId || s.name === styleId);
    if (!target) return alert("צריך לבחור סגנון לעריכה.");
    dialog.classList.add("open");
    fillForm(target);
    dialog.dataset.editingId = target.id;
    refreshSavedList(dialog, paneManager, select);
    document.getElementById("csd-name")?.focus();
  };
  window.__ravtextOpenStyleEditor = openStyleEditor;
  const closeDialog = () => dialog.classList.remove("open");
  dialog.querySelector(".csd-close")?.addEventListener("click", closeDialog); dialog.querySelector(".csd-backdrop")?.addEventListener("click", closeDialog); dialog.querySelector("#csd-cancel")?.addEventListener("click", closeDialog);
  dialog.querySelectorAll(".csd-clear").forEach(b => b.addEventListener("click", () => { const t = document.getElementById(b.dataset.target); if (t) t.dataset.cleared = "1"; }));
  dialog.querySelectorAll('input[type="color"]').forEach(c => c.addEventListener("input", () => { c.dataset.cleared = "0"; }));
  dialog.querySelector("#csd-superscript")?.addEventListener("change", ev => { if (ev.target.checked) { const sub = dialog.querySelector("#csd-subscript"); if (sub) sub.checked = false; } });
  dialog.querySelector("#csd-subscript")?.addEventListener("change", ev => { if (ev.target.checked) { const sup = dialog.querySelector("#csd-superscript"); if (sup) sup.checked = false; } });
  dialog.querySelector("#csd-apply-only")?.addEventListener("click", () => applyCustomStyleToActiveEditor(readForm(), paneManager));
  dialog.querySelector("#csd-save")?.addEventListener("click", () => { const style = readForm(); if (!style.name) return alert("חובה לתת שם לסגנון."); const styles = loadStyles(); const editingId = dialog.dataset.editingId; if (editingId) { const idx = styles.findIndex(s => s.id === editingId); if (idx >= 0) styles[idx] = { ...styles[idx], ...style }; } else styles.push({ id: uniqueId(styles), ...style }); saveStyles(styles); refreshCustomStylesGallery(select, styles); refreshSavedList(dialog, paneManager, select); refreshAutoRuleStyleOptions(); installStyleSelectEditButtons(paneManager); delete dialog.dataset.editingId; });
  select.addEventListener("change", ev => { const v = select.value; if (v === "__add-custom__") { ev.stopImmediatePropagation(); select.value = ""; openDialog(); return; } if (v) { ev.stopImmediatePropagation(); const target = loadStyles().find(s => s.id === v); if (target) applyCustomStyleToActiveEditor(target, paneManager); } }, true);
  wireStreamAutoStyleRules(paneManager, select);
}
