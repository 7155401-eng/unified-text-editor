import { execSync } from 'node:child_process'
import { build, defineConfig } from 'vite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

// Build is intentionally source-read-only. Historical apply_* migration scripts remain
// in scripts/ for audit/history, but runtime source must already contain their final state.

const BASE = process.env.VITE_BASE || './'

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
    const re = new RegExp(`(href|src)="([./\\/]*?)(${files})"`, 'g');

    return html.replace(
      re,
      (m, attr, prefix, file) => `${attr}="${prefix || ''}${file}?v=${v}"`
    );
  },
};

const PEIMOT_TIDIO_WIDGET = {
  name: 'peimot-tidio-widget',
  enforce: 'post',
  transformIndexHtml(html) {
    const tidioSrc = '//code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js';
    if (html.includes('code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js')) return html;

    const scriptTag = `     <script src="${tidioSrc}" async data-ravtext-peimot-tidio="1" data-widget-purpose="peimot-phone-capture"></script>`;
    if (html.includes('</head>')) return html.replace('</head>', `${scriptTag}\n  </head>`);

    return `${html}\n${scriptTag}\n`;
  },
};

const CLOUDFLARE_ADVANCED_WORKER_BUILD = {
  name: 'cloudflare-advanced-worker-build',
  apply: 'build',
  closeBundle: async () => {
    if (process.env.SKIP_CLOUDFLARE_WORKER_BUILD === '1') return;

    await build({
      configFile: false,
      publicDir: false,
      build: {
        target: 'es2022',
        outDir: 'worker-dist',
        emptyOutDir: true,
        minify: false,
        sourcemap: false,
        lib: {
          // חשוב: זה ה-entry שנבנה בפועל ל-dist/_worker.js בפריסת GitHub Pages.
          // wrangler.json אינו ה-entry של הפריסה הזו.
          entry: 'worker/index_diagnostics_live.js',
          formats: ['es'],
          fileName: () => '_worker.js',
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    });

    mkdirSync('dist', { recursive: true });
    copyFileSync('worker-dist/_worker.js', 'dist/_worker.js');
    writeFileSync('dist/.assetsignore', '_worker.js\n', 'utf8');
  },
};

// ★ משה 27/09/2026 — "שיהיה גירסה על כל ענף למעלה מספר גירסה כדי שנדע
// אם התעדכן משהו".
// המספר מ-package.json הוא 0.1.0 והוא לא משתנה בין דחיפה לדחיפה, ולכן
// אי אפשר לדעת ממנו אם הגרסה שעל המסך היא החדשה. כאן נצרב בזמן הבנייה
// גם מזהה הדחיפה הקצר וגם תאריך הבנייה — שניהם משתנים בכל פריסה, וכך
// אפשר לראות בעין אם מה שרואים הוא באמת העדכון האחרון.
const BUILD_STAMP = (() => {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return { sha, when };
  } catch (_) {
    // בנייה מחוץ לעותק גיט (למשל בשרת) — לא מפילים את הבנייה
    return { sha: '', when: new Date().toISOString().slice(0, 16).replace('T', ' ') };
  }
})();

export default defineConfig({
  base: BASE,
  build: {
    rollupOptions: {
      output: {
        // Keep only the user-triggered PDF lazy entry stable across deployments.
        // An editing tab can legitimately stay open while a new version is
        // deployed; its old main bundle must still be able to import PDF later.
        // Other chunks retain content hashes and normal immutable caching.
        chunkFileNames(chunkInfo) {
          return chunkInfo.name === 'pdf_export'
            ? 'assets/pdf_export.js'
            : 'assets/[name]-[hash].js';
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  define: {
    __RAVTEXT_BUILD_SHA__: JSON.stringify(BUILD_STAMP.sha),
    __RAVTEXT_BUILD_TIME__: JSON.stringify(BUILD_STAMP.when),
  },
  plugins: [PUBLIC_CACHE_BUST, PEIMOT_TIDIO_WIDGET, CLOUDFLARE_ADVANCED_WORKER_BUILD],
})
