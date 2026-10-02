// בדיקת דפדפן אמיתית לחלון ההקראה.
// מריצים: node scripts/verify_tts_browser.mjs
// הספק מדומה בתוך הדף — אין רשת, אין מפתח אמיתי, ואין חיוב.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-chromium';

const root = process.cwd();
const OUT_DIR = path.join(root, 'test-results', 'tts');

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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(60000);

  await page.goto(`http://127.0.0.1:${server.address().port}/tests/tts/browser-fixture.html`);
  await page.waitForFunction(() => window.__fixtureReady === true);

  console.log('\n[1] הכלי נטען רק בלחיצה');
  check('החלון עוד לא קיים', await page.locator('#rt-tts-dialog').count(), 0);
  await page.click('[data-action="open-tts"]');
  await page.waitForSelector('#rt-tts-dialog.is-open');
  check('נפתח', await page.locator('#rt-tts-dialog.is-open').count(), 1);
  check('מימין לשמאל', await page.getAttribute('#rt-tts-dialog', 'dir'), 'rtl');
  check('חלון נגיש', await page.getAttribute('#rt-tts-dialog .rtts-window', 'role'), 'dialog');

  console.log('\n[2] רשימת המקורות נבנית מהמסמך');
  const options = await page.$$eval('#rtts-source option', (els) => els.map((e) => e.textContent.trim()));
  checkThat('יש את הטקסט הראשי', options.some((o) => o.includes('הראשי')), JSON.stringify(options));
  checkThat('יש את הזרם לפי שמו', options.some((o) => o.includes('ביאור')), JSON.stringify(options));
  checkThat('ויש כל המסמך', options.some((o) => o.includes('כל המסמך')), JSON.stringify(options));

  console.log('\n[3] ⭐ הקודים לא מוקראים — זה הלב של הכלי');
  const preview = await page.inputValue('#rtts-preview');
  checkThat('אין סימן זרם', !preview.includes('@01'), preview);
  checkThat('אין מספר בסוגריים', !preview.includes('[2]'), preview);
  checkThat('אין הערה מסולסלת', !preview.includes('{'), preview);
  checkThat('והטקסט עצמו נשאר', preview.includes('ויאמר') && preview.includes('ויצאתם'), preview);

  console.log('\n[4] אפשר לבחור שההערות כן יוקראו');
  await page.check('#rtts-keep-notes');
  const withNotes = await page.inputValue('#rtts-preview');
  checkThat('ההערה חזרה', withNotes.includes('הערה פנימית'), withNotes);
  checkThat('אבל סימן הזרם עדיין לא', !withNotes.includes('@01'), withNotes);
  await page.uncheck('#rtts-keep-notes');

  console.log('\n[5] נתוני הטקסט מוצגים למשתמש מראש');
  const stats = (await page.textContent('#rtts-stats'))?.trim() || '';
  checkThat('תווים, מנות וזמן', /תווים/.test(stats) && /(מנה אחת|מנות)/.test(stats) && /(שניות|דקה|דקות)/.test(stats), stats);
  checkThat('ובעברית תקינה — לא „1 מנות”', !/\b1 מנות/.test(stats), stats);

  console.log('\n[6] בלי מפתח — נאמר מראש שזה קול המחשב');
  const msg = (await page.textContent('#rtts-msg'))?.trim() || '';
  checkThat('ההודעה מסבירה', msg.includes('קול המחשב'), msg);
  check('הורדה חסומה', await page.isDisabled('#rtts-download'), true);

  console.log('\n[7] עם מפתח — נשלחת בקשה לספק ומתקבל קובץ');
  await page.fill('#rtts-key', 'sk-test-key');
  await page.click('#rtts-play');
  await page.waitForFunction(() => !document.getElementById('rtts-play').disabled, null, { timeout: 30000 });
  const log = await page.evaluate(() => window.__ttsFetchLog);
  checkThat('נשלחה לפחות בקשה אחת', log.length >= 1, JSON.stringify(log.length));
  checkThat('המפתח נשלח בכותרת', log.every((e) => e.hasKey), JSON.stringify(log));
  checkThat('לכתובת של הספק', log.every((e) => e.url.includes('elevenlabs.io')), JSON.stringify(log[0]?.url));
  check('כפתור ההורדה נפתח', await page.isDisabled('#rtts-download'), false);
  checkThat('נגן השמע מוצג', await page.locator('#rtts-audio').isVisible());

  console.log('\n[8] המפתח נשמר במקום שבו כלי התמלול כבר שומר אותו');
  const stored = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ravtext.torah_transcription.config') || '{}').elevenlabs_api_key; }
    catch { return null; }
  });
  check('נשמר', stored, 'sk-test-key');

  console.log('\n[9] תקלה אצל הספק — הודעה בעברית שאומרת מה לעשות');
  await page.evaluate(() => { window.__ttsNextStatus = 401; window.__ttsFetchLog = []; });
  await page.click('#rtts-play');
  await page.waitForFunction(() => document.getElementById('rtts-msg')?.classList.contains('is-warn'), null, { timeout: 30000 });
  const err = (await page.textContent('#rtts-msg'))?.trim() || '';
  checkThat('מסביר שהמפתח לא התקבל', err.includes('המפתח'), err);
  checkThat('בלי קוד שגיאה גולמי', !err.includes('401'), err);
  checkThat('ובלי לחשוף את המפתח', !err.includes('sk-test-key'), err);

  console.log('\n[10] צילום והקשה על Esc');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('#rt-tts-dialog .rtts-window').screenshot({ path: path.join(OUT_DIR, 'tts.png') });
  checkThat('הצילום נשמר', fs.existsSync(path.join(OUT_DIR, 'tts.png')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('נסגר', await page.locator('#rt-tts-dialog.is-open').count(), 0);

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
