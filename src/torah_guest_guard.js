import { FREE_LIMIT_TORAH_OR } from "./torah_free_limit.js";

function authState() {
  return window.__RAVTEXT_AUTH__ || {};
}

function isLoggedIn() {
  return !!authState().loggedIn;
}

function isPaidUser() {
  return !!authState().paid;
}

function isInsideTorahToolbar(target) {
  return !!target?.closest?.('.torah-toolbar');
}

function textOf(el) {
  return String([
    el?.id,
    el?.dataset?.cmd,
    el?.dataset?.tool,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('title'),
    el?.textContent,
  ].filter(Boolean).join(' '));
}

function isTorahOrHashalemAction(target) {
  const el = target?.closest?.('button,select,input,label,[role="button"]') || target;
  const t = textOf(el).toLowerCase();
  return (
    t.indexOf('\u05ea\u05d5\u05e8\u05d4 \u05d0\u05d5\u05e8') !== -1 ||
    t.indexOf('\u05d0\u05d5\u05e8 \u05d4\u05e9\u05dc\u05dd') !== -1 ||
    t.indexOf('\u05d4\u05e9\u05dc\u05de\u05ea \u05db\u05dc \u05d4\u05de\u05e7\u05d5\u05e8') !== -1 ||
    t.indexOf('torah or') !== -1 ||
    t.indexOf('hashalem') !== -1
  );
}

function selectedTextFromBrowser() {
  return String(window.getSelection?.().toString() || '').trim();
}

function selectedTextFromEditor() {
  try {
    const pm = window.paneManager;
    const ed = pm?.getActiveEditor?.();
    if (!ed) return '';
    const sel = ed.state?.selection;
    if (!sel || sel.empty) {
      return ed.state?.doc?.textBetween?.(0, ed.state.doc.content.size, '\n', '\n').trim() || '';
    }
    return ed.state.doc.textBetween(sel.from, sel.to, '\n', '\n').trim();
  } catch {
    return '';
  }
}

function currentSelectedText() {
  return selectedTextFromBrowser() || selectedTextFromEditor();
}

