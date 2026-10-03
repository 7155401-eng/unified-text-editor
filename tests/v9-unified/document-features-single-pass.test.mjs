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


test('document feature reserve geometry delegates to layout_context only', async () => {
  const source = await readFile(
    new URL('../../src/document_features.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /import \{ createLayoutContext, layoutContextReserveValues, publishLayoutContextToCssVars \} from "\.\/engine\/layout_context\.js";/,
    'document_features must consume the shared layout measurement authority'
  );
  assert.doesNotMatch(
    source,
    /function getOrCreateMeasurePage\(/,
    'document_features must not keep a second hidden measure-page implementation'
  );
  assert.doesNotMatch(
    source,
    /function measureOverlayReserved\(/,
    'document_features must not keep an independent overlay measurement algorithm'
  );

  const start = source.indexOf('export function syncReservedSpace(options = {}) {');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  const sync = source.slice(start, end);

  assert.match(sync, /const context = createLayoutContext\(\)/);
  assert.match(sync, /const reserves = layoutContextReserveValues\(context\)/);
  assert.match(sync, /publishLayoutContextToCssVars\(context\)/);
  assert.doesNotMatch(
    sync,
    /measureOverlayReserved|getOrCreateMeasurePage/,
    'post-render sync must not diverge from pre-pagination measurement'
  );
});

test('layout_context measures configured header/footer text and owns reserve normalization', async () => {
  const source = await readFile(
    new URL('../../src/engine/layout_context.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /function measureOverlayReserve\(className, isTop, text = "מידה"\)/);
  assert.match(source, /el\.textContent = String\(text \|\| "מידה"\)/);
  assert.match(
    source,
    /header:\s*headerText \? measureOverlayReserve\("ravtext-page-header", true, headerText\) : 0/
  );
  assert.match(
    source,
    /footer:\s*footerText \? measureOverlayReserve\("ravtext-page-footer", false, footerText\) : 0/
  );
  assert.match(source, /export function layoutContextReserveValues\(context = createLayoutContext\(\)\)/);
  assert.match(
    source,
    /const reserves = layoutContextReserveValues\(context\);[\s\S]*--ravtext-features-header-reserved[\s\S]*--ravtext-features-footer-reserved[\s\S]*--ravtext-features-pagenumber-reserved/,
    'CSS reserve publication must use the same normalized values exposed to document_features'
  );
});
