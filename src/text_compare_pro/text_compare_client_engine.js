export function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}

export function getBlocks(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length);
}

async function postTextCompare(action, payload) {
  const res = await fetch("/api/text-compare-pro", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    let message = "Server rejected text compare request";
    try {
      const body = await res.json();
      message = body?.message || body?.error || message;
    } catch (_) {}
    throw new Error(message);
  }
  const body = await res.json();
  return body.report;
}

export function computeSmartCompare(text1, text2, opts) {
  return postTextCompare("smart", { text1, text2, opts });
}

export function renderSmartReport(report) {
  return report?.html || "";
}

export function computeIntegrity(base, insert, merged, opts) {
  return postTextCompare("integrity", { base, insert, merged, opts });
}

export function renderIntegrityReport(report) {
  return report?.html || "";
}

function vendorBase() {
  let b = "/";
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) {
      b = import.meta.env.BASE_URL;
    }
  } catch (_) {}
  if (!b.endsWith("/")) b = b + "/";
  return b + "vendor/text_compare_pro";
}
let _vendorPromise = null;

export function ensureVendorLoaded() {
  if (_vendorPromise) return _vendorPromise;
  const base = vendorBase();
  _vendorPromise = Promise.all([
    loadScript(`${base}/mammoth.browser.min.js`),
  ]);
  return _vendorPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-tcp-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.tcpSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}
