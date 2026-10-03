// בדיקת דפדפן אמיתית ל„תרגום לצד הטקסט".
// מריצים: node scripts/verify_parallel_translation_browser.mjs
//
// נתוני הבדיקה כוללים בכוונה **חוסר התאמה** — 3 פסקאות מקור מול 2 תרגום —
// כדי לוודא שהכלי אומר זאת ואינו מצמיד תרגום לפסקה הלא נכונה.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'parallel');

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
  const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/parallel/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] פתיחה');
  await page.click('#parallel-translation-btn');
  await page.waitForSelector('#rt-parallel.is-open');
  check('מימין לשמאל', await page.getAttribute('#rt-parallel', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-parallel .rtp-window', 'role'), 'dialog');

  console.log('\n[2] ההסבר שזה אינו הערת צד');
  const hint = (await page.textContent('#rt-parallel .rtp-hint')) || '';
  checkThat('מסביר את ההבדל', hint.includes('זורמות') && hint.includes('עמודה קבועה'), hint);
  checkThat('ומציין שמותר אחד בלבד', hint.includes('אחד בלבד'), hint);

  console.log('\n[3] ברירות המחדל של התוכנה הישנה');
  check('רוחב 30%', await page.inputValue('#rtp-width'), '30');
  check('מרווח 0.8 ס״מ', await page.inputValue('#rtp-gap'), '0.8');
  const gapPx = (await page.textContent('#rtp-gap-px')) || '';
  checkThat('וההמרה לפיקסלים מוצגת', gapPx.includes('30.24'), gapPx);

  console.log('\n[4] ⭐⭐ חוסר התאמה — נאמר ואינו מוסתר');
  const note = (await page.textContent('#rtp-note')) || '';
  checkThat('מזהיר', note.includes('⚠️'), note);
  checkThat('ואומר 3 מול 2', note.includes('3') && note.includes('2'), note);
  checkThat('ומצהיר שלא נוחש', note.includes('ולא נוחש'), note);
  checkThat('והתיבה צבועה כאזהרה',
    (await page.getAttribute('#rtp-note', 'class')).includes('is-warn'), '');

  console.log('\n[5] ⭐ הפסקה השלישית מופיעה — עם תרגום ריק, לא עם תרגום של אחר');
  const cells = await page.$$eval('#rtp-preview .rtp-src', (els) => els.map((e) => e.textContent.trim()));
  const trs = await page.$$eval('#rtp-preview .rtp-tr', (els) => els.map((e) => e.textContent.trim()));
  check('שלוש פסקאות מקור', cells.length, 3);
  check('ושלושה תאי תרגום', trs.length, 3);
  checkThat('השלישי ריק', trs[2] === '', JSON.stringify(trs));
  checkThat('והוא מסומן חזותית',
    await page.locator('#rtp-preview .rtp-tr.is-empty').count() === 1, '');

  console.log('\n[6] ⭐ פסקה והתרגום שלה מתחילים באותו גובה');
  const tops = await page.evaluate(() => {
    const s = document.querySelectorAll('#rtp-preview .rtp-src');
    const t = document.querySelectorAll('#rtp-preview .rtp-tr');
    return [0, 1].map((i) => [Math.round(s[i].getBoundingClientRect().top),
                              Math.round(t[i].getBoundingClientRect().top)]);
  });
  checkThat('זוג ראשון מיושר', Math.abs(tops[0][0] - tops[0][1]) <= 1, JSON.stringify(tops[0]));
  checkThat('וזוג שני מיושר', Math.abs(tops[1][0] - tops[1][1]) <= 1, JSON.stringify(tops[1]));

  console.log('\n[7] שינוי הצד הופך את העמודות');
  const beforeLeft = await page.evaluate(() =>
    document.querySelector('#rtp-preview .rtp-src').getBoundingClientRect().left);
  await page.selectOption('#rtp-position', 'right');
  await page.waitForTimeout(250);
  const afterLeft = await page.evaluate(() =>
    document.querySelector('#rtp-preview .rtp-src').getBoundingClientRect().left);
  checkThat('המקור זז', Math.abs(beforeLeft - afterLeft) > 20, `${beforeLeft} ⟵ ${afterLeft}`);
  await page.selectOption('#rtp-position', 'left');
  await page.waitForTimeout(200);

  console.log('\n[8] הרוחב באמת משתנה');
  const w30 = await page.evaluate(() => document.querySelector('#rtp-preview .rtp-tr').getBoundingClientRect().width);
  await page.fill('#rtp-width', '60');
  await page.waitForTimeout(250);
  const w60 = await page.evaluate(() => document.querySelector('#rtp-preview .rtp-tr').getBoundingClientRect().width);
  checkThat('60% רחב מ-30%', w60 > w30 * 1.5, `${Math.round(w30)} ⟵ ${Math.round(w60)}`);
  await page.fill('#rtp-width', '30');
  await page.waitForTimeout(200);

  console.log('\n[9] ⛔ המסמך לא נגע');
  const doc = await page.evaluate(() => window.paneManager.panes.map((p) => p._body.textContent));
  checkThat('המקור שלם', doc[0].includes('פסקה שלישית'), '');
  checkThat('והתרגום לא השתנה', doc[1].split('\n\n').length === 2, doc[1]);

  console.log('\n[10] שמירה והורדה');
  await page.click('#rtp-save');
  await page.waitForTimeout(200);
  checkThat('ההגדרות נשמרו', ((await page.textContent('#rtp-note')) || '').includes('נשמרו'), '');
  check('ההורדה פתוחה', await page.isDisabled('#rtp-download'), false);

  console.log('\n[11] צילום ו-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('#rt-parallel .rtp-window').screenshot({ path: path.join(OUT_DIR, 'parallel.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'parallel.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('נסגר', await page.locator('#rt-parallel.is-open').count(), 0);

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
