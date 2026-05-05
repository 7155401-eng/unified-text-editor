/* Bridge shim copied from text_compare_pro/web/editor/bridge_shim.js. */
(function () {
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
