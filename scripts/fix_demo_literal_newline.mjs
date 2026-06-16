import fs from 'node:fs';

function repairDemoLiteralNewline() {
  const file = 'src/demo_mode.js';
  // In the broken source there are two literal characters: backslash + n,
  // directly between the closing brace and the export statement.
  const broken = '}\\nexport function installConsoleGuard() {';
  const fixed = '}\nexport function installConsoleGuard() {';

  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(broken)) {
    text = text.split(broken).join(fixed);
    fs.writeFileSync(file, text, 'utf8');
    console.log('[build-fix] repaired literal backslash-n before installConsoleGuard in src/demo_mode.js');
  }

  const after = fs.readFileSync(file, 'utf8');
  if (after.includes(broken)) {
    throw new Error('src/demo_mode.js still contains literal backslash-n before installConsoleGuard');
  }
}

function installFloatingLanguageSwitcherBuildPatch() {
  const file = 'index.html';
  const html = fs.readFileSync(file, 'utf8');
  let next = html;

  // Remove the previous inline patch that tried to alter the toolbar language button.
  next = next.replace(/\n?<style id="ravtext-language-switcher-build-style">[\s\S]*?<\/style>/g, '');
  next = next.replace(/\n?<script id="ravtext-language-switcher-build-patch">[\s\S]*?<\/script>/g, '');

  const styleMarker = 'ravtext-floating-language-switcher-style';
  if (!next.includes(styleMarker)) {
    const style = `
<style id="${styleMarker}">
#ravtextFloatingLangBtn {
  position: fixed;
  left: max(16px, env(safe-area-inset-left));
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 76px;
  height: 46px;
  padding: 0 15px;
  border: 1px solid rgba(15, 20, 25, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  color: #1e40af;
  box-shadow: 0 10px 28px rgba(15, 20, 25, 0.22), 0 1px 0 rgba(255, 255, 255, 0.7) inset;
  cursor: pointer;
  font: 700 13px/1 var(--ravtext-ui-font-family, "Heebo", "Segoe UI", Arial, sans-serif);
  letter-spacing: .04em;
  -webkit-tap-highlight-color: transparent;
  backdrop-filter: blur(10px);
}
#ravtextFloatingLangBtn:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 34px rgba(15, 20, 25, 0.26), 0 1px 0 rgba(255, 255, 255, 0.8) inset;
}
#ravtextFloatingLangBtn:active {
  transform: translateY(0);
}
#ravtextFloatingLangBtn:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.32);
  outline-offset: 3px;
}
#ravtextFloatingLangBtn .ravtext-floating-lang-globe {
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  pointer-events: none;
}
#ravtextFloatingLangBtn .ravtext-floating-lang-label {
  pointer-events: none;
}
@media (max-width: 640px) {
  #ravtextFloatingLangBtn {
    left: max(10px, env(safe-area-inset-left));
    bottom: max(12px, env(safe-area-inset-bottom));
    height: 42px;
    min-width: 68px;
    padding: 0 12px;
  }
}
</style>`;
    next = next.replace('</head>', `${style}\n</head>`);
  }

  const scriptMarker = 'ravtext-floating-language-switcher-script';
  if (!next.includes(scriptMarker)) {
    const iconSvg =
      '<svg class="ravtext-floating-lang-globe" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"></circle>' +
      '<path d="M2 12h20"></path>' +
      '<path d="M12 2a15 15 0 0 1 0 20"></path>' +
      '<path d="M12 2a15 15 0 0 0 0 20"></path>' +
      '</svg>';

    const inlineScript = `
<script id="${scriptMarker}">
(() => {
  const buttonId = 'ravtextFloatingLangBtn';
  const iconSvg = ${JSON.stringify(iconSvg)};

  function normalizedLang(value) {
    const lang = String(value || '').toLowerCase();
    return lang.startsWith('en') ? 'en' : 'he';
  }

  function currentLang() {
    try {
      const stored = localStorage.getItem('ravtext.lang');
      if (stored === 'en' || stored === 'he') return stored;
    } catch (_) {}
    return normalizedLang(document.documentElement.lang);
  }

  function nextLangLabel() {
    return currentLang() === 'he' ? 'EN' : 'HE';
  }

  function renderFloatingButton() {
    let btn = document.getElementById(buttonId);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = buttonId;
      btn.type = 'button';
      btn.innerHTML = iconSvg + '<span class="ravtext-floating-lang-label"></span>';
      document.body.appendChild(btn);
      btn.addEventListener('click', () => {
        const toolbarBtn = document.getElementById('langBtn');
        if (toolbarBtn && typeof toolbarBtn.click === 'function') {
          toolbarBtn.click();
          setTimeout(renderFloatingButton, 0);
          setTimeout(renderFloatingButton, 160);
          setTimeout(renderFloatingButton, 600);
          return;
        }

        const next = currentLang() === 'he' ? 'en' : 'he';
        try {
          localStorage.setItem('ravtext.lang', next);
        } catch (_) {}
        document.documentElement.lang = next;
        document.documentElement.dir = next === 'he' ? 'rtl' : 'ltr';
        setTimeout(() => location.reload(), 0);
      });
    }

    const label = nextLangLabel();
    const labelNode = btn.querySelector('.ravtext-floating-lang-label');
    if (labelNode && labelNode.textContent !== label) labelNode.textContent = label;
    btn.title = label === 'EN' ? 'English' : 'עברית';
    btn.setAttribute('aria-label', label === 'EN' ? 'Switch language to English' : 'החלף שפה לעברית');
    btn.dataset.nextLang = label === 'EN' ? 'en' : 'he';
    return btn;
  }

  function startFloatingLanguageSwitcher() {
    renderFloatingButton();

    if (window.MutationObserver) {
      const observer = new MutationObserver(() => setTimeout(renderFloatingButton, 0));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir', 'class'] });

      const toolbarBtn = document.getElementById('langBtn');
      if (toolbarBtn) {
        observer.observe(toolbarBtn, { childList: true, characterData: true, subtree: true });
      }
    }

    window.addEventListener('storage', (event) => {
      if (event.key === 'ravtext.lang') renderFloatingButton();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFloatingLanguageSwitcher, { once: true });
  } else {
    startFloatingLanguageSwitcher();
  }
})();
</script>`;
    next = next.replace('</body>', `${inlineScript}\n</body>`);
  }

  if (next !== html) {
    fs.writeFileSync(file, next, 'utf8');
    console.log('[build-fix] installed floating language switcher in index.html');
  }
}

repairDemoLiteralNewline();
installFloatingLanguageSwitcherBuildPatch();
