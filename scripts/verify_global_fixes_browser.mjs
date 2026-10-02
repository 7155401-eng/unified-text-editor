// בדיקת דפדפן אמיתית ל„תיקונים גלובליים".
// מריצים: node scripts/verify_global_fixes_browser.mjs
//
// ⚠️ זה הכלי היחיד כאן ש**כן כותב למסמך**, ולכן הבדיקות המרכזיות הן:
// שכלום לא קורה בלי לחיצה מפורשת, ושהביטול מחזיר את הטקסט **תו בתו**.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'text-fixes');

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
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, actual, expected });
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name}\n      צפוי: ${JSON.stringify(expected)}\n      קיבלנו: ${JSON.stringify(actual)}`);
};
const checkThat = (name, cond, detail = '') => {
  checks.push({ name, ok: !!cond, actual: detail });
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? `  (${detail})` : ''}`);
};
const paneText = (page) => page.evaluate(() => window.paneManager.panes[0]._body.textContent);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/text-fixes/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] פתיחה');
  await page.click('#global-fixes-btn');
  await page.waitForSelector('#rt-global-fixes.is-open');
  check('מימין לשמאל', await page.getAttribute('#rt-global-fixes', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-global-fixes .rtgf-window', 'role'), 'dialog');

  console.log('\n[2] ⛔ ברירת המחדל — הכול כבוי, כמו בתוכנה הישנה');
  const boxes = await page.$$eval('#rt-global-fixes input[type=checkbox]', (els) => els.map((e) => e.checked));
  check('26 תיבות', boxes.length, 26);
  checkThat('כולן כבויות', boxes.every((b) => b === false), JSON.stringify(boxes.filter(Boolean).length));
  check('כפתור ההחלה חסום', await page.isDisabled('#rtgf-apply'), true);

  console.log('\n[3] בחירת תיקון — התצוגה המקדימה מתעדכנת, והמסמך לא');
  await page.check('#rtgf-no_space_before_comma');
  await page.waitForTimeout(150);
  const after = (await page.textContent('#rtgf-after')) || '';
  const before = (await page.textContent('#rtgf-before')) || '';
  checkThat('ב„לפני" יש רווח לפני הפסיק', before.includes('אמר ,'), before);
  checkThat('וב„אחרי" אין', after.includes('אמר,') && !after.includes('אמר ,'), after);
  check('⛔ והמסמך עצמו עוד לא נגע', await paneText(page), await page.evaluate(() => window.__original));

  console.log('\n[4] ⭐ תיקון שסומן ולא ישנה כלום — נאמר מראש');
  await page.check('#rtgf-strip_angle');
  await page.waitForTimeout(150);
  const noopLabel = await page.$eval('#rtgf-strip_angle', (el) => el.closest('label').className);
  checkThat('סומן כלא-משנה', noopLabel.includes('is-noop'), noopLabel);
  const noopText = await page.$eval('#rtgf-strip_angle', (el) => el.closest('label').textContent);
  checkThat('והכיתוב מסביר', noopText.includes('לא ישנה כאן כלום'), noopText.trim());

  console.log('\n[5] הסיכום מספרי');
  const msg = (await page.textContent('#rtgf-msg')) || '';
  checkThat('אומר כמה תיקונים שינו משהו', /(תיקון אחד ישנה|\d+ תיקונים ישנו)/.test(msg), msg);
  checkThat('ובעברית תקינה — לא „1 תיקונים”', !/1 תיקונים/.test(msg), msg);
  check('וכפתור ההחלה נפתח', await page.isDisabled('#rtgf-apply'), false);

  console.log('\n[6] ⭐ החלה — רק אחרי לחיצה מפורשת');
  const original = await page.evaluate(() => window.__original);
  await page.click('#rtgf-apply');
  await page.waitForTimeout(250);
  const applied = await paneText(page);
  checkThat('המסמך השתנה', applied !== original, applied);
  checkThat('הרווח לפני הפסיק נעלם', !applied.includes('אמר ,'), applied);
  checkThat('ושאר הטקסט נשמר', applied.includes('ר\' משה') && applied.includes('{הערה}'), applied);

  console.log('\n[7] ⭐⭐ ביטול מחזיר תו בתו');
  check('כפתור הביטול נפתח', await page.isDisabled('#rtgf-undo'), false);
  await page.click('#rtgf-undo');
  await page.waitForTimeout(250);
  check('הטקסט חזר בדיוק למקור', await paneText(page), original);
  check('וכפתור הביטול נחסם שוב', await page.isDisabled('#rtgf-undo'), true);

  console.log('\n[8] הבחירה נזכרת בין פתיחות');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#global-fixes-btn');
  await page.waitForSelector('#rt-global-fixes.is-open');
  check('התיקון שנבחר נשמר', await page.isChecked('#rtgf-no_space_before_comma'), true);

  console.log('\n[9] „נקה בחירה" מכבה הכול');
  await page.click('#rt-global-fixes [data-act="none"]');
  await page.waitForTimeout(150);
  const after2 = await page.$$eval('#rt-global-fixes input[type=checkbox]', (els) => els.filter((e) => e.checked).length);
  check('אפס מסומנות', after2, 0);
  check('וההחלה חסומה', await page.isDisabled('#rtgf-apply'), true);

  console.log('\n[10] ⭐ הכלל העברי עובד על טקסט אמיתי');
  await page.check('#rtgf-hebrew_geresh');
  await page.waitForTimeout(150);
  const heb = (await page.textContent('#rtgf-after')) || '';
  checkThat('ר\' הפך לגרש עברי', heb.includes('ר׳'), heb.slice(0, 40));

  console.log('\n[11] צילום ו-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('#rt-global-fixes .rtgf-window').screenshot({ path: path.join(OUT_DIR, 'global-fixes.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'global-fixes.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('נסגר', await page.locator('#rt-global-fixes.is-open').count(), 0);
  check('⛔ והמסמך נשאר כמו שהיה', await paneText(page), original);

  console.log('\n[12] אין שגיאות דף');
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
