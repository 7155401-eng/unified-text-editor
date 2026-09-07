// Diagnostic: WHO starts a render, and WHO clears the pages container?
// Non-invasive - hooks setTimeout(delay===650) which is the render debounce,
// and the innerHTML setter, capturing JS stacks only (never page text).
import { chromium } from 'playwright-chromium';
import fs from 'fs';

const URL = 'http://127.0.0.1:5204/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__renderStacks = [];
  window.__clearStacks = [];
  const st = window.setTimeout;
  window.setTimeout = function (fn, delay, ...rest) {
    if (delay === 650) {
      window.__renderStacks.push({ t: Math.round(performance.now()), stack: new Error().stack });
    }
    return st.call(window, fn, delay, ...rest);
  };
  const proto = Element.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  Object.defineProperty(proto, 'innerHTML', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(this); },
    set(v) {
      if (this.id === 'pages-container' || (this.classList && this.classList.contains('pages-container'))) {
        window.__clearStacks.push({
          t: Math.round(performance.now()),
          hadPages: this.querySelectorAll('.page:not(.page-placeholder)').length,
          newLen: String(v == null ? '' : v).length,
          stack: new Error().stack,
        });
      }
      return desc.set.call(this, v);
    },
  });
});

const trim = (s) => String(s || '')
  .split('\n').slice(1, 7)
  .map((l) => l.trim().replace(/^at\s+/, '').replace('http://127.0.0.1:5204/', ''))
  .filter((l) => !/_probe|evaluate|puppeteer|<anonymous>:/.test(l))
  .join(' | ');

const dump = async (label, o) => {
  const r = await page.evaluate(() => ({
    render: window.__renderStacks.splice(0),
    clear: window.__clearStacks.splice(0),
    pages: document.querySelectorAll('.page:not(.page-placeholder)').length,
  }));
  o[label] = {
    pages: r.pages,
    renderStarts: r.render.length,
    renderFrom: r.render.map((x) => x.t + 'ms ' + trim(x.stack)),
    clears: r.clear.map((x) => x.t + 'ms had=' + x.hadPages + ' newLen=' + x.newLen + ' :: ' + trim(x.stack)),
  };
};

const out = {};

// 1) cold start with auto-render OFF (the default)
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(16000);
await dump('coldStart_autoOff', out);

// 2) explicit user render, then turn auto-render off via the checkbox
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(14000);
await dump('afterUserRender', out);

await page.evaluate(() => {
  localStorage.setItem('ravtext.liveRender.userChoice', '1');
  localStorage.setItem('ravtext.liveRender', '1');
  const cb = document.getElementById('live-render-toggle');
  if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(9000);
await dump('afterAutoOn', out);

await page.evaluate(() => {
  const cb = document.getElementById('live-render-toggle');
  if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(10000);
await dump('afterAutoOff', out);

// 3) the pause button, then the stop path
await page.evaluate(() => document.getElementById('btn-render-pause')?.click());
await page.waitForTimeout(4000);
await dump('afterPause', out);

await page.evaluate(() => document.getElementById('btn-render-pause')?.click());
await page.waitForTimeout(12000);
await dump('afterResume', out);

// 4) render, then press the render button again mid-flight (becomes STOP)
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(900);
await page.evaluate(() => document.getElementById('btn-render')?.click());
await page.waitForTimeout(12000);
await dump('afterStopMidRender', out);

// 5) reload with rendering switched off
await page.evaluate(() => {
  localStorage.setItem('ravtext.liveRender.userChoice', '1');
  localStorage.setItem('ravtext.liveRender', '0');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(16000);
await dump('reload_autoOff', out);

fs.writeFileSync('_who_renders.json', JSON.stringify(out, null, 2), 'utf8');
console.log('WROTE _who_renders.json');
console.log(JSON.stringify(out, null, 2).slice(0, 12000));
await browser.close();
