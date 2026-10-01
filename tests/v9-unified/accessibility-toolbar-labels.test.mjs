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

function expectButtonIdAria(id, label) {
  const re = new RegExp(`<button(?=[^>]*id=["']${id}["'])(?=[^>]*aria-label=["']${label}["'])[^>]*>`, 'u');
  assert.match(html, re, `missing aria-label for #${id}`);
}

function expectSelectAria(id, label) {
  const re = new RegExp(`<select(?=[^>]*id=["']${id}["'])(?=[^>]*aria-label=["']${label}["'])[^>]*>`, 'u');
  assert.match(html, re, `missing aria-label for #${id}`);
}

function expectStreamButtonAria(stream, label) {
  const re = new RegExp(`<button(?=[^>]*data-stream=["']${stream}["'])(?=[^>]*class=["'][^"']*btn-stream(?:\\s|["']))(?=[^>]*aria-label=["']${label}["'])[^>]*>`, 'u');
  assert.match(html, re, `missing aria-label for marker stream ${stream}`);
}

function expectStressButtonAria(multiplier, label) {
  const re = new RegExp(`<button(?=[^>]*data-mul=["']${multiplier}["'])(?=[^>]*class=["'][^"']*btn-stress(?:\\s|["']))(?=[^>]*title=["']${label}["'])(?=[^>]*aria-label=["']${label}["'])[^>]*>`, 'u');
  assert.match(html, re, `missing accessible stress label for ×${multiplier}`);
}

test('audited PR #246 accessibility labels remain present on current toolbar', () => {
  expectInputAria('custom-stream-input', 'מספר זרם מותאם אישית');
  expectInputAria('jump-stream-input', 'מספר זרם מותאם אישית לקפיצה');
  for (let i = 1; i <= 6; i++) expectButtonAria(`h${i}`, `כותרת רמה ${i}`);
  expectButtonAria('blockquote', 'ציטוט');
  expectButtonAria('code-block', 'בלוק קוד');
  expectButtonAria('code-inline', 'קוד בשורה');
  expectButtonAria('unlink', 'הסר קישור');
  expectButtonIdAria('zoom-reset', 'איפוס לזום 100%');
  expectSelectAria('styles-gallery-select', 'סגנון לטקסט נבחר');
  expectSelectAria('local-font-select', 'גופנים במחשב');
  expectSelectAria('size-selected-select', 'בחר גודל לטקסט הנבחר');
  expectButtonAria('size-24', 'הגדר את הטקסט הנבחר ל-24px');
  expectButtonAria('size-18', 'הגדר את הטקסט הנבחר ל-18px');
  expectButtonAria('size-15', 'הגדר את הטקסט הנבחר ל-15px');
  expectButtonAria('size-12', 'הגדר את הטקסט הנבחר ל-12px');
});


test('stress multiplier controls expose their action instead of only the multiplication token', () => {
  for (const multiplier of [3, 10, 30, 100]) {
    expectStressButtonAria(multiplier, `הכפל פי ${multiplier}`);
  }
});
