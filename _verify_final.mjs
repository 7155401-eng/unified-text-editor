// Final verification: Task A gate, Task B keep-last-render, Task C indicator,
// plus the 40-page regression check. Counts, timings and stack frames only.
import { chromium } from 'playwright-chromium';
import fs from 'fs';

const URL = 'http://127.0.0.1:5204/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const out = {};

const pc = () => page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);
const trim = (s) => String(s || '').split('\n').slice(1, 6)
  .map((l) => l.trim().replace(/^at\s+/, '').replace('http://127.0.0.1:5204/', ''))
  .filter((l) => !/evaluate|<anonymous>:/.test(l)).join(' | ');

await page.addInitScript(() => {
  window.__vStarts = [];
  window.__vEnds = [];
  window.__vVis = [];
  window.addEventListener('ravtext:engine-render-start', () => {
    window.__vStarts.push({ t: Math.round(performance.now()), stack: new Error().stack });
  });
  window.addEventListener('ravtext:engine-rendered', () => {
    window.__vEnds.push({ t: Math.round(performance.now()) });
  });
});

const reset = () => page.evaluate(() => { window.__vStarts = []; window.__vEnds = []; });
const counts = () => page.evaluate(() => ({
  starts: window.__vStarts.length,
  ends: window.__vEnds.length,
  stacks: window.__vStarts.map((s) => s.stack),
}));
const setAuto = (on) => page.evaluate((v) => {
  localStorage.setItem('ravtext.liveRender.userChoice', '1');
  localStorage.setItem('ravtext.liveRender', v ? '1' : '0');
  const cb = document.getElementById('live-render-toggle');
  if (cb) cb.checked = !!v;
}, on);
const typeInPane = (t) => page.evaluate((s) => {
  const ed = window.paneManager?.getActiveEditor?.();
  if (ed) ed.chain().focus().insertContent(s).run();
}, t);

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);

// ---------------------------------------------------------------- TASK A
out.A_gate = await page.evaluate(() => window.__ravtextRenderGateStatus?.() ?? null);
out.A_coldStart = { pages: await pc(), ...(await counts()) };
delete out.A_coldStart.stacks;

await reset();
for (let i = 0; i < 5; i++) { await typeInPane('bdikah '); await page.waitForTimeout(700); }
await page.evaluate(() => {
  const pm = window.paneManager;
  pm?.panes?.[1]?.element?.click();
  pm?.getActiveEditor?.()?.commands.focus();
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('resize'));
});
await page.setViewportSize({ width: 1200, height: 820 });
await page.waitForTimeout(600);
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(20000);
const a1 = await counts();
out.A_autoOff_20s = { starts: a1.starts, ends: a1.ends };

await setAuto(true);
await page.waitForTimeout(1200);
await reset();
await typeInPane('z');
await page.waitForTimeout(14000);
const a2 = await counts();
out.A_autoOn_oneEdit = { starts: a2.starts, ends: a2.ends, from: a2.stacks.map(trim) };

await reset();
await page.evaluate(() => { window.paneManager?.emit?.('change'); });
await page.waitForTimeout(8000);
const a3 = await counts();
out.A_autoOn_changeEventButSameText = { starts: a3.starts, ends: a3.ends };

// ------------------------------------------------- regression: 40 pages
await setAuto(false);
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(18000);
out.R_pagesAfterRender = await pc();
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(18000);
out.R_pagesAfterSecondRender = await pc();

// ---------------------------------------------------------------- TASK C
// how long is the pill up compared with how long the render takes?
out.C_renderWindow = await page.evaluate(async () => {
  const samples = [];
  let startAt = null, endAt = null;
  const onStart = () => { if (startAt === null) startAt = performance.now(); };
  const onEnd = () => { endAt = performance.now(); };
  window.addEventListener('ravtext:engine-render-start', onStart);
  window.addEventListener('ravtext:engine-rendered', onEnd);
  document.getElementById('btn-render')?.click();
  const t0 = performance.now();
  while (performance.now() - t0 < 20000) {
    samples.push([Math.round(performance.now() - t0), window.__ravtextLoading.isVisible() ? 1 : 0]);
    await new Promise((r) => setTimeout(r, 150));
  }
  window.removeEventListener('ravtext:engine-render-start', onStart);
  window.removeEventListener('ravtext:engine-rendered', onEnd);
  const vis = samples.filter((s) => s[1] === 1);
  return {
    renderStartMs: startAt === null ? null : Math.round(startAt - t0),
    lastEndMs: endAt === null ? null : Math.round(endAt - t0),
    pillFirstVisibleMs: vis.length ? vis[0][0] : null,
    pillLastVisibleMs: vis.length ? vis[vis.length - 1][0] : null,
    pillVisibleSamples: vis.length,
    totalSamples: samples.length,
  };
});
out.C_pagesAfter = await pc();

// ---------------------------------------------------------------- TASK B
out.B_before = await pc();
out.B_snapshot = await page.evaluate(() => window.__ravtextLastGoodRenderInfo?.() ?? null);

await page.evaluate(() => {
  const cb = document.getElementById('live-render-toggle');
  if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  localStorage.setItem('ravtext.liveRender', '0');
});
await page.waitForTimeout(10000);
out.B_tenSecAfterTurningRenderOff = await pc();

// cancel mid-render, repeatedly, at several points in the pipeline
const cancelResults = [];
for (const waitMs of [1200, 2200, 3200, 4500]) {
  await page.evaluate(() => document.getElementById('btn-render')?.click());
  await page.waitForTimeout(waitMs);
  await page.evaluate(() => window.__ravtextCancelRender?.('verify'));
  await page.waitForTimeout(2500);
  const now = await pc();
  await page.waitForTimeout(6000);
  cancelResults.push({ cancelledAtMs: waitMs, pagesRightAfter: now, pagesLater: await pc() });
}
out.B_cancelMidRender = cancelResults;

// the stop button
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(2400);
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(6000);
out.B_afterStopButton = await pc();

// supersede: ask for a second render while the first is still drawing
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(2600);
await page.evaluate(() => window.__ravtextRerender?.());
await page.waitForTimeout(1500);
out.B_pagesWhileSuperseded = await pc();
await page.waitForTimeout(16000);
out.B_pagesAfterSuperseded = await pc();

fs.writeFileSync('_verify_final.json', JSON.stringify(out, null, 2), 'utf8');
console.log('RESULT ' + JSON.stringify(out, null, 2));
await browser.close();
