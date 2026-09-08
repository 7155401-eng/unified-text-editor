// Regression guard: the sample document must still lay out to 40 real pages
// after a full re-pack. Nothing here touches the editors - it only renders.
import { chromium } from 'playwright-chromium';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5203/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);

const before = await page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);
console.log('pages before render:', before);

await page.click('#btn-render');

// a full re-pack takes about four seconds; poll for up to 40s so a slow render
// is never mistaken for a regression.
let pages = 0;
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  await page.waitForTimeout(1000);
  const n = await page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);
  if (n === pages && n >= 40) break;
  pages = n;
}
console.log('pages after render:', pages, 'took', Math.round((Date.now() - t0) / 1000) + 's');
console.log(pages === 40 ? 'PASS  40 pages' : `FAIL  expected 40, got ${pages}`);
await browser.close();
process.exit(pages === 40 ? 0 : 1);
