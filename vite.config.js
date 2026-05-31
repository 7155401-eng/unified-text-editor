import { build, defineConfig } from 'vite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

// V9 + DOCX patches must run even when the host calls `vite build` directly
// instead of `npm run build`. משה 2026-05-31: עברו ל-dynamic import עם
// try/catch — patches שה-anchor שלהם כבר לא קיים (כי הקוד בעצמו עודכן והם
// superseded) לא יפילו את כל ה-build, רק יראו warning. ה-fix עצמו ממילא
// קיים בקוד אז אין רגרסיה. הסדר נשמר כי כל await רץ סדרתית.
const _patches = [
  './scripts/apply_v9_limit_full_strip3_one_line_patch.mjs',
  './scripts/apply_v9_column_continuation_flag_patch.mjs',
  './scripts/apply_v9_column_split_line_edge_guard_patch.mjs',
  './scripts/apply_v9_column_split_balance_and_expansion_patch.mjs',
  './scripts/apply_v9_stream_line_stretch_guard_patch.mjs',
  './scripts/apply_word_extractor_worker_freeze_patch.mjs',
  './scripts/apply_docx_upload_debug_patch.mjs',
  './scripts/apply_docx_response_trim_patch.mjs',
  './scripts/apply_docx_uploadid_worker_core_patch.mjs',
  './scripts/apply_docx_uploadid_client_api_patch.mjs',
  './scripts/apply_docx_uploadid_splitter_menu_patch.mjs',
  './scripts/apply_docx_uploadid_runtime_guard_patch.mjs',
  './scripts/apply_docx_post_upload_button_handler_fallback_patch.mjs',
];
for (const p of _patches) {
  try { await import(p); }
  catch (e) { console.warn('[vite-config] patch skipped: ' + p + ' — ' + (e?.message || e)); }
}

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
