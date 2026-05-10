// Comparator tool — main entry. Opens a full-screen modal that hosts either
// the standalone (full) UI or the integrated UI variant (matching the two
// Python files: comparator_tool.py + "comparator_tool ממשק משתלב.py").
//
// Vendor libraries (Quill 1.3.6 + JSZip) are loaded once on first open from
// /vendor/comparator_tool/ — verbatim copies of the originals shipped with
// the Python app under work-files/vendor/.

import './comparator.css';
import { mountComparatorUI } from './comparator_ui.js';
import { mountComparatorIntegratedUI } from './comparator_integrated.js';
import { assertToolAllowed } from '../tool_runtime_gate.js';

// Resolve vendor path against the document base URL so it works in dev
// (vite serves from root), production (relative base './'), and any
// subpath deployment (Vercel + GH Pages + Cloudflare).
function _vendorBase() {
  try {
    return new URL('vendor/comparator_tool/', document.baseURI).href;
  } catch (_) {
    return 'vendor/comparator_tool/';
  }
}

let _vendorLoaded = false;
let _vendorPromise = null;

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}

function _loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = () => resolve();
    l.onerror = () => reject(new Error('Failed to load: ' + href));
    document.head.appendChild(l);
  });
}

async function ensureVendor() {
  if (_vendorLoaded) return;
  if (_vendorPromise) return _vendorPromise;
  _vendorPromise = (async () => {
    const base = _vendorBase();
    if (!window.Quill) {
      await _loadStylesheet(base + 'quill.snow.css');
      await _loadScript(base + 'quill.min.js');
    }
    if (!window.JSZip) {
      await _loadScript(base + 'jszip.min.js');
    }
    _vendorLoaded = true;
  })();
  return _vendorPromise;
}

let _activeModal = null;

function _closeActive() {
  if (_activeModal) {
    try { _activeModal.remove(); } catch (_) {}
    _activeModal = null;
  }
}

/**
 * Open the comparator tool in a modal.
 *
 * @param {Object} options
 * @param {string} options.variant - 'full' (default) or 'integrated'
 * @param {string} [options.lang]  - 'he' / 'en' override
 */
export async function openComparator(options = {}) {
  await assertToolAllowed('comparator-tool');
  await ensureVendor();
  _closeActive();

  const variant = options.variant === 'integrated' ? 'integrated' : 'full';

  const overlay = document.createElement('div');
  overlay.className = 'comparator-host-overlay';
  overlay.id = 'comparator-host-overlay';
  overlay.innerHTML = `<div class="comparator-host-frame"><button class="comparator-host-close" type="button" title="סגור">✖ סגור</button><div class="comparator-host-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div></div>`;
  document.body.appendChild(overlay);
  _activeModal = overlay;

  const closeBtn = overlay.querySelector('.comparator-host-close');
  closeBtn.addEventListener('click', _closeActive);

  // ESC closes (in addition to the in-app wow alert ESC)
  const onKey = (e) => {
    if (e.key === 'Escape' && _activeModal === overlay) {
      // Only close if the inner wow alert is not active
      const wow = overlay.querySelector('#wowAlert.active');
      if (!wow) _closeActive();
    }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('remove-keys', () => {
    document.removeEventListener('keydown', onKey);
  });

  const body = overlay.querySelector('.comparator-host-body');

  let api;
  if (variant === 'integrated') {
    api = mountComparatorIntegratedUI(body, {
      lang: options.lang,
      onClose: _closeActive
    });
  } else {
    api = mountComparatorUI(body, {
      lang: options.lang,
      onClose: _closeActive
    });
  }

  return api;
}

/**
 * Wire a button into the editor toolbar (or wherever appropriate) that opens
 * the comparator. Adds `[data-cmd="open-comparator"]` handling and creates a
 * default visible button if none exists.
 */
export function wireComparatorButton(_paneManager) {
  // Generic data-cmd handler — picks up explicit host buttons only.
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-cmd="open-comparator"]');
    if (btn) {
      ev.preventDefault();
      const variant = btn.getAttribute('data-variant') === 'integrated' ? 'integrated' : 'full';
      openComparator({ variant }).catch((err) => console.warn('[comparator] blocked:', err));
    }
    const integratedBtn = ev.target.closest('[data-cmd="open-comparator-integrated"]');
    if (integratedBtn) {
      ev.preventDefault();
      openComparator({ variant: 'integrated' }).catch((err) => console.warn('[comparator] blocked:', err));
    }
  });
}

// Export internals for advanced use
export { mountComparatorUI, mountComparatorIntegratedUI };
