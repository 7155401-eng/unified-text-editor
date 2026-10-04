import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'https://ravtext.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const settingsMod = await import('../../src/original_stream_columns.js');
const titleMod = await import('../../src/engine/regular_stream_title.js');
const { getStreamSettings } = settingsMod;
const { createRegularMainStreamTitle, createRegularStreamTitle } = titleMod;

function withSettings(code, patch, fn) {
  const all = getStreamSettings();
  const saved = all[code];
  all[code] = { ...(saved || {}), ...patch };
  try { return fn(all[code]); }
  finally {
    if (saved === undefined) delete all[code];
    else all[code] = saved;
  }
}

test('B42 regular main-stream title obeys title/titleShow and has no implicit fallback', () => {
  withSettings('main', { title:'כותרת ראשית', titleShow:true, titleStyleId:'', barShow:false }, () => {
    const title = createRegularMainStreamTitle();
    assert(title, 'visible main title was not created');
    assert.equal(title.textContent, 'כותרת ראשית');
    assert.equal(title.classList.contains('main-stream-title'), true);
    assert.equal(title.dataset.stream, 'main');
  });

  withSettings('main', { title:'כותרת ראשית', titleShow:false }, () => {
    assert.equal(createRegularMainStreamTitle(), null, 'hidden main title was still painted');
  });

  withSettings('main', { title:'', titleShow:true }, () => {
    assert.equal(createRegularMainStreamTitle(), null,
      'regular renderer invented a main title even though the user left it empty');
  });
});

test('B42 regular commentary title obeys titleShow while retaining resolved fallback label', () => {
  withSettings('01', { title:'', titleShow:true, titleStyleId:'', barShow:false }, () => {
    const title = createRegularStreamTitle('01', 'ביאור');
    assert(title, 'visible commentary title was not created');
    assert.equal(title.textContent, 'ביאור');
    assert.equal(title.dataset.stream, '01');
  });

  withSettings('01', { title:'ביאור ידני', titleShow:true, titleStyleId:'', barShow:false }, () => {
    assert.equal(createRegularStreamTitle('01', 'fallback')?.textContent, 'ביאור ידני');
  });

  withSettings('01', { title:'ביאור', titleShow:false }, () => {
    assert.equal(createRegularStreamTitle('01', 'ביאור'), null,
      'titleShow=false still created a regular commentary title');
  });
});

test('B42 regular measurement and paint use the same stream-title helper', () => {
  const renderer = fs.readFileSync(new URL('../../src/engine/renderer.js', import.meta.url), 'utf8');
  const packer = fs.readFileSync(new URL('../../src/engine/dom_packer.js', import.meta.url), 'utf8');

  for (const [name, source] of [['renderer',renderer],['dom_packer',packer]]) {
    assert.match(source, /createRegularMainStreamTitle/,`${name} does not use the shared main-title helper`);
    assert.match(source, /createRegularStreamTitle/,`${name} does not use the shared commentary-title helper`);
  }

  assert.doesNotMatch(renderer,
    /const title = document\.createElement\("div"\);\s*title\.className = "stream-title";/,
    'renderer reintroduced an independent title constructor');
  assert.doesNotMatch(packer,
    /const title = document\.createElement\("div"\);\s*title\.className = "stream-title";/,
    'measurement path reintroduced an independent title constructor');
});
