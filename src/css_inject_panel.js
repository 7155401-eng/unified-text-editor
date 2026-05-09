// css_inject_panel.js — Royal CSS injection panel for the output preview.
// Allows pasting custom CSS scoped to: page, paragraph, note, stream, or
// arbitrary selector. Exports current design state as JSON for AI prompts.

const STORAGE_KEY = "ravtext.cssInject.css";
const SCOPE_KEY = "ravtext.cssInject.scope";
const HISTORY_KEY = "ravtext.cssInject.history";
const STYLE_TAG_ID = "ravtext-css-inject-tag";
const PANEL_ID = "ravtext-css-inject-panel";
const TOGGLE_ID = "ravtext-css-inject-toggle";

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function saveHistoryEntry(css, scope, label) {
  if (!css || !css.trim()) return;
  const hist = getHistory();
  // Don't dup last entry
  if (hist.length > 0 && hist[0].css === css && hist[0].scope === scope) return;
  hist.unshift({
    label: label || `${new Date().toLocaleTimeString("he-IL")} · ${scope}`,
    css, scope,
    timestamp: new Date().toISOString(),
  });
  // Cap at 50 entries
  while (hist.length > 50) hist.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
}
function deleteHistoryEntry(idx) {
  const hist = getHistory();
  hist.splice(idx, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
}

function getCss() {
  return localStorage.getItem(STORAGE_KEY) || "";
}
function setCss(v) { localStorage.setItem(STORAGE_KEY, v || ""); }
function getScope() { return localStorage.getItem(SCOPE_KEY) || "page"; }
function setScope(v) { localStorage.setItem(SCOPE_KEY, v); }

const PICKED_CLASS = "ravtext-css-pick-target";
function applyCssToDoc() {
  let tag = document.getElementById(STYLE_TAG_ID);
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  const raw = getCss();
  const scope = getScope();
  if (!raw.trim()) {
    tag.textContent = "";
    return;
  }
  let scoped = "";
  switch (scope) {
    case "page":      scoped = `.page { ${raw} }`; break;
    case "paragraph": scoped = `.page .page-main p { ${raw} }`; break;
    case "note":      scoped = `.page .stream .note { ${raw} }`; break;
    case "stream":    scoped = `.page .stream { ${raw} }`; break;
    case "picked":    scoped = `.${PICKED_CLASS} { ${raw} }`; break;
    default:          scoped = raw;
  }
  tag.textContent = scoped;
}

function buildDesignJson() {
  // Snapshot of current design state for AI prompt.
  const ls = (k) => localStorage.getItem(k);
  const data = {
    talmud: {
      enabled: ls("ravtext.talmudLayout") === "1",
      streams: ls("ravtext.talmudLayout.streams") || "",
      crownLines: ls("ravtext.talmudLayout.crownLines") || "4",
      mainWidth: ls("ravtext.talmudLayout.mainWidth") || "42",
      sideMode: ls("ravtext.talmudLayout.sideMode") || "inner-outer",
      preserveBreaks: ls("ravtext.talmudLayout.preserveBreaks") === "1",
      streamRoles: JSON.parse(ls("ravtext.talmudLayout.streamRoles") || "{}"),
    },
    mishna: {
      wrap: ls("ravtext.mishnaWrap") === "1",
      levels: ls("ravtext.mishnaWrap.levels") || "",
    },
    typography: {
      fontFamily: ls("ravtext.fontFamily") || "",
      fontSize: ls("ravtext.fontSize") || "16",
      pageMarginTop: ls("ravtext.pageMarginTop") || "22",
      pageMarginRight: ls("ravtext.pageMarginRight") || "24",
      pageMarginBottom: ls("ravtext.pageMarginBottom") || "18",
      pageMarginLeft: ls("ravtext.pageMarginLeft") || "24",
    },
    customCss: getCss(),
    scope: getScope(),
    timestamp: new Date().toISOString(),
  };
  return JSON.stringify(data, null, 2);
}

async function callAI(prompt) {
  const provider = localStorage.getItem("ravtext.ai.provider") || "anthropic";
  const apiKey = localStorage.getItem("ravtext.ai.apiKey") || "";
  if (!apiKey) {
    alert("נדרש מפתח API. הזן בהגדרות.");
    return null;
  }
  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    return data.content?.[0]?.text || JSON.stringify(data);
  }
  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }
  if (provider === "google") {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2000 },
      }),
    });
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
  }
  if (provider === "mistral") {
    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "mistral-large-latest",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }
  if (provider === "groq") {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }
  if (provider === "deepseek") {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }
  return null;
}