// \u05de\u05e9\u05d4 2026-05-14: \u05d3\u05d9\u05d0\u05dc\u05d5\u05d2\u05d9\u05dd \u05de\u05d5\u05ea\u05d0\u05de\u05d9\u05dd \u05dc\u05e2\u05d9\u05e6\u05d5\u05d1 \u05d4\u05d0\u05ea\u05e8. \u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05d1-.modal-overlay /
// .modal / .modal-desc / .modal-btns \u05d4\u05e7\u05d9\u05d9\u05de\u05d9\u05dd \u05d1-styles.css + theme-base-refresh.css.
function buildThemedModal({ title, description, primaryLabel, primaryAction, secondaryLabel = "\u05d1\u05d9\u05d8\u05d5\u05dc" }) {
  // \u05d4\u05e1\u05e8\u05ea \u05de\u05d5\u05d3\u05d0\u05dc \u05e7\u05d5\u05d3\u05dd \u05d0\u05dd \u05e4\u05ea\u05d5\u05d7
  document.getElementById("torah-guest-themed-modal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "torah-guest-themed-modal";
  overlay.className = "modal-overlay active";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.dir = "rtl";

  const h = document.createElement("h2");
  h.textContent = title;
  modal.appendChild(h);

  const desc = document.createElement("div");
  desc.className = "modal-desc";
  desc.style.whiteSpace = "pre-line";
  desc.textContent = description;
  modal.appendChild(desc);

  const btns = document.createElement("div");
  btns.className = "modal-btns";

  const close = () => overlay.remove();

  const primary = document.createElement("button");
  primary.type = "button";
  // משה 2026-05-14: תומך גם HTML (לאייקון Google) — נסתפק ב-SVG בטוח שאנחנו מבקרים.
  if (primaryLabel && primaryLabel.includes("<svg")) {
    primary.innerHTML = primaryLabel;
  } else {
    primary.textContent = primaryLabel;
  }
  primary.style.display = "inline-flex";
  primary.style.alignItems = "center";
  primary.style.justifyContent = "center";
  primary.addEventListener("click", () => {
    close();
    if (typeof primaryAction === "function") primaryAction();
  });

  const secondary = document.createElement("button");
  secondary.type = "button";
  secondary.textContent = secondaryLabel;
  secondary.addEventListener("click", close);

  btns.appendChild(primary);
  btns.appendChild(secondary);
  modal.appendChild(btns);
  overlay.appendChild(modal);

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  document.addEventListener("keydown", function onEsc(ev) {
    if (ev.key === "Escape") {
      close();
      document.removeEventListener("keydown", onEsc);
    }
  });

  document.body.appendChild(overlay);
  primary.focus();
}

// \u05de\u05e9\u05d4 2026-05-14: \u05d0\u05d9\u05d9\u05e7\u05d5\u05df \u05dc\u05d5\u05d2\u05d5 Google \u05d1-4 \u05e6\u05d1\u05e2\u05d9\u05dd \u2014 \u05d0\u05d5\u05ea\u05d5 SVG \u05e9\u05de\u05d5\u05e4\u05d9\u05e2 \u05d1\u05d0\u05d5\u05d5\u05d8\u05d0\u05e8.
const GOOGLE_G_SVG = `<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" focusable="false" style="vertical-align:-3px;margin-inline-end:6px;">
  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
  <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
</svg>`;

function showLoginDialog() {
  buildThemedModal({
    title: "\u05e0\u05d3\u05e8\u05e9\u05ea \u05d4\u05ea\u05d7\u05d1\u05e8\u05d5\u05ea",
    description: "\u05db\u05d3\u05d9 \u05dc\u05d4\u05e9\u05ea\u05de\u05e9 \u05d1\u05db\u05dc\u05d9\u05dd \u05e9\u05d1\u05d8\u05d0\u05d1 \u05d4\u05ea\u05d5\u05e8\u05e0\u05d9 \u05d9\u05e9 \u05dc\u05d4\u05ea\u05d7\u05d1\u05e8 \u05dc\u05d7\u05e9\u05d1\u05d5\u05df.",
    primaryLabel: GOOGLE_G_SVG + "\u05d4\u05ea\u05d7\u05d1\u05e8 \u05e2\u05dd Google",
    primaryAction: () => { window.location.href = "/api/auth/login"; },
  });
}

function showFreeLimitDialog(length) {
  buildThemedModal({
    title: '\u05de\u05d2\u05d1\u05dc\u05ea "\u05ea\u05d5\u05e8\u05d4 \u05d0\u05d5\u05e8 \u05d4\u05e9\u05dc\u05dd"',
    description:
      '\u05dc\u05ea\u05d5\u05db\u05e0\u05d9\u05ea \u05d7\u05d9\u05e0\u05de\u05d9\u05ea \u05d0\u05e4\u05e9\u05e8 \u05dc\u05d4\u05e9\u05ea\u05de\u05e9 \u05d1"\u05ea\u05d5\u05e8\u05d4 \u05d0\u05d5\u05e8 \u05d4\u05e9\u05dc\u05dd" \u05e2\u05d3 500 \u05ea\u05d5\u05d5\u05d9\u05dd \u05d1\u05db\u05dc \u05e4\u05e2\u05dd.' +
      '\n\n\u05e1\u05d5\u05de\u05e0\u05d5 \u05db\u05e2\u05ea ' + length + ' \u05ea\u05d5\u05d5\u05d9\u05dd.' +
      '\n\n\u05d1\u05d7\u05e8 \u05e7\u05d8\u05e2 \u05e7\u05e6\u05e8 \u05d9\u05d5\u05ea\u05e8 \u05d0\u05d5 \u05e2\u05d1\u05d5\u05e8 \u05dc\u05de\u05e0\u05d5\u05d9 \u05de\u05dc\u05d0.',
    primaryLabel: "\u05e2\u05d1\u05d5\u05e8 \u05dc\u05de\u05e0\u05d5\u05d9",
    primaryAction: () => { window.location.href = "/api/auth/login"; },
    secondaryLabel: "\u05e1\u05d2\u05d5\u05e8",
  });
}

function blockEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function guardTorahEvent(event) {
  const target = event.target;
  if (!isInsideTorahToolbar(target)) return;

  if (!isLoggedIn()) {
    blockEvent(event);
    showLoginDialog();
    return;
  }

  if (!isPaidUser() && isTorahOrHashalemAction(target)) {
    const text = currentSelectedText();
    if (text.length > FREE_LIMIT_TORAH_OR) {
      blockEvent(event);
      showFreeLimitDialog(text.length);
    }
  }
}

export function installTorahGuestGuard() {
  if (window.__RAVTEXT_TORAH_GUEST_GUARD_INSTALLED__) return;
  window.__RAVTEXT_TORAH_GUEST_GUARD_INSTALLED__ = true;

  for (const type of ['click', 'change', 'input', 'keydown', 'pointerdown']) {
    document.addEventListener(type, guardTorahEvent, true);
  }

  console.info('[torah-guard] installed');
}
