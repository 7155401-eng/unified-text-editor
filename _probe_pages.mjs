// Page-count regression probe. Prints NUMBERS ONLY (never document text).
import { chromium } from 'playwright-chromium';
import fs from 'fs';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:5205/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(32000); // full pack settles ~31s on this sample

const before = await page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);
await page.evaluate(() => document.querySelector('#btn-render')?.click());
await page.waitForTimeout(12000);
const after = await page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);

const out = { url: URL, pagesBeforeClick: before, pagesAfterRender: after };
fs.writeFileSync('_probe_pages.json', JSON.stringify(out, null, 1), 'utf8');
console.log('pagesBeforeClick=' + before + ' pagesAfterRender=' + after);
await browser.close();