// Drag-resize: handle sits on left or right edge of panel; cursor delta updates the panel's
// grid-column width. Direction is derived from handle position relative to panel center, so
// it works in both LTR and RTL.
const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 720;
const PANEL_WIDTH_KEY = "ravtext.cssInject.panelWidth";

function attachPanelResizer(handle, panel, mainEl) {
  handle.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const panelRect = panel.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const handleCenterX = handleRect.left + handleRect.width / 2;
    const isRightEdge = handleCenterX > panelRect.left + panelRect.width / 2;
    const anchorX = isRightEdge ? panelRect.left : panelRect.right;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e) {
      const newW = isRightEdge ? (e.clientX - anchorX) : (anchorX - e.clientX);
      if (newW >= PANEL_MIN_WIDTH && newW <= PANEL_MAX_WIDTH) {
        mainEl.style.setProperty("--ci-panel-width", `${Math.round(newW)}px`);
      }
    }
    function onUp() {
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        const cur = mainEl.style.getPropertyValue("--ci-panel-width");
        if (cur) localStorage.setItem(PANEL_WIDTH_KEY, cur);
      } catch (_) {}
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function restorePanelWidth(mainEl) {
  try {
    const saved = localStorage.getItem(PANEL_WIDTH_KEY);
    if (saved) mainEl.style.setProperty("--ci-panel-width", saved);
  } catch (_) {}
}

