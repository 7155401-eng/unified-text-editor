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

  function installLanguageSwitcherIconShim() {
    const styleId = "ravtext-language-switcher-icon-shim";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #langBtn.language-switcher-lite {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 4px !important;
          white-space: nowrap !important;
        }
        #langBtn .ravtext-lang-globe {
          font-size: 14px;
          line-height: 1;
          pointer-events: none;
        }
        #langBtn .ravtext-lang-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .04em;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    }

    function render() {
      const btn = document.getElementById("langBtn");
      if (!btn) return false;

      // If the module-based switcher already rendered its inline SVG, do not override it.
      if (btn.classList.contains("language-switcher") && btn.querySelector("svg")) return true;

      const currentLabel =
        (btn.querySelector(".ravtext-lang-label")?.textContent || btn.textContent || "")
          .replace("🌐", "")
          .trim() || "EN";

      if (btn.querySelector(".ravtext-lang-globe") && btn.querySelector(".ravtext-lang-label")) {
        const label = btn.querySelector(".ravtext-lang-label");
        if (label.textContent !== currentLabel) label.textContent = currentLabel;
        return true;
      }

      btn.classList.add("language-switcher-lite");
      btn.innerHTML =
        '<span class="ravtext-lang-globe" aria-hidden="true">🌐</span>' +
        '<span class="ravtext-lang-label"></span>';
      btn.querySelector(".ravtext-lang-label").textContent = currentLabel;
      return true;
    }

    let renderLock = false;
    function safeRender() {
      if (renderLock) return;
      renderLock = true;
      try {
        render();
      } finally {
        renderLock = false;
      }
    }

    if (render()) {
      const btn = document.getElementById("langBtn");
      const observer = new MutationObserver(() => setTimeout(safeRender, 0));
      observer.observe(btn, { childList: true, characterData: true, subtree: true });
      return;
    }

    let attemptsLeft = 80;
    const timer = setInterval(() => {
      if (render() || --attemptsLeft <= 0) clearInterval(timer);
    }, 100);
  }

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
      force_close: function () {
        bridge.editor_force_close();
      },
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

  function loadRenderSafetyAddons() {
    const src = "/render-safety-addons.js?v=20260519-render-menu-public";
    if (document.querySelector('script[data-render-safety-addons="1"]')) return;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.dataset.renderSafetyAddons = "1";
    document.head.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
    document.addEventListener("DOMContentLoaded", loadRenderSafetyAddons, { once: true });
    document.addEventListener("DOMContentLoaded", installLanguageSwitcherIconShim, { once: true });
  } else {
    init();
    loadRenderSafetyAddons();
    installLanguageSwitcherIconShim();
  }
})();
