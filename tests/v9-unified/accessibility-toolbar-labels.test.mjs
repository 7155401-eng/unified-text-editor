import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function expectInputAria(id, label) {
  const re = new RegExp(`<input(?=[^>]*id=["']${id}["'])(?=[^>]*aria-label=["']${label}["'])[^>]*>`, 'u');
  assert.match(html, re, `missing aria-label for #${id}`);
}

function expectButtonAria(cmd, label) {
  const re = new RegExp(`<button(?=[^>]*data-cmd=["']${cmd}["'])(?=[^>]*aria-label=["']${label}["'])[^>]*>`, 'u');
  assert.match(html, re, `missing aria-label for data-cmd=${cmd}`);
}

test('ported PR #246 accessibility labels remain present on current toolbar', () => {
  expectInputAria('custom-stream-input', 'מספר זרם מותאם אישית');
  expectInputAria('jump-stream-input', 'מספר זרם מותאם אישית לקפיצה');
  for (let i = 1; i <= 6; i++) expectButtonAria(`h${i}`, `כותרת רמה ${i}`);
  expectButtonAria('blockquote', 'ציטוט');
  expectButtonAria('code-block', 'בלוק קוד');
  expectButtonAria('code-inline', 'קוד בשורה');
  expectButtonAria('unlink', 'הסר קישור');
});
