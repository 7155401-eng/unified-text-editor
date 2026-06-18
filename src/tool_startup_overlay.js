// tool_startup_overlay.js
// Small shared loader shown immediately while a tool checks permission or loads vendors.

export function openToolStartupOverlay({ title = "טוען כלי…", message = "מכין את החלון…", dir = "rtl", min = 8 } = {}) {
  if (typeof document === "undefined" || !document.body) return { set() {}, close() {} };

  document.getElementById("ravtext-tool-startup-overlay")?.remove();

  let value = Math.max(0, Math.min(100, Number(min) || 8));
  let closed = false;
  const overlay = document.createElement("div");
  overlay.id = "ravtext-tool-startup-overlay";
  overlay.dir = dir;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.42);backdrop-filter:blur(2px);transition:opacity .09s ease";
  overlay.innerHTML = `
    <style>@keyframes ravtextToolSpin{to{transform:rotate(360deg)}}</style>
    <div style="width:min(420px,calc(100vw - 32px));box-sizing:border-box;border-radius:18px;padding:22px 24px;background:#fff;color:#172033;box-shadow:0 22px 60px rgba(15,23,42,.32);border:1px solid rgba(148,163,184,.35);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:right">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div aria-hidden="true" style="width:28px;height:28px;border-radius:999px;border:3px solid #dbeafe;border-top-color:#2563eb;animation:ravtextToolSpin .8s linear infinite"></div>
        <div style="min-width:0">
          <div style="font-weight:800;font-size:17px;line-height:1.35">${escapeHtml(title)}</div>
          <div data-tool-startup-sub style="font-size:13px;line-height:1.45;color:#64748b;margin-top:3px">${escapeHtml(message)}</div>
        </div>
      </div>
      <progress data-tool-startup-progress value="${value}" max="100" style="width:100%;height:12px;display:block;accent-color:#2563eb"></progress>
    </div>`;

  document.body.appendChild(overlay);
  const progress = overlay.querySelector("[data-tool-startup-progress]");
  const sub = overlay.querySelector("[data-tool-startup-sub]");
  const timer = setInterval(() => {
    if (closed || !progress) return;
    value = Math.min(94, value + (value < 35 ? 7 : value < 70 ? 4 : 1));
    progress.value = value;
  }, 180);

  return {
    set(nextValue, nextMessage) {
      if (closed) return;
      if (Number.isFinite(Number(nextValue))) {
        value = Math.max(value, Math.min(100, Number(nextValue)));
        if (progress) progress.value = value;
      }
      if (nextMessage && sub) sub.textContent = nextMessage;
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      if (progress) progress.value = 100;
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 90);
    }
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
