import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const versions = {
  current: root,
  pr1092_1536: path.join(root, '.versions', 'pr1092'),
  pr1095_4096: path.join(root, '.versions', 'pr1095'),
  pr1108_dominance: path.join(root, '.versions', 'pr1108'),
};

function profileExactTail(source) {
  const token = 'export function findV9ExactTailPartition';
  if (!source.includes(token)) throw new Error('exact-tail export anchor missing');
  let out = source.replace(token, 'function __ravtextProfileExactTailImpl');
  out += `
export function findV9ExactTailPartition(args) {
  const p = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
  p.exactSearches = (p.exactSearches || 0) + 1;
  p.metricCalls = p.metricCalls || 0;
  p.metricMs = p.metricMs || 0;
  p.exactMs = p.exactMs || 0;
  p.evaluations = p.evaluations || 0;
  p.statuses = p.statuses || {};
  const originalMetric = args.metricFor;
  const wrappedMetric = (...metricArgs) => {
    p.metricCalls++;
    const started = performance.now();
    try { return originalMetric(...metricArgs); }
    finally { p.metricMs += performance.now() - started; }
  };
  const started = performance.now();
  const result = __ravtextProfileExactTailImpl({ ...args, metricFor: wrappedMetric });
  p.exactMs += performance.now() - started;
  p.evaluations += Number(result?.evaluations) || 0;
  const status = String(result?.status || 'unknown');
  p.statuses[status] = (p.statuses[status] || 0) + 1;
  return result;
}
`;
  return out;
}

function profileMainInline(source) {
  let out = source;
  const keyToken = 'function exactTailCacheKey(';
  if (out.includes(keyToken)) {
    out = out.replace(keyToken, 'function __ravtextProfileExactTailCacheKeyImpl(');
    out += `
function exactTailCacheKey(args) {
  const p = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
  const started = performance.now();
  const key = __ravtextProfileExactTailCacheKeyImpl(args);
  p.cacheKeyCalls = (p.cacheKeyCalls || 0) + 1;
  p.cacheKeyMs = (p.cacheKeyMs || 0) + (performance.now() - started);
  p.cacheKeyChars = (p.cacheKeyChars || 0) + String(key || '').length;
  return key;
}
`;
  }

  const lookup = '    let search = cache.get(cacheKey);\n    if (!search) {';
  if (out.includes(lookup)) {
    out = out.replace(lookup, `    let search = cache.get(cacheKey);
    {
      const p = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
      if (search) p.exactCacheHits = (p.exactCacheHits || 0) + 1;
      else p.exactCacheMisses = (p.exactCacheMisses || 0) + 1;
    }
    if (!search) {`);
  }
  return out;
}

function profileMeasurement(source) {
  let out = source;
  const keyExport = 'export function v9MeasurementCacheKey';
  if (!out.includes(keyExport)) throw new Error('measurement key export anchor missing');
  out = out.replace(keyExport, 'function __ravtextProfileMeasurementKeyImpl');
  out += `
export function v9MeasurementCacheKey(part) {
  const p = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
  const started = performance.now();
  const key = __ravtextProfileMeasurementKeyImpl(part);
  p.measureKeyCalls = (p.measureKeyCalls || 0) + 1;
  p.measureKeyMs = (p.measureKeyMs || 0) + (performance.now() - started);
  p.measureKeyChars = (p.measureKeyChars || 0) + String(key || '').length;
  return key;
}
`;

  const token = '      const found = cache.get(key); if (found) return found;';
  if (!out.includes(token)) throw new Error('measurement cache anchor missing');
  out = out.replace(token, `      const profile = globalThis.__V9_PROFILE__ || (globalThis.__V9_PROFILE__ = {});
      profile.measureCalls = (profile.measureCalls || 0) + 1;
      const found = cache.get(key);
      if (found) {
        profile.measureHits = (profile.measureHits || 0) + 1;
        return found;
      }
      profile.measureMisses = (profile.measureMisses || 0) + 1;
      const __ravtextMissStarted = performance.now();`);

  const endToken = '      cache.set(key, result); return result;';
  if (!out.includes(endToken)) throw new Error('measurement miss end anchor missing');
  out = out.replace(endToken, `      profile.measureMissMs = (profile.measureMissMs || 0) + (performance.now() - __ravtextMissStarted);
      cache.set(key, result); return result;`);
  return out;
}

function maybeInstrument(filename, source) {
  const normalized = filename.replaceAll('\\', '/');
  if (normalized.endsWith('/src/engine/v9_exact_tail_partition.js')) return profileExactTail(source);
  if (normalized.endsWith('/src/engine/v9_main_inline_layout.js')) return profileMainInline(source);
  if (normalized.endsWith('/src/engine/v9_text_measurement.js')) return profileMeasurement(source);
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
let browser;
const results = [];

try {
  browser = await chromium.launch({ headless: true });

  for (const version of Object.keys(versions)) {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(String(err)));
    await page.goto(`http://127.0.0.1:${port}/${version}/tests/v9-unified/browser-fixture.html`);

    const result = await page.evaluate(async ({ version, port }) => {
      globalThis.__V9_PROFILE__ = {};
      const longTasks = [];
      let observer = null;
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {}

      const base = `http://127.0.0.1:${port}/${version}/`;
      const [{ buildPages }, { getStreamSettings }] = await Promise.all([
        import(base + 'src/vilna_v9.js'),
        import(base + 'src/original_stream_columns.js'),
      ]);

      const neutral = 'אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר';
      const mainText = Array(8).fill(neutral).join(' ');
      const words = [...mainText.matchAll(/\S+/gu)];
      const input = Array.from({ length: 8 }, (_, pi) => ({
        id: `profile-gap-${pi}`,
        mainText,
        notes: Array.from({ length: 4 }, (_, ni) => {
          const at = words[Math.min(words.length - 1, 5 + ni * 16)];
          return {
            stream: '03',
            uid: `profile-gap-note-${pi}-${ni}`,
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
      await new Promise(resolve => setTimeout(resolve, 0));
      observer?.disconnect();

      const html = host.innerHTML;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
      const domHash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
      const profile = { ...globalThis.__V9_PROFILE__ };
      return {
        version,
        elapsedMs,
        maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
        complete: !!built.complete,
        pages: built.pages?.length || 0,
        mainRows: host.querySelectorAll('.v9-line[data-v9-role="main"]').length,
        streamRows: host.querySelectorAll('.v9-final-stream-line').length,
        noteAnchorFallbacks: built.noteAnchorFallbacks?.length || 0,
        domHash,
        profile,
      };
    }, { version, port });

    result.elapsedMs = Number(result.elapsedMs.toFixed(1));
    result.maxLongTaskMs = Number(result.maxLongTaskMs.toFixed(1));
    results.push({ ...result, pageErrors });
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

fs.mkdirSync('test-results/v9-unified', { recursive: true });
fs.writeFileSync(
  'test-results/v9-unified/render-history-profile.json',
  JSON.stringify({ browserVersion: browser?.version?.() || '', results }, null, 2)
);
console.log(JSON.stringify(results, null, 2));
if (results.some(r => !r.complete || r.pageErrors.length)) process.exitCode = 1;
