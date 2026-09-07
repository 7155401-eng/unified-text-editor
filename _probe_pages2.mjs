import { chromium } from 'playwright-chromium';
import fs from 'fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:5205/', { waitUntil: 'networkidle' });
const samples = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(3000);
  samples.push(await page.evaluate(() => ({
    t: Math.round(performance.now()/1000),
    pages: document.querySelectorAll('.page:not(.page-placeholder)').length,
    ph: document.querySelectorAll('.page-placeholder').length,
    panes: (window.paneManager?.panes||[]).length,
    streams: (window.paneManager?.panes||[]).filter(p=>p.streamCode).length,
    mainChars: (window.paneManager?.getMainPane?.()?.editor?.getText?.()||'').length,
  })));
}
await page.evaluate(() => document.querySelector('#btn-render')?.click());
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(3000);
  samples.push(await page.evaluate(() => ({ t: Math.round(performance.now()/1000), afterClick: true, pages: document.querySelectorAll('.page:not(.page-placeholder)').length })));
}
fs.writeFileSync('_probe_pages2.json', JSON.stringify({ samples, errs }, null, 1), 'utf8');
console.log(JSON.stringify(samples));
console.log('errs=' + errs.length);
await browser.close();
