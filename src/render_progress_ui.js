// render_progress_ui.js — פס התקדמות יוקרתי ועדין לרינדור V9.
// המודול לא נוגע בלוגיקת העימוד: הוא עוקב אחרי יצירת .page ב-container
// ומציג למשתמש התקדמות, אחוזים וכמות עמודים. בסיום הוא נסגר לבד.

let host = null;
let styleEl = null;
let activeSession = null;
let sessionSeq = 0;

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined" && document.body;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function injectStyles() {
  if (!canUseDom()) return;
  if (styleEl && document.head.contains(styleEl)) return;
  styleEl = document.createElement("style");
  styleEl.id = "ravtext-render-progress-ui-styles";
  styleEl.textContent = `
    #ravtext-render-progress-ui {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%) translateY(-10px) scale(0.985);
      z-index: 2147483000;
      direction: rtl;
      pointer-events: none;
      opacity: 0;
      transition: opacity 180ms ease, transform 220ms cubic-bezier(.2,.9,.2,1);
      font-family: var(--ravtext-ui-font, inherit);
      color: #20304a;
    }

    #ravtext-render-progress-ui.rt-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }

    #ravtext-render-progress-ui.rt-done {
      transform: translateX(-50%) translateY(-4px) scale(.995);
    }

    #ravtext-render-progress-ui .rtp-card {
      width: min(420px, calc(100vw - 34px));
      border-radius: 22px;
      padding: 13px 15px 12px;
      overflow: hidden;
      position: relative;
      background:
        radial-gradient(circle at 88% 0%, rgba(224, 191, 112, .22), transparent 34%),
        radial-gradient(circle at 10% 95%, rgba(71, 126, 213, .16), transparent 38%),
        linear-gradient(135deg, rgba(255,255,255,.93), rgba(250,247,239,.84));
      border: 1px solid rgba(134, 105, 48, .16);
      box-shadow:
        0 18px 48px rgba(27, 38, 61, .14),
        0 5px 16px rgba(27, 38, 61, .08),
        inset 0 1px 0 rgba(255,255,255,.8);
      backdrop-filter: blur(18px) saturate(1.18);
      -webkit-backdrop-filter: blur(18px) saturate(1.18);
    }

    #ravtext-render-progress-ui .rtp-card::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(110deg, transparent 0%, rgba(255,255,255,.40) 32%, transparent 48%);
      transform: translateX(80%);
      animation: rtp-card-sheen 3.8s ease-in-out infinite;
      opacity: .65;
    }

    #ravtext-render-progress-ui .rtp-card::after {
      content: "";
      position: absolute;
      inset: 1px;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,.36);
      pointer-events: none;
    }

    #ravtext-render-progress-ui .rtp-inner {
      position: relative;
      z-index: 1;
    }

    #ravtext-render-progress-ui .rtp-top {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    #ravtext-render-progress-ui .rtp-orb {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      position: relative;
      background:
        conic-gradient(from 20deg, #b68a34, #f2d48d, #5b82d6, #b68a34);
      box-shadow:
        0 4px 12px rgba(182, 138, 52, .24),
        inset 0 0 0 1px rgba(255,255,255,.65);
    }

    #ravtext-render-progress-ui .rtp-orb::before {
      content: "";
      position: absolute;
      inset: 4px;
      border-radius: 50%;
      background: rgba(255,255,255,.92);
      box-shadow: inset 0 1px 3px rgba(35, 43, 65, .12);
    }

    #ravtext-render-progress-ui .rtp-orb::after {
      content: "";
      position: absolute;
      inset: 9px;
      border-radius: 50%;
      background: #2c5aa0;
      opacity: .86;
      animation: rtp-pulse 1.25s ease-in-out infinite;
    }

    #ravtext-render-progress-ui .rtp-title {
      font-size: 13px;
      line-height: 1.25;
      font-weight: 750;
      letter-spacing: .08px;
      color: #273a5b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #ravtext-render-progress-ui .rtp-subtitle {
      margin-top: 2px;
      font-size: 11.5px;
      line-height: 1.2;
      color: rgba(61, 77, 108, .76);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #ravtext-render-progress-ui .rtp-percent {
      min-width: 54px;
      text-align: left;
      font-size: 22px;
      line-height: 1;
      font-weight: 850;
      letter-spacing: -.3px;
      color: #2c5aa0;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 0 rgba(255,255,255,.85);
    }

    #ravtext-render-progress-ui .rtp-cancel {
      border: 1px solid rgba(153, 27, 27, .24);
      border-radius: 999px;
      background: rgba(255,255,255,.75);
      color: #991b1b;
      font-size: 12px;
      font-weight: 800;
      padding: 8px 10px;
      cursor: pointer;
      pointer-events: auto;
    }
    #ravtext-render-progress-ui .rtp-cancel:hover { background: #fee2e2; }

    #ravtext-render-progress-ui .rtp-track {
      height: 9px;
      border-radius: 999px;
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(53, 76, 119, .10), rgba(53, 76, 119, .16));
      box-shadow:
        inset 0 1px 2px rgba(21, 30, 52, .10),
        0 1px 0 rgba(255,255,255,.74);
    }

    #ravtext-render-progress-ui .rtp-fill {
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      width: 0%;
      border-radius: 999px;
      background:
        linear-gradient(90deg, #224982 0%, #4e82db 42%, #d0a64e 100%);
      box-shadow:
        0 0 18px rgba(78,130,219,.35),
        inset 0 1px 0 rgba(255,255,255,.35);
      transition: width 160ms cubic-bezier(.2,.8,.2,1);
    }

    #ravtext-render-progress-ui .rtp-fill::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent);
      transform: translateX(80%);
      animation: rtp-bar-sheen 1.45s linear infinite;
      opacity: .85;
    }

    #ravtext-render-progress-ui .rtp-meta {
      margin-top: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 11.5px;
      color: rgba(48, 62, 91, .78);
      font-variant-numeric: tabular-nums;
    }

    #ravtext-render-progress-ui .rtp-pages {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    #ravtext-render-progress-ui .rtp-chip {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(44, 90, 160, .08);
      color: #284c85;
      border: 1px solid rgba(44, 90, 160, .10);
    }

    #ravtext-render-progress-ui .rtp-status {
      opacity: .82;
      white-space: nowrap;
    }

    @keyframes rtp-card-sheen {
      0%, 55% { transform: translateX(80%); }
      100% { transform: translateX(-80%); }
    }

    @keyframes rtp-bar-sheen {
      from { transform: translateX(100%); }
      to { transform: translateX(-100%); }
    }

    @keyframes rtp-pulse {
      0%, 100% { transform: scale(.76); opacity: .72; }
      50% { transform: scale(1); opacity: 1; }
    }

    @media (max-width: 520px) {
      #ravtext-render-progress-ui { top: 10px; }
      #ravtext-render-progress-ui .rtp-card { width: calc(100vw - 20px); border-radius: 18px; }
      #ravtext-render-progress-ui .rtp-percent { font-size: 20px; min-width: 48px; }
    }
  `;
  document.head.appendChild(styleEl);
}

