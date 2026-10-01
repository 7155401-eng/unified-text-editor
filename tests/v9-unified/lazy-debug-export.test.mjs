import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('debug exporter stays out of the toolbar startup static import graph', async () => {
  const toolbar = await source('src/engine_toolbar.js');
  assert.doesNotMatch(
    toolbar,
    /^\s*import\s+.*from\s+"\.\/debug_export\.js"/m
  );
  assert.match(
    toolbar,
    /_debugExportModulePromise\s*=\s*import\("\.\/debug_export\.js"\)/
  );
});

test('all debug/export buttons load the shared module only from explicit activation', async () => {
  const toolbar = await source('src/engine_toolbar.js');

  const html = toolbar.indexOf('getElementById("pdf-download-html")');
  const htmlLoad = toolbar.indexOf('await loadDebugExporter()', html);
  const htmlCall = toolbar.indexOf('await downloadPagesAsHtml(pagesContainer)', htmlLoad);
  assert.ok(html >= 0 && htmlLoad > html && htmlCall > htmlLoad);

  const snapshot = toolbar.indexOf('getElementById("pdf-debug-snapshot")');
  const snapshotLoad = toolbar.indexOf('await loadDebugExporter()', snapshot);
  const snapshotCall = toolbar.indexOf('downloadDebugSnapshot(pagesContainer)', snapshotLoad);
  assert.ok(snapshot >= 0 && snapshotLoad > snapshot && snapshotCall > snapshotLoad);

  const highlight = toolbar.indexOf('getElementById("pdf-debug-highlight")');
  const highlightLoad = toolbar.indexOf('await loadDebugExporter()', highlight);
  const highlightCall = toolbar.indexOf('toggleProblemHighlight(pagesContainer)', highlightLoad);
  assert.ok(highlight >= 0 && highlightLoad > highlight && highlightCall > highlightLoad);
});

test('debug HTML/JSON safety guards and highlight active state remain intact', async () => {
  const toolbar = await source('src/engine_toolbar.js');

  const html = toolbar.slice(
    toolbar.indexOf('getElementById("pdf-download-html")'),
    toolbar.indexOf('getElementById("pdf-debug-snapshot")')
  );
  assert.match(html, /blockClientSideExportInDemo\("הורדת HTML Debug מקומית"\)/);

  const snapshot = toolbar.slice(
    toolbar.indexOf('getElementById("pdf-debug-snapshot")'),
    toolbar.indexOf('getElementById("pdf-debug-highlight")')
  );
  assert.match(snapshot, /blockClientSideExportInDemo\("הורדת JSON Debug מקומית"\)/);

  const highlightStart = toolbar.indexOf('getElementById("pdf-debug-highlight")');
  const highlightEnd = toolbar.indexOf('getElementById("pdf-zoom-actual")', highlightStart);
  const highlight = toolbar.slice(highlightStart, highlightEnd);
  assert.match(highlight, /btn\.disabled\s*=\s*true/);
  assert.match(highlight, /setAttribute\("aria-busy",\s*"true"\)/);
  assert.match(highlight, /btn\.classList\.toggle\("active"\)/);
  assert.match(highlight, /finally\s*\{/);
  assert.match(highlight, /btn\.disabled\s*=\s*false/);
  assert.match(highlight, /removeAttribute\("aria-busy"\)/);
});

test('failed debug exporter chunk load is retryable', async () => {
  const toolbar = await source('src/engine_toolbar.js');
  const loader = toolbar.match(/async function loadDebugExporter\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loader, /\.catch\(\(error\) => \{/);
  assert.match(loader, /_debugExportModulePromise\s*=\s*null/);
  assert.match(loader, /throw error/);
});
