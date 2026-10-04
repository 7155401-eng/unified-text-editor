// Lightweight usage tracking kept out of the full inbox/modal implementation.
// This module is safe to load during startup; the heavy forms stay lazy.

function isLoggedIn() {
  const auth = (typeof window !== "undefined" && window.__RAVTEXT_AUTH__) || null;
  return !!(auth && auth.loggedIn);
}

let trackInflight = false;
const trackQueue = [];

async function flushTrackQueue() {
  if (trackInflight || trackQueue.length === 0) return;
  trackInflight = true;
  const next = trackQueue.shift();
  try {
    await fetch("/api/usage/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
      keepalive: true,
    });
  } catch (_) {
    // Usage telemetry is best-effort and must never block the editor.
  } finally {
    trackInflight = false;
    if (trackQueue.length > 0) flushTrackQueue();
  }
}

export function trackUsage(event, detail = null) {
  if (!isLoggedIn()) return;
  if (!event || typeof event !== "string") return;
  trackQueue.push({ event, detail });
  flushTrackQueue();
}
