import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('all icon-only AI key toggles have explicit accessible names', async () => {
  const html = await source('index.html');
  const tags = [...html.matchAll(/<button\b[^>]*class="ai-key-toggle"[^>]*>/g)]
    .map((match) => match[0]);

  assert.equal(tags.length, 6, 'expected all six provider visibility toggles');
  for (const tag of tags) {
    assert.match(tag, /aria-label="[^"]+"/, tag);
  }
});

for (const file of [
  'src/comparator_tool/comparator_ui.js',
  'src/comparator_tool/comparator_integrated.js',
]) {
  test(file + ' keeps icon-only controls named across mount, language changes and dynamic panes', async () => {
    const text = await source(file);

    assert.match(text, /function syncIconButtonA11y\(\)/);
    assert.match(text, /\[data-action="toggleTheme"\]/);
    assert.match(text, /\[data-action="changeFontSize"\]\[data-arg="-2"\]/);
    assert.match(text, /\[data-action="changeFontSize"\]\[data-arg="-1"\]/);
    assert.match(text, /\[data-action="changeFontSize"\]\[data-arg="1"\]/);
    assert.match(text, /\[data-action="changeFontSize"\]\[data-arg="2"\]/);
    assert.match(text, /querySelectorAll\('\[data-action="removePane"\]'\)/);

    const calls = text.match(/syncIconButtonA11y\(\);/g) || [];
    assert.ok(calls.length >= 3, 'expected initial, add-pane and language-toggle synchronization');
  });
}