function buildPanel() {
  if (document.getElementById(PANEL_ID)) return;
  // Place panel as sibling BETWEEN input section and preview pane (outside preview)
  const main = document.querySelector("main.main");
  const previewPane = document.querySelector(".preview-pane");
  if (!main || !previewPane) {
    setTimeout(buildPanel, 500);
    return;
  }
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.dir = "rtl";
  panel.hidden = true;
  panel.style.cssText = `
    flex: 0 0 320px;
    background: var(--panel, #ffffff);
    color: var(--txt, #1d1d1f);
    border-inline-start: 1px solid var(--border, #d0d0d4);
    padding: 12px; font-family: inherit;
    display: flex; flex-direction: column; gap: 8px; overflow-y: auto;
    align-self: stretch; position: relative;
  `;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border,#d0d0d4);padding-bottom:6px;">
      <strong style="font-size:14px;color:var(--word-blue,#2B579A);">CSS מותאם · AI</strong>
      <button id="ci-close" class="ci-btn" style="padding:2px 8px;">×</button>
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
      <span style="min-width:50px;color:var(--muted,#666);">היקף:</span>
      <select id="ci-scope" style="flex:1;padding:4px 6px;font-size:12px;">
        <option value="page">כל העמודים</option>
        <option value="paragraph">כל הפסקאות בראשי</option>
        <option value="note">כל ההערות בזרמים</option>
        <option value="stream">כל הזרמים</option>
        <option value="picked">פריט שנבחר ⤵</option>
        <option value="raw">CSS חופשי</option>
      </select>
    </label>
    <div id="ci-scope-help" style="font-size:11px;color:var(--muted,#666);background:#fafafa;padding:5px;border-radius:3px;border:1px dashed var(--border,#d0d0d4);">בחר היקף — ה-CSS יוחל לכל פריט בקטגוריה</div>
    <button id="ci-pick" class="ci-btn" style="display:none;">בחר אלמנט בעמוד (לחץ עליו)</button>
    <div id="ci-picked-target" style="font-size:11px;color:var(--word-blue,#2B579A);display:none;"></div>
    <textarea id="ci-css" rows="6" placeholder="/* CSS מותאם */" spellcheck="false" style="
      background:#fafafa;color:#1d1d1f;border:1px solid var(--border,#d0d0d4);border-radius:4px;
      padding:6px;font-family:'Consolas','Monaco',monospace;font-size:11px;direction:ltr;text-align:left;
      resize:vertical;min-height:100px;"></textarea>
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      <button id="ci-apply" class="ci-btn ci-btn-primary">החל ושמור בהיסטוריה</button>
      <button id="ci-clear" class="ci-btn">נקה</button>
    </div>
    <div style="border-top:1px solid var(--border,#d0d0d4);padding-top:6px;">
      <strong style="color:var(--word-blue,#2B579A);font-size:12px;">JS מותאם (לתיקוני engine)</strong>
      <textarea id="ci-js" rows="5" placeholder="// קוד JS — ירוץ פעם אחת על pages-container.&#10;// דוגמה: document.querySelectorAll('.talmud-crown-portion').forEach(c => c.style.height = '72px')" spellcheck="false" style="
        margin-top:4px;background:#fafafa;color:#1d1d1f;border:1px solid var(--border,#d0d0d4);border-radius:4px;
        padding:6px;font-family:'Consolas','Monaco',monospace;font-size:11px;direction:ltr;text-align:left;
        resize:vertical;min-height:80px;width:100%;"></textarea>
      <div style="display:flex;gap:4px;margin-top:4px;">
        <button id="ci-js-run" class="ci-btn ci-btn-primary">הרץ JS</button>
        <button id="ci-js-clear" class="ci-btn">נקה</button>
      </div>
      <div id="ci-js-result" style="font-size:11px;color:#444;margin-top:4px;display:none;background:#fafafa;padding:4px;border-radius:3px;border:1px solid var(--border,#d0d0d4);direction:ltr;text-align:left;"></div>
    </div>
    <div style="border-top:1px solid var(--border,#d0d0d4);padding-top:6px;">
      <strong style="color:var(--word-blue,#2B579A);font-size:12px;">היסטוריה</strong>
      <div id="ci-history" style="max-height:130px;overflow-y:auto;font-size:11px;margin-top:4px;"></div>
    </div>
    <div style="border-top:1px solid var(--border,#d0d0d4);padding-top:8px;display:flex;flex-direction:column;gap:6px;">
      <strong style="color:var(--word-blue,#2B579A);font-size:12px;">בקש מ-AI עיצוב</strong>
      <textarea id="ci-prompt" rows="3" placeholder="תאר מה תרצה לעצב…" style="
        background:#fafafa;color:#1d1d1f;border:1px solid var(--border,#d0d0d4);border-radius:4px;
        padding:6px;font-size:12px;direction:rtl;resize:vertical;"></textarea>
      <button id="ci-ask-ai" class="ci-btn ci-btn-primary">קבל הצעה מ-AI</button>
      <div id="ci-ai-result" style="font-size:11px;color:#444;max-height:120px;overflow-y:auto;display:none;background:#fafafa;padding:6px;border-radius:3px;border:1px solid var(--border,#d0d0d4);"></div>
    </div>
  `;
  // Inject minimal button styles for the panel
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    #${PANEL_ID} .ci-btn {
      background: var(--btn,#fff); color: var(--txt,#1d1d1f);
      border: 1px solid var(--border,#d0d0d4); border-radius: 4px;
      padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
    }
    #${PANEL_ID} .ci-btn:hover { background: var(--btn-h,#f0f0f0); }
    #${PANEL_ID} .ci-btn-primary {
      background: var(--word-blue,#2B579A); color: #fff;
      border-color: var(--word-blue-dark,#185ABD);
    }
    #${PANEL_ID} .ci-btn-primary:hover { background: var(--word-blue-dark,#185ABD); }
    #${TOGGLE_ID} {
      background: var(--btn,#fff); color: var(--word-blue,#2B579A);
      border: 1px solid var(--border,#d0d0d4); border-radius: 4px;
      padding: 4px 10px; font-size: 12px; cursor: pointer;
      margin-inline-start: 8px;
    }
    #${TOGGLE_ID}:hover { background: var(--btn-h,#f0f0f0); }
    #${TOGGLE_ID}.active { background: var(--word-blue,#2B579A); color: #fff; }
    .preview-pane.has-css-panel { display: flex; flex-direction: row-reverse; }
    .preview-pane.has-css-panel > #${PANEL_ID} { order: -1; }
  `;
  document.head.appendChild(styleTag);
  // Insert panel BETWEEN input section and preview pane (sibling of preview)
  main.insertBefore(panel, previewPane);

  // Resize handles — drag panel edge with editor (left handle) and with preview (right handle).
  // The .main grid uses var(--ci-panel-width) for the panel column; we update it on drag.
  const handleLeft = document.createElement("div");
  handleLeft.className = "ci-resize-handle left";
  handleLeft.title = "גרור לשינוי רוחב הסרגל";
  const handleRight = document.createElement("div");
  handleRight.className = "ci-resize-handle right";
  handleRight.title = "גרור לשינוי רוחב הסרגל";
  panel.appendChild(handleLeft);
  panel.appendChild(handleRight);
  attachPanelResizer(handleLeft, panel, main);
  attachPanelResizer(handleRight, panel, main);
  restorePanelWidth(main);

  // Toggle button — placed in pdf-toolbar
  const toolbar = document.getElementById("pdf-toolbar");
  if (toolbar) {
    const toggle = document.createElement("button");
    toggle.id = TOGGLE_ID;
    toggle.type = "button";
    toggle.title = "פאנל CSS + AI";
    toggle.textContent = "{ } CSS";
    toggle.addEventListener("click", () => {
      const willOpen = panel.hidden;
      panel.hidden = !willOpen ? true : false;
      panel.style.display = willOpen ? "flex" : "none";
      toggle.classList.toggle("active", willOpen);
    });
    toolbar.appendChild(toggle);
    // Initial state — closed
    panel.style.display = "none";
  }

  // Wire panel
  panel.querySelector("#ci-close").addEventListener("click", () => {
    panel.hidden = true;
    panel.style.display = "none";
    const tg = document.getElementById(TOGGLE_ID);
    if (tg) tg.classList.remove("active");
  });
  const cssTa = panel.querySelector("#ci-css");
  const scopeSel = panel.querySelector("#ci-scope");
  cssTa.value = getCss();
  scopeSel.value = getScope();
  // Scope picker UI logic
  const helpEl = panel.querySelector("#ci-scope-help");
  const pickBtn = panel.querySelector("#ci-pick");
  const pickedEl = panel.querySelector("#ci-picked-target");
  const helpTexts = {
    page: "ה-CSS יוחל על כל אלמנט .page בעמודי הפלט",
    paragraph: "ה-CSS יוחל על כל פסקה (p) בזרם הראשי",
    note: "ה-CSS יוחל על כל הערה בזרמי הצד והתחתון",
    stream: "ה-CSS יוחל על כל אלמנט .stream",
    picked: "לחץ 'בחר אלמנט', ואז לחץ על פריט בעמוד שתרצה לעצב",
    raw: "ה-CSS שתזין יוחל ישירות בלי הגבלת היקף — כתוב סלקטורים מלאים",
  };
  function updateScopeUI() {
    const v = scopeSel.value;
    helpEl.textContent = helpTexts[v] || "";
    pickBtn.style.display = v === "picked" ? "block" : "none";
    pickedEl.style.display = v === "picked" && document.querySelector("." + PICKED_CLASS) ? "block" : "none";
  }
  scopeSel.addEventListener("change", () => {
    setScope(scopeSel.value);
    updateScopeUI();
    applyCssToDoc();
  });
  updateScopeUI();
  // Picker mode
  let pickActive = false;
  function exitPickMode() {
    pickActive = false;
    document.body.style.cursor = "";
    document.removeEventListener("click", pickHandler, true);
    pickBtn.textContent = "בחר אלמנט בעמוד (לחץ עליו)";
  }
  function pickHandler(ev) {
    const target = ev.target.closest(".page p, .page .note, .page .stream, .page");
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    document.querySelectorAll("." + PICKED_CLASS).forEach(el => el.classList.remove(PICKED_CLASS));
    target.classList.add(PICKED_CLASS);
    pickedEl.textContent = `נבחר: ${target.tagName.toLowerCase()}.${[...target.classList].filter(c=>c!==PICKED_CLASS).slice(0,2).join(".")}`;
    pickedEl.style.display = "block";
    exitPickMode();
  }
  pickBtn.addEventListener("click", () => {
    if (pickActive) { exitPickMode(); return; }
    pickActive = true;
    document.body.style.cursor = "crosshair";
    pickBtn.textContent = "מצב בחירה פעיל — לחץ על אלמנט (או כאן לביטול)";
    setTimeout(() => document.addEventListener("click", pickHandler, true), 100);
  });

  function renderHistory() {
    const histEl = panel.querySelector("#ci-history");
    if (!histEl) return;
    const hist = getHistory();
    if (hist.length === 0) {
      histEl.innerHTML = '<div style="color:var(--muted,#888);padding:4px;">אין עדיין שמירות. החל CSS כדי לשמור.</div>';
      return;
    }
    histEl.innerHTML = "";
    hist.forEach((entry, idx) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:4px;padding:3px;border-bottom:1px solid #eee;";
      const lbl = document.createElement("button");
      lbl.className = "ci-btn";
      lbl.style.cssText = "flex:1;text-align:right;padding:3px 6px;font-size:11px;";
      lbl.textContent = entry.label;
      lbl.title = entry.css.slice(0, 200);
      lbl.addEventListener("click", () => {
        cssTa.value = entry.css;
        scopeSel.value = entry.scope || "page";
        setCss(entry.css);
        setScope(scopeSel.value);
        applyCssToDoc();
        updateScopeUI();
      });
      const del = document.createElement("button");
      del.className = "ci-btn";
      del.style.cssText = "padding:2px 6px;font-size:11px;color:#a33;";
      del.textContent = "🗑";
      del.title = "מחק";
      del.addEventListener("click", () => {
        deleteHistoryEntry(idx);
        renderHistory();
      });
      row.appendChild(lbl);
      row.appendChild(del);
      histEl.appendChild(row);
    });
  }
  renderHistory();
  panel.querySelector("#ci-apply").addEventListener("click", () => {
    // Cloud-Chrome 2026-05-06 fix: לפעמים cssTa.value אינו עדכני בעת click
    // (React/programmatic set without event). מאלצים read מ-DOM נטו.
    const liveTa = document.getElementById("ci-css") || cssTa;
    const v = liveTa.value;
    setCss(v);
    setScope(scopeSel.value);
    saveHistoryEntry(v, scopeSel.value);
    applyCssToDoc();
    renderHistory();
    // sanity: גם אם המאזין לא רץ, לכפות עדכון של style tag ישיר
    const tag = document.getElementById(STYLE_TAG_ID);
    if (tag && tag.textContent !== "" && !tag.textContent.includes(v.slice(0, 30))) {
      console.warn("[CSS panel] style tag mismatch — forcing direct update");
      applyCssToDoc();
    }
  });
  panel.querySelector("#ci-clear").addEventListener("click", () => {
    cssTa.value = ""; setCss(""); applyCssToDoc();
  });
  // משה 2026-05-06: JS injection — להריץ קוד JS מותאם על pages-container.
  // CSS לבד לא מספיק לתיקוני engine; JS מאפשר לשנות style.height inline ולתקן
  // באגים ברמת אלמנט (כמו crown 54px) שה-CSS לא יכול לכפות.
  const jsTa = panel.querySelector("#ci-js");
  const jsResult = panel.querySelector("#ci-js-result");
  panel.querySelector("#ci-js-run").addEventListener("click", () => {
    const code = jsTa.value.trim();
    if (!code) { jsResult.style.display = "block"; jsResult.textContent = "אין קוד"; return; }
    jsResult.style.display = "block";
    try {
      const fn = new Function("pagesContainer", "doc", code);
      const ret = fn(document.querySelector(".pages-container"), document);
      jsResult.style.color = "#0a8a0a";
      jsResult.textContent = "✓ הורץ בהצלחה" + (ret !== undefined ? " | תוצאה: " + String(ret).slice(0, 200) : "");
    } catch (err) {
      jsResult.style.color = "#c62828";
      jsResult.textContent = "✗ שגיאה: " + err.message;
    }
  });
  panel.querySelector("#ci-js-clear").addEventListener("click", () => {
    jsTa.value = ""; jsResult.style.display = "none";
  });
  panel.querySelector("#ci-ask-ai").addEventListener("click", async () => {
    const userPrompt = panel.querySelector("#ci-prompt").value.trim();
    if (!userPrompt) { alert("הזן בקשה"); return; }
    const result = panel.querySelector("#ci-ai-result");
    result.style.display = "block";
    result.textContent = "בקשה ל-AI… (עשוי לקחת 5-15 שניות)";
    const json = buildDesignJson();
    // Capture sanitized HTML of pages-container (limit to first 3 pages, strip styles)
    const pages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
    let htmlSnippet = "";
    Array.from(pages).slice(0, 3).forEach((p, i) => {
      const clone = p.cloneNode(true);
      clone.querySelectorAll("[style]").forEach(el => el.removeAttribute("style"));
      htmlSnippet += `\n<!-- Page ${i + 1} -->\n` + clone.outerHTML.slice(0, 4000);
    });
    const v9KnowledgeBase = `
== מבנה הקלאסים והקוד של V9 (מנוע פריסת וילנא) ==

מבנה DOM:
- .pages-container — מיכל כל העמודים. dir=rtl. CSS variables --ravtext-page-width (380px ברירת מחדל), --ravtext-page-height (537px), --ravtext-page-main-size (12px), --ravtext-page-stream-size (10px), --ravtext-page-font-family.
- .page.v9-page — עמוד יחיד. position:relative, overflow:hidden, רוחב/גובה קבועים, padding=12px. dataset: data-page-index="0", data-realized="1".
- .v9-line — שורת טקסט בודדת. position:absolute. inline style: left, top, width, height, font-size, line-height, font-family. עם class "justify" אם השורה מוצדקת (לא אחרונה בפסקה).
- .v9-stream-title — כותרת של זרם (למשל "מגן אברהם"). position:absolute. font-weight:bold, border-bottom. עם class stream-color-N (1-6) לרקע צבעוני: 1=תכלת, 2=ירוק, 3=סגול, 4=צהוב, 5=ורוד, 6=כתום.

מבנה הפריסה (Talmud V9):
- שני זרמי "sides" בראש העמוד: ימני left=194 width=174, שמאלי left=12 width=174 (פיזיות RTL: ימין=high left).
- כתר (crown): לפעמים מופיע בראש לפני הראשי, 4 שורות ברירת מחדל (cfg.crownLines).
- ראשי: מתחת לסיידים. מתפרס בפסים (strips) עם רוחבים שונים לפי בר־מצרא: כשפרשן מסתיים, הראשי מתפשט לתוך השטח שלו. רוחב strip 1 = mainWidth (~149px), strip 2 = רחב יותר (~253px), strip 3 = הכי רחב (~356px).
- footer streams: מתחת לראשי, full-width 356px, font-size 10px. כל זרם מקבל כותרת (.v9-stream-title stream-color-N).

מבנה הקלט והנתונים:
- paragraphs[] = רשימת פסקאות. כל פסקה: { mainText: string, notes: [{stream, text, anchor, num}] }.
- notes[].anchor = אופסט תווים ב-mainText בו מופיע ה-marker של ההערה (1-based offset של מילה).
- notes[].stream = קוד זרם דו-ספרתי "01"-"99": 01=מגן אברהם, 02=משנה ברורה, 03=ביאור הלכה, 04=טורי זהב, 05=כף החיים.
- talmudStreams config = מערך קודי זרמים שהמשתמש בחר; הראשון=ימני, השני=שמאלי, השאר=footer.

מנגנון פיצול ועיגון (V9 internals):
- buildPages(container, paragraphs, config) — כניסה ראשית, אסינכרוני.
- aggregateForV9(slice, ...) — בונה תוכן עמוד מפסקאות + carryOver.
- buildPagePlan / buildSinglePage — מתכנן ומרנדר עמוד יחיד.
- pendingParagraph — המשך פסקה שפוצלה (mainText חתוך, notes חתוכים לפי anchor).
- carryOver — overflow.streams שעולה מעמוד אחד לבא (text per streamId).
- _drainMarker — pendingParagraph ריק שמייצג "המשך הערות הפסקה הקודמת" — מונע מ-carry לזרום לעמוד עם פסקה חדשה.
- fitsClean(tp) — בודק שהעמוד לא חורג ושום הערה לא נחתכה.
- אנקור-ספליט — כשפסקה מפוצלת, הערות עם anchor < נקודת-הפיצול נשארות בחצי הראשון; אנקור >= נקודת-הפיצול עוברים לחצי השני (אנקור מתעדכן ב-minus).

localStorage keys:
- ravtext.talmudLayout = "0"/"1" — האם מצב גפ"ת פעיל
- ravtext.talmudLayout.streams = "01,02,03" — קודי זרמים
- ravtext.vilnaV9Beta = "0"/"1" — V9 (admin only)
- ravtext.talmudLayout.crownLines = number — שורות בכתר
- ravtext.talmudLayout.mainWidth = percent — רוחב ראשי
- ravtext.talmudLayout.sideMode = "auto"/"right-left"/"inner-outer"

נתיב הקובץ: src/vilna_v9.js (~1100 שורות), src/vilna_v9_apply.js (gateway), src/talmud_controls.js (UI wiring).
`;
    const fullPrompt =
      `אני משתמש במערכת "רב טקסט" עם פריסת תלמוד. הנה נתוני העיצוב הנוכחי:\n\n` +
      `\`\`\`json\n${json}\n\`\`\`\n\n` +
      `הנה דוגמא של ה-HTML של העמודים:\n\`\`\`html\n${htmlSnippet}\n\`\`\`\n` +
      v9KnowledgeBase + `\n` +
      `הבקשה שלי:\n${userPrompt}\n\n` +
      `הוראות: החזר CSS בלבד שיכניס לתיבת ה-CSS המותאם. עטוף בבלוק \`\`\`css ... \`\`\`. בלי הסברים, בלי טקסט נוסף.`;
    try {
      const reply = await callAI(fullPrompt);
      if (reply) {
        result.textContent = reply;
        const cssMatch = reply.match(/```css\s*([\s\S]+?)```/) || reply.match(/```\s*([\s\S]+?)```/);
        if (cssMatch) {
          cssTa.value = cssMatch[1].trim();
        } else {
          cssTa.value = reply.trim();
        }
      } else {
        result.textContent = "לא התקבלה תשובה (בדוק מפתח API בהגדרות)";
      }
    } catch (err) {
      result.textContent = "שגיאה: " + (err.message || err);
    }
  });
}

export function setupCssInjectPanel() {
  if (document.getElementById(PANEL_ID)) return;
  buildPanel();
  applyCssToDoc();
}

export { applyCssToDoc, buildDesignJson };
