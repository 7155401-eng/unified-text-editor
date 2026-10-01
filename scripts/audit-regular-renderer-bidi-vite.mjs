import { chromium } from 'playwright-chromium';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
});
await server.listen();

const addr = server.httpServer.address();
const port = typeof addr === 'object' && addr ? addr.port : 5173;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`http://127.0.0.1:${port}/tests/v9-unified/browser-fixture.html`);

  const result = await page.evaluate(async () => {
    const { renderPages } = await import('/src/engine/renderer.js');
    window.__FORCE_SYNC_RENDER__ = true;

    const samples = [
      {text:"אב'(גד)",runs:[]},
      {text:"אב')גד(",runs:[]},
      {text:"אב' (גד)",runs:[]},
      {text:"אב'123(גד)",runs:[]},
      {text:"אב'(גד)",runs:[
        {start:2,end:3,marks:{color:'rgb(1, 2, 3)'}},
        {start:3,end:4,marks:{color:'rgb(4, 5, 6)'}},
      ]},
      {text:"('אב')",runs:[
        {start:0,end:1,marks:{color:'rgb(1, 2, 3)'}},
        {start:1,end:2,marks:{color:'rgb(4, 5, 6)'}},
        {start:4,end:5,marks:{color:'rgb(7, 8, 9)'}},
      ]},
    ];

    const chars = (root) => {
      const rect = root.getBoundingClientRect();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const out = [];
      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue || '';
        for (let i = 0; i < value.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          out.push({
            ch: value[i],
            left: r.left - rect.left,
            right: r.right - rect.left,
          });
        }
      }
      return out;
    };

    const failures = [];
    for (const sample of samples) {
      const host = document.createElement('div');
      const native = document.createElement('span');
      host.style.cssText = 'position:absolute;left:0;top:0;width:240px;font:24px serif;';
      native.style.cssText = 'position:absolute;left:300px;top:0;display:inline-block;white-space:pre;direction:rtl;font:24px serif;';
      document.body.append(host, native);

      renderPages([{
        main: [[0, sample.text, 0, sample.text.length, { mainRuns: sample.runs }]],
        streams: {}
      }], host);

      const regular = host.querySelector('.page-main p,.page-main div,.page-main blockquote,.page-main pre');
      if (!regular) {
        failures.push({sample:sample.text,reason:'missing regular paragraph'});
        host.remove(); native.remove();
        continue;
      }

      regular.style.font = '24px serif';
      regular.style.direction = 'rtl';
      regular.style.whiteSpace = 'pre';
      native.textContent = sample.text;

      const a = chars(regular);
      const b = chars(native);
      if (a.length !== b.length) {
        failures.push({sample:sample.text,reason:'char-count',regular:a,native:b});
      } else {
        const normalize = (items) => {
          const min = Math.min(...items.map(x => x.left));
          return items.map(x => ({...x,left:x.left-min,right:x.right-min}));
        };
        const an = normalize(a);
        const bn = normalize(b);
        for (let i = 0; i < an.length; i++) {
          if (an[i].ch !== bn[i].ch || Math.abs(an[i].left - bn[i].left) > 1.25 || Math.abs(an[i].right - bn[i].right) > 1.25) {
            failures.push({sample:sample.text,index:i,regular:an[i],native:bn[i]});
            break;
          }
        }
      }

      host.remove();
      native.remove();
    }

    return {ok: failures.length === 0, failures};
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
