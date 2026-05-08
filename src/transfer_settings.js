// transfer_settings.js
// פורט verbatim של תכונת "הגדרות העתקה" + "כפתור צף העתק לזרם N"
// מ-comparator_tool.py (PR #105 בפייתון).
//
// המקור הפייתוני:
//   showTransferSettings, closeTransferModal, saveTransferSettings,
//   updateTransferButtonText, handleMainSelection, copySelectedText
//   (comparator_tool.py שורות 1412-1491)
//
// המודול עובד על paneManager של העורך החדש — חלונית 1 = ראשי, חלוניות
// אחרות = זרמים. transferTargetStream שומר אינדקס חלונית-יעד; prefix/suffix
// נכרכים סביב הטקסט הנבחר בזמן ההעתקה.

const STORAGE_KEY = "ravtext.transfer.v1";

let transferTargetIndex = 1;   // אינדקס בתוך paneManager.panes (1 = החלונית השנייה = "זרם 1")
let transferPrefix = "";
let transferSuffix = "";
let _selectionTimer = null;

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.targetIndex === "number") transferTargetIndex = obj.targetIndex;
    if (typeof obj.prefix === "string") transferPrefix = obj.prefix;
    if (typeof obj.suffix === "string") transferSuffix = obj.suffix;
  } catch (_) { /* localStorage חסום — דילוג */ }
}

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      targetIndex: transferTargetIndex,
      prefix: transferPrefix,
      suffix: transferSuffix,
    }));
  } catch (_) { /* localStorage חסום — דילוג */ }
}

function streamPanes(paneManager) {
  // כל החלוניות מלבד הראשית (אינדקס 0)
  return (paneManager.panes || []).filter((_, i) => i > 0);
}

