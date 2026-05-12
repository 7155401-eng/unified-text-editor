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

function showLoginDialog() {
  alert('\u05db\u05d3\u05d9 \u05dc\u05d4\u05e9\u05ea\u05de\u05e9 \u05d1\u05db\u05dc\u05d9\u05dd \u05e9\u05d1\u05d8\u05d0\u05d1 \u05ea\u05d5\u05e8\u05e0\u05d9 \u05d9\u05e9 \u05dc\u05d4\u05ea\u05d7\u05d1\u05e8 \u05dc\u05d7\u05e9\u05d1\u05d5\u05df.');
}

function showFreeLimitDialog(length) {
  alert(
    '\u05dc\u05ea\u05d5\u05db\u05e0\u05d9\u05ea \u05d7\u05d9\u05e0\u05de\u05d9\u05ea \u05d0\u05e4\u05e9\u05e8 \u05dc\u05d4\u05e9\u05ea\u05de\u05e9 \u05d1"\u05ea\u05d5\u05e8\u05d4 \u05d0\u05d5\u05e8 \u05d4\u05e9\u05dc\u05dd" \u05e2\u05d3 500 \u05ea\u05d5\u05d5\u05d9\u05dd \u05d1\u05db\u05dc \u05e4\u05e2\u05dd.' +
    '\n\n\u05e1\u05d5\u05de\u05e0\u05d5 \u05db\u05e2\u05ea ' + length + ' \u05ea\u05d5\u05d5\u05d9\u05dd.' +
    '\n\n\u05d1\u05d7\u05e8 \u05e7\u05d8\u05e2 \u05e7\u05e6\u05e8 \u05d9\u05d5\u05ea\u05e8 \u05d0\u05d5 \u05e2\u05d1\u05d5\u05e8 \u05dc\u05de\u05e0\u05d5\u05d9 \u05de\u05dc\u05d0.'
  );
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
