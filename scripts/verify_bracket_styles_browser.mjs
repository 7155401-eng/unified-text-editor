// בדיקת דפדפן אמיתית למסך „עיצוב סוגריים".
// מריצים: node scripts/verify_bracket_styles_browser.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'bracket-styles');
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

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/bracket-styles/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] פתיחה');
  await page.click('#bracket-styles-btn');
  await page.waitForSelector('#rt-bracket-styles.is-open');
  check('מימין לשמאל', await page.getAttribute('#rt-bracket-styles', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-bracket-styles .rtbs-window', 'role'), 'dialog');

  console.log('\n[2] ארבעת הסוגים, כולם כבויים');
  check('ארבע קבוצות', await page.locator('#rt-bracket-styles fieldset').count(), 4);
  const on = await page.$$eval('#rt-bracket-styles fieldset input[type=checkbox]', (e) => e.filter((x) => x.checked).length);
  check('אפס מופעלים', on, 0);

  console.log('\n[3] ⭐ נספר כמה קטעים יש מכל סוג — לפני שנוגעים');
  const roundCount = await page.textContent('#rtbs-count-round');
  const curlyCount = await page.textContent('#rtbs-count-curly');
  checkThat('שתי עגולות', roundCount.includes('2 קטעים'), roundCount);
  checkThat('ומסולסלת אחת, בלשון יחיד', curlyCount.includes('קטע אחד'), curlyCount);

  console.log('\n[4] הפעלה — התצוגה המקדימה מעצבת');
  await page.check('#rtbs-round-on');
  await page.fill('#rtbs-round-size', '70');
  await page.waitForTimeout(200);
  const spans = await page.locator('#rtbs-preview span.rt-bracket-round').count();
  check('שני קטעים עוטפו', spans, 2);
  const style = await page.getAttribute('#rtbs-preview span.rt-bracket-round', 'style');
  checkThat('בגודל שנבחר', (style || '').includes('70%'), style);
  checkThat('והסוגריים נשארו', (await page.textContent('#rtbs-preview')).includes('(') , '');

  console.log('\n[5] סוג שלא הופעל אינו נגע');
  check('אין מרובעות', await page.locator('#rtbs-preview span.rt-bracket-square').count(), 0);

  console.log('\n[6] ⛔ הטקסט עצמו לא השתנה');
  check('המסמך זהה', await page.evaluate(() => window.paneManager.panes[0]._body.textContent),
    await page.evaluate(() => window.__original));

  console.log('\n[7] שמירה לכל חלונית בנפרד');
  await page.click('#rtbs-save');
  await page.waitForTimeout(150);
  checkThat('נשמר', ((await page.textContent('#rtbs-msg')) || '').includes('נשמר'), '');
  await page.selectOption('#rtbs-pane', { index: 1 });
  await page.waitForTimeout(200);
  check('בחלונית השנייה ההגדרה ריקה', await page.isChecked('#rtbs-round-on'), false);
  await page.selectOption('#rtbs-pane', { index: 0 });
  await page.waitForTimeout(200);
  check('ובראשונה היא חזרה', await page.isChecked('#rtbs-round-on'), true);
  check('וגם הגודל', await page.inputValue('#rtbs-round-size'), '70');

  console.log('\n[8] איפוס');
  await page.click('#rtbs-reset');
  await page.waitForTimeout(150);
  check('כובה', await page.isChecked('#rtbs-round-on'), false);

  console.log('\n[9] צילום ו-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.check('#rtbs-round-on');
  await page.waitForTimeout(200);
  await page.locator('#rt-bracket-styles .rtbs-window').screenshot({ path: path.join(OUT_DIR, 'bracket-styles.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'bracket-styles.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('נסגר', await page.locator('#rt-bracket-styles.is-open').count(), 0);

  console.log('\n[10] אין שגיאות דף');
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
