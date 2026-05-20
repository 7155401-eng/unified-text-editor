/* Bridge shim copied from text_compare_pro/web/editor/bridge_shim.js. */
(function () {
  // 2026-05-18: Compatibility for render completion code that may call
  // pdfToolbarApi.setTotal(...) / rememberBaseSize(...) while the current
  // toolbar object exposes refresh(...) / applyZoom(...).
  function installToolbarCompatMethod(name, fn) {
    if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) return;
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: fn,
    });
  }

  installToolbarCompatMethod("setTotal", function setTotalCompat(total) {
    if (this && typeof this.refresh === "function") return this.refresh(total);
    return undefined;
  });

  installToolbarCompatMethod("rememberBaseSize", function rememberBaseSizeCompat() {
    return undefined;
  });

  installToolbarCompatMethod("applyZoom", function applyZoomCompat() {
    return undefined;
  });

  let attempts = 0;
  const maxAttempts = 200;

  function wrap(slot) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      return new Promise((resolve) => {
        slot.apply(null, args.concat([(result) => resolve(result)]));
      });
    };
  }

  function makeApi(bridge) {
    return {
      set_modified: wrap(bridge.editor_set_modified),
      poll_sync: wrap(bridge.editor_poll_sync),
      import_word: wrap(bridge.editor_import_word),
      import_path: wrap(bridge.editor_import_path),
      extract_word: wrap(bridge.editor_extract_word),
      export_word: wrap(bridge.editor_export_word),
      get_initial_file: wrap(bridge.editor_get_initial_file),
      force_close: function () { bridge.editor_force_close(); },
    };
  }

  function init() {
    attempts++;
    if (typeof QWebChannel === "undefined" || !window.qt || !qt.webChannelTransport) {
      if (attempts > maxAttempts) {
        console.warn("[bridge_shim] QWebChannel unavailable; continuing without pywebview bridge.");
        return;
      }
      setTimeout(init, 50);
      return;
    }
    new QWebChannel(qt.webChannelTransport, (channel) => {
      const bridge = channel.objects.pybridge;
      window.pywebview = window.pywebview || {};
      window.pywebview.api = makeApi(bridge);
      window._bridge = bridge;
      window.dispatchEvent(new Event("pywebviewready"));
    });
  }

  function loadScript(src, marker) {
    if (document.querySelector(`script[data-${marker}="1"]`)) return;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.dataset[marker] = "1";
    document.head.appendChild(script);
  }

  function loadRenderSafetyAddons() {
    loadScript("/render-safety-addons.js?v=20260519-render-tab", "renderSafetyAddons");
    loadScript("/render-ribbon-tab-fix.js?v=20260519b", "renderRibbonTabFix");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
    document.addEventListener("DOMContentLoaded", loadRenderSafetyAddons, { once: true });
  } else {
    init();
    loadRenderSafetyAddons();
  }
})();
