(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setActive(tabName) {
    const tabsBar = byId('ribbon-tabs');
    const mainToolbar = document.querySelector('.ribbon-toolbar') || document.querySelector('.source-format-toolbar') || document.querySelector('.toolbar');
    if (!tabsBar || !mainToolbar) return;
    localStorage.setItem('ravtext.ribbonTab', tabName);
    all('.ribbon-tab', tabsBar).forEach((b) => {
      const active = b.dataset.ribbonTab === tabName;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    mainToolbar.querySelectorAll('.tb-group').forEach((group) => {
      const tabs = (group.dataset.ribbonTab || 'home').split(/\s+/).filter(Boolean);
      group.classList.toggle('ribbon-hidden', !tabs.includes(tabName));
    });
    document.querySelectorAll('.ribbon-panel').forEach((panel) => {
      const tabs = (panel.dataset.ribbonTab || 'home').split(/\s+/).filter(Boolean);
      panel.classList.toggle('ribbon-hidden', !tabs.includes(tabName));
    });
  }

  function removeOldPopupMenu() {
    byId('render-options-menu-wrap')?.remove();
  }

  function ensureRenderTab() {
    const tabsBar = byId('ribbon-tabs');
    const renderBtn = byId('btn-render');
    if (!tabsBar || !renderBtn) return;
    removeOldPopupMenu();

    let tab = byId('btn-render-options-tab');
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      tab.id = 'btn-render-options-tab';
      tab.className = 'ribbon-tab';
      tab.dataset.ribbonTab = 'render';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.title = 'אפשרויות רינדור';
      tab.textContent = '▾';
      const collapse = byId('ribbon-collapse-toggle');
      const slot = tabsBar.querySelector('.ribbon-tab-render-slot');
      if (collapse) tabsBar.insertBefore(tab, collapse);
      else if (slot) tabsBar.insertBefore(tab, slot);
      else tabsBar.appendChild(tab);
      tab.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setActive('render');
      });
    }

    let panel = byId('render-safety-toolbar');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'render-safety-toolbar';
      panel.className = 'toolbar bottom-toolbar source-bottom-toolbar ribbon-panel render-safety-toolbar ribbon-hidden';
      panel.dir = 'rtl';
      panel.dataset.ribbonTab = 'render';
      panel.innerHTML = '<span class="tb-group" data-title="רינדור" id="render-safety-render-group"></span><span class="tb-group" data-title="אבחון ושחזור" id="render-safety-diagnostics-group"></span>';
      const mainToolbar = document.querySelector('.ribbon-toolbar') || document.querySelector('.source-format-toolbar') || document.querySelector('.toolbar');
      if (mainToolbar) mainToolbar.after(panel);
      else renderBtn.parentElement?.after(panel);
    }

    const renderGroup = byId('render-safety-render-group');
    const diagnosticsGroup = byId('render-safety-diagnostics-group');
    const pause = byId('btn-render-pause');
    const stop = byId('btn-render-stop-menu');
    const diag = byId('btn-render-diagnostics');
    const snaps = byId('btn-ravtext-snapshots');
    const reset = byId('btn-reset-display-only');
    if (renderGroup && pause) renderGroup.appendChild(pause);
    if (renderGroup && stop) renderGroup.appendChild(stop);
    if (diagnosticsGroup && diag) diagnosticsGroup.appendChild(diag);
    if (diagnosticsGroup && snaps) diagnosticsGroup.appendChild(snaps);
    if (diagnosticsGroup && reset) diagnosticsGroup.appendChild(reset);
    if (localStorage.getItem('ravtext.ribbonTab') === 'render') setActive('render');
  }

  function installStyle() {
    if (byId('render-ribbon-tab-style')) return;
    const s = document.createElement('style');
    s.id = 'render-ribbon-tab-style';
    s.textContent = '#btn-render-options-tab{font-weight:700}.render-safety-toolbar .tb-group button{white-space:nowrap}.render-safety-toolbar{direction:rtl}';
    document.head.appendChild(s);
  }

  function boot() {
    installStyle();
    ensureRenderTab();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else setTimeout(boot, 0);
  new MutationObserver(boot).observe(document.documentElement, { childList: true, subtree: true });
})();
