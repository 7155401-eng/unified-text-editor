import { chromium } from 'playwright-chromium';
import fs from 'fs';
import path from 'path';

const root = path.resolve('.');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js  = fs.readFileSync(path.join(root, 'src/auth_ui.js'), 'utf8');

const html = (auth) => `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <style>${css}</style>
  <style>
    body { margin: 0; font-family: 'Heebo', system-ui, sans-serif; background: #EEF2F8; color: #1f2937; }
    /* fallback vars for the avatar focus ring etc. */
    :root { --panel: #fff; --gold: #b8860b; --bright-gold: #d4af37; --border: #c8d4e3; --muted: #5e6a7d; --word-blue: #2B579A; }
  </style>
</head>
<body class="light-theme">
  <header class="app-header">
    <div class="app-header-row">
      <h1>רב טקסט לוורד AI</h1>
      <div class="app-header-actions">
        <button class="header-action-btn">דיווח באג</button>
        <a class="header-action-btn header-action-btn-phone" href="tel:0527155401">052-7155401</a>
        <a class="header-action-btn" href="mailto:x@x">צור קשר</a>
      </div>
    </div>
  </header>
  <main style="padding:20px; min-height:60vh;"></main>
  <script>window.__RAVTEXT_AUTH__ = ${JSON.stringify(auth)};</script>
  <script type="module">
${js}
    installAuthUi();
  </script>
</body></html>`;

const browser = await chromium.launch();
for (const v of [{w:1280,h:600,tag:'desktop'}, {w:390,h:600,tag:'mobile'}]) {
  for (const auth of [
    { loggedIn:false, paid:false, email:null, admin:false, label:'guest' },
    { loggedIn:true,  paid:true,  email:'7155401@gmail.com', admin:true,  label:'paid' },
    { loggedIn:true,  paid:false, email:'7155401@gmail.com', admin:false, label:'demo' },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.setContent(html(auth), { waitUntil: 'networkidle' });
    // closed
    await page.screenshot({ path: `test-harness/auth_${auth.label}_${v.tag}_closed.png`, fullPage: false });
    // open
    await page.click('#profile-avatar-btn');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `test-harness/auth_${auth.label}_${v.tag}_open.png`, fullPage: false });
    // also capture position metrics so we can see if the menu overflows
    const m = await page.evaluate(() => {
      const menu = document.getElementById('profile-avatar-menu');
      const r = menu.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth };
    });
    console.log('OK', auth.label, v.tag, 'menu rect=', JSON.stringify(m));
    await ctx.close();
  }
}
await browser.close();
