// Browser check for the stream-links chooser. Prints ASCII only — never any
// document text.
import { chromium } from 'playwright-chromium';
import fs from 'fs';

const URL = 'http://127.0.0.1:5205/';
const out = [];
const check = (name, cond, detail = '') => out.push({ name, pass: !!cond, detail: String(detail).slice(0, 120) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(14000);

// --- 1. one button per stream pane header, none on the main pane ---
const btnInfo = await page.evaluate(() => {
  const btns = document.querySelectorAll('.pane-stream-links-btn');
  const streamPanes = (window.paneManager?.panes || []).filter((p) => p.streamCode).length;
  const onMain = Array.from(document.querySelectorAll('.pane.main-pane .pane-stream-links-btn')).length;
  const dup = Array.from(document.querySelectorAll('.pane-header'))
    .map((h) => h.querySelectorAll('.pane-stream-links-btn').length)
    .filter((n) => n > 1).length;
  return { buttons: btns.length, streamPanes, onMain, dup };
});
check('one button per stream pane', btnInfo.buttons === btnInfo.streamPanes && btnInfo.buttons > 0,
  `buttons=${btnInfo.buttons} streamPanes=${btnInfo.streamPanes}`);
check('no button on the main pane', btnInfo.onMain === 0, `onMain=${btnInfo.onMain}`);
check('no duplicated buttons', btnInfo.dup === 0, `headersWithMoreThanOne=${btnInfo.dup}`);

// --- 2. rename a pane, then open the chooser: it must show the NEW name ---
const renamed = await page.evaluate(() => {
  const panes = (window.paneManager?.panes || []).filter((p) => p.streamCode);
  const target = panes[1];                       // the stream we will tick
  const old = target.label;
  target.label = 'RENAMED-TEST-' + target.streamCode;
  return { code: target.streamCode, old, now: target.label, first: panes[0].streamCode };
});

await page.evaluate((code) => {
  const panes = (window.paneManager?.panes || []).filter((p) => p.streamCode);
  const first = panes[0];
  const btn = first.element.querySelector('.pane-stream-links-btn');
  btn.click();
}, renamed.code);
await page.waitForTimeout(400);

const opened = await page.evaluate((renamedCode) => {
  const p = document.getElementById('stream-links-popover');
  if (!p) return { present: false };
  const r = p.getBoundingClientRect();
  const rows = Array.from(p.querySelectorAll('input[type=checkbox]'));
  const labels = rows.map((c) => c.closest('label')?.textContent || '');
  const renamedRow = rows.find((c) => c.value === renamedCode);
  return {
    present: true,
    visible: p.style.display !== 'none' && r.width > 0,
    dir: p.dir,
    width: Math.round(r.width),
    height: Math.round(r.height),
    widerThanTall: r.width > r.height,
    boxes: rows.length,
    checkedCount: rows.filter((c) => c.checked).length,
    showsRenamed: labels.some((t) => t.indexOf('RENAMED-TEST-') !== -1),
    renamedRowFound: !!renamedRow,
    hasCloseButton: Array.from(p.querySelectorAll('button')).some((b) => b.textContent.indexOf('×') !== -1),
    groups: p.querySelectorAll('div[style*="grid-template-columns"]').length,
  };
}, renamed.code);

check('chooser opens', opened.present && opened.visible, JSON.stringify(opened));
check('chooser is RTL', opened.dir === 'rtl', `dir=${opened.dir}`);
check('chooser is 460 wide', opened.width === 460, `w=${opened.width}`);
check('chooser is wider than tall', opened.widerThanTall === true, `${opened.width}x${opened.height}`);
check('chooser has a close button', opened.hasCloseButton === true);
check('chooser uses two side-by-side groups', opened.groups === 1, `grids=${opened.groups}`);
check('lists the other streams', opened.boxes === btnInfo.streamPanes - 1, `boxes=${opened.boxes}`);
check('default state: nothing ticked', opened.checkedCount === 0, `checked=${opened.checkedCount}`);
check('list uses the LIVE pane label', opened.showsRenamed === true, `renamedRowFound=${opened.renamedRowFound}`);

// --- 3. tick a parent -> persisted immediately ---
const ticked = await page.evaluate((renamedCode) => {
  const p = document.getElementById('stream-links-popover');
  const box = Array.from(p.querySelectorAll('input[type=checkbox]')).find((c) => c.value === renamedCode);
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return localStorage.getItem('ravtext.streamLinks.v1');
}, renamed.code);
// renamed.first = the pane whose chooser is open = the CHILD.
// renamed.code  = the pane we ticked          = the PARENT it may hang from.
check('ticking persists immediately', ticked === JSON.stringify({ [renamed.first]: [renamed.code] }),
  `stored=${ticked}`);

// --- 4. Escape closes ---
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEsc = await page.evaluate(() => {
  const p = document.getElementById('stream-links-popover');
  return p ? p.style.display : 'missing';
});
check('Escape closes the chooser', afterEsc === 'none', `display=${afterEsc}`);

// --- 5. reopen -> shows the current state ---
await page.evaluate(() => {
  const first = (window.paneManager?.panes || []).filter((p) => p.streamCode)[0];
  first.element.querySelector('.pane-stream-links-btn').click();
});
await page.waitForTimeout(400);
const reopened = await page.evaluate((renamedCode) => {
  const p = document.getElementById('stream-links-popover');
  const rows = Array.from(p.querySelectorAll('input[type=checkbox]'));
  const box = rows.find((c) => c.value === renamedCode);
  return { checked: !!box?.checked, checkedCount: rows.filter((c) => c.checked).length };
}, renamed.code);
check('reopening shows the saved tick', reopened.checked === true && reopened.checkedCount === 1,
  JSON.stringify(reopened));

// --- 6. click outside closes ---
// Pick a point that is provably outside the panel's own rectangle, otherwise
// we would be clicking INSIDE it and it is right to stay open.
const spot = await page.evaluate(() => {
  const r = document.getElementById('stream-links-popover').getBoundingClientRect();
  const y = r.top > 120 ? Math.round(r.top / 2) : Math.round(Math.min(window.innerHeight - 10, r.bottom + 40));
  const x = r.left > 120 ? Math.round(r.left / 2) : Math.round(Math.min(window.innerWidth - 10, r.right + 60));
  return { x, y, panel: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] };
});
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(300);
const afterOutside = await page.evaluate(() => document.getElementById('stream-links-popover')?.style.display);
check('a click outside closes it', afterOutside === 'none', `display=${afterOutside} clickedAt=${spot.x},${spot.y} panel=${spot.panel.join('/')}`);

// --- 7. RELOAD: the choice survives and the chooser shows it ---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(14000);
const survived = await page.evaluate(() => localStorage.getItem('ravtext.streamLinks.v1'));
check('choice survives a reload (storage)', survived === ticked, `after=${survived}`);

await page.evaluate(() => {
  const first = (window.paneManager?.panes || []).filter((p) => p.streamCode)[0];
  first.element.querySelector('.pane-stream-links-btn').click();
});
await page.waitForTimeout(400);
const afterReload = await page.evaluate((renamedCode) => {
  const p = document.getElementById('stream-links-popover');
  if (!p) return { present: false };
  const rows = Array.from(p.querySelectorAll('input[type=checkbox]'));
  const box = rows.find((c) => c.value === renamedCode);
  return { present: true, checked: !!box?.checked, checkedCount: rows.filter((c) => c.checked).length };
}, renamed.code);
check('chooser still shows the tick after reload', afterReload.present && afterReload.checked === true
  && afterReload.checkedCount === 1, JSON.stringify(afterReload));

// --- 8. engine agrees: canNestInside is live for the linked pair only ---
const engineRule = await page.evaluate(async ({ child, parent }) => {
  const m = await import('/src/stream_links.js');
  const panes = (window.paneManager?.panes || []).filter((p) => p.streamCode).map((p) => p.streamCode);
  const third = panes.find((c) => c !== child && c !== parent);
  return {
    linked: m.canNestInside(child, parent),
    reversed: m.canNestInside(parent, child),
    unrelated: third ? m.canNestInside(child, third) : false,
    sig: m.streamLinksSignature(),
  };
}, { child: renamed.first, parent: renamed.code });
check('engine: linked pair allowed', engineRule.linked === true);
check('engine: reverse direction still blocked', engineRule.reversed === false);
check('engine: unrelated parent still blocked', engineRule.unrelated === false);
check('engine: cache signature reflects the link', engineRule.sig === `${renamed.first}>${renamed.code}`, engineRule.sig);

// --- 9. untick -> back to main only, key removed ---
await page.evaluate((renamedCode) => {
  const p = document.getElementById('stream-links-popover');
  const box = Array.from(p.querySelectorAll('input[type=checkbox]')).find((c) => c.value === renamedCode);
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}, renamed.code);
await page.waitForTimeout(200);
const cleared = await page.evaluate(() => localStorage.getItem('ravtext.streamLinks.v1'));
check('unticking returns to main-only', cleared === null, `stored=${cleared}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(200);

const passed = out.filter((r) => r.pass).length;
fs.writeFileSync('_probe_stream_links.json', JSON.stringify({ out, errs, renamedCode: renamed.code, parentCode: renamed.first }, null, 1), 'utf8');
for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  <- ' + r.detail}`);
console.log(`\n${passed}/${out.length} browser checks passed   pageErrors=${errs.length}`);
await browser.close();
process.exit(passed === out.length ? 0 : 1);
