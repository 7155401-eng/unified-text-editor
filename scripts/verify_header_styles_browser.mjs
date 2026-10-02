// בדיקת דפדפן אמיתית ל„עיצוב כותרת ותחתית".
// מריצים: node scripts/verify_header_styles_browser.mjs
//
// הבדיקה המרכזית: שהיישור המתחלף באמת מתחלף בין עמוד זוגי לאי-זוגי על
// עמודים אמיתיים, ושכיבוי ההגדרה מחזיר את המראה הקודם במדויק.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'header-styles');

const server = http.createServer((req, res) => {
  const name = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!name.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(name, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') || name.endsWith('.mjs')
      ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const checks = [];
const pageErrors = [];
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  checks.push({ name: n, ok, actual: a, expected: e });
  console.log(ok ? `  ✓ ${n}` : `  ✗ ${n}\n      צפוי: ${JSON.stringify(e)}\n      קיבלנו: ${JSON.stringify(a)}`);
};
const checkThat = (n, c, d = '') => {
  checks.push({ name: n, ok: !!c, actual: d });
  console.log(c ? `  ✓ ${n}` : `  ✗ ${n}${d ? `  (${d})` : ''}`);
};
const headerStyle = (page, nth, prop) => page.evaluate(
  ([i, p]) => getComputedStyle(document.querySelectorAll('#pages .ravtext-page-header')[i]).getPropertyValue(p),
  [nth, prop]);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/header-styles/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] סימון זוגיות קורה כבר בטעינה, בלי לפתוח כלום');
  const parity = await page.$$eval('#pages .page', (els) => els.map((e) => e.getAttribute('data-page-parity')));
  check('שלושה עמודים מסומנים', parity, ['odd', 'even', 'odd']);

  console.log('\n[2] בלי הגדרה — אין גיליון עיצוב בכלל');
  check('אין תגית עיצוב', await page.locator('#rt-header-style-rules').count(), 0);
  const baseSize = await headerStyle(page, 0, 'font-size');

  console.log('\n[3] פתיחת החלון');
  await page.click('#header-styles-btn');
  await page.waitForSelector('#rt-header-styles.is-open');
  check('מימין לשמאל', await page.getAttribute('#rt-header-styles', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-header-styles .rths-window', 'role'), 'dialog');
  check('כבוי כברירת מחדל', await page.isChecked('#rths-on'), false);

  console.log('\n[4] הפעלה — העיצוב מוחל על העמודים האמיתיים');
  await page.check('#rths-on');
  await page.fill('#rths-size', '18');
  await page.check('#rths-bold');
  await page.waitForTimeout(250);
  const size = await headerStyle(page, 0, 'font-size');
  checkThat('הגודל השתנה', size !== baseSize, `${baseSize} ⟵ ${size}`);
  check('מודגש', await headerStyle(page, 0, 'font-weight'), '700');

  console.log('\n[5] ⭐ יישור מתחלף — הלב של הפריט');
  await page.selectOption('#rths-align', 'outer');
  await page.waitForTimeout(250);
  check('עמוד 1 (אי-זוגי) לימין', (await headerStyle(page, 0, 'text-align')).trim(), 'right');
  check('עמוד 2 (זוגי) לשמאל', (await headerStyle(page, 1, 'text-align')).trim(), 'left');
  check('עמוד 3 (אי-זוגי) שוב לימין', (await headerStyle(page, 2, 'text-align')).trim(), 'right');

  await page.selectOption('#rths-align', 'inner');
  await page.waitForTimeout(250);
  check('פנימי — עמוד 1 לשמאל', (await headerStyle(page, 0, 'text-align')).trim(), 'left');
  check('ופנימי — עמוד 2 לימין', (await headerStyle(page, 1, 'text-align')).trim(), 'right');

  console.log('\n[6] התחתית — אפשר להחיל עליה ואפשר לא');
  const footerWeight = () => page.evaluate(() =>
    getComputedStyle(document.querySelector('#pages .ravtext-page-footer')).fontWeight);
  check('מודגשת כברירת מחדל', await footerWeight(), '700');
  await page.uncheck('#rths-footer');
  await page.waitForTimeout(250);
  checkThat('ואחרי הכיבוי כבר לא', (await footerWeight()) !== '700', await footerWeight());

  console.log('\n[7] ⛔ אבטחה — צבע פסול אינו מזריק קוד');
  await page.fill('#rths-color', 'red;}body{display:none');
  await page.waitForTimeout(250);
  const sheet = await page.evaluate(() => document.getElementById('rt-header-style-rules')?.textContent || '');
  checkThat('הגיליון אינו מכיל את הקוד', !sheet.includes('display:none'), sheet.slice(0, 120));
  checkThat('והדף עדיין נראה', await page.locator('#pages').isVisible());
  await page.fill('#rths-color', '');

  console.log('\n[8] ⭐ כיבוי מחזיר את המראה הקודם במדויק');
  await page.uncheck('#rths-on');
  await page.waitForTimeout(250);
  check('תגית העיצוב הוסרה', await page.locator('#rt-header-style-rules').count(), 0);
  check('והגודל חזר למקור', await headerStyle(page, 0, 'font-size'), baseSize);

  console.log('\n[9] שמירה נשמרת בין פתיחות');
  await page.check('#rths-on');
  await page.fill('#rths-size', '15');
  await page.click('#rths-save');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#header-styles-btn');
  await page.waitForSelector('#rt-header-styles.is-open');
  check('ההגדרה חזרה', await page.inputValue('#rths-size'), '15');
  check('והיא פעילה', await page.isChecked('#rths-on'), true);

  console.log('\n[10] צילום ו-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('#rt-header-styles .rths-window').screenshot({ path: path.join(OUT_DIR, 'header-styles.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'header-styles.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('נסגר', await page.locator('#rt-header-styles.is-open').count(), 0);

  console.log('\n[11] אין שגיאות דף');
  check('אפס שגיאות', pageErrors, []);
} finally {
  await browser?.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), total: checks.length, failed: failed.length, checks, pageErrors }, null, 2));
console.log(`\n────────────\nעברו ${checks.length - failed.length} · נכשלו ${failed.length}\n`);
process.exit(failed.length ? 1 : 0);
