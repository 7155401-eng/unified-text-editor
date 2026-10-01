import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridgeSource = fs.readFileSync(new URL('../../src/engine_bridge.js', import.meta.url), 'utf8');
const rendererSource = fs.readFileSync(new URL('../../src/engine/renderer.js', import.meta.url), 'utf8');
const v9Source = fs.readFileSync(new URL('../../src/vilna_v9.js', import.meta.url), 'utf8');
const v9ApplySource = fs.readFileSync(new URL('../../src/vilna_v9_apply.js', import.meta.url), 'utf8');
const smartSource = fs.readFileSync(new URL('../../src/engine/smart_packer.js', import.meta.url), 'utf8');

test('front-matter render pipeline keeps introductions as independent pagination groups', () => {
  assert.match(bridgeSource, /function partitionFrontMatterContent\(/);
  assert.match(bridgeSource, /paneRole !== "intro"/);
  assert.match(bridgeSource, /byPane\.get\(id\)\.content\.push\(item\)/);
  assert.match(bridgeSource, /async function packFrontMatterGroups\(/);
  assert.match(bridgeSource, /await domPack\(group\.content \|\| \[\], pageGeom/);
  assert.match(bridgeSource, /page\.frontMatter = \{/);
  assert.match(bridgeSource, /prependFrontMatterPages\(pagesContainer, packedFrontMatter\)/);
});

test('body rendering starts after physical front-matter page offset in regular and V9 modes', () => {
  assert.match(rendererSource, /pageIndexOffset = Math\.max\(0, Math\.floor\(Number\(options\.pageIndexOffset\) \|\| 0\)\)/);
  assert.match(rendererSource, /const physicalIndex = pageIndexOffset \+ i/);
  assert.match(bridgeSource, /renderPages\(pages, pagesContainer, \{ pageIndexOffset: frontMatterPageCount \}\)/);
  assert.match(bridgeSource, /pageIndexOffset: frontMatterPageCount/);
  assert.match(v9ApplySource, /pageIndexOffset: Math\.max\(0, Math\.floor\(Number\(opts\.pageIndexOffset\) \|\| 0\)\)/);
  assert.match(v9Source, /let pageIdx = Math\.max\(0, Math\.floor\(Number\(cfg\.pageIndexOffset\) \|\| 0\)\)/);
});

test('V9 page offset does not consume maxPages body budget', () => {
  assert.match(v9Source, /let renderedPageCount = 0/);
  assert.match(v9Source, /renderedPageCount < cfg\.maxPages/);
  assert.match(v9Source, /pageIdx\+\+;\s*renderedPageCount\+\+/);
});

test('front-matter pages are excluded from body smart-tune metrics', () => {
  assert.match(smartSource, /\.page:not\(\.page-placeholder\):not\(\.front-matter-page\)/);
});

test('renderer marks detached front-matter pages and preserves physical indexes', () => {
  assert.match(rendererSource, /page\.classList\.add\("front-matter-page"\)/);
  assert.match(rendererSource, /page\.dataset\.frontMatterPaneId/);
  assert.match(rendererSource, /export function renderPackedPagesToElements/);
  assert.match(rendererSource, /__ravtextRunPreRenderPageDecorators\(el, physicalIndex\)/);
});
