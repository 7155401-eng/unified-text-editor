import { chromium } from 'playwright-chromium';
import fs from 'fs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto('http://127.0.0.1:5202/', { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.argv[2]||20000));

await page.keyboard.press('Control+f');
await page.waitForTimeout(1500);
const res = await page.evaluate(async () => {
  const desc = (n) => {
    if (!n) return '?';
    if (n.nodeType === 3) return '#text';
    const el = n;
    return (el.nodeName || '?') + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  };
  const child = new Map();
  const attr = new Map();
  const moChild = new MutationObserver((list) => {
    for (const r of list) {
      const key = desc(r.target) + '  <<+' + [...r.addedNodes].map(desc).join(',') + ' -' + [...r.removedNodes].map(desc).join(',');
      child.set(key, (child.get(key) || 0) + 1);
    }
  });
  moChild.observe(document.body, { childList: true, subtree: true });
  const moAttr = new MutationObserver((list) => {
    for (const r of list) {
      const key = desc(r.target) + '  @' + r.attributeName;
      attr.set(key, (attr.get(key) || 0) + 1);
    }
  });
  moAttr.observe(document.body, { attributes: true, subtree: true });

  await new Promise((r) => setTimeout(r, 3000));
  moChild.disconnect();
  moAttr.disconnect();
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return { childTop: top(child), attrTop: top(attr),
    childTotal: [...child.values()].reduce((a, b) => a + b, 0),
    attrTotal: [...attr.values()].reduce((a, b) => a + b, 0) };
});

fs.writeFileSync('C:/Users/User/rt_work/findreplace/_probe/churn.json', JSON.stringify(res, null, 1), 'utf8');
console.log('child=' + res.childTotal + ' attr=' + res.attrTotal);
await browser.close();
