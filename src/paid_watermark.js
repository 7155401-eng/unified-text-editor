// משה 2026-05-07: סימן מים בתצוגה מלאה — שכבת כיסוי עם מייל המשתמש,
// שקיפות נמוכה, באלכסון, על כל המסך. pointer-events:none כדי שלא יחסום אינטראקציה.
// MutationObserver מחזיר את השכבה אם הוסרה ע"י כלי מפתחים.

const LAYER_ID = "ravtext-paid-watermark-layer";

function buildLayer(email) {
  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  layer.dataset.ravtextWm = "1";
  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483640",
    "pointer-events:none",
    "overflow:hidden",
    "user-select:none",
  ].join(";") + ";";

  const tile = document.createElement("div");
  tile.style.cssText = [
    "position:absolute",
    "inset:-50%",
    "transform:rotate(-30deg)",
    "transform-origin:center",
    "color:#000",
    "opacity:0.06",
    "font:600 22px/1 'Segoe UI', sans-serif",
    "white-space:nowrap",
    "letter-spacing:1px",
  ].join(";") + ";";

  const repeated = (email + "  •  ").repeat(28);
  const rowsHtml = Array.from({ length: 50 }, (_, i) =>
    `<div style="padding:18px 0;">${escapeHtml(repeated)}</div>`
  ).join("");
  tile.innerHTML = rowsHtml;

  layer.appendChild(tile);
  return layer;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureMounted(email) {
  let layer = document.getElementById(LAYER_ID);
  if (layer && layer.dataset.ravtextWm === "1") return;
  if (layer) layer.remove();
  document.body.appendChild(buildLayer(email));
}

export function installPaidWatermark() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const auth = window.__RAVTEXT_AUTH__;
  if (!auth || !auth.paid || !auth.email) return;

  const email = String(auth.email);

  const start = () => {
    ensureMounted(email);

    const observer = new MutationObserver(() => {
      ensureMounted(email);
    });
    observer.observe(document.body, { childList: true, subtree: false });

    setInterval(() => ensureMounted(email), 5000);
  };

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }
}
