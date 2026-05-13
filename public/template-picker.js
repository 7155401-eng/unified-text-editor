/* ============================================================================
   RavText — Template Picker (vanilla JS, self-contained)
   ----------------------------------------------------------------------------
   A unified picker for all built-in styles. Replaces the legacy ☀/🌙 toggle.

   Options:
     "" / light      → body.light-theme           (default, blue accent)
     "dark"          → body (no light-theme)      (legacy dark mode)
     "word-style"    → body.light-theme.template-word-style (coral accent)
     "judaica"       → body.template-judaica      (parchment on ink)

   Persisted under localStorage key "ravtext-template". Also writes
   "ravtext.theme" ("light"|"dark") for backward compatibility with the
   legacy toggle button which we still hide via CSS.
   ============================================================================ */
(function () {
  'use strict';

  var KEY = 'ravtext-template';
  var LEGACY_KEY = 'ravtext.theme';

  var TEMPLATES = [
    {
      id: '',
      name: 'בהיר',
      desc: 'ברירת המחדל — גוון כחול קלאסי',
      previewClass: 'rt-tp-prev-light'
    },
    {
      id: 'dark',
      name: 'כהה',
      desc: 'מצב לילה — רקע כהה ואותיות בהירות',
      previewClass: 'rt-tp-prev-dark'
    },
    {
      id: 'word-style',
      name: 'סגנון וורד',
      desc: 'אותו מבנה, גוון קוראל→שזיף חם',
      previewClass: 'rt-tp-prev-word'
    },
    {
      id: 'judaica',
      name: 'סגנון יודאיקה',
      desc: 'קלף חם על דיו כהה, זהב עתיק',
      previewClass: 'rt-tp-prev-judaica'
    }
  ];

  function getCurrent() {
    try {
      var t = localStorage.getItem(KEY);
      if (t !== null) return t;
      /* backward compat: if legacy stored "dark", show dark as current */
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy === 'dark') return 'dark';
      return '';
    } catch (e) { return ''; }
  }

  function setCurrent(id) {
    try {
      localStorage.setItem(KEY, id || '');
      /* sync legacy key so the rest of the app (and the hidden toggle button)
         remains consistent */
      var isDark = (id === 'dark');
      localStorage.setItem(LEGACY_KEY, isDark ? 'dark' : 'light');
    } catch (e) {}
    apply(id);
  }

  function apply(id) {
    var body = document.body;
    body.classList.remove('template-word-style', 'template-judaica');
    if (id === 'dark') {
      body.classList.remove('light-theme');
    } else {
      body.classList.add('light-theme');
      if (id === 'word-style') body.classList.add('template-word-style');
      else if (id === 'judaica') body.classList.add('template-judaica');
    }
  }

  function buildPopover() {
    var pop = document.createElement('div');
    pop.className = 'rt-tp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('dir', 'rtl');
    pop.innerHTML =
      '<div class="rt-tp-pop-head">' +
        '<h4>בחר תבנית עיצוב</h4>' +
        '<small>השינוי נשמר אוטומטית במכשיר זה</small>' +
      '</div>' +
      '<div class="rt-tp-grid"></div>';
    var grid = pop.querySelector('.rt-tp-grid');
    var cur = getCurrent();
    TEMPLATES.forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'rt-tp-card' + (t.id === cur ? ' cur' : '');
      card.dataset.tpl = t.id;
      card.innerHTML =
        '<div class="rt-tp-preview ' + t.previewClass + '">' +
          '<div class="rt-tp-page"></div>' +
          '<span class="rt-tp-current">פעיל</span>' +
        '</div>' +
        '<div class="rt-tp-meta">' +
          '<div class="rt-tp-name">' + t.name + '</div>' +
          '<div class="rt-tp-desc">' + t.desc + '</div>' +
        '</div>';
      card.addEventListener('click', function () {
        setCurrent(t.id);
        Array.prototype.forEach.call(grid.querySelectorAll('.rt-tp-card'), function (c) {
          c.classList.toggle('cur', c.dataset.tpl === t.id);
        });
        updateButtonSwatch();
        setTimeout(closePopover, 160);
      });
      grid.appendChild(card);
    });
    document.body.appendChild(pop);
    return pop;
  }

  var popover = null;
  var triggerBtn = null;

  function openPopover() {
    if (!popover) popover = buildPopover();
    var rect = triggerBtn.getBoundingClientRect();
    popover.classList.add('open');
    var popWidth = popover.offsetWidth || 620;
    var top = rect.bottom + 8;
    var right = Math.max(8, window.innerWidth - rect.right);
    if (right + popWidth > window.innerWidth - 8) {
      right = Math.max(8, window.innerWidth - popWidth - 8);
    }
    popover.style.top = top + 'px';
    popover.style.right = right + 'px';
    popover.style.left = 'auto';
    setTimeout(function () {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey);
    }, 0);
  }
  function closePopover() {
    if (popover) popover.classList.remove('open');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey);
  }
  function onDocClick(e) {
    if (!popover) return;
    if (popover.contains(e.target)) return;
    if (triggerBtn && triggerBtn.contains(e.target)) return;
    closePopover();
  }
  function onKey(e) { if (e.key === 'Escape') closePopover(); }

  function updateButtonSwatch() {
    if (!triggerBtn) return;
    var cur = getCurrent();
    triggerBtn.setAttribute('data-tpl', cur || 'light');
  }

  function injectButton() {
    var actions = document.querySelector('.app-header-actions');
    if (!actions) return false;
    if (actions.querySelector('.rt-tp-btn')) return true;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rt-tp-btn header-action-btn';
    btn.title = 'בחר תבנית עיצוב — בהיר / כהה / סגנון וורד / סגנון יודאיקה';
    btn.innerHTML =
      '<span class="rt-tp-swatch" aria-hidden="true"></span>' +
      '<span>סגנון</span>' +
      '<span class="rt-tp-caret" aria-hidden="true">▾</span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (popover && popover.classList.contains('open')) closePopover();
      else openPopover();
    });
    /* prepend so it appears first in the RTL row (closest to the title) */
    actions.insertBefore(btn, actions.firstChild);
    triggerBtn = btn;
    updateButtonSwatch();
    return true;
  }

  /* Hide the legacy ☀/🌙 toggle button — the picker has replaced it. */
  function hideLegacyThemeToggle() {
    var legacy = document.querySelector('[data-cmd="theme-toggle"]');
    if (legacy) legacy.style.display = 'none';
  }

  function init() {
    apply(getCurrent());
    var injected = injectButton();
    hideLegacyThemeToggle();
    if (!injected) {
      var tries = 0;
      var iv = setInterval(function () {
        tries += 1;
        if (injectButton() || tries > 40) clearInterval(iv);
        hideLegacyThemeToggle();
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
