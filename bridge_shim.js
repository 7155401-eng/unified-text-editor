(() => {
  'use strict';

  // This file is already loaded by index.html. Keep it tiny and safe:
  // it only loads the visible render-safety addon if it exists.
  function loadRenderSafetyAddons() {
    const src = '/render-safety-addons.js?v=20260518-visible-buttons';
    if (document.querySelector('script[data-render-safety-addons="1"]')) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.renderSafetyAddons = '1';
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRenderSafetyAddons, { once: true });
  } else {
    loadRenderSafetyAddons();
  }
})();
