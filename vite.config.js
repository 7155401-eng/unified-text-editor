import { build, defineConfig } from 'vite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

// V9 critical source patches must run even when the host calls `vite build`
// directly instead of `npm run build`. Several deployment providers allow the
// build command to bypass package.json prebuild hooks; importing these scripts
// here guarantees the generated bundle is built from the patched V9 source.
import './scripts/apply_v9_limit_full_strip3_one_line_patch.mjs'
import './scripts/apply_v9_column_continuation_flag_patch.mjs'
import './scripts/apply_v9_column_split_line_edge_guard_patch.mjs'
import './scripts/apply_v9_column_split_balance_and_expansion_patch.mjs'
import './scripts/apply_v9_stream_line_stretch_guard_patch.mjs'
import './scripts/apply_word_extractor_worker_freeze_patch.mjs'

// משה 2026-05-07: base relative ('./')כדי שמתאים גם ב-Vercel (root) וגם
// ב-GitHub Pages (subpath). אם נרצה נשנה בפקודת הבנייה.
const BASE = process.env.VITE_BASE || './'

// משה 2026-05-14: cache-busting גם ל-styles.css וגם לקבצי public שנקראים
// עם slash בתחילת הנתיב. זה מונע מצב שבו בדפדפן/Cloudflare ממשיכים להגיש
// CSS ישן ומובילים לרגרסיות "חצי מסך נעלם" אחרי תיקון שכבר מוזג ל-main.
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
          entry: 'worker/index.js',
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

    // Support both Cloudflare deployment modes:
    //
    // 1. Cloudflare Pages Git/Direct deployment expects Advanced Mode workers inside the
    //    output directory as `dist/_worker.js`.
    // 2. Wrangler Workers Static Assets can use `worker-dist/_worker.js` as `main` and
    //    `dist` as the assets directory.
    //
    // Keep both files. Hide the Pages copy from Wrangler's static asset upload
    // so it is not published as a public asset when `wrangler.jsonc` is used.
    mkdirSync('dist', { recursive: true });
    copyFileSync('worker-dist/_worker.js', 'dist/_worker.js');
    writeFileSync('dist/.assetsignore', '_worker.js\n', 'utf8');
  },
};

export default defineConfig({
  base: BASE,
  worker: {
    format: 'es',
  },
  plugins: [PUBLIC_CACHE_BUST, CLOUDFLARE_ADVANCED_WORKER_BUILD],
})
