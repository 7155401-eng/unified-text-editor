// בדיקת דפדפן אמיתית למכוון העמודים.
//
// מריצים: node scripts/verify_page_tweaker_browser.mjs
// מרים שרת מקומי, פותח Chromium אמיתי, לוחץ על הכפתורים כמו משה, ובודק שמה
// שקרה על המסך תואם למה שנרשם במודל. בסוף נשמר צילום מסך כהוכחה.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'page-tweaker');

const server = http.createServer((req, res) => {
  const name = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!name.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(name, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    const type = name.endsWith('.js') || name.endsWith('.mjs')
      ? 'text/javascript; charset=utf-8'
      : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8';
    res.setHeader('Content-Type', type);
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const checks = [];
const pageErrors = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, actual, expected });
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name}\n      צפוי: ${JSON.stringify(expected)}\n      קיבלנו: ${JSON.stringify(actual)}`);
}
function checkThat(name, condition, detail = '') {
  checks.push({ name, ok: !!condition, actual: detail });
  console.log(condition ? `  ✓ ${name}` : `  ✗ ${name}${detail ? `  (${detail})` : ''}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/page-tweaker/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] הכפתור נתלה בסרגל האבחון');
  await page.waitForSelector('#page-tweaker-btn');
  check('הכפתור קיים', await page.locator('#page-tweaker-btn').count(), 1);
  check('הכיתוב בעברית', (await page.locator('#page-tweaker-btn').textContent())?.trim(), 'מכוון עמודים');
  check('החלון עדיין סגור', await page.locator('#rt-page-tweaker.is-open').count(), 0);

  console.log('\n[2] לחיצה פותחת את החלון');
  await page.click('#page-tweaker-btn');
  await page.waitForSelector('#rt-page-tweaker.is-open');
  check('החלון פתוח', await page.locator('#rt-page-tweaker.is-open').count(), 1);
  check('הכיוון מימין לשמאל', await page.getAttribute('#rt-page-tweaker', 'dir'), 'rtl');
  check('זה חלון נגיש', await page.getAttribute('#rt-page-tweaker .rtpt-window', 'role'), 'dialog');

  console.log('\n[3] הטבלה מציגה את שלושת העמודים');
  await page.waitForFunction(() => document.querySelectorAll('#rtpt-tbody tr[data-page]').length === 3);
  check('שלוש שורות', await page.locator('#rtpt-tbody tr[data-page]').count(), 3);
  check('העמוד הראשון נבחר כברירת מחדל', await page.locator('#rtpt-tbody tr.is-sel').getAttribute('data-page'), '1');

  console.log('\n[4] המדידה האמיתית רצה ומצאה את העמוד החצי-ריק');
  // העמוד השני נבנה עם 4 שורות מול 14, ולכן הרווח התחתון שלו גדול.
  const gaps = await page.$$eval('#rtpt-tbody tr[data-page]', (rows) =>
    rows.map((r) => ({ page: r.dataset.page, gap: r.children[2].textContent.trim() })));
  checkThat('לכל עמוד נמדד רווח תחתון', gaps.every((g) => g.gap !== '—'), JSON.stringify(gaps));
  const gap2 = Number(gaps.find((g) => g.page === '2')?.gap);
  const gap1 = Number(gaps.find((g) => g.page === '1')?.gap);
  checkThat('הרווח בעמוד 2 גדול מזה שבעמוד 1', gap2 > gap1, `עמ' 1 = ${gap1} · עמ' 2 = ${gap2}`);
  checkThat('עמוד 2 סומן באדום כבעייתי',
    await page.locator('#rtpt-tbody tr[data-page="2"] td.is-bad').count() > 0);

  console.log('\n[5] סינון „רק עמודים בעייתיים”');
  await page.check('#rtpt-only-problems');
  const filtered = await page.$$eval('#rtpt-tbody tr[data-page]', (rows) => rows.map((r) => r.dataset.page));
  checkThat('רק העמוד הבעייתי נשאר', filtered.includes('2') && !filtered.includes('1'), JSON.stringify(filtered));
  await page.uncheck('#rtpt-only-problems');
  check('בלי סינון חוזרים שלושה', await page.locator('#rtpt-tbody tr[data-page]').count(), 3);

  console.log('\n[6] בחירת עמוד גוללת אליו ומסמנת אותו על המסך');
  await page.click('#rtpt-tbody tr[data-page="3"]');
  check('השורה מסומנת', await page.locator('#rtpt-tbody tr.is-sel').getAttribute('data-page'), '3');
  check('העמוד השלישי מודגש במסך', await page.locator('#pages .page:nth-child(3).rt-tweaker-target').count(), 1);
  check('ואף עמוד אחר לא', await page.locator('#pages .rt-tweaker-target').count(), 1);

  console.log('\n[7] הורדת שורה — המסך מתעדכן מיד והמודל אחרי ההשהיה');
  await page.click('#rtpt-tbody tr[data-page="2"]');
  await page.click('#rtpt-panel button[data-act="lines-dec"]');
  check('המסך מראה מינוס 1 מיד', (await page.locator('#rtpt-lines-val').textContent())?.trim(), '-1');
  const beforeCommit = await page.evaluate(() => window.paneManager.getPageTweak(2).linesDiff);
  check('המודל עדיין לא עודכן', beforeCommit, 0);
  await page.waitForFunction(() => window.paneManager.getPageTweak(2).linesDiff === -1, null, { timeout: 5000 });
  check('אחרי ההשהיה המודל עודכן', await page.evaluate(() => window.paneManager.getPageTweak(2).linesDiff), -1);

  console.log('\n[8] עשר לחיצות רצופות = רינדור אחד');
  const rendersBefore = await page.evaluate(() => window.paneManager.renderCount);
  for (let i = 0; i < 10; i += 1) await page.click('#rtpt-panel button[data-act="lines-inc"]');
  check('המסך מראה את הסכום המיידי', (await page.locator('#rtpt-lines-val').textContent())?.trim(), '+9');
  await page.waitForFunction(() => window.paneManager.getPageTweak(2).linesDiff === 9, null, { timeout: 5000 });
  const rendersAfter = await page.evaluate(() => window.paneManager.renderCount);
  check('נוסף רינדור אחד בלבד', rendersAfter - rendersBefore, 1);

  console.log('\n[9] הזזת זרמי הערות — לכל זרם בנפרד, לפי השם שלו');
  const streamRows = await page.$$eval('#rtpt-panel .rtpt-name', (els) => els.map((e) => e.textContent.trim()));
  checkThat('הזרמים מוצגים בשמם', streamRows.some((t) => t.includes('ביאור')) && streamRows.some((t) => t.includes('פשר דבר')),
    JSON.stringify(streamRows));
  await page.click('#rtpt-panel button[data-act="shift-inc"][data-code="01"]');
  await page.click('#rtpt-panel button[data-act="shift-inc"][data-code="01"]');
  await page.waitForFunction(() => window.paneManager.getPageTweak(2).footnoteShift['01'] === 2, null, { timeout: 5000 });
  check('זרם 01 קיבל 2', await page.evaluate(() => window.paneManager.getPageTweak(2).footnoteShift), { '01': 2 });
  check('זרם 02 לא נגעו בו', await page.evaluate(() => window.paneManager.getPageTweak(2).footnoteShift['02'] ?? null), null);

  console.log('\n[10] הזזה שלילית נעצרת באפס ואינה יורדת מתחתיו');
  for (let i = 0; i < 5; i += 1) await page.click('#rtpt-panel button[data-act="shift-dec"][data-code="01"]');
  await page.waitForTimeout(600);
  check('נעצר באפס', await page.evaluate(() => window.paneManager.getPageTweak(2).footnoteShift['01'] ?? 0), 0);

  console.log('\n[11] אישור עמוד');
  await page.click('#rtpt-panel button[data-act="approve"]');
  check('הסטטוס מאושר', await page.evaluate(() => window.paneManager.getPageTweak(2).status), 'approved');
  checkThat('התג מופיע בטבלה',
    await page.locator('#rtpt-tbody tr[data-page="2"] .rtpt-badge.s-approved').count() === 1);
  check('המדידה נשמרה כבסיס',
    await page.evaluate(() => window.paneManager.getPageTweak(2).spaceLines !== null), true);

  console.log('\n[12] עריכה אחרי אישור מחזירה לסימון „שונה”');
  await page.click('#rtpt-panel button[data-act="lines-dec"]');
  await page.waitForFunction(() => window.paneManager.getPageTweak(2).status === 'changed', null, { timeout: 5000 });
  check('הסטטוס שונה', await page.evaluate(() => window.paneManager.getPageTweak(2).status), 'changed');
  checkThat('והתג התחלף',
    await page.locator('#rtpt-tbody tr[data-page="2"] .rtpt-badge.s-changed').count() === 1);

  console.log('\n[13] קיצורי מקלדת');
  await page.click('#rtpt-tbody tr[data-page="1"]');
  await page.keyboard.press('ArrowLeft');
  check('חץ שמאלה מקדם עמוד', await page.locator('#rtpt-tbody tr.is-sel').getAttribute('data-page'), '2');
  await page.keyboard.press('ArrowRight');
  check('חץ ימינה חוזר', await page.locator('#rtpt-tbody tr.is-sel').getAttribute('data-page'), '1');

  console.log('\n[14] הערה חופשית נשמרת ביציאה מהשדה, לא על כל אות');
  await page.fill('#rtpt-notes', 'בדקתי, הכתר כאן בכוונה');
  const notesBefore = await page.evaluate(() => window.paneManager.getPageTweak(1).notes);
  check('בזמן ההקלדה לא נשמר', notesBefore, '');
  await page.locator('#rtpt-notes').blur();
  await page.waitForFunction(() => window.paneManager.getPageTweak(1).notes.length > 0, null, { timeout: 5000 });
  check('אחרי יציאה מהשדה נשמר',
    await page.evaluate(() => window.paneManager.getPageTweak(1).notes), 'בדקתי, הכתר כאן בכוונה');

  console.log('\n[15] ניקוי עמוד בודד מוחק אותו מהרשימה באמת');
  await page.click('#rtpt-tbody tr[data-page="1"]');
  await page.click('#rtpt-panel button[data-act="reset-page"]');
  await page.waitForTimeout(200);
  check('העמוד נעלם ממצב המסמך',
    await page.evaluate(() => Object.keys(window.paneManager.getPageTweaks().pages).includes('1')), false);

  console.log('\n[16] צילום מסך כהוכחה, ואז סגירה ב-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('#rt-page-tweaker .rtpt-window').screenshot({ path: path.join(OUT_DIR, 'page-tweaker.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'page-tweaker.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check('החלון נסגר', await page.locator('#rt-page-tweaker.is-open').count(), 0);
  check('הסימון על העמוד הוסר', await page.locator('#pages .rt-tweaker-target').count(), 0);

  console.log('\n[17] אין שגיאות דף');
  check('אפס שגיאות', pageErrors, []);
} finally {
  await browser?.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), total: checks.length, failed: failed.length, checks, pageErrors }, null, 2));

console.log(`\n────────────\nעברו ${checks.length - failed.length} · נכשלו ${failed.length}`);
console.log(`ראיות: test-results/page-tweaker/\n`);
process.exit(failed.length ? 1 : 0);