function ensureHost() {
  if (!canUseDom()) return null;
  injectStyles();
  if (host && document.body.contains(host)) return host;

  host = document.createElement("div");
  host.id = "ravtext-render-progress-ui";
  host.setAttribute("aria-live", "polite");
  host.innerHTML = `
    <div class="rtp-card">
      <div class="rtp-inner">
        <div class="rtp-top">
          <div class="rtp-orb" aria-hidden="true"></div>
          <div class="rtp-copy">
            <div class="rtp-title" data-rtp="title">מרנדר עמודים</div>
            <div class="rtp-subtitle" data-rtp="subtitle">מודד שורות, מפרשים וריווח דף</div>
          </div>
          <div class="rtp-percent" data-rtp="percent">0%</div>
          <button type="button" class="rtp-cancel" data-rtp-action="cancel" title="עצור רינדור">עצור</button>
        </div>
        <div class="rtp-track"><div class="rtp-fill" data-rtp="fill"></div></div>
        <div class="rtp-meta">
          <span class="rtp-pages">
            <span class="rtp-chip" data-rtp="page">עמוד 0</span>
            <span data-rtp="count">0 עמודים נבנו</span>
          </span>
          <span class="rtp-status" data-rtp="status">מתחיל…</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  return host;
}

function setText(selector, value) {
  if (!host) return;
  const el = host.querySelector(`[data-rtp="${selector}"]`);
  if (el) el.textContent = value;
}

function setPercent(percent) {
  if (!host) return;
  const safe = clamp(Math.round(percent), 0, 100);
  setText("percent", `${safe}%`);
  const fill = host.querySelector('[data-rtp="fill"]');
  if (fill) fill.style.width = `${safe}%`;
}

function pageCountFrom(container) {
  try {
    return container ? container.querySelectorAll(".page").length : 0;
  } catch (_) {
    return 0;
  }
}

function updateSession(session, forcedPercent = null) {
  if (!session || session.stopped) return;
  const pages = pageCountFrom(session.container);
  session.pageCount = pages;
  if (pages >= session.estimatedTotalPages) {
    session.estimatedTotalPages = pages + 1;
  }

  const elapsed = Math.max(0, performance.now() - session.startedAt);
  const softByPages = pages <= 0
    ? 3
    : (pages / Math.max(session.estimatedTotalPages, 1)) * 92;
  const softByTime = Math.min(24, elapsed / 380);
  const percent = forcedPercent == null
    ? clamp(Math.max(softByPages, softByTime), 1, 96)
    : forcedPercent;

  setPercent(percent);
  setText("page", `עמוד ${pages}`);
  setText("count", `${pages} עמודים נבנו`);
  setText("status", pages > 0 ? "עובר דף־דף…" : "מודד מסמך…");
}

function stopSession(session) {
  if (!session || session.stopped) return;
  session.stopped = true;
  try { session.observer?.disconnect?.(); } catch (_) {}
  if (session.timer) clearInterval(session.timer);
  if (session.hideTimer) clearTimeout(session.hideTimer);
}

export function startVilnaRenderProgress({
  container,
  estimatedTotalPages = 1,
  title = "מרנדר עמודים",
  subtitle = "מודד שורות, מפרשים וריווח דף",
} = {}) {
  if (!canUseDom()) {
    return { finish() {}, abort() {}, fail() {}, update() {} };
  }

  if (activeSession) {
    stopSession(activeSession);
  }

  const el = ensureHost();
  const id = ++sessionSeq;
  const session = {
    id,
    container,
    estimatedTotalPages: Math.max(1, Number(estimatedTotalPages) || 1),
    pageCount: 0,
    startedAt: performance.now(),
    stopped: false,
    observer: null,
    timer: null,
    hideTimer: null,
  };
  activeSession = session;

  el.classList.remove("rt-done");
  setText("title", title);
  setText("subtitle", subtitle);
  setPercent(1);
  setText("page", "עמוד 0");
  setText("count", "0 עמודים נבנו");
  setText("status", "מתחיל…");

  requestAnimationFrame(() => {
    if (activeSession === session && !session.stopped) el.classList.add("rt-visible");
  });

  if (container && typeof MutationObserver !== "undefined") {
    session.observer = new MutationObserver(() => updateSession(session));
    session.observer.observe(container, { childList: true, subtree: false });
  }

  session.timer = setInterval(() => updateSession(session), 260);
  updateSession(session);

  const api = {
    update(data = {}) {
      if (activeSession !== session || session.stopped) return;
      if (Number(data.estimatedTotalPages) > 0) {
        session.estimatedTotalPages = Math.max(session.estimatedTotalPages, Number(data.estimatedTotalPages));
      }
      updateSession(session, data.percent);
    },
    finish({ totalPages } = {}) {
      if (activeSession !== session || session.stopped) return;
      const pages = Number(totalPages) || pageCountFrom(container) || session.pageCount || 0;
      setPercent(100);
      setText("page", `עמוד ${pages}`);
      setText("count", `${pages} עמודים נבנו`);
      setText("status", "הושלם");
      el.classList.add("rt-done");
      stopSession(session);
      session.hideTimer = setTimeout(() => {
        if (activeSession === session && host) {
          host.classList.remove("rt-visible");
          activeSession = null;
        }
      }, 430);
    },
    abort() {
      if (activeSession !== session || session.stopped) return;
      stopSession(session);
      if (host) host.classList.remove("rt-visible");
      activeSession = null;
    },
    fail(error) {
      if (activeSession !== session || session.stopped) return;
      setText("status", "הרינדור נעצר");
      stopSession(session);
      if (host) host.classList.remove("rt-visible");
      activeSession = null;
      if (error && typeof console !== "undefined") {
        console.warn("[render-progress] render failed", error);
      }
    },
  };

  return api;
}

export function hideVilnaRenderProgressImmediately() {
  if (activeSession) stopSession(activeSession);
  activeSession = null;
  if (host) host.classList.remove("rt-visible", "rt-done");
}
