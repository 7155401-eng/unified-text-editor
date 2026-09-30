import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderComparatorMarkerBar } from '../../src/comparator_tool/comparator_marker_bar.js';

test('comparator marker bar keeps hostile imported symbols as inert text and dataset values', () => {
  const dom = new JSDOM('<!doctype html><body><div id="bar"></div></body>');
  try {
    const bar = dom.window.document.getElementById('bar');
    const payload = '<img src=x onerror="globalThis.__comparatorXss=1"><script>globalThis.__comparatorXss=2</script>';
    renderComparatorMarkerBar(
      bar,
      '7',
      [{ sym: payload }],
      { [payload]: 2 }
    );

    assert.equal(bar.querySelectorAll('img,script').length, 0, 'hostile symbol was parsed as markup');
    assert.equal(bar.querySelector('.sym-label-bar')?.textContent, payload);
    const badges = [...bar.querySelectorAll('.badge')];
    assert.equal(badges.length, 2);
    assert.deepEqual(badges.map(b => b.dataset.sym), [payload, payload]);
    assert.deepEqual(badges.map(b => b.dataset.edid), ['7', '7']);
    assert.deepEqual(badges.map(b => b.dataset.nth), ['1', '2']);
    assert.equal(dom.window.__comparatorXss, undefined);
  } finally {
    dom.window.close();
  }
});

test('both comparator UIs use the shared safe marker renderer and do not rebuild marker HTML strings', () => {
  for (const rel of [
    '../../src/comparator_tool/comparator_ui.js',
    '../../src/comparator_tool/comparator_integrated.js',
  ]) {
    const source = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(source, /renderComparatorMarkerBar\(bar, edId, syms, counts\)/, rel);
    assert.doesNotMatch(source, /sym-label-bar['"][^\n]*\+\s*s\.sym/, rel);
    assert.doesNotMatch(source, /bar\.innerHTML\s*\+=/, rel);
  }
});
