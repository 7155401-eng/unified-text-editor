import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const store = new Map([
  ['ravtext.customStyles.v1', JSON.stringify([
    { id: 'style-a', name: 'Style A' },
    { id: 'style-b', name: 'Style B', bold: true },
  ])],
]);
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};

const {
  streamSettingsPanelSignature,
  refreshStreamStyleSelectOptions,
} = await import('../../src/original_stream_columns.js');

test('stream settings structure signature ignores ordering and duplicate sources', () => {
  const pagesA = [
    { streams: { '03': {}, '01': {} } },
    { streams: { '02': {}, '01': {} } },
  ];
  const panesA = [
    { streamCode: '02' },
    { streamCode: '04' },
    { streamCode: '03' },
  ];
  assert.equal(streamSettingsPanelSignature(pagesA, panesA), '01,02,03,04');

  const pagesB = [{ streams: { '04': {}, '03': {}, '02': {}, '01': {} } }];
  const panesB = [{ streamCode: '01' }];
  assert.equal(streamSettingsPanelSignature(pagesB, panesB), '01,02,03,04');

  assert.equal(
    streamSettingsPanelSignature(pagesB, [...panesB, { streamCode: '05' }]),
    '01,02,03,04,05'
  );
});

test('style refresh updates existing select options in place and preserves selection', () => {
  const select = { value: 'style-b', innerHTML: '<option>stale</option>' };
  const sameSelect = select;
  const panel = {
    querySelectorAll(selector) {
      assert.equal(selector, '.stream-style-select');
      return [select];
    },
  };

  const updated = refreshStreamStyleSelectOptions(panel);
  assert.equal(updated, 1);
  assert.strictEqual(select, sameSelect);
  assert.equal(select.value, 'style-b');
  assert.match(select.innerHTML, /Style A/);
  assert.match(select.innerHTML, /Style B/);
  assert.match(select.innerHTML, /value="style-b" selected/);
});

test('main skips text-only stream-panel refreshes and styles-changed refreshes options in place', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  const streams = await readFile(new URL('../../src/original_stream_columns.js', import.meta.url), 'utf8');

  assert.match(main, /streamSettingsPanelSignature\(pages, paneManager\.panes\)/);
  assert.match(main, /signature === _lastStreamSettingsPanelStructureSig[\s\S]*?panel\?\.dataset\?\.builtFor === signature[\s\S]*?return;/);
  assert.match(
    streams,
    /addEventListener\("ravtext:styles-changed", \(\) => refreshStreamStyleSelectOptions\(panel\)\)/
  );
  assert.doesNotMatch(
    streams,
    /addEventListener\("ravtext:styles-changed", \(\) => updateOriginalStreamColumnsPanel/
  );
});
