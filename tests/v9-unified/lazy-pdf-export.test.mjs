import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('PDF exporter stays out of the toolbar startup static import graph', async () => {
  const toolbar = await source('src/engine_toolbar.js');
  assert.doesNotMatch(
    toolbar,
    /^\s*import\s+\{[^}]*downloadPagesAsPdf[^}]*\}\s+from\s+"\.\/pdf_export\.js"/m
  );
  assert.match(
    toolbar,
    /_pdfExportModulePromise\s*=\s*import\("\.\/pdf_export\.js"\)/
  );
});

test('PDF exporter is loaded only from the download click path', async () => {
  const toolbar = await source('src/engine_toolbar.js');
  const click = toolbar.indexOf('getElementById("pdf-download")');
  const load = toolbar.indexOf('await loadPdfExporter()', click);
  const exportCall = toolbar.indexOf('await downloadPagesAsPdf(', load);

  assert.ok(click >= 0, 'PDF download handler missing');
  assert.ok(load > click, 'PDF exporter must load from the PDF download handler');
  assert.ok(exportCall > load, 'PDF export must run only after lazy module load');
});

test('PDF lazy load preserves safety, progress and button restoration semantics', async () => {
  const toolbar = await source('src/engine_toolbar.js');
  const click = toolbar.indexOf('getElementById("pdf-download")');
  const block = toolbar.slice(click, click + 2200);

  assert.match(block, /blockClientSideExportInDemo\("הורדת PDF מקומית"\)/);
  assert.match(block, /realizeAllPages\(\)/);
  assert.match(block, /btn\.disabled\s*=\s*true/);
  assert.match(block, /btn\.textContent\s*=\s*"מכין PDF\.\.\."/);
  assert.match(block, /includeBackgrounds:\s*isOutputBackgroundEnabled\(\)/);
  assert.match(block, /fallbackToPrint:\s*true/);
  assert.match(block, /onProgress\(page, total\)/);
  assert.match(block, /finally\s*\{/);
  assert.match(block, /btn\.disabled\s*=\s*false/);
  assert.match(block, /btn\.textContent\s*=\s*originalText/);
});

test('failed PDF exporter chunk load is retryable', async () => {
  const toolbar = await source('src/engine_toolbar.js');
  const loader = toolbar.match(/async function loadPdfExporter\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loader, /\.catch\(\(error\) => \{/);
  assert.match(loader, /_pdfExportModulePromise\s*=\s*null/);
  assert.match(loader, /throw error/);
});
