/* ============================================================================
   RavText — Template Picker (vanilla JS, self-contained)
   ----------------------------------------------------------------------------
   Adds a "סגנון" button to the header actions and a popover with 3 cards.
   Selection toggles a class on <body> and is persisted in localStorage under
   key "ravtext-template": "" | "word-style" | "judaica".
   ============================================================================ */
(function () {
  'use strict';

  var KEY = 'ravtext-template';
  var TEMPLATES = [
    {
      id: '',
      name: 'ברירת מחדל',
      desc: 'הסגנון המקורי של רב טקסט',
      previewClass: 'rt-tp-prev-default'
    },
    {
      id: 'word-style',
      name: 'סגנון וורד',
      desc: 'קנבס קרם, גרדיאנט קוראל, פנלים צפים',
      previewClass: 'rt-tp-prev-word'
    },
    {
      id: 'judaica',
      name: 'סגנון יודאיקה',
      desc: 'קלף חם על דיו כהה, זהב עתיק, מקלדת סופרים',
      previewClass: 'rt-tp-prev-judaica'
    }
  ];

  function getCurrent() {
    try { return localStorage.getItem(KEY) || ''; }
    catch (e) { return ''; }
  }

  function setCurrent(id) {
    try { localStorage.setItem(KEY, id || ''); } catch (e) {}
    apply(id);
  }

  function apply(id) {
    var body = document.body;
    TEMPLATES.forEach(function (t) {
      if (t.id) body.classList.remove('template-' + t.id);
    });
    if (id) body.classList.add('template-' + id);
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
        setTimeout(closePopover, 180);
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
    var popWidth = popover.offsetWidth || 540;
    var top = rect.bottom + 8;
    var right = Math.max(8, window.innerWidth - rect.right);
    /* keep within viewport */
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

  function injectButton() {
    var actions = document.querySelector('.app-header-actions');
    if (!actions) return false;
    if (actions.querySelector('.rt-tp-btn')) return true;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rt-tp-btn header-action-btn';
    btn.title = 'בחר תבנית עיצוב — ברירת מחדל / סגנון וורד / סגנון יודאיקה';
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
    return true;
  }

  function init() {
    apply(getCurrent());
    if (!injectButton()) {
      /* retry once the rest of the app has mounted */
      var tries = 0;
      var iv = setInterval(function () {
        tries += 1;
        if (injectButton() || tries > 40) clearInterval(iv);
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
