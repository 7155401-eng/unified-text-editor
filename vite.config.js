import { defineConfig } from 'vite'

// משה 2026-05-07: base relative ('./') כדי שיעבוד גם ב-Vercel (root) וגם
// ב-GitHub Pages (subpath). אין צורך במשתנה סביבה.
const BASE = process.env.VITE_BASE || './'

// משה 2026-05-13: cache-busting לקבצי public/ (CSS/JS תבניות). vite לא
// hash-ים אותם, ולכן דפדפנים שמשתמשים בגירסה ישנה רואים crash חלקי
// (חצי דף נסתר עד שמרעננים cache). הplugin הזה דוחף ?v=<timestamp> לכל
// תיוג <link>/<script> של theme/template ב-index.html בזמן בנייה,
// כך שדפדפן מקבל URL חדש בכל deploy ולא מגיש קובץ ישן מ-cache.
const PUBLIC_CACHE_BUST = {
  name: 'public-css-cache-bust',
  enforce: 'post',
  transformIndexHtml(html) {
    const v = String(Date.now());
    return html.replace(
      /(href|src)="(\.\/)?(theme-base-refresh\.css|template-word-style\.css|template-judaica\.css|template-picker\.css|template-picker\.js|bridge_shim\.js)"/g,
      (m, attr, prefix, file) => `${attr}="${prefix || ''}${file}?v=${v}"`
    );
  },
};

export default defineConfig({
  base: BASE,
  plugins: [PUBLIC_CACHE_BUST],
})
