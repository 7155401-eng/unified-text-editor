import { defineConfig } from 'vite'

// משה 2026-05-07: base relative ('./') כדי שיעבוד גם ב-Vercel (root) וגם
// ב-GitHub Pages (subpath). אין צורך במשתנה סביבה.
const BASE = process.env.VITE_BASE || './'

// משה 2026-05-14: cache-busting גם ל-styles.css וגם לקבצי public שנקראים
// עם slash בתחילת הנתיב. זה מונע מצב שבו הדפדפן/Cloudflare ממשיכים להגיש
// CSS ישן וגורמים לבאג "חצי מסך נעלם" אחרי תיקון שכבר מוזג ל-main.
const PUBLIC_CACHE_BUST_FILES = [
  'styles.css',
  'theme-base-refresh.css',
  'template-word-style.css',
  'template-judaica.css',
  'template-picker.css',
  'template-picker.js',
  'bridge_shim.js',
];

const PUBLIC_CACHE_BUST = {
  name: 'public-css-cache-bust',
  enforce: 'post',
  transformIndexHtml(html) {
    const v = String(Date.now());
    const files = PUBLIC_CACHE_BUST_FILES
      .map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const re = new RegExp(`(href|src)="([./\\/]*)(${files})"`, 'g');

    return html.replace(
      re,
      (m, attr, prefix, file) => `${attr}="${prefix || ''}${file}?v=${v}"`
    );
  },
};

export default defineConfig({
  base: BASE,
  plugins: [PUBLIC_CACHE_BUST],
})