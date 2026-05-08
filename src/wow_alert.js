// wow_alert.js
// פורט verbatim של showWowAlert / closeWowAlert מ-comparator_tool.py:1493-1505
// modal מעוצב עם 4 סוגים: info / warn / err / ok.
// מציע API דומה ל-alert(), אבל מחזיר Promise כדי שאפשר לחכות לסגירה.

let _wowResolve = null;

function ensureMarkup() {
  if (document.getElementById("wowAlert")) return;

  const ov = document.createElement("div");
  ov.id = "wowAlert";
  ov.className = "wow-overlay";
  ov.innerHTML = `
    <div class="wow-card" id="wowCard">
      <div class="wow-icon" id="wowIcon">ℹ</div>
      <div class="wow-title" id="wowTitle"></div>
      <div class="wow-msg" id="wowMsg"></div>
      <button class="wow-btn" id="wowOk">אישור</button>
    </div>
  `;
  document.body.appendChild(ov);

  if (!document.getElementById("wow-alert-style")) {
    const st = document.createElement("style");
    st.id = "wow-alert-style";
    st.textContent = `
      .wow-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);
        z-index:10000;display:none;align-items:center;justify-content:center;}
      .wow-overlay.active{display:flex;}
      .wow-card{background:#1a1f2e;color:#eee;padding:28px 32px;border-radius:12px;
        min-width:320px;max-width:90vw;box-shadow:0 16px 40px rgba(0,0,0,0.5);
        border-top:4px solid #D4AF37;text-align:center;direction:rtl;}
      .wow-card.wow-info{border-top-color:#3B82F6;}
      .wow-card.wow-warn{border-top-color:#F59E0B;}
      .wow-card.wow-err{border-top-color:#DC2626;}
      .wow-card.wow-ok{border-top-color:#16A34A;}
      .wow-icon{font-size:36px;margin-bottom:8px;}
      .wow-title{font-size:18px;font-weight:bold;margin-bottom:8px;}
      .wow-msg{font-size:14px;color:#bbb;margin-bottom:16px;white-space:pre-line;}
      .wow-btn{background:#D4AF37;color:#000;border:none;padding:10px 28px;
        border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;}
      .wow-btn:hover{background:#E5C158;}
      body.light-theme .wow-card{background:#fff;color:#1a1f2e;}
      body.light-theme .wow-msg{color:#444;}
    `;
    document.head.appendChild(st);
  }

  ov.querySelector("#wowOk").addEventListener("click", closeWowAlert);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const o = document.getElementById("wowAlert");
    if (o && o.classList.contains("active")) closeWowAlert();
  });
}

export function showWowAlert(title, message, type) {
  ensureMarkup();
  const ov = document.getElementById("wowAlert");
  const card = document.getElementById("wowCard");
  const icon = document.getElementById("wowIcon");
  const t = document.getElementById("wowTitle");
  const m = document.getElementById("wowMsg");
  const typeMap = {
    info: { cls: "wow-info", ic: "ℹ" },
    warn: { cls: "wow-warn", ic: "⚠" },
    err:  { cls: "wow-err",  ic: "✖" },
    ok:   { cls: "wow-ok",   ic: "✔" },
  };
  const cfg = typeMap[type] || typeMap.info;
  card.className = "wow-card " + cfg.cls;
  icon.textContent = cfg.ic;
  t.textContent = title || "";
  m.textContent = message || "";
  ov.classList.add("active");
  return new Promise((res) => { _wowResolve = res; });
}

export function closeWowAlert() {
  const ov = document.getElementById("wowAlert");
  if (ov) ov.classList.remove("active");
  if (_wowResolve) { _wowResolve(true); _wowResolve = null; }
}

// חשיפה ל-window למקרים שצריך לקרוא מ-inline onclick
if (typeof window !== "undefined") {
  window.showWowAlert = showWowAlert;
  window.closeWowAlert = closeWowAlert;
}
