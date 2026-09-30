import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('document features use one engine-render listener and one page snapshot per pass', async () => {
  const source = await readFile(
    new URL('../../src/document_features.js', import.meta.url),
    'utf8'
  );

  const listeners = source.match(
    /addEventListener\("ravtext:engine-rendered"/g
  ) || [];
  assert.equal(
    listeners.length,
    1,
    'document features must not repaint every page from duplicate engine-rendered listeners'
  );

  assert.match(
    source,
    /function applyPageNumbers\(pages = pageElements\(\)\)[\s\S]*?pages\.forEach/,
    'page-number standalone calls must keep a default page snapshot'
  );
  assert.match(
    source,
    /function applyHeaderFooter\(pages = pageElements\(\)\)[\s\S]*?pages\.forEach/,
    'header/footer standalone calls must keep a default page snapshot'
  );
  assert.match(
    source,
    /function applyWatermark\(pages = pageElements\(\)\)[\s\S]*?pages\.forEach/,
    'watermark standalone calls must keep a default page snapshot'
  );

  const applyAllStart = source.indexOf('function applyAll() {');
  const applyAllEnd = source.indexOf('\n}', applyAllStart) + 2;
  assert.ok(applyAllStart >= 0 && applyAllEnd > applyAllStart);
  const applyAll = source.slice(applyAllStart, applyAllEnd);

  assert.equal(
    (applyAll.match(/pageElements\(\)/g) || []).length,
    1,
    'applyAll must query the page list exactly once'
  );
  assert.match(applyAll, /applyPageNumbers\(pages\)/);
  assert.match(applyAll, /applyHeaderFooter\(pages\)/);
  assert.match(applyAll, /applyWatermark\(pages\)/);
});

test('gradual-page fallbacks remain after duplicate render listener removal', async () => {
  const source = await readFile(
    new URL('../../src/document_features.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /new MutationObserver\(\(records\) =>/);
  assert.match(source, /observer\.observe\(c, \{ childList: true, subtree: true \}\)/);
  assert.match(source, /container\.__processRealizedPage = \(page, idx\) =>/);
  assert.match(source, /installRealizedPageHook\(\)/);
  assert.match(
    source,
    /syncReservedSpace\(\{ rerenderOnChange: false, reason: "engine-rendered" \}\)/,
    'authoritative render listener must still update reserved overlay geometry'
  );
});
