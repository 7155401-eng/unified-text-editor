import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { partitionFrontMatterContent } from '../../src/engine/front_matter_partition.js';

const bridgeSource = fs.readFileSync(new URL('../../src/engine_bridge.js', import.meta.url), 'utf8');
const rendererSource = fs.readFileSync(new URL('../../src/engine/renderer.js', import.meta.url), 'utf8');
const v9Source = fs.readFileSync(new URL('../../src/vilna_v9.js', import.meta.url), 'utf8');
const v9ApplySource = fs.readFileSync(new URL('../../src/vilna_v9_apply.js', import.meta.url), 'utf8');
const smartSource = fs.readFileSync(new URL('../../src/engine/smart_packer.js', import.meta.url), 'utf8');

test('front-matter partition preserves pane order, body order and orphan intro content', () => {
  const paneManager = {
    panes: [
      { id:'intro-a', paneRole:'intro', label:'Intro A' },
      { id:'intro-b', paneRole:'intro', label:'Intro B' },
      { id:'main', paneRole:'main', label:'Main' },
    ],
    getIntroPanes() { return this.panes.filter(p => p.paneRole === 'intro'); },
  };
  const a1={id:'a1',paneRole:'intro',paneId:'intro-a'};
  const body1={id:'b1',paneRole:'main',paneId:'main'};
  const orphan={id:'orphan',paneRole:'intro',paneId:'deleted-pane'};
  const a2={id:'a2',paneRole:'intro',paneId:'intro-a'};
  const bIntro={id:'b-intro',paneRole:'intro',paneId:'intro-b'};
  const body2={id:'b2',paneRole:'main',paneId:'main'};

  const out=partitionFrontMatterContent([a1,body1,orphan,a2,bIntro,body2],paneManager);

  assert.deepEqual(out.body,[body1,body2]);
  assert.equal(out.groups.length,3);
  assert.deepEqual(out.groups.map(g=>g.paneId),['','intro-a','intro-b']);
  assert.deepEqual(out.groups[0].content,[orphan]);
  assert.deepEqual(out.groups[1].content,[a1,a2]);
  assert.deepEqual(out.groups[2].content,[bIntro]);

  const flattened=[...out.groups.flatMap(g=>g.content),...out.body];
  assert.equal(flattened.length,6,'partition lost or duplicated content');
  assert.equal(new Set(flattened).size,6,'partition duplicated a source item');
});

test('front-matter render pipeline keeps introductions as independent pagination groups', () => {
  const partitionSource = fs.readFileSync(new URL('../../src/engine/front_matter_partition.js', import.meta.url), 'utf8');
  assert.match(partitionSource, /function partitionFrontMatterContent\(/);
  assert.match(partitionSource, /paneRole !== "intro"/);
  assert.match(partitionSource, /byPane\.get\(id\)\.content\.push\(item\)/);
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
