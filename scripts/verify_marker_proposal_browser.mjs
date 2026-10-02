// בדיקת דפדפן אמיתית למסך „הצעת קישורים".
// מריצים: node scripts/verify_marker_proposal_browser.mjs
//
// הבדיקה המרכזית: שהכלי **אינו נוגע במסמך**, ושכל הצעה שאינה ודאית מוצגת
// ככזו — עם סיבה — ולא מוסווית כהתאמה.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'link-tools');

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

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/link-tools/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] הכפתור והחלון');
  await page.waitForSelector('#marker-proposal-btn');
  check('הכיתוב בעברית', (await page.textContent('#marker-proposal-btn'))?.trim(), 'הצעת קישורים');
  check('החלון עוד לא נטען', await page.locator('#rt-marker-proposal').count(), 0);
  await page.click('#marker-proposal-btn');
  await page.waitForSelector('#rt-marker-proposal.is-open');
  check('מימין לשמאל', await page.getAttribute('#rt-marker-proposal', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-marker-proposal .rtmp-window', 'role'), 'dialog');

  console.log('\n[2] ⛔ האזהרה שהכלי אינו משנה דבר מוצגת מיד');
  const warn = (await page.textContent('#rt-marker-proposal .rtmp-warn'))?.trim() || '';
  checkThat('כתוב שאינו משנה את המסמך', warn.includes('אינו משנה את המסמך'), warn);
  checkThat('וכתוב ששום אות לא זזה', warn.includes('אינה זזה'), warn);

  console.log('\n[3] ההצעה רצה לבד על הזרם הראשון');
  await page.waitForFunction(() => document.querySelectorAll('#rtmp-tbody tr').length >= 3);
  check('שלוש הערות', await page.locator('#rtmp-tbody tr').count(), 3);

  console.log('\n[4] ⭐ כל מצב מוצג כמו שהוא — בלי להסוות אי-ודאות');
  const rows = await page.$$eval('#rtmp-tbody tr', (trs) => trs.map((tr) => ({
    phrase: tr.children[1]?.textContent.trim(),
    state: tr.children[2]?.textContent.trim(),
    why: tr.children[4]?.textContent.trim(),
  })));
  checkThat('הערה 1 סומנה שיש יותר ממקום אחד', rows[0].state.includes('יותר ממקום אחד'), JSON.stringify(rows[0]));
  checkThat('הערה 2 ברורה', rows[1].state.includes('ברור'), JSON.stringify(rows[1]));
  checkThat('הערה 3 סומנה שלא נמצאה', rows[2].state.includes('לא נמצא'), JSON.stringify(rows[2]));
  checkThat('ולכל אחת יש סיבה כתובה', rows.every((r) => r.why && r.why.length > 5), JSON.stringify(rows.map((r) => r.why)));

  console.log('\n[5] ⭐ ההקשר מוצג מהטקסט האמיתי, עם הדגשה');
  const marks = await page.locator('#rtmp-tbody mark').count();
  checkThat('יש לפחות הדגשה אחת', marks >= 1, String(marks));
  const firstCtx = await page.locator('#rtmp-tbody tr:first-child .rtmp-ctx').first().textContent();
  checkThat('ההקשר מכיל את הדיבור המתחיל', firstCtx.includes('אשר יצאתם'), firstCtx);

  console.log('\n[6] הסיכום מספרי וכן');
  const sum = (await page.textContent('#rtmp-sum'))?.trim() || '';
  checkThat('מופיע מספר ההערות', sum.includes('3 הערות'), sum);
  checkThat('ומופיע כמה לא נמצאו', /לא נמצאו/.test(sum), sum);

  console.log('\n[7] ⛔ ההוכחה החשובה: המסמך לא נגוע');
  const docAfter = await page.evaluate(() => ({
    main: window.paneManager.panes[0]._body.textContent,
    stream: window.paneManager.panes[1]._body.textContent,
  }));
  checkThat('הטקסט הראשי זהה בדיוק', docAfter.main.includes('ויאמר משה אל העם זכור את היום הזה'), '');
  checkThat('ואין בו סמן חדש', (docAfter.main.match(/@\d/gu) || []).length === 0, docAfter.main.slice(0, 60));
  checkThat('חלונית הזרם זהה', (docAfter.stream.match(/@01/gu) || []).length === 3, docAfter.stream.slice(0, 60));

  console.log('\n[8] צילום ו-Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('#rt-marker-proposal .rtmp-window').screenshot({ path: path.join(OUT_DIR, 'marker-proposal.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'marker-proposal.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('נסגר', await page.locator('#rt-marker-proposal.is-open').count(), 0);

  console.log('\n[9] אין שגיאות דף');
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
