import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('FAQ first open preloads one shared module and shows loading feedback', async () => {
  const header = await source('src/premium/header_icons.js');
  assert.match(header, /let faqModulePromise = null/);
  assert.match(header, /faqModulePromise = import\("\.\.\/faq_panel\.js"\)/);
  assert.match(header, /requestIdleCallback\(run, \{ timeout: 1800 \}\)/);
  assert.match(header, /addEventListener\("pointerenter", warmFaqModule/);
  assert.match(header, /addEventListener\("focus", warmFaqModule\)/);
  assert.match(header, /classList\.toggle\("is-loading", loading\)/);
  assert.match(header, /setAttribute\("aria-busy", loading \? "true" : "false"\)/);
  assert.match(header, /loading \? "טוען שאלות נפוצות" : "פתח שאלות נפוצות"/);
  assert.match(header, /faqIcon\.title = loading \? "טוען שאלות נפוצות…" : "שאלות נפוצות"/);
  assert.match(header, /faqText\.textContent = loading \? "טוען…" : "שאלות"/);
  assert.match(header, /const mod = await loadFaqModule\(\)/);
  assert.doesNotMatch(header, /faqIcon\.addEventListener\("click", \(\) => \{\s*import\(/);
});

test('FAQ panel pre-renders during warmup and commits rows in one DOM operation', async () => {
  const faq = await source('src/faq_panel.js');
  assert.match(faq, /export function prepareFaqPanel\(\)/);
  assert.match(faq, /document\.createDocumentFragment\(\)/);
  assert.match(faq, /listEl\.replaceChildren\(fragment\)/);
  assert.match(faq, /if \(q === lastRenderedFilter && listEl\.childNodes\.length\) return/);
  assert.match(faq, /requestAnimationFrame\(\(\) => \{/);
  assert.match(faq, /prepareFaqPanel\(\);\s*panel\.classList\.add\("is-open"\)/);
});

test('FAQ icon has an animated loading indicator', async () => {
  const css = await source('src/premium/premium_styles.css');
  assert.match(css, /\.rt-prem-icon-faq\.is-loading::after/);
  assert.match(css, /@keyframes rt-faq-loading-spin/);
  assert.match(css, /animation:\s*rt-faq-loading-spin 0\.68s linear infinite/);
});
