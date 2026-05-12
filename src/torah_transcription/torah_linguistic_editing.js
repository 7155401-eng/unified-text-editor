import { getSyncedGeminiApiKey } from "../ai_key_sync.js";
import { trimTorahOrTextForFreeUser } from "../torah_free_limit.js";
import { GasClient } from "./torah_transcription_gas.js";

const CONFIG_KEY = "ravtext.torah_transcription.config";

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function saveConfigPatch(patch) {
  try {
    const cfg = loadConfig();
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...cfg, ...patch }));
  } catch (e) {
    /* noop */
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== false && value != null) {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textToHtml(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p></p>")
    .join("");
}

function readEditorText(editor) {
  try {
    if (!editor) return { text: "", hasSelection: false };
    const sel = editor.state && editor.state.selection;
    if (sel && sel.from !== sel.to) {
      return {
        text: editor.state.doc.textBetween(sel.from, sel.to, "\n", "\n").trim(),
        hasSelection: true,
      };
    }
    return {
      text: editor.getText ? String(editor.getText() || "").trim() : "",
      hasSelection: false,
    };
  } catch (e) {
    return { text: "", hasSelection: false };
  }
}

function insertIntoEditor(editor, text, replaceSelection) {
  if (!editor || !text) return;
  const html = textToHtml(text);
  try {
    let chain = editor.chain().focus();
    if (replaceSelection && editor.state && editor.state.selection) {
      const { from, to } = editor.state.selection;
      chain = chain.deleteRange({ from, to });
    }
    chain.insertContent(html).run();
  } catch (e) {
    try { editor.chain().focus().insertContent(text).run(); } catch (_) {}
  }
}

export function openTorahLinguisticEditor({ paneManager } = {}) {
  const activeEditor = paneManager && paneManager.getActiveEditor
    ? paneManager.getActiveEditor()
    : null;
  const editorText = readEditorText(activeEditor);
  const limitedEditorText = trimTorahOrTextForFreeUser(editorText.text);
  const cfg = loadConfig();
  let client = null;

  const overlay = el("div", { class: "tt-modal-overlay" });
  const modal = el("div", {
    class: "tt-modal",
    style: "width:min(860px,96vw);height:min(720px,96vh);",
  });
  overlay.appendChild(modal);

  function close() {
    try { if (client) client.cancel(); } catch (e) {}
    try { overlay.remove(); } catch (e) {}
  }

  const header = el("div", { class: "tt-header" },
    el("div", { class: "tt-header-title" }, "עריכה לשונית תורנית"),
    el("button", { class: "tt-close-btn", title: "סגור", onclick: close }, "×")
  );
  modal.appendChild(header);

  const wrap = el("div", {
    class: "tt-content-area",
    style: "display:flex;flex-direction:column;gap:12px;",
  });
  modal.appendChild(wrap);

  wrap.appendChild(el("div", { class: "tt-info" },
    "הדבק טקסט או השתמש בטקסט שנלקח מהעורך, בחר סגנון, ושלח לעיבוד התורני בשרת."
  ));

  const inputBox = el("textarea", {
    class: "tt-textarea",
    style: "min-height:150px;",
    placeholder: "הדבק כאן טקסט לעריכה לשונית תורנית...",
  });
  inputBox.value = limitedEditorText.text || "";
  wrap.appendChild(el("div", { class: "tt-card" },
    el("div", { class: "tt-h2" }, "טקסט לעריכה"),
    inputBox
  ));

  const styleCard = el("div", { class: "tt-card tt-card-gold-light" },
    el("div", { class: "tt-h2" }, "בחירת סגנון")
  );
  const styleOpts = [
    ["ancient", "כסגנון הראשונים"],
    ["modern", "תורני בן זמננו"],
    ["combined", "שילוב של שניהם"],
  ];
  const savedStyle = cfg.torah_style || "combined";
  for (const [value, label] of styleOpts) {
    styleCard.appendChild(el("label", { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, label),
      el("input", {
        type: "radio",
        name: "tt-linguistic-style",
        value,
        ...(savedStyle === value ? { checked: true } : {}),
      })
    ));
  }
  wrap.appendChild(styleCard);

  const actionRow = el("div", { class: "tt-row-flex" });
  const runBtn = el("button", { class: "tt-btn tt-btn-primary" }, "עבד את הטקסט");
  const insertBtn = el("button", { class: "tt-btn tt-btn-secondary" }, "הכנס לעורך");
  const cancelBtn = el("button", { class: "tt-btn tt-btn-secondary", style: "display:none;" }, "בטל");
  actionRow.append(runBtn, insertBtn, cancelBtn);
  wrap.appendChild(actionRow);

  const status = el("div", { class: "tt-status" }, "מוכן.");
  const progress = el("div", { class: "tt-progress" });
  const progressFill = el("div", { class: "tt-progress-fill" });
  progress.appendChild(progressFill);
  wrap.append(status, progress);

  const resultBox = el("textarea", {
    class: "tt-textarea",
    style: "min-height:190px;",
    placeholder: "התוצאה תופיע כאן...",
  });
  wrap.appendChild(el("div", { class: "tt-card" },
    el("div", { class: "tt-h2" }, "תוצאה"),
    resultBox
  ));

  function selectedStyle() {
    const checked = modal.querySelector('input[name="tt-linguistic-style"]:checked');
    return checked ? checked.value : "combined";
  }

  runBtn.addEventListener("click", async () => {
    const text = inputBox.value.trim();
    if (!text) {
      window.alert("אין טקסט לעריכה.");
      return;
    }
    const apiKey = getSyncedGeminiApiKey(cfg.gemini_api_key || "");
    if (!apiKey) {
      window.alert("חסר מפתח Gemini בהגדרות המערכת.");
      return;
    }
    const style = selectedStyle();
    saveConfigPatch({ torah_style: style });
    runBtn.disabled = true;
    cancelBtn.style.display = "";
    status.textContent = "שולח לשרת לעריכה לשונית תורנית...";
    progressFill.style.width = "25%";
    client = new GasClient();
    try {
      const resp = await client.call({
        prompt_type: `torah_style_${style}`,
        model: "gemini-3.1-pro-preview",
        access_code: null,
        api_key: apiKey,
        text_payload: text,
        torah_mode: true,
        status_callback: (msg) => {
          try { status.textContent = msg; } catch (e) {}
        },
      });
      resultBox.value = resp.result || "";
      progressFill.style.width = "100%";
      status.textContent = "העריכה הושלמה.";
    } catch (e) {
      status.textContent = "העריכה נכשלה.";
      window.alert("שגיאה בעריכה לשונית: " + (e && e.message ? e.message : e));
    } finally {
      runBtn.disabled = false;
      cancelBtn.style.display = "none";
      client = null;
    }
  });

  cancelBtn.addEventListener("click", () => {
    try { if (client) client.cancel(); } catch (e) {}
    status.textContent = "מבוטל...";
  });

  insertBtn.addEventListener("click", () => {
    const text = resultBox.value.trim();
    if (!text) {
      window.alert("אין תוצאה להכניס.");
      return;
    }
    if (!activeEditor) {
      window.alert("אין עורך פעיל להכניס אליו את התוצאה.");
      return;
    }
    insertIntoEditor(activeEditor, text, editorText.hasSelection);
  });

  overlay.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
  overlay.tabIndex = 0;
  document.body.appendChild(overlay);
  try { overlay.focus(); } catch (e) {}
  return { close };
}
