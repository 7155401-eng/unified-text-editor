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

function installLanguageSwitcherBuildPatch() {
  const file = 'index.html';
  const html = fs.readFileSync(file, 'utf8');

  const iconSvg =
    '<svg class="ravtext-lang-globe" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"></circle>' +
    '<path d="M2 12h20"></path>' +
    '<path d="M12 2a15 15 0 0 1 0 20"></path>' +
    '<path d="M12 2a15 15 0 0 0 0 20"></path>' +
    '</svg>';

  const renderMarkup = (label = 'EN') =>
    `${iconSvg}<span class="ravtext-lang-label">${label}</span>`;

  let next = html;

  const langButtonRe = /(<button\b(?=[^>]*\bid=["']langBtn["'])(?=[^>]*\bdata-cmd=["']lang-toggle["'])[^>]*>)([\s\S]*?)(<\/button>)/;
  const match = next.match(langButtonRe);
  if (!match) {
    throw new Error('index.html language button #langBtn was not found for build patch');
  }

  if (!match[2].includes('ravtext-lang-globe')) {
    const label = (match[2] || '').replace(/<[^>]*>/g, '').trim() || 'EN';
    next = next.replace(langButtonRe, `$1${renderMarkup(label)}$3`);
  }

  const styleMarker = 'ravtext-language-switcher-build-style';
  if (!next.includes(styleMarker)) {
    const style = `
<style id="${styleMarker}">
#langBtn.language-switcher-build,
#langBtn:has(.ravtext-lang-globe) {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px !important;
  white-space: nowrap !important;
}
#langBtn .ravtext-lang-globe {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  pointer-events: none;
}
#langBtn .ravtext-lang-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
  pointer-events: none;
}
</style>`;
    next = next.replace('</head>', `${style}\n</head>`);
  }

  const scriptMarker = 'ravtext-language-switcher-build-patch';
  if (!next.includes(scriptMarker)) {
    const inlineScript = `
<script id="${scriptMarker}">
(() => {
  const iconSvg = ${JSON.stringify(iconSvg)};
  const labelHtml = (label) => iconSvg + '<span class="ravtext-lang-label">' + label + '</span>';

  function currentLabel(btn) {
    const fromSpan = btn.querySelector('.ravtext-lang-label')?.textContent?.trim();
    const fromText = (btn.textContent || '').replace(/[^A-Z]/g, '').trim();
    const label = fromSpan || fromText || 'EN';
    return label === 'HE' ? 'HE' : 'EN';
  }

  function render() {
    const btn = document.getElementById('langBtn');
    if (!btn) return false;

    const label = currentLabel(btn);
    const hasIcon = !!btn.querySelector('.ravtext-lang-globe');
    const hasLabel = !!btn.querySelector('.ravtext-lang-label');

    btn.classList.add('language-switcher-build');
    if (!hasIcon || !hasLabel) {
      btn.innerHTML = labelHtml(label);
      return true;
    }

    const labelNode = btn.querySelector('.ravtext-lang-label');
    if (labelNode.textContent !== label) labelNode.textContent = label;
    return true;
  }

  function start() {
    if (!render()) {
      let left = 100;
      const timer = setInterval(() => {
        if (render() || --left <= 0) clearInterval(timer);
      }, 100);
      return;
    }

    const btn = document.getElementById('langBtn');
    if (!btn || !window.MutationObserver) return;

    let locked = false;
    new MutationObserver(() => {
      if (locked) return;
      locked = true;
      setTimeout(() => {
        render();
        locked = false;
      }, 0);
    }).observe(btn, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
</script>`;
    next = next.replace('</body>', `${inlineScript}\n</body>`);
  }

  if (next !== html) {
    fs.writeFileSync(file, next, 'utf8');
    console.log('[build-fix] installed language switcher inline SVG build patch in index.html');
  }
}

repairDemoLiteralNewline();
installLanguageSwitcherBuildPatch();
