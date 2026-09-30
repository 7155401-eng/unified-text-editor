import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  syncAiKeyToggleA11y,
  toggleAiKeyVisibility,
} from '../../src/premium/ai_keys_settings.js';

function fakeButton() {
  const attrs = new Map();
  return {
    setAttribute(name, value) { attrs.set(String(name), String(value)); },
    getAttribute(name) { return attrs.get(String(name)) ?? null; },
  };
}

test('AI key visibility toggle exposes the current action and controlled field',()=>{
  const btn=fakeButton();
  const input={type:'password',id:''};

  syncAiKeyToggleA11y(btn,input,'openai');

  assert.equal(input.id,'settings-ai-key-openai');
  assert.equal(btn.getAttribute('aria-controls'),input.id);
  assert.equal(btn.getAttribute('aria-label'),'הצג מפתח API של OpenAI');
  assert.equal(btn.getAttribute('title'),'הצג מפתח API של OpenAI');

  toggleAiKeyVisibility(btn,input,'openai');
  assert.equal(input.type,'text');
  assert.equal(btn.getAttribute('aria-label'),'הסתר מפתח API של OpenAI');
  assert.equal(btn.getAttribute('aria-controls'),'settings-ai-key-openai');

  toggleAiKeyVisibility(btn,input,'openai');
  assert.equal(input.type,'password');
  assert.equal(btn.getAttribute('aria-label'),'הצג מפתח API של OpenAI');
});

test('setup path initializes accessibility state and refreshes it after click',()=>{
  const source=fs.readFileSync(new URL('../../src/premium/ai_keys_settings.js',import.meta.url),'utf8');
  assert.match(source,/syncAiKeyToggleA11y\(btn, input, provider\);\s*btn\.addEventListener/);
  assert.match(source,/toggleAiKeyVisibility\(btn, input, provider\)/);
  assert.doesNotMatch(source,/aria-label["']?\s*,?\s*["']הצג\/הסתר["']/,
    'regressed to an ambiguous static show/hide accessible name');
});
