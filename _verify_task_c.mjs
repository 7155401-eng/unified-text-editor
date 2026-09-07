// Task C only: is the indicator up during start-up and during a render, does it
// go away within 2s of the end, and does it stay clear of the toolbars?
import { chromium } from 'playwright-chromium';

const URL = 'http://127.0.0.1:5204/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const out = {};

const geom = () => page.evaluate(() => {
  const el = document.getElementById('ravtext-loading');
  if (!el) return { exists: false };
  const cs = getComputedStyle(el);
  const visible = !el.hidden && cs.display !== 'none';
  const r = el.getBoundingClientRect();
  // every toolbar / ribbon panel currently on screen
  let worstOverlap = 0;
  if (visible) {
    for (const tb of document.querySelectorAll('.toolbar, .ribbon-toolbar, .ribbon-tabs, header')) {
      const t = tb.getBoundingClientRect();
      if (t.width === 0 || t.height === 0) continue;
      const ox = Math.max(0, Math.min(r.right, t.right) - Math.max(r.left, t.left));
      const oy = Math.max(0, Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top));
      worstOverlap = Math.max(worstOverlap, ox * oy);
    }
  }
  return {
    exists: true, visible,
    dir: cs.direction, position: cs.position, pointerEvents: cs.pointerEvents,
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    windowHeight: window.innerHeight,
    overlapWithToolbarsPx2: Math.round(worstOverlap),
    ariaBusy: document.getElementById('btn-render')?.getAttribute('aria-busy') ?? null,
  };
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
await page.reload({ waitUntil: 'domcontentloaded' });

// sample the first two seconds of start-up
const startupSamples = [];
for (const t of [120, 300, 600, 900, 1400, 2200, 3500]) {
  await page.waitForTimeout(t === 120 ? 120 : 250);
  startupSamples.push({ atMs: t, ...(await geom()) });
}
out.C1_startupSamples = startupSamples.map((s) => ({
  atMs: s.atMs, visible: s.visible, top: s.rect?.top, overlap: s.overlapWithToolbarsPx2,
}));
out.C1_shownDuringStartup = startupSamples.some((s) => s.visible);
out.C1_geometryWhileVisible = startupSamples.find((s) => s.visible) || null;

await page.waitForTimeout(14000);
out.C2_afterStartup = await geom();

// a real render
await page.evaluate(() => document.getElementById('btn-render')?.click());
const during = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(800);
  const g = await geom();
  during.push({ atMs: (i + 1) * 800, visible: g.visible, ariaBusy: g.ariaBusy, overlap: g.overlapWithToolbarsPx2 });
}
out.C3_duringRender = during;
out.C3_visibleAtLeastOnce = during.some((d) => d.visible);
out.C3_ariaBusyTrueAtLeastOnce = during.some((d) => d.ariaBusy === 'true');
out.C3_maxOverlapWithToolbars = Math.max(...during.map((d) => d.overlap || 0));

await page.waitForTimeout(16000);
out.C4_afterRenderSettled = await geom();
out.C4_pages = await page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);

// how fast does it go after the last end event?
out.C5_hideLatencyMs = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent('ravtext:engine-render-start', { detail: { token: -1 } }));
  await new Promise((r) => setTimeout(r, 200));
  const shown = window.__ravtextLoading.isVisible();
  const t0 = performance.now();
  window.dispatchEvent(new CustomEvent('ravtext:engine-rendered', { detail: { pages: [], content: [] } }));
  while (window.__ravtextLoading.isVisible() && performance.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return { shownFirst: shown, hiddenAfterMs: Math.round(performance.now() - t0) };
});

// a render that throws
out.C6_afterThrow = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent('ravtext:engine-render-start', { detail: { token: -2 } }));
  await new Promise((r) => setTimeout(r, 200));
  const during = window.__ravtextLoading.isVisible();
  window.dispatchEvent(new CustomEvent('ravtext:engine-rendered', {
    detail: { pages: [], content: [], error: 'synthetic failure' },
  }));
  await new Promise((r) => setTimeout(r, 2000));
  return { visibleDuring: during, visibleAfter: window.__ravtextLoading.isVisible() };
});

console.log('RESULT ' + JSON.stringify(out, null, 2));
await browser.close();
