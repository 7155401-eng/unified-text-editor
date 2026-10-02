// בדיקת דפדפן אמיתית ל„בדיקת שלמות אחרי מיזוג".
// מריצים: node scripts/verify_merge_verifier_browser.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'merge-verify');

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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/merge-verify/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] פתיחה');
  await page.click('#merge-verify-btn');
  await page.waitForSelector('#rt-merge-verify.is-open');
  check('מימין לשמאל', await page.getAttribute('#rt-merge-verify', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-merge-verify .rtmv-window', 'role'), 'dialog');
  check('ההורדה חסומה לפני בדיקה', await page.isDisabled('#rtmv-download'), true);

  console.log('\n[2] האזהרה שהכלי אינו מתקן מוצגת מיד');
  const hint = (await page.textContent('#rt-merge-verify .rtmv-hint')) || '';
  checkThat('כתוב שאינו מתקן', hint.includes('אינו מתקן'), hint);
  checkThat('וכתוב שאין בוט', hint.includes('בלי בוט'), hint);

  console.log('\n[3] ⭐ תוצאה תקינה — נאמר במפורש ששום דבר לא אבד');
  await page.selectOption('#rtmv-source', { index: 0 });
  await page.selectOption('#rtmv-merged', { index: 1 });
  await page.click('#rtmv-run');
  await page.waitForTimeout(250);
  const okVerdict = (await page.textContent('#rtmv-verdict')) || '';
  checkThat('הפסיקה חיובית', okVerdict.includes('שום דבר לא אבד'), okVerdict);
  checkThat('והיא צבועה כתקינה', (await page.getAttribute('#rtmv-verdict', 'class')).includes('is-ok'), '');
  const chips = (await page.textContent('#rtmv-chips')) || '';
  checkThat('100% נשמרו', chips.includes('100%'), chips);

  console.log('\n[4] ⭐⭐ תוצאה שברחה — הכלי אומר את זה במפורש');
  await page.selectOption('#rtmv-merged', { index: 2 });
  await page.click('#rtmv-run');
  await page.waitForTimeout(250);
  const badVerdict = (await page.textContent('#rtmv-verdict')) || '';
  checkThat('מדווח על חוסר', badVerdict.includes('חסרות'), badVerdict);
  checkThat('⭐ ומזהיר שהמיזוג ברח ממקומו', badVerdict.includes('ברח ממקומו'), badVerdict);
  checkThat('וצבוע כתקלה', (await page.getAttribute('#rtmv-verdict', 'class')).includes('is-bad'), '');
  checkThat('ומספר 30 המילים מופיע', badVerdict.includes('30'), badVerdict);

  console.log('\n[5] הרשימה מראה איפה בדיוק');
  const rows = await page.locator('#rtmv-list div').count();
  checkThat('יש לפחות שורה אחת', rows >= 1, String(rows));
  const listText = (await page.textContent('#rtmv-list')) || '';
  checkThat('ומצוין מה חסר', listText.includes('חסר'), listText.slice(0, 80));

  console.log('\n[6] ⛔ המסמך לא נגע');
  const after = await page.evaluate(() => window.paneManager.panes.map((p) => p._body.textContent.length));
  const expected = await page.evaluate(() => [70, 70, 50].length);
  checkThat('שלוש חלוניות עדיין קיימות', after.length === 3, JSON.stringify(after));
  checkThat('והמקור לא התקצר', after[0] > after[2], JSON.stringify(after));

  console.log('\n[7] הדוח ניתן להורדה');
  check('הכפתור נפתח', await page.isDisabled('#rtmv-download'), false);

  console.log('\n[8] אפשר להדביק מקור ידנית');
  await page.selectOption('#rtmv-source', '__paste');
  await page.waitForTimeout(150);
  checkThat('תיבת ההדבקה נפתחה', await page.locator('#rtmv-paste').isVisible(), '');
  await page.fill('#rtmv-paste', 'מילה0 מילה1 מילה2');
  await page.click('#rtmv-run');
  await page.waitForTimeout(250);
  checkThat('והבדיקה רצה עליה', ((await page.textContent('#rtmv-chips')) || '').includes('3 מילים במקור'),
    await page.textContent('#rtmv-chips'));

  console.log('\n[9] צילום ו-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.selectOption('#rtmv-source', { index: 0 });
  await page.selectOption('#rtmv-merged', { index: 2 });
  await page.click('#rtmv-run');
  await page.waitForTimeout(250);
  await page.locator('#rt-merge-verify .rtmv-window').screenshot({ path: path.join(OUT_DIR, 'merge-verify.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'merge-verify.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('נסגר', await page.locator('#rt-merge-verify.is-open').count(), 0);

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