function ensureModal() {
  let modal = document.getElementById("transferModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "transferModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="transferTitle">
      <h2 id="transferTitle">הגדרות העתקת טקסט</h2>
      <p style="color:var(--muted);margin-bottom:12px">הגדר את יעד ההעתקה מהטקסט הראשי:</p>
      <div style="display:flex; flex-direction:column; gap:10px; text-align:right;">
        <div>
          <label for="transferStreamSelect">זרם יעד:</label>
          <select id="transferStreamSelect" class="sym-input"
                  style="width:100%; padding:5px; margin-top:5px;"></select>
        </div>
        <div>
          <label for="transferPrefix">תוספת לפני הטקסט (לדוגמה $$):</label>
          <input type="text" id="transferPrefix" class="sym-input"
                 style="width:100%; padding:5px; margin-top:5px;">
        </div>
        <div>
          <label for="transferSuffix">תוספת אחרי הטקסט (לדוגמה ##):</label>
          <input type="text" id="transferSuffix" class="sym-input"
                 style="width:100%; padding:5px; margin-top:5px;">
        </div>
      </div>
      <div class="modal-btns" style="margin-top:20px;">
        <button type="button" class="btn gold" id="transferSaveBtn">שמור</button>
        <button type="button" class="btn" id="transferCancelBtn">ביטול</button>
      </div>
    </div>
  `;
  // CSS גנרי אם השרת לא הגדיר .modal-overlay/.modal — fallback inline
  if (!document.querySelector("style#transfer-settings-style")) {
    const st = document.createElement("style");
    st.id = "transfer-settings-style";
    st.textContent = `
      #transferModal{position:fixed;inset:0;background:rgba(0,0,0,0.55);
        z-index:9998;display:none;align-items:center;justify-content:center;}
      #transferModal.active{display:flex;}
      #transferModal .modal{background:var(--bg, #1a1f2e);color:var(--txt, #eee);
        padding:24px 28px;border-radius:10px;min-width:320px;max-width:90vw;
        box-shadow:0 12px 32px rgba(0,0,0,0.4);direction:rtl;}
      #transferModal h2{margin:0 0 8px;font-size:18px;}
      #transferModal label{font-size:13px;}
      #transferModal .sym-input{background:var(--bg-input, #0f1320);
        color:var(--txt, #eee);border:1px solid var(--border, #444);}
      #transferModal .modal-btns{display:flex;gap:10px;justify-content:flex-start;}
      #transferModal .btn{padding:8px 18px;border:none;border-radius:6px;cursor:pointer;
        font-weight:600;background:#475569;color:#fff;}
      #transferModal .btn.gold{background:#D4AF37;color:#000;}
      #quick-transfer-btn{position:absolute;background:#D4AF37;color:#1a1f2e;
        border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;
        z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:13px;
        font-family:inherit;}
    `;
    document.head.appendChild(st);
  }
  document.body.appendChild(modal);
  return modal;
}

function repopulateSelect(paneManager) {
  const sel = document.getElementById("transferStreamSelect");
  if (!sel) return;
  const streams = streamPanes(paneManager);
  sel.innerHTML = "";
  streams.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i + 1);  // אינדקס 1-based בתוך paneManager.panes (i+1 כי דילגנו על הראשי)
    const label = p.label || (`זרם ${i + 1}`);
    const code = p.streamCode ? ` (@${p.streamCode})` : "";
    opt.textContent = `${label}${code}`;
    sel.appendChild(opt);
  });
  if (transferTargetIndex < 1 || transferTargetIndex > streams.length) {
    transferTargetIndex = streams.length > 0 ? 1 : 0;
  }
  sel.value = String(transferTargetIndex);
}

export function showTransferSettings(paneManager) {
  const modal = ensureModal();
  repopulateSelect(paneManager);
  document.getElementById("transferPrefix").value = transferPrefix;
  document.getElementById("transferSuffix").value = transferSuffix;
  modal.classList.add("active");
}

export function closeTransferModal() {
  const m = document.getElementById("transferModal");
  if (m) m.classList.remove("active");
}

function saveTransferSettings(paneManager) {
  const sel = document.getElementById("transferStreamSelect");
  const pre = document.getElementById("transferPrefix");
  const suf = document.getElementById("transferSuffix");
  if (sel) transferTargetIndex = parseInt(sel.value, 10) || 1;
  if (pre) transferPrefix = pre.value;
  if (suf) transferSuffix = suf.value;
  savePrefs();
  closeTransferModal();
  updateTransferButtonText(paneManager);
}

function updateTransferButtonText(paneManager) {
  const btn = document.getElementById("quick-transfer-btn");
  if (btn) {
    const streams = streamPanes(paneManager);
    const tgt = streams[transferTargetIndex - 1];
    const label = tgt?.label || `זרם ${transferTargetIndex}`;
    btn.textContent = `העתק ל${label}`;
  }
}

// פורט מ-handleMainSelection ב-comparator_tool.py:1442-1468
function handleMainSelection(paneManager) {
  const main = paneManager.getMainPane?.();
  if (!main || !main.editor) return;
  const ed = main.editor;
  const existing = document.getElementById("quick-transfer-btn");
  if (existing) existing.remove();

  const { from, to } = ed.state.selection;
  if (from === to) return;
  const selectedText = ed.state.doc.textBetween(from, to, "\n");
  if (!selectedText) return;

  // חישוב מיקום — מציבים את הכפתור מתחת לסוף הבחירה במסך
  let coords;
  try {
    coords = ed.view.coordsAtPos(to);
  } catch (_) {
    return;
  }
  if (!coords) return;

  const streams = streamPanes(paneManager);
  if (streams.length === 0) return;
  const tgt = streams[transferTargetIndex - 1] || streams[0];
  const label = tgt?.label || `זרם ${transferTargetIndex}`;

  const btn = document.createElement("button");
  btn.id = "quick-transfer-btn";
  btn.type = "button";
  btn.textContent = `העתק ל${label}`;
  btn.style.left = (coords.left + window.scrollX) + "px";
  btn.style.top = (coords.bottom + window.scrollY + 8) + "px";
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    copySelectedText(paneManager);
    btn.remove();
  });
  document.body.appendChild(btn);

  clearTimeout(window._transferBtnTimer);
  window._transferBtnTimer = setTimeout(() => {
    if (btn.parentNode) btn.remove();
  }, 4000);
}

// פורט מ-copySelectedText ב-comparator_tool.py:1470-1491
function copySelectedText(paneManager) {
  const main = paneManager.getMainPane?.();
  if (!main || !main.editor) return;
  const ed = main.editor;
  const { from, to } = ed.state.selection;
  if (from === to) return;
  const text = ed.state.doc.textBetween(from, to, "\n");
  if (!text) return;

  const streams = streamPanes(paneManager);
  const target = streams[transferTargetIndex - 1] || streams[0];
  if (!target || !target.editor) {
    alert("אין חלונית יעד — צור חלונית עם כפתור '+ חלונית'");
    return;
  }

  const fullText = transferPrefix + text + transferSuffix;
  // הוספה בסוף החלונית (paste-style append) ושמירה על מיקוד הסמן
  target.editor.chain().focus("end").insertContent(fullText).run();
}

export function setupTransferSettings(paneManager) {
  loadPrefs();
  ensureModal();

  // Wire close/save buttons + esc key
  document.addEventListener("click", (ev) => {
    if (ev.target.id === "transferSaveBtn") saveTransferSettings(paneManager);
    if (ev.target.id === "transferCancelBtn") closeTransferModal();
    // קליק מחוץ ל-.modal סוגר
    if (ev.target.id === "transferModal") closeTransferModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = document.getElementById("transferModal");
    if (m && m.classList.contains("active")) closeTransferModal();
  });

  // Wire selection handler על העורך הראשי
  function bindMainSelection() {
    const main = paneManager.getMainPane?.();
    if (!main || !main.editor) return;
    const ed = main.editor;
    if (ed._transferSelectionWired) return;
    ed._transferSelectionWired = true;
    ed.on("selectionUpdate", () => {
      clearTimeout(_selectionTimer);
      _selectionTimer = setTimeout(() => handleMainSelection(paneManager), 220);
    });
    // הסרת הכפתור הצף בכל לחיצה במסך מחוץ אליו
    document.addEventListener("mousedown", (ev) => {
      const b = document.getElementById("quick-transfer-btn");
      if (b && !b.contains(ev.target)) b.remove();
    });
  }
  bindMainSelection();
  // אם החלונית הראשית עדיין נטענת — ננסה שוב כמה פעמים
  let tries = 0;
  const tid = setInterval(() => {
    tries++;
    bindMainSelection();
    const main = paneManager.getMainPane?.();
    if ((main && main.editor) || tries > 20) clearInterval(tid);
  }, 400);
}
