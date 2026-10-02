const fs = require('fs');

const performanceComment = `/*
 * 💡 What: In-memory cache for configuration settings synchronized via storage events.
 * 🎯 Why: Avoids synchronous localStorage.getItem calls during tight layout/render loops.
 * 📊 Impact: Eliminates GC pressure and I/O bottlenecks in frequent reads.
 * 🔬 Measurement: Observe reduced main thread blocking in performance profiles during scrolling/rendering.
 */
`;

function patchSpacing() {
  const file = 'src/spacing_settings.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /let _spacingCacheRaw = null;\nlet _spacingCacheSnapshot = null;\nlet _spacingStoredSnapshot = null;/,
    `let _spacingCacheRaw = null;
let _spacingCacheSnapshot = null;
let _spacingStoredSnapshot = null;

${performanceComment}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      _spacingCacheRaw = null; // force read
    }
  });
}`
  );

  fs.writeFileSync(file, content);
}

function patchDocumentStyle() {
  const file = 'src/document_style_settings.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /let _documentStyleCacheRaw = null;\nlet _documentStyleCacheSnapshot = null;/,
    `let _documentStyleCacheRaw = null;
let _documentStyleCacheSnapshot = null;

${performanceComment}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      _documentStyleCacheRaw = null; // force read
    }
  });
}`
  );

  fs.writeFileSync(file, content);
}

function patchPageSettings() {
  const file = 'src/page_settings.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /let runtimeOutputBackgroundEphemeral = false;/,
    `let runtimeOutputBackgroundEphemeral = false;

${performanceComment}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (e) => {
    if (e.key === PAGE_SETTINGS_KEY || e.key === null) {
      runtimeMarginsRaw = undefined; // force read
    }
    if (e.key === OUTPUT_BACKGROUND_KEY || e.key === null) {
      runtimeOutputBackgroundRaw = undefined; // force read
    }
  });
}`
  );

  fs.writeFileSync(file, content);
}

function patchTest() {
  const file = 'tests/v9-unified/page-settings-cache.test.mjs';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /globalThis\.window = \{ __RAVTEXT_STORAGE_DISABLED__: false \};/,
    `globalThis.window = { __RAVTEXT_STORAGE_DISABLED__: false, addEventListener: () => {} };`
  );

  fs.writeFileSync(file, content);
}

patchSpacing();
patchDocumentStyle();
patchPageSettings();
patchTest();
console.log("Patched successfully");
