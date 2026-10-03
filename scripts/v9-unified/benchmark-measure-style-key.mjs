import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const versions = {
  head: root,
  base: path.join(root, '.baseline'),
};

function instrumentMeasurement(source) {
  let out = source;
  const keyPatterns = [
    '      const key = measurementKey(part);',
    '      const key = v9MeasurementCacheKey(part);',
  ];
  const keyPattern = keyPatterns.find(token => out.includes(token));
  if (!keyPattern) throw new Error('measurement key call anchor missing');
  const expression = keyPattern.includes('measurementKey')
    ? 'measurementKey(part)'
    : 'v9MeasurementCacheKey(part)';
  out = out.replace(keyPattern, `      const __ravtextKeyStarted = performance.now();
      const key = ${expression};
      {
        const p = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
        p.measureKeyCalls = (p.measureKeyCalls || 0) + 1;
        p.measureKeyMs = (p.measureKeyMs || 0) + (performance.now() - __ravtextKeyStarted);
        p.measureKeyChars = (p.measureKeyChars || 0) + String(key || '').length;
      }`);

  const foundOld = '      const found = cache.get(key); if (found) return found;';
  if (!out.includes(foundOld)) throw new Error('measurement lookup anchor missing');
  out = out.replace(foundOld, `      const p = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
      p.measureCalls = (p.measureCalls || 0) + 1;
      const found = cache.get(key);
      if (found) {
        p.measureHits = (p.measureHits || 0) + 1;
        return found;
      }
      p.measureMisses = (p.measureMisses || 0) + 1;
      const __ravtextMissStarted = performance.now();`);

  const missEnd = '      cache.set(key, result); return result;';
  if (!out.includes(missEnd)) throw new Error('measurement miss end anchor missing');
  out = out.replace(missEnd, `      p.measureMissMs = (p.measureMissMs || 0) + (performance.now() - __ravtextMissStarted);
      cache.set(key, result); return result;`);
  return out;
}

function maybeInstrument(filename, source) {
  const normalized = filename.replaceAll('\\', '/');
  if (normalized.endsWith('/src/engine/v9_text_measurement.js')) {
    return instrumentMeasurement(source);
  }
  return source;
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const bits = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    const version = bits.shift();
    const base = versions[version];
    if (!base) { res.writeHead(404).end('unknown version'); return; }
    const filename = path.resolve(base, bits.join('/'));
    if (!filename.startsWith(path.resolve(base) + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let data = fs.readFileSync(filename);
    if (/\.(?:js|mjs)$/.test(filename)) {
      data = Buffer.from(maybeInstrument(filename, data.toString('utf8')));
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    } else if (filename.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    res.end(data);
  } catch (error) {
    res.writeHead(404).end(String(error?.message || error));
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

async function runOne(page, version) {
  await page.goto(`http://127.0.0.1:${port}/${version}/tests/v9-unified/browser-fixture.html`);
  return page.evaluate(async ({ version, port }) => {
    globalThis.__V9_PROFILE__ = {};
    const base = `http://127.0.0.1:${port}/${version}/`;
    const [{ buildPages }, { getStreamSettings }] = await Promise.all([
      import(base + 'src/vilna_v9.js'),
      import(base + 'src/original_stream_columns.js'),
    ]);

    const neutral = 'אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר';
    const mainText = Array(8).fill(neutral).join(' ');
    const words = [...mainText.matchAll(/\S+/gu)];
    const input = Array.from({ length: 8 }, (_, pi) => ({
      id: `measure-key-${pi}`,
      mainText,
      notes: Array.from({ length: 4 }, (_, ni) => {
        const at = words[Math.min(words.length - 1, 5 + ni * 16)];
        return {
          stream: '03',
          uid: `measure-key-note-${pi}-${ni}`,
          num: pi * 4 + ni + 1,
          anchor: at.index + at[0].length,
          anchorAffinity: 'backward',
          text: Array(8 + ni * 3).fill(neutral).join(' '),
        };
      }),
    }));

    const settings = getStreamSettings();
    settings['03'] = {
      ...(settings['03'] || {}),
      mainRefEnabled: true,
      noteNumEnabled: false,
      lemmaBold: false,
      titleShow: false,
    };

    const cfg = {
      pageWidth: 380,
      pageHeight: 260,
      padding: 12,
      mainFontSize: 13,
      sideFontSize: 11,
      lineHeightRatio: 1.55,
      mainFontFamily: 'serif',
      sideFontFamily: 'serif',
      talmudStreams: ['01', '02'],
      maxPages: 200,
      openingWordSettings: { enabled: false },
      mishnaWrapOn: false,
      streamSettings: { '03': { inlineStyle: { fontSize: 11 } } },
    };

    const host = document.getElementById('test-root');
    const started = performance.now();
    const built = await buildPages(host, input, cfg);
    const elapsedMs = performance.now() - started;
    const html = host.innerHTML;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
    const domHash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    return {
      version,
      elapsedMs,
      complete: !!built.complete,
      pages: built.pages?.length || 0,
      noteAnchorFallbacks: built.noteAnchorFallbacks?.length || 0,
      domHash,
      profile: { ...globalThis.__V9_PROFILE__ },
    };
  }, { version, port });
}

const browser = await chromium.launch({ headless: true });
const order = ['base', 'head', 'head', 'base', 'base', 'head'];
const results = [];
try {
  for (const version of order) {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', err => errors.push(String(err)));
    const result = await runOne(page, version);
    result.elapsedMs = Number(result.elapsedMs.toFixed(1));
    result.pageErrors = errors;
    results.push(result);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const byVersion = Object.groupBy(results, row => row.version);
function median(values) {
  const xs = [...values].sort((a,b)=>a-b);
  return xs[Math.floor(xs.length / 2)];
}
const summary = {};
for (const [version, rows] of Object.entries(byVersion)) {
  summary[version] = {
    runs: rows.length,
    elapsedMedianMs: median(rows.map(r => r.elapsedMs)),
    keyMedianMs: median(rows.map(r => r.profile.measureKeyMs || 0)),
    keyChars: rows[0].profile.measureKeyChars || 0,
    measureCalls: rows[0].profile.measureCalls || 0,
    measureHits: rows[0].profile.measureHits || 0,
    measureMisses: rows[0].profile.measureMisses || 0,
    missMedianMs: median(rows.map(r => r.profile.measureMissMs || 0)),
    pages: rows[0].pages,
    domHash: rows[0].domHash,
  };
}

fs.mkdirSync('test-results/v9-unified', { recursive: true });
fs.writeFileSync(
  'test-results/v9-unified/measure-style-key-benchmark.json',
  JSON.stringify({ results, summary }, null, 2)
);
console.log(JSON.stringify({ results, summary }, null, 2));

const base = summary.base;
const head = summary.head;
if (!base || !head) throw new Error('missing benchmark side');
if (base.domHash !== head.domHash || base.pages !== head.pages) {
  throw new Error('candidate changed rendered output');
}
if (results.some(r => !r.complete || r.noteAnchorFallbacks || r.pageErrors.length)) {
  throw new Error('candidate/base render did not complete cleanly');
}
